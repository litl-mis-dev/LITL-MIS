const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { emitToUser } = require('../realtime/socket')
const { sendPushToUser } = require('./push.service')
const { loadPermissions } = require('./permissions.service')
const { OFFICER_ROLES } = require('../utils/roles')

// ── Low-level helpers ───────────────────────────────────────────────────────

async function createNotification({ userId, type, title, message, link = null, groupKey = null }) {
  const notification = await prisma.notification.create({
    data: { userId, type, title, message, link, groupKey },
  })

  emitToUser(userId, 'notification:new', notification)
  sendPushToUser(userId, { title, message, link }).catch((err) =>
    logError('Push dispatch', err)
  )

  return notification
}

async function createNotificationForUsers(userIds, data) {
  await Promise.all(userIds.map((userId) => createNotification({ ...data, userId })))
}

async function getUserIdsWithModuleAccess(module, level = 'EDIT') {
  const map = await loadPermissions()
  const RANK = { NONE: 0, VIEW: 1, EDIT: 2 }
  const eligibleRoles = Object.keys(map).filter(
    (role) => RANK[map[role]?.[module] ?? 'NONE'] >= RANK[level]
  )
  if (eligibleRoles.length === 0) return []

  const users = await prisma.user.findMany({
    where: { role: { in: eligibleRoles }, status: 'APPROVED' },
    select: { id: true },
  })
  return users.map((u) => u.id)
}

// ── Member notifications ────────────────────────────────────────────────────

async function notifyRegistrationApproved(userId, memberName) {
  return createNotification({
    userId,
    type: 'REGISTRATION_APPROVED',
    title: 'Registration Approved',
    message: memberName
      ? `Congratulations, ${memberName}. Your membership registration has been approved, and your account is now active.`
      : 'Your membership registration has been approved, and your account is now active.',
    link: '/members',
  })
}

async function notifyRegistrationRejected(userId, memberName) {
  return createNotification({
    userId,
    type: 'REGISTRATION_REJECTED',
    title: 'Registration Not Approved',
    message: 'Your membership registration was not approved. Please contact an officer for further assistance.',
    link: '/',
  })
}

// ── Shared audience helpers ─────────────────────────────────────────────────

function parseAccess(access) {
  return typeof access === 'string' ? JSON.parse(access || '[]') : (access || [])
}

// "Officer" here means the same broad definition used everywhere else in the
// app (utils/roles.js) — every role except MEMBER. Event notifications go to
// ALL officers unconditionally; this is intentionally separate from the
// RBAC/access checks used for view permissions.
async function getApprovedOfficerIds() {
  const officers = await prisma.user.findMany({
    where: { role: { in: OFFICER_ROLES }, status: 'APPROVED' },
    select: { id: true },
  })
  return officers.map((o) => o.id)
}

async function getApprovedMemberIds() {
  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', status: 'APPROVED' },
    select: { id: true },
  })
  return members.map((m) => m.id)
}

function formatDateLabel(dateStr) {
  if (!dateStr) return dateStr
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

function formatTimeLabel(timeStr) {
  if (!timeStr) return timeStr
  const [h, min] = timeStr.split(':').map(Number)
  if (Number.isNaN(h)) return timeStr
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(min ?? 0).padStart(2, '0')} ${period}`
}

function joinParts(parts) {
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts.join(' and ')
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// ── Event notifications ─────────────────────────────────────────────────────
// Officers ALWAYS receive event notifications, regardless of the event's
// `access` setting — `access` only controls who can VIEW the event, never
// who gets notified. Members are only included when `access` includes
// "Members", since a member notification is meaningless if they can't open
// the event.

async function notifyEventCreated(event) {
  const access = parseAccess(event.access)

  const officerIds = await getApprovedOfficerIds()
  if (officerIds.length) {
    await createNotificationForUsers(officerIds, {
      type: 'EVENT_CREATED',
      title: 'New Event Created',
      message: `A new event, "${event.title}," has been created and added to the system.`,
      link: '/officers/events',
    })
  }

  if (access.includes('Members')) {
    const memberIds = await getApprovedMemberIds()
    if (memberIds.length) {
      await createNotificationForUsers(memberIds, {
        type: 'EVENT_CREATED',
        title: 'New Event Announced',
        message: `A new event, "${event.title}," has been announced. Please view the event details for more information.`,
        link: '/members/events',
      })
    }
  }
}

// Called when an edit newly adds "Members" to an event's access that didn't
// have it before. Only members are notified here — officers were already
// notified at creation regardless of access, so they must NOT be re-notified.
async function notifyEventAccessGrantedToMembers(event) {
  const memberIds = await getApprovedMemberIds()
  if (!memberIds.length) return

  await createNotificationForUsers(memberIds, {
    type: 'EVENT_CREATED',
    title: 'Event Now Available',
    message: `The event "${event.title}" is now available to members. Please view the event details for more information.`,
    link: '/members/events',
  })
}

// Formal, announcement-style wording based on the event's new status —
// mirrors how an official MIS would phrase a status change. `audience` only
// changes the verb used for the "Open" case; every other status uses
// identical wording for both members and officers.
function buildStatusAnnouncement(eventTitle, previousLabel, newLabel, audience) {
  switch (newLabel) {
    case 'Open':
      return {
        title: `${eventTitle} Is Now Open`,
        message: audience === 'officer'
          ? `${eventTitle} is now open. Members and officers may now proceed with the event.`
          : `${eventTitle} is now open. Members may now participate in the event.`,
      }
    case 'Closed':
      return {
        title: `${eventTitle} Is Now Closed`,
        message: `${eventTitle} is now closed. No further participation will be accepted.`,
      }
    case 'Cancelled':
      return {
        title: `${eventTitle} Has Been Cancelled`,
        message: `${eventTitle} has been cancelled. Please disregard any previously announced schedule for this event.`,
      }
    case 'Coming soon':
      return {
        title: `${eventTitle} Is Coming Soon`,
        message: `${eventTitle} is coming soon. Further details will be announced at a later time.`,
      }
    default:
      return {
        title: `${eventTitle} Status Updated`,
        message: `The status of "${eventTitle}" has been updated from ${previousLabel} to ${newLabel}.`,
      }
  }
}

async function notifyEventStatusChanged(event, previousLabel, newLabel) {
  if (previousLabel === newLabel) return // nothing actually changed

  const access = parseAccess(event.access)

  const officerAnnouncement = buildStatusAnnouncement(event.title, previousLabel, newLabel, 'officer')
  const officerIds = await getApprovedOfficerIds()
  if (officerIds.length) {
    await createNotificationForUsers(officerIds, {
      type: 'EVENT_STATUS_CHANGED',
      title: officerAnnouncement.title,
      message: officerAnnouncement.message,
      link: '/officers/events',
    })
  }

  if (access.includes('Members')) {
    const memberAnnouncement = buildStatusAnnouncement(event.title, previousLabel, newLabel, 'member')
    const memberIds = await getApprovedMemberIds()
    if (memberIds.length) {
      await createNotificationForUsers(memberIds, {
        type: 'EVENT_STATUS_CHANGED',
        title: memberAnnouncement.title,
        message: memberAnnouncement.message,
        link: '/members/events',
      })
    }
  }
}

// `changes` is an object built by the controller from an actual before/after
// diff — e.g. { date: {from, to}, time: {from, to}, location: {from, to} }.
// Only keys that are present (i.e. actually changed) generate message parts,
// and if nothing changed this is a no-op — avoids unnecessary notifications.
async function notifyEventUpdated(event, changes) {
  const parts = []
  if (changes.date) {
    parts.push(`the event date has been changed from ${formatDateLabel(changes.date.from)} to ${formatDateLabel(changes.date.to)}`)
  }
  if (changes.time) {
    parts.push(`the event time has been changed from ${formatTimeLabel(changes.time.from)} to ${formatTimeLabel(changes.time.to)}`)
  }
  if (changes.location) {
    parts.push(`the event location has been changed from "${changes.location.from}" to "${changes.location.to}"`)
  }
  if (parts.length === 0) return // nothing meaningful changed — don't notify

  const message = `The details of "${event.title}" have been updated. ${capitalize(joinParts(parts))}.`
  const access = parseAccess(event.access)

  const officerIds = await getApprovedOfficerIds()
  if (officerIds.length) {
    await createNotificationForUsers(officerIds, {
      type: 'EVENT_UPDATED',
      title: 'Event Details Updated',
      message,
      link: '/officers/events',
    })
  }

  if (access.includes('Members')) {
    const memberIds = await getApprovedMemberIds()
    if (memberIds.length) {
      await createNotificationForUsers(memberIds, {
        type: 'EVENT_UPDATED',
        title: 'Event Details Updated',
        message,
        link: '/members/events',
      })
    }
  }
}

// ── Officer notification: grouped member-approval requests ─────────────────
// Instead of one notification per pending user, every officer with EDIT on
// MEMBERS_APPROVAL gets a single notification row (identified by groupKey)
// that is updated in place to reflect the current pending count. Call this
// any time the pending list changes (new registration, approve, reject).
async function syncMemberApprovalNotifications() {
  const GROUP_KEY = 'member-approval-pending'

  const pending = await prisma.user.findMany({
    where: { status: 'PENDING_OFFICER_APPROVAL' },
    select: {
      id: true,
      member: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const officerIds = await getUserIdsWithModuleAccess('MEMBERS_APPROVAL', 'EDIT')
  if (officerIds.length === 0) return

  if (pending.length === 0) {
    await prisma.notification.deleteMany({ where: { groupKey: GROUP_KEY, userId: { in: officerIds } } })
    return
  }

  const firstName = pending[0].member
    ? `${pending[0].member.firstName} ${pending[0].member.lastName}`
    : 'A member'

  const message =
    pending.length === 1
      ? `${firstName} has submitted a registration request awaiting your approval.`
      : `${firstName} and ${pending.length - 1} other${pending.length - 1 > 1 ? 's' : ''} have submitted registration requests awaiting your approval.`

  await Promise.all(
    officerIds.map(async (userId) => {
      const existing = await prisma.notification.findFirst({
        where: { userId, groupKey: GROUP_KEY },
      })

      let notification
      if (existing) {
        notification = await prisma.notification.update({
          where: { id: existing.id },
          data: { message, isRead: false, updatedAt: new Date() },
        })
      } else {
        notification = await prisma.notification.create({
          data: {
            userId,
            type: 'MEMBER_APPROVAL_REQUEST',
            title: 'Pending Member Approval Requests',
            message,
            link: '/officers/members-list',
            groupKey: GROUP_KEY,
          },
        })
      }

      emitToUser(userId, 'notification:new', notification)
      sendPushToUser(userId, { title: notification.title, message, link: notification.link }).catch(
        (err) => logError('Push dispatch (member approval)', err)
      )
    })
  )
}

// ── Audit notifications ──────────────────────────────────────────────────
const AUDIT_STATUS_LABELS = {
  PENDING: 'Pending',
  REVIEW: 'For Review',
  FOR_CLARIFICATION: 'For Clarification',
  CLEARED: 'Cleared',
}

async function notifyAuditStatusChanged(subjectLabel, previousStatus, newStatus, link = '/officers/audit') {
  if (previousStatus === newStatus) return

  const previousLabel = AUDIT_STATUS_LABELS[previousStatus] ?? previousStatus
  const newLabel = AUDIT_STATUS_LABELS[newStatus] ?? newStatus

  const officerIds = await getUserIdsWithModuleAccess('AUDIT', 'VIEW')
  if (officerIds.length === 0) return

  await createNotificationForUsers(officerIds, {
    type: 'AUDIT_STATUS_CHANGED',
    title: 'Audit Status Updated',
    message: `${subjectLabel}: ${previousLabel} → ${newLabel}`,
    link,
  })
}

// ── Custom announcements ────────────────────────────────────────────────────
async function notifyAnnouncement(announcement) {
  const { recipients, title, message } = announcement

  let userIds = []
  if (recipients === 'MEMBERS' || recipients === 'BOTH') {
    userIds = userIds.concat(await getApprovedMemberIds())
  }
  if (recipients === 'OFFICERS' || recipients === 'BOTH') {
    userIds = userIds.concat(await getApprovedOfficerIds())
  }
  if (userIds.length === 0) return

  await createNotificationForUsers(userIds, {
    type: 'ANNOUNCEMENT',
    title,
    message,
  })
}

module.exports = {
  createNotification,
  createNotificationForUsers,
  getUserIdsWithModuleAccess,
  notifyRegistrationApproved,
  notifyRegistrationRejected,
  notifyEventCreated,
  notifyEventAccessGrantedToMembers,
  notifyEventStatusChanged,
  notifyEventUpdated,
  notifyAuditStatusChanged,
  syncMemberApprovalNotifications,
  notifyAnnouncement,
}