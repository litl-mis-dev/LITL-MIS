const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { OFFICER_ROLES: OFFICER_ROLE_LIST, NON_MEMBER_ROLES, DEVELOPER_ROLE } = require('../utils/roles')
const { ensureEventCertificationFolder } = require('./certification.controller')
const {
  notifyEventCreated, notifyEventStatusChanged,
  notifyEventUpdated, notifyEventAccessGrantedToMembers,
} = require('../services/notification.service')
const { emitToAll, emitToOfficers } = require('../realtime/socket')
const { validateScheduleDate, validateScheduleTime } = require('../utils/schedule')
const { RETURNS_SUMMARY_INCLUDE, summarizeReturns } = require('../services/calculations.service')

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_TO_LABEL = {
  COMING_SOON: 'Coming soon',
  OPEN:        'Open',
  CLOSED:      'Closed',
  CANCELLED:   'Cancelled',
}

const LABEL_TO_STATUS = {
  'Coming soon': 'COMING_SOON',
  'Open':        'OPEN',
  'Closed':      'CLOSED',
  'Cancelled':   'CANCELLED',
}

// The disbursement funding an event, with what is needed for its budget.
const EVENT_INCLUDE = {
  _count: { select: { attendances: true } },
  disbursement: {
    select: { id: true, reference: true, titleOfActivities: true, amount: true, ...RETURNS_SUMMARY_INCLUDE },
  },
}

// An event funded by a disbursement shows that disbursement's amount spent as
// its budget, so recording the amount spent updates it too. Events from
// before budgets were linked keep the amount typed in.
function eventBudget(event) {
  if (event.disbursement) return summarizeReturns(event.disbursement).amountSpent
  return event.budget == null ? null : event.budget.toFixed(2)
}

// Only officers see which disbursement funds an event; members see the budget.
function formatEvent(event, { withDisbursement = false } = {}) {
  return {
    id:           event.id,
    title:        event.title,
    date:         event.date,
    time:         event.time,
    location:     event.location,
    Proponent:    event.proponent,   // capital P — matches frontend field name
    description:  event.description,
    status:       STATUS_TO_LABEL[event.status] ?? event.status,
    access:       JSON.parse(event.access || '[]'),
    hasGoogleForm: event.hasGoogleForm,
    googleFormUrl: event.googleFormUrl ?? '',
    createdAt:    event.createdAt,
    budget:       eventBudget(event),
    attendanceCount: event._count?.attendances ?? 0,
    ...(withDisbursement && {
      disbursementId: event.disbursementId ?? null,
      disbursement: event.disbursement && {
        id:          event.disbursement.id,
        reference:   event.disbursement.reference,
        title:       event.disbursement.titleOfActivities,
        amountSpent: summarizeReturns(event.disbursement).amountSpent,
      },
    }),
  }
}

// Returns { absent: true } when the request leaves the link alone, { value }
// with the disbursement ID or null (no disbursement yet), or { error }.
function parseDisbursementId(raw) {
  if (raw === undefined) return { absent: true }
  if (raw === null || raw === '') return { value: null }
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return { error: 'Choose a valid disbursement.' }
  return { value: id }
}

// A disbursement funds one event, and only one from the current school year
// can be newly chosen. Returns an error message, or null when it's allowed.
async function disbursementUnavailableReason(disbursementId, eventId = null) {
  const disbursement = await prisma.disbursement.findUnique({
    where: { id: disbursementId },
    include: { semester: { select: { schoolYear: true } }, event: { select: { id: true, title: true } } },
  })
  if (!disbursement || disbursement.isArchived) return 'That disbursement is not available.'
  if (disbursement.event && disbursement.event.id !== eventId) {
    return `That disbursement already funds the event "${disbursement.event.title}".`
  }
  if (disbursement.event) return null // already this event's
  const activeSemester = await prisma.semester.findFirst({ where: { isActive: true }, select: { schoolYear: true } })
  if (!activeSemester || disbursement.semester.schoolYear !== activeSemester.schoolYear) {
    return 'Only disbursements from the current school year can be chosen.'
  }
  return null
}

