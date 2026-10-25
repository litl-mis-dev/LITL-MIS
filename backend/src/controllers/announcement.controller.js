const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { notifyAnnouncement } = require('../services/notification.service')

const RECIPIENT_VALUES = ['MEMBERS', 'OFFICERS', 'BOTH']
const PRIORITY_VALUES = ['NORMAL', 'IMPORTANT']

function formatAnnouncement(announcement) {
  return {
    id:         announcement.id,
    title:      announcement.title,
    message:    announcement.message,
    recipients: announcement.recipients,
    priority:   announcement.priority,
    expiresAt:  announcement.expiresAt,
    createdAt:  announcement.createdAt,
  }
}

// ── Create announcement ─────────────────────────────────────────────────────
// Route-level roleGuard(ANNOUNCEMENT_MANAGERS) already restricts who can hit
// this endpoint at all — this is the real (backend) authorization check;
// the frontend button being hidden is not relied upon for security.
const createAnnouncement = async (req, res) => {
  try {
    const { title, message, recipients, priority = 'NORMAL', expiresAt } = req.body

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ message: 'Title and message are required.' })
    }

    if (!RECIPIENT_VALUES.includes(recipients)) {
      return res.status(400).json({ message: 'Recipients must be Members, Officers, or Both.' })
    }

    if (!PRIORITY_VALUES.includes(priority)) {
      return res.status(400).json({ message: 'Priority must be Normal or Important.' })
    }

    // Expiration only ever applies to Important announcements — a Normal
    // announcement has no pinned slot to expire from, so silently drop it
    // rather than trusting whatever the client sent.
    let expiresAtDate = null
    if (priority === 'IMPORTANT' && expiresAt) {
      const parsed = new Date(expiresAt)
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ message: 'Invalid expiration date.' })
      }
      if (parsed.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Expiration date must be in the future.' })
      }
      expiresAtDate = parsed
    }

    const announcement = await prisma.announcement.create({
      data: {
        title: title.trim(),
        message: message.trim(),
        recipients,
        priority,
        expiresAt: expiresAtDate,
        createdById: req.user.id,
      },
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ANNOUNCEMENT_SENT,
      details: { announcementId: announcement.id, title: announcement.title, recipients, priority },
    })

    notifyAnnouncement(announcement).catch((err) => logError('Notify announcement', err))

    return res.status(201).json({ message: 'Announcement sent.', announcement: formatAnnouncement(announcement) })
  } catch (err) {
    logError('Create announcement', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── List active Important Announcements for the caller ─────────────────────
// Scoped by the caller's effective role (so "view as member" shows what a
// member would see) and by expiration — an expired Important announcement
// simply stops being returned here, it is not deleted.
const listImportantAnnouncements = async (req, res) => {
  try {
    // The Developer is neither a member nor an officer — no audience applies.
    if (req.user.role === 'DEVELOPER') return res.json({ announcements: [] })

    const isMember = req.user.effectiveRole === 'MEMBER'
    const audienceValues = isMember ? ['MEMBERS', 'BOTH'] : ['OFFICERS', 'BOTH']

    const announcements = await prisma.announcement.findMany({
      where: {
        priority: 'IMPORTANT',
        recipients: { in: audienceValues },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ announcements: announcements.map(formatAnnouncement) })
  } catch (err) {
    logError('List important announcements', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { createAnnouncement, listImportantAnnouncements }