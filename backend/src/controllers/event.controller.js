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

function formatEvent(event) {
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
    attendanceCount: event._count?.attendances ?? 0,
  }
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
      include: { _count: { select: { attendances: true } } },
      orderBy: { date: 'asc' }
    })

    return res.json({ events: events.map(formatEvent) })
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
      include: { _count: { select: { attendances: true } } }
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

    return res.json({ event: formatEvent(event) })
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
      description, status, access, hasGoogleForm, googleFormUrl
    } = req.body

    if (!title?.trim() || !date || !time || !location?.trim() || !proponent?.trim() || !description?.trim()) {
      return res.status(400).json({ message: 'All required fields must be filled.' })
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
        createdById:   req.user.id,
      },
      include: { _count: { select: { attendances: true } } }
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

    return res.status(201).json({ message: 'Event created.', event: formatEvent(event) })
  } catch (err) {
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
      description, status, access, hasGoogleForm, googleFormUrl
    } = req.body

    if (Array.isArray(access) && access.length === 0) {
      return res.status(400).json({ message: 'At least one access group must be selected.' })
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
      },
      include: { _count: { select: { attendances: true } } }
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

    return res.json({ message: 'Event updated.', event: formatEvent(updated) })
  } catch (err) {
    logError('Update event', err)
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

module.exports = { listEvents, getEvent, createEvent, updateEvent, archiveEvent, recordAttendance, getAttendance }