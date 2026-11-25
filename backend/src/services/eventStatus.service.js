const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { emitToAll } = require('../realtime/socket')
const { todayInOrgTimezone, timeInOrgTimezone } = require('../utils/schedule')
const { notifyEventStatusChanged } = require('./notification.service')

// An event's status follows its schedule (Philippine time):
//   Coming soon -> Open    at its date and start time
//   Open        -> Closed  at 11:59 PM that same day
// The server applies this every minute (utils/eventStatusJob.js) and whenever
// events are read, so it happens even when nobody has the site open.
//
// Officers can also change it by hand. Statuses that aren't final can go
// back; final ones are locked:
//   Coming soon -> Open or Cancelled
//   Open        -> Coming soon (rescheduled to a later start), Closed or Cancelled
//   Closed and Cancelled are final.

const STATUS_LABELS = { COMING_SOON: 'Coming soon', OPEN: 'Open', CLOSED: 'Closed', CANCELLED: 'Cancelled' }

const ALLOWED_STATUS_CHANGES = {
  COMING_SOON: ['OPEN', 'CANCELLED'],
  OPEN: ['COMING_SOON', 'CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
}

const CLOSING_TIME = '23:59'

const statusLabel = (status) => STATUS_LABELS[status] ?? status

// Why a manual change from `from` to `to` isn't allowed, or null when it is.
function statusChangeError(from, to) {
  if (from === to || ALLOWED_STATUS_CHANGES[from]?.includes(to)) return null
  if (from === 'CLOSED' || from === 'CANCELLED') {
    return `This event is ${statusLabel(from)}, so its status can no longer be changed.`
  }
  return `An event that is ${statusLabel(from)} can't be changed to ${statusLabel(to)}. Open it first.`
}

// True when the event's date and start time are still ahead (Philippine time).
function startsLater(date, time, now = new Date()) {
  const today = todayInOrgTimezone(now)
  return date > today || (date === today && time > timeInOrgTimezone(now))
}

// The status the schedule calls for, or null when the event should stay as it is.
function scheduledStatus(event, now = new Date()) {
  if (event.status !== 'COMING_SOON' && event.status !== 'OPEN') return null
  const today = todayInOrgTimezone(now)
  const time = timeInOrgTimezone(now)

  const dayIsOver = event.date < today || (event.date === today && time >= CLOSING_TIME)
  if (dayIsOver) return 'CLOSED'

  const hasStarted = event.date < today || (event.date === today && time >= event.time)
  if (event.status === 'COMING_SOON' && hasStarted) return 'OPEN'
  return null
}

// Moves every event whose time has come. Returns how many changed.
async function applyScheduledStatuses(now = new Date()) {
  const due = await prisma.event.findMany({
    where: { isArchived: false, status: { in: ['COMING_SOON', 'OPEN'] }, date: { lte: todayInOrgTimezone(now) } },
  })

  let changed = 0
  for (const event of due) {
    const next = scheduledStatus(event, now)
    if (!next) continue

    // Only if nobody changed it in the meantime (an officer, or another run).
    const { count } = await prisma.event.updateMany({ where: { id: event.id, status: event.status }, data: { status: next } })
    if (count === 0) continue
    changed++

    const from = statusLabel(event.status)
    const to = statusLabel(next)
    await writeAuditLog({
      actorId: null,
      action: AUDIT_ACTIONS.EVENT_STATUS_CHANGED,
      entity: { type: 'event', id: event.id },
      details: { eventId: event.id, title: event.title, from, to, automatic: true },
    })
    notifyEventStatusChanged({ ...event, status: next }, from, to)
      .catch((err) => logError('Notify scheduled event status', err, { eventId: event.id }))
    emitToAll('event:changed', { eventId: event.id, action: 'updated' })
  }
  return changed
}

module.exports = {
  STATUS_LABELS, ALLOWED_STATUS_CHANGES, CLOSING_TIME,
  statusLabel, statusChangeError, scheduledStatus, applyScheduledStatuses, startsLater,
}
