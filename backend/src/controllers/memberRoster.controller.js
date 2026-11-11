const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { syncMemberApprovalNotifications } = require('../services/notification.service')
const { emitToOfficers } = require('../realtime/socket')
const {
  MAX_ROSTER_ROWS, validateRosterRows, buildRosterPlan, applyRosterPlan,
} = require('../services/memberRoster.service')

const MODES = ['add', 'replace']
const MAX_INVALID_ROWS_SHOWN = 200

// Reads { rows, mode } from the body. Returns { entries, invalid, mode } or { error }.
function readRosterRequest(body) {
  const { rows, mode = 'add' } = body ?? {}
  if (!MODES.includes(mode)) return { error: 'Choose whether to add to or replace the roster.' }
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'The list has no rows.' }
  if (rows.length > MAX_ROSTER_ROWS) return { error: `A roster can have at most ${MAX_ROSTER_ROWS} rows.` }
  const { entries, invalid } = validateRosterRows(rows)
  if (entries.size === 0) return { error: 'No valid rows were found. Check the Student Number and Last Name columns.', invalid }
  return { entries, invalid, mode }
}

function planResponse(plan, invalid, totalRows) {
  return {
    mode: plan.mode,
    totalRows,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, MAX_INVALID_ROWS_SHOWN),
    ...plan.summary,
    willApprove: plan.willApprove,
    nameMismatch: plan.nameMismatch,
    personalEmail: plan.personalEmail,
  }
}

// GET /api/officer/roster
const getRoster = async (req, res) => {
  try {
    const entries = await prisma.memberRoster.findMany({
      orderBy: { studentNumber: 'asc' },
      select: { studentNumber: true, lastName: true, updatedAt: true },
    })
    const registered = await prisma.user.findMany({
      where: { studentNumber: { in: entries.map((e) => e.studentNumber) } },
      select: { studentNumber: true, status: true },
    })
    const statusByNumber = new Map(registered.map((u) => [u.studentNumber, u.status]))
    return res.json({
      entries: entries.map((e) => ({ ...e, accountStatus: statusByNumber.get(e.studentNumber) ?? null })),
    })
  } catch (err) {
    logError('Get member roster', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// POST /api/officer/roster/preview   body: { rows: [{ row, studentNumber, lastName }], mode }
// Shows what saving would do. Nothing is changed.
const previewRoster = async (req, res) => {
  try {
    const request = readRosterRequest(req.body)
    if (request.error) return res.status(400).json({ message: request.error, invalid: request.invalid?.slice(0, MAX_INVALID_ROWS_SHOWN) ?? [] })
    const plan = await buildRosterPlan(request.entries, request.mode)
    return res.json(planResponse(plan, request.invalid, req.body.rows.length))
  } catch (err) {
    logError('Preview member roster', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// POST /api/officer/roster   body: same as preview
// Saves the roster, then approves every pending registration that matches.
// The plan is rebuilt here, so it reflects the data at the moment of saving.
const applyRoster = async (req, res) => {
  try {
    const request = readRosterRequest(req.body)
    if (request.error) return res.status(400).json({ message: request.error, invalid: request.invalid?.slice(0, MAX_INVALID_ROWS_SHOWN) ?? [] })

    const plan = await buildRosterPlan(request.entries, request.mode)
    const approved = await applyRosterPlan(plan, req.user.id)

    // Counts only — the student list itself stays out of the activity log.
    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.MEMBER_ROSTER_UPDATED,
      details: {
        mode: plan.mode,
        added: plan.summary.added,
        updated: plan.summary.updated,
        removed: plan.summary.removed,
        rosterSize: plan.summary.rosterSizeAfter,
        approvedCount: approved.length,
      },
    })

    if (approved.length > 0) {
      await syncMemberApprovalNotifications()
      emitToOfficers('membership:changed', { action: 'approved' })
    }
    emitToOfficers('memberRoster:changed', {})

    return res.json({
      ...planResponse(plan, request.invalid, req.body.rows.length),
      approvedCount: approved.length,
      approved,
      message: `Roster saved (${plan.summary.rosterSizeAfter} student${plan.summary.rosterSizeAfter === 1 ? '' : 's'}). `
        + `${approved.length} pending member${approved.length === 1 ? ' was' : 's were'} approved automatically.`,
    })
  } catch (err) {
    logError('Save member roster', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// DELETE /api/officer/roster/:studentNumber
// Removing a student from the roster never undoes an approval already given.
const removeRosterEntry = async (req, res) => {
  try {
    const studentNumber = String(req.params.studentNumber || '').trim()
    const { count } = await prisma.memberRoster.deleteMany({ where: { studentNumber } })
    if (count === 0) return res.status(404).json({ message: 'That student is not on the roster.' })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.MEMBER_ROSTER_UPDATED,
      details: { mode: 'remove', removed: 1 },
    })
    emitToOfficers('memberRoster:changed', {})

    return res.json({ message: 'Removed from the roster.' })
  } catch (err) {
    logError('Remove roster entry', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { getRoster, previewRoster, applyRoster, removeRosterEntry }
