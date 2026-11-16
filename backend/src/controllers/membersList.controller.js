const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { syncMemberApprovalNotifications } = require('../services/notification.service')
const { emitToOfficers } = require('../realtime/socket')
const {
  MAX_MEMBERS_LIST_ROWS, validateMembersListRows, buildMembersListPlan, applyMembersListPlan,
} = require('../services/membersList.service')

const MODES = ['add', 'replace']
const MAX_INVALID_ROWS_SHOWN = 200

// Reads { rows, mode } from the body. Returns { entries, invalid, mode } or { error }.
function readMembersListRequest(body) {
  const { rows, mode = 'add' } = body ?? {}
  if (!MODES.includes(mode)) return { error: 'Choose whether to add to or replace the Members List.' }
  if (!Array.isArray(rows) || rows.length === 0) return { error: 'The list has no rows.' }
  if (rows.length > MAX_MEMBERS_LIST_ROWS) return { error: `The Members List can have at most ${MAX_MEMBERS_LIST_ROWS} rows.` }
  const { entries, invalid } = validateMembersListRows(rows)
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

// GET /api/officer/members-list
const getMembersListEntries = async (req, res) => {
  try {
    const entries = await prisma.membersListEntry.findMany({
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
    logError('Get Members List', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// POST /api/officer/members-list/preview   body: { rows: [{ row, studentNumber, lastName }], mode }
// Shows what saving would do. Nothing is changed.
const previewMembersList = async (req, res) => {
  try {
    const request = readMembersListRequest(req.body)
    if (request.error) return res.status(400).json({ message: request.error, invalid: request.invalid?.slice(0, MAX_INVALID_ROWS_SHOWN) ?? [] })
    const plan = await buildMembersListPlan(request.entries, request.mode)
    return res.json(planResponse(plan, request.invalid, req.body.rows.length))
  } catch (err) {
    logError('Preview Members List', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// POST /api/officer/members-list   body: same as preview
// Saves the Members List, then approves every pending registration that matches.
// The plan is rebuilt here, so it reflects the data at the moment of saving.
const applyMembersList = async (req, res) => {
  try {
    const request = readMembersListRequest(req.body)
    if (request.error) return res.status(400).json({ message: request.error, invalid: request.invalid?.slice(0, MAX_INVALID_ROWS_SHOWN) ?? [] })

    const plan = await buildMembersListPlan(request.entries, request.mode)
    const approved = await applyMembersListPlan(plan, req.user.id)

    // Counts only — the student list itself stays out of the activity log.
    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.MEMBERS_LIST_UPDATED,
      details: {
        mode: plan.mode,
        added: plan.summary.added,
        updated: plan.summary.updated,
        removed: plan.summary.removed,
        listSize: plan.summary.listSizeAfter,
        approvedCount: approved.length,
      },
    })

    if (approved.length > 0) {
      await syncMemberApprovalNotifications()
      emitToOfficers('membership:changed', { action: 'approved' })
    }
    emitToOfficers('membersList:changed', {})

    return res.json({
      ...planResponse(plan, request.invalid, req.body.rows.length),
      approvedCount: approved.length,
      approved,
      message: `Members list saved (${plan.summary.listSizeAfter} student${plan.summary.listSizeAfter === 1 ? '' : 's'}). `
        + `${approved.length} pending member${approved.length === 1 ? ' was' : 's were'} approved automatically.`,
    })
  } catch (err) {
    logError('Save Members List', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// DELETE /api/officer/members-list/:studentNumber
// Removing a student from the Members List never undoes an approval already given.
const removeMembersListEntry = async (req, res) => {
  try {
    const studentNumber = String(req.params.studentNumber || '').trim()
    const { count } = await prisma.membersListEntry.deleteMany({ where: { studentNumber } })
    if (count === 0) return res.status(404).json({ message: 'That student is not on the members list.' })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.MEMBERS_LIST_UPDATED,
      details: { mode: 'remove', removed: 1 },
    })
    emitToOfficers('membersList:changed', {})

    return res.json({ message: 'Removed from the members list.' })
  } catch (err) {
    logError('Remove Members List entry', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { getMembersListEntries, previewMembersList, applyMembersList, removeMembersListEntry }
