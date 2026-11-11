const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { notifyAnnouncement } = require('../services/notification.service')
const { positionLabel } = require('../utils/roles')

const RECIPIENT_VALUES = ['MEMBERS', 'OFFICERS', 'BOTH']
const PRIORITY_VALUES = ['NORMAL', 'IMPORTANT']
// Same limits as the Create Announcement form (MembersList.jsx).
const MAX_TITLE_LENGTH = 120
const MAX_MESSAGE_LENGTH = 1000

// Every Important announcement stays pinned for exactly this long.
const IMPORTANT_ANNOUNCEMENT_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const CREATED_BY_SELECT = {
  select: {
    role: true,
    adviserTitle: true,
    member: { select: { firstName: true, lastName: true, suffix: true } },
  },
}

function formatCreatedBy(user) {
  if (!user) return null
  const name = [user.member?.firstName, user.member?.lastName, user.member?.suffix].filter(Boolean).join(' ')
  const position = positionLabel(user)
  return { name: name || position, position }
}

function formatAnnouncement(announcement) {
  return {
    id:         announcement.id,
    title:      announcement.title,
    message:    announcement.message,
    recipients: announcement.recipients,
    priority:   announcement.priority,
    expiresAt:  announcement.expiresAt,
    createdAt:  announcement.createdAt,
    createdBy:  formatCreatedBy(announcement.createdBy),
  }
}

// Which recipient groups a user belongs to. Officers who also have a Member
// side see member announcements while viewing as a member, the same rule
// the Important Announcements list uses.
function audienceFor(user) {
  const values = new Set(['BOTH'])
  if (user.role === 'MEMBER' || user.effectiveRole === 'MEMBER') values.add('MEMBERS')
  if (user.role !== 'MEMBER') values.add('OFFICERS')
  return values
}

// ── Create announcement ─────────────────────────────────────────────────────
// Route-level roleGuard(ANNOUNCEMENT_MANAGERS) already restricts who can hit
// this endpoint at all — this is the real (backend) authorization check;
// the frontend button being hidden is not relied upon for security.
const createAnnouncement = async (req, res) => {
  try {
    const { title, message, recipients, priority = 'NORMAL' } = req.body

    if (typeof title !== 'string' || typeof message !== 'string' || !title.trim() || !message.trim()) {
      return res.status(400).json({ message: 'Title and message are required.' })
    }
    if (title.trim().length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ message: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` })
    }
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` })
    }

    if (!RECIPIENT_VALUES.includes(recipients)) {
      return res.status(400).json({ message: 'Recipients must be Members, Officers, or Both.' })
    }

    if (!PRIORITY_VALUES.includes(priority)) {
      return res.status(400).json({ message: 'Priority must be Normal or Important.' })
    }

    // Expiration only ever applies to Important announcements, and is always
    // 7 days from now — a Normal announcement has no pinned slot to expire from.
    const expiresAtDate = priority === 'IMPORTANT'
      ? new Date(Date.now() + IMPORTANT_ANNOUNCEMENT_DAYS * DAY_MS)
      : null

    const announcement = await prisma.announcement.create({
      data: {
        title: title.trim(),
        message: message.trim(),
        recipients,
        priority,
        expiresAt: expiresAtDate,
        createdById: req.user.id,
      },
      include: { createdBy: CREATED_BY_SELECT },
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

// A payment reminder sent to this user is pinned with the Important
// Announcements for 7 days, like an Important announcement. It comes from
// the reminder's own notification row, so there is no separate record.
async function listPinnedPaymentReminders(userId) {
  const since = new Date(Date.now() - IMPORTANT_ANNOUNCEMENT_DAYS * DAY_MS)
  const reminders = await prisma.notification.findMany({
    where: { userId, type: 'PAYMENT_REMINDER', createdAt: { gt: since } },
    orderBy: { createdAt: 'desc' },
    take: 1, // only the latest reminder matters
  })
  return reminders.map((n) => ({
    id:         `payment-reminder-${n.id}`,
    kind:       'PAYMENT_REMINDER',
    title:      n.title,
    message:    n.message,
    recipients: 'MEMBERS',
    priority:   'IMPORTANT',
    expiresAt:  new Date(n.createdAt.getTime() + IMPORTANT_ANNOUNCEMENT_DAYS * DAY_MS),
    createdAt:  n.createdAt,
    createdBy:  null,
  }))
}

// ── List active Important Announcements for the caller ─────────────────────
// Scoped by the caller's effective role (so "view as member" shows what a
// member would see) and by expiration — an expired Important announcement
// simply stops being returned here, it is not deleted. The caller's own
// payment reminder from the last 7 days is listed first.
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
      include: { createdBy: CREATED_BY_SELECT },
      orderBy: { createdAt: 'desc' },
    })
    const reminders = await listPinnedPaymentReminders(req.user.id)

    return res.json({ announcements: [...reminders, ...announcements.map(formatAnnouncement)] })
  } catch (err) {
    logError('List important announcements', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Get one announcement ────────────────────────────────────────────────────
// Opened from a notification or the pinned list. Only users in the
// announcement's recipient group may read it.
const getAnnouncement = async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ message: 'Announcement not found.' })
    }

    const announcement = await prisma.announcement.findUnique({
      where: { id },
      include: { createdBy: CREATED_BY_SELECT },
    })
    if (!announcement || req.user.role === 'DEVELOPER' || !audienceFor(req.user).has(announcement.recipients)) {
      return res.status(404).json({ message: 'Announcement not found.' })
    }

    return res.json({ announcement: formatAnnouncement(announcement) })
  } catch (err) {
    logError('Get announcement', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { createAnnouncement, listImportantAnnouncements, getAnnouncement, IMPORTANT_ANNOUNCEMENT_DAYS }