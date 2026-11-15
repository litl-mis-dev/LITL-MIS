const { logInfo, logError } = require('./logger')

const prisma = require('../lib/prisma')

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000 // every 15 minutes

const storageService = require('../services/storage.service')

const TRASH_RETENTION_DAYS = 30

// Google Drive-style retention: anything left in Temporary for more than
// TRASH_RETENTION_DAYS is permanently deleted, files included.
const cleanupExpiredTrashedDocuments = async () => {
  try {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const expired = await prisma.documentItem.findMany({
      where: { isTrashed: true, trashedAt: { lt: cutoff } },
      select: { id: true, storagePath: true },
    })
    if (expired.length === 0) return

    await prisma.documentItem.deleteMany({ where: { id: { in: expired.map((d) => d.id) } } })

    await storageService.deleteFiles(expired.map((d) => d.storagePath))

    logInfo('Cleanup: purged expired trashed documents', { count: expired.length })
  } catch (err) {
    logError('Cleanup: trashed documents failed', err)
  }
}

const cleanupExpiredPendingRegistrations = async () => {
  try {
    const result = await prisma.pendingRegistration.deleteMany({
      where: { otpExpiresAt: { lt: new Date() } }
    })
    if (result.count > 0) {
      logInfo('Cleanup: removed expired pending registrations', { count: result.count })
    }
  } catch (err) {
    logError('Cleanup: pending registrations failed', err)
  }
}

const cleanupOldOtps = async () => {
  try {
    // Remove OTP rows that are expired AND already used, or expired for more than a day
    // (kept briefly for any debugging/audit needs, then purged)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const result = await prisma.otp.deleteMany({
      where: { expiresAt: { lt: cutoff } }
    })
    if (result.count > 0) {
      logInfo('Cleanup: removed old OTP records', { count: result.count })
    }
  } catch (err) {
    logError('Cleanup: OTP records failed', err)
  }
}

// Notifications already read and untouched for this long are deleted, so the
// table doesn't grow forever. Unread ones are never deleted. Once a day is
// enough; the 15-minute job skips it in between.
const NOTIFICATION_RETENTION_DAYS = 90
const NOTIFICATION_CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000
let lastNotificationCleanupAt = 0

const cleanupOldReadNotifications = async (now = Date.now()) => {
  if (now - lastNotificationCleanupAt < NOTIFICATION_CLEANUP_EVERY_MS) return
  lastNotificationCleanupAt = now
  try {
    const cutoff = new Date(now - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    // updatedAt, not createdAt: a grouped notification (pending approvals)
    // is updated in place and counts as new each time.
    const result = await prisma.notification.deleteMany({
      where: { isRead: true, updatedAt: { lt: cutoff } }
    })
    if (result.count > 0) {
      logInfo('Cleanup: removed old read notifications', { count: result.count })
    }
  } catch (err) {
    logError('Cleanup: old notifications failed', err)
  }
}

const startCleanupJob = () => {
  // Run once on startup, then on the configured interval
  cleanupExpiredPendingRegistrations()
  cleanupOldOtps()
  cleanupExpiredTrashedDocuments()
  cleanupOldReadNotifications()

  setInterval(() => {
    cleanupExpiredPendingRegistrations()
    cleanupOldOtps()
    cleanupExpiredTrashedDocuments()
    cleanupOldReadNotifications()
  }, CLEANUP_INTERVAL_MS)

  logInfo('Cleanup job started', { intervalMinutes: CLEANUP_INTERVAL_MS / 60000 })
}

module.exports = {
  startCleanupJob, cleanupExpiredPendingRegistrations, cleanupOldOtps, cleanupExpiredTrashedDocuments,
  cleanupOldReadNotifications, NOTIFICATION_RETENTION_DAYS,
}