const isDisbursementTaken = (err) => err?.code === 'P2002' && String(err.meta?.target ?? '').includes('disbursementId')

// Events are listed by status — Open, Coming soon, Closed, Cancelled — and
// by date and time (soonest first) within the same status.
const STATUS_SORT_ORDER = { OPEN: 0, COMING_SOON: 1, CLOSED: 2, CANCELLED: 3 }

function compareEvents(a, b) {
  return (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99)
    || a.date.localeCompare(b.date)
    || a.time.localeCompare(b.time)
    || a.id - b.id
}

const MAX_BUDGET = 99999999.99 // DECIMAL(10, 2)

// Returns { value } with the budget as a 2-decimal string, or { error }.
function parseBudget(raw) {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { error: 'Budget must be a number with up to 2 decimal places.' }
  }
  const amount = Number(text)
  if (amount > MAX_BUDGET) return { error: 'Budget is too large.' }
  return { value: amount.toFixed(2) }
}

function parseStatus(raw) {
  return LABEL_TO_STATUS[raw] ?? 'COMING_SOON'
}

async function resolveAccessTier(userId, effectiveRole) {
  if (effectiveRole === 'MEMBER') return 'MEMBER'
  if (OFFICER_ROLE_LIST.includes(effectiveRole)) return 'OFFICER'
  return 'NONE'
}


// ── List events ───────────────────────────────────────────────────────────────
// Members see only events that include "Members" in their access list.
// Officers see all events.

const listEvents = async (req, res) => {
  try {
    const tier = await resolveAccessTier(req.user.id, req.user.effectiveRole)

    const events = await prisma.event.findMany({
      where: tier === 'OFFICER'
        ? { isArchived: false }
        : { isArchived: false, access: { contains: '"Members"' } },
      include: EVENT_INCLUDE,
    })

    const withDisbursement = tier === 'OFFICER'
    return res.json({ events: events.sort(compareEvents).map((e) => formatEvent(e, { withDisbursement })) })
  } catch (err) {
    logError('List events', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const getEvent = async (req, res) => {
  try {
    const id   = Number(req.params.id)
    const tier = await resolveAccessTier(req.user.id, req.user.effectiveRole)

    const event = await prisma.event.findUnique({
      where: { id },
      include: EVENT_INCLUDE
    })

    if (!event || event.isArchived) {
      return res.status(404).json({ message: 'Event not found.' })
    }

    if (tier !== 'OFFICER') {
      const access = JSON.parse(event.access || '[]')
      if (!access.includes('Members')) {
        return res.status(403).json({ message: 'You do not have access to this event.' })
      }
    }

    return res.json({ event: formatEvent(event, { withDisbursement: tier === 'OFFICER' }) })
  } catch (err) {
    logError('Get event', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Create event ──────────────────────────────────────────────────────────────

const createEvent = async (req, res) => {
  try {
    const {
      title, date, time, location,
      Proponent: proponent,
      description, status, access, hasGoogleForm, googleFormUrl, budget, disbursementId
    } = req.body

    if (!title?.trim() || !date || !time || !location?.trim() || !proponent?.trim() || !description?.trim()) {
      return res.status(400).json({ message: 'All required fields must be filled.' })
    }

    const scheduleError = validateScheduleDate(date) || validateScheduleTime(time)
    if (scheduleError) return res.status(400).json({ message: scheduleError })

    // The budget comes from the chosen disbursement, or is "Not set" until
    // one is chosen. A typed budget is still accepted from older clients.
    const parsedDisbursement = parseDisbursementId(disbursementId)
    if (parsedDisbursement.error) return res.status(400).json({ message: parsedDisbursement.error })
    const linkedDisbursementId = parsedDisbursement.value ?? null
    if (linkedDisbursementId) {
      const reason = await disbursementUnavailableReason(linkedDisbursementId)
      if (reason) return res.status(400).json({ message: reason })
    }
    let parsedBudget = { value: null }
    if (!linkedDisbursementId && budget !== undefined && budget !== null && budget !== '') {
      parsedBudget = parseBudget(budget)
      if (parsedBudget.error) return res.status(400).json({ message: parsedBudget.error })
    }

    if (!Array.isArray(access) || access.length === 0) {
      return res.status(400).json({ message: 'At least one access group must be selected.' })
    }

    const event = await prisma.event.create({
      data: {
        title:        title.trim(),
        date,
        time,
        location:     location.trim(),
        proponent:    proponent.trim(),
        description:  description.trim(),
        status:       parseStatus(status),
        access:       JSON.stringify(access),
        hasGoogleForm: Boolean(hasGoogleForm),
        googleFormUrl: hasGoogleForm ? (googleFormUrl?.trim() || null) : null,
        budget:        parsedBudget.value,
        disbursementId: linkedDisbursementId,
        createdById:   req.user.id,
      },
      include: EVENT_INCLUDE
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.EVENT_CREATED,
      details: { eventId: event.id, title: event.title }
    })

    notifyEventCreated(event).catch((err) => logError('Notify event created', err))

    // Auto-create this event's certification folder under the current
    // academic year's archive — officers never create this by hand.
    await ensureEventCertificationFolder(event, req.user.id).catch((err) => {
      logError('Auto-create event certification folder', err)
    })

    emitToAll('event:changed', { eventId: event.id, action: 'created' })

    return res.status(201).json({ message: 'Event created.', event: formatEvent(event, { withDisbursement: true }) })
  } catch (err) {
    if (isDisbursementTaken(err)) {
      return res.status(409).json({ message: 'That disbursement was just chosen for another event. Choose another.' })
    }
    logError('Create event', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Update event ──────────────────────────────────────────────────────────────
const updateEvent = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const existing = await prisma.event.findUnique({ where: { id } })
    if (!existing || existing.isArchived) {
      return res.status(404).json({ message: 'Event not found.' })
    }

    const {
      title, date, time, location,
      Proponent: proponent,
      description, status, access, hasGoogleForm, googleFormUrl, budget, disbursementId
    } = req.body

    if (Array.isArray(access) && access.length === 0) {
      return res.status(400).json({ message: 'At least one access group must be selected.' })
    }

    // Only a changed date/time is checked, so an event whose date has passed
    // can still be edited (e.g. to close it) without being rescheduled.
    if (date && date !== existing.date) {
      const dateError = validateScheduleDate(date)
      if (dateError) return res.status(400).json({ message: dateError })
    }
    if (time && time !== existing.time) {
      const timeError = validateScheduleTime(time)
      if (timeError) return res.status(400).json({ message: timeError })
    }

    let budgetValue
    if (budget !== undefined && budget !== null && budget !== '') {
      const parsedBudget = parseBudget(budget)
      if (parsedBudget.error) return res.status(400).json({ message: parsedBudget.error })
      budgetValue = parsedBudget.value
    } else if (existing.budget != null && budget !== undefined) {
      return res.status(400).json({ message: 'Budget is required.' })
    }

    const parsedDisbursement = parseDisbursementId(disbursementId)
    if (parsedDisbursement.error) return res.status(400).json({ message: parsedDisbursement.error })
    if (parsedDisbursement.value) {
      const reason = await disbursementUnavailableReason(parsedDisbursement.value, id)
      if (reason) return res.status(400).json({ message: reason })
    }

    const updated = await prisma.event.update({
      where: { id },
      data: {
        ...(title        && { title: title.trim() }),
        ...(date         && { date }),
        ...(time         && { time }),
        ...(location     && { location: location.trim() }),
        ...(proponent    && { proponent: proponent.trim() }),
        ...(description  && { description: description.trim() }),
        ...(status       && { status: parseStatus(status) }),
        ...(access       && { access: JSON.stringify(access) }),
        ...(hasGoogleForm !== undefined && { hasGoogleForm: Boolean(hasGoogleForm) }),
        googleFormUrl: hasGoogleForm ? (googleFormUrl?.trim() || null) : null,
        ...(budgetValue !== undefined && { budget: budgetValue }),
        ...(!parsedDisbursement.absent && { disbursementId: parsedDisbursement.value }),
      },
      include: EVENT_INCLUDE
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.EVENT_UPDATED,
      details: { eventId: id, title: updated.title }
    })

    // ── Notification diffing — based on the ACTUAL persisted before/after
    // values, never on whether a field happened to be present in the
    // request body. This guarantees no notification fires for a field that
    // didn't really change.
    const statusChanged = existing.status !== updated.status
    if (statusChanged) {
      notifyEventStatusChanged(
        updated,
        STATUS_TO_LABEL[existing.status] ?? existing.status,
        STATUS_TO_LABEL[updated.status] ?? updated.status
      ).catch((err) => logError('Notify event status changed', err))
    }

    const infoChanges = {}
    if (existing.date !== updated.date) infoChanges.date = { from: existing.date, to: updated.date }
    if (existing.time !== updated.time) infoChanges.time = { from: existing.time, to: updated.time }
    if (existing.location !== updated.location) infoChanges.location = { from: existing.location, to: updated.location }

    if (Object.keys(infoChanges).length > 0) {
      notifyEventUpdated(updated, infoChanges).catch((err) => logError('Notify event updated', err))
    }

    // Members newly granted access (event previously wasn't visible to
    // members, now it is) get an "event available" notice. Officers are
    // deliberately NOT re-notified here — they already received the
    // event-created notification regardless of access.
    const previousAccess = JSON.parse(existing.access || '[]')
    const newAccess = JSON.parse(updated.access || '[]')
    const membersNewlyGranted = !previousAccess.includes('Members') && newAccess.includes('Members')

    if (membersNewlyGranted) {
      notifyEventAccessGrantedToMembers(updated).catch((err) => logError('Notify event access granted', err))
    }

    emitToAll('event:changed', { eventId: id, action: 'updated' })

    return res.json({ message: 'Event updated.', event: formatEvent(updated, { withDisbursement: true }) })
  } catch (err) {
    if (isDisbursementTaken(err)) {
      return res.status(409).json({ message: 'That disbursement was just chosen for another event. Choose another.' })
    }
    logError('Update event', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Disbursements an event can be funded by ──────────────────────────────────
// GET /events/available-disbursements?eventId=… — for the Budget dropdown.
// Needs Event EDIT, not Financial access, so it returns only what the
// dropdown shows: no signatories or other financial details.
const listAvailableDisbursements = async (req, res) => {
  try {
    const eventId = req.query.eventId ? Number(req.query.eventId) : null
    if (eventId !== null && (!Number.isInteger(eventId) || eventId <= 0)) {
      return res.status(400).json({ message: 'Invalid event.' })
    }
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true }, select: { schoolYear: true } })
    if (!activeSemester) return res.json({ disbursements: [] })

    const disbursements = await prisma.disbursement.findMany({
      where: {
        isArchived: false,
        OR: [
          { semester: { schoolYear: activeSemester.schoolYear }, event: { is: null } },
          ...(eventId ? [{ event: { is: { id: eventId } } }] : []),
        ],
      },
      select: { id: true, reference: true, titleOfActivities: true, amount: true, ...RETURNS_SUMMARY_INCLUDE },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({
      disbursements: disbursements.map((d) => ({
        id:          d.id,
        reference:   d.reference,
        title:       d.titleOfActivities,
        amountSpent: summarizeReturns(d).amountSpent,
      })),
    })
  } catch (err) {
    logError('List available disbursements', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Archive event (soft delete) ───────────────────────────────────────────────

const archiveEvent = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const event = await prisma.event.findUnique({ where: { id } })
    if (!event || event.isArchived) {
      return res.status(404).json({ message: 'Event not found.' })
    }

    await prisma.event.update({ where: { id }, data: { isArchived: true } })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.EVENT_ARCHIVED,
      details: { eventId: id, title: event.title }
    })

    emitToAll('event:changed', { eventId: id, action: 'archived' })

    return res.json({ message: 'Event archived.' })
  } catch (err) {
    logError('Archive event', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Record QR attendance ──────────────────────────────────────────────────────

const recordAttendance = async (req, res) => {
  try {
    const eventId = Number(req.params.id)
    const { qrCode } = req.body

    if (!qrCode?.trim()) {
      return res.status(400).json({ message: 'QR code is required.' })
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event || event.isArchived) {
      return res.status(404).json({ message: 'Event not found.' })
    }

    // Advisers are not members — they can't be checked in as attendees.
    const scannedLines = qrCode.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)
    const scannedStudentNumber = scannedLines[scannedLines.length - 1]
    if (scannedStudentNumber) {
      const scannedUser = await prisma.user.findUnique({
        where: { studentNumber: scannedStudentNumber },
        select: { role: true }
      })
      if (scannedUser && NON_MEMBER_ROLES.includes(scannedUser.role)) {
        return res.status(400).json({ message: 'Advisers are not members and cannot be checked in as attendees.' })
      }
      if (scannedUser?.role === DEVELOPER_ROLE) {
        return res.status(400).json({ message: 'The Developer account is not a member and cannot be checked in.' })
      }
    }

    // Duplicate check — @@unique([eventId, qrCode]) will also catch this at DB level
    const existing = await prisma.eventAttendance.findUnique({
      where: { eventId_qrCode: { eventId, qrCode: qrCode.trim() } }
    })
    if (existing) {
      return res.status(409).json({ message: 'This QR code is already checked in for this event.' })
    }

    const attendance = await prisma.eventAttendance.create({
      data: { eventId, qrCode: qrCode.trim() }
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ATTENDANCE_RECORDED,
      details: { eventId, eventTitle: event.title, qrCode: qrCode.trim() }
    })

    emitToOfficers('attendance:changed', { eventId })

    return res.status(201).json({ message: 'Attendance recorded.', attendance })
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ message: 'This QR code is already checked in for this event.' })
    }
    logError('Record attendance', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Get attendance list ───────────────────────────────────────────────────────

const getAttendance = async (req, res) => {
  try {
    const eventId = Number(req.params.id)
    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event || event.isArchived) {
      return res.status(404).json({ message: 'Event not found.' })
    }

    const attendances = await prisma.eventAttendance.findMany({
      where: { eventId },
      orderBy: { checkedInAt: 'desc' }
    })

    // Resolve each qrCode to a real member by matching studentNumber
    // The QR payload is "Full Name\nStudentNumber" — extract the student number
    const studentNumberOf = (qrCode) => {
      const lines = qrCode.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
      return lines[lines.length - 1] ?? null
    }
    const studentNumbers = [...new Set(attendances.map((a) => studentNumberOf(a.qrCode)).filter(Boolean))]

    const users = studentNumbers.length === 0 ? [] : await prisma.user.findMany({
      where: { studentNumber: { in: studentNumbers } },
      select: {
        studentNumber: true,
        member: {
          select: { firstName: true, middleName: true, lastName: true, suffix: true, yearLevel: true, section: true }
        }
      }
    })
    const userByStudentNumber = new Map(users.map((u) => [u.studentNumber, u]))

    const enriched = attendances.map((a) => {
      const user = userByStudentNumber.get(studentNumberOf(a.qrCode))
      let member = null
      if (user?.member) {
        const m = user.member
        member = {
          studentNumber: user.studentNumber,
          name: [m.firstName, m.middleName, m.lastName, m.suffix].filter(Boolean).join(' '),
          yearLevel: m.yearLevel,
          section: m.section
        }
      }
      return { ...a, member }
    })

    // Sort by Year, then Section, then alphabetically by Name. Unresolved
    // scans (no matching member) sort last so the identifiable, ordered
    // attendees are never pushed down by raw QR codes.
    enriched.sort((a, b) => {
      if (!a.member && !b.member) return 0
      if (!a.member) return 1
      if (!b.member) return -1

      const yearCompare = String(a.member.yearLevel || '').localeCompare(String(b.member.yearLevel || ''))
      if (yearCompare !== 0) return yearCompare

      const sectionCompare = String(a.member.section || '').localeCompare(String(b.member.section || ''))
      if (sectionCompare !== 0) return sectionCompare

      return String(a.member.name || '').localeCompare(String(b.member.name || ''))
    })

    return res.json({ attendances: enriched })
  } catch (err) {
    logError('Get attendance', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { listEvents, getEvent, createEvent, updateEvent, archiveEvent, recordAttendance, getAttendance, listAvailableDisbursements }