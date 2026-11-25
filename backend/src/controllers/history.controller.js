const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { hasAccess } = require('../services/permissions.service')
const { AUDIT_ACTION_LABELS } = require('../utils/auditActions')
const { buildDescription } = require('./auditLog.controller')
const { canView } = require('../utils/documentAccess')
const { ACTOR_SELECT, actorNameOf, parseDetails, isEdit } = require('../utils/lastEdit')

// GET /api/history/:entityType/:entityId
// A record's edit history — who changed it, when, and what changed — read
// from the Activity Log entries written with that record as their `entity`.
// Each record type needs the same module access as the page it's shown on.
const ENTITY_MODULES = {
  event: 'EVENT',
  disbursement: 'FINANCIAL',
  fundCategory: 'FINANCIAL',
  member: 'MEMBER_LIST',
  audit: 'AUDIT',
  document: null, // per item: whoever can see the document (utils/documentAccess.js)
}

// Entries written before `changes` existed (or by older code paths) still
// show what changed, from the fields those actions always recorded.
function changesOf(action, details) {
  if (Array.isArray(details?.changes)) return details.changes
  switch (action) {
    case 'CATEGORY_UPDATED':
      return [
        { field: 'name', label: 'Name', from: details.previousName ?? null, to: details.name ?? null },
        { field: 'percentage', label: 'Percentage', from: details.previousPercentage ?? null, to: details.percentage ?? null },
      ].filter((c) => String(c.from) !== String(c.to))
    case 'RETURN_FUND_UPDATED':
      return [{ field: 'amountReturned', label: 'Amount returned', from: details.previousAmount ?? null, to: details.newAmount ?? null }]
    case 'AUDIT_STATUS_UPDATED':
    case 'AUDIT_CLEARED':
      return [{ field: 'status', label: 'Status', from: details.previousStatus ?? null, to: details.newStatus ?? null }]
    case 'EVENT_STATUS_CHANGED':
    case 'DISBURSEMENT_TITLE_UPDATED':
      return [{ field: action === 'EVENT_STATUS_CHANGED' ? 'status' : 'titleOfActivities', label: action === 'EVENT_STATUS_CHANGED' ? 'Status' : 'Title of activity', from: details.from ?? null, to: details.to ?? null }]
    default:
      return []
  }
}

const getHistory = async (req, res) => {
  try {
    const { entityType } = req.params
    const entityId = Number(req.params.entityId)
    if (!Object.hasOwn(ENTITY_MODULES, entityType) || !Number.isSafeInteger(entityId) || entityId <= 0) {
      return res.status(404).json({ message: 'History not found.' })
    }
    const module = ENTITY_MODULES[entityType]
    const allowed = module
      ? await hasAccess(req.user.role, module, 'VIEW')
      : canView(await prisma.documentItem.findUnique({ where: { id: entityId }, include: { groupAccess: true, officerAccess: true } }), req.user)
    if (!allowed) return res.status(403).json({ message: 'Access denied' })

    const logs = await prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: ACTOR_SELECT },
    })

    const entries = logs.map((log) => {
      const details = parseDetails(log)
      return {
        id: log.id,
        action: log.action,
        actionLabel: AUDIT_ACTION_LABELS[log.action] ?? log.action,
        isEdit: isEdit(log),
        actorName: actorNameOf(log, details),
        createdAt: log.createdAt,
        changes: changesOf(log.action, details),
        description: buildDescription(log.action, details, null),
      }
    })

    // The latest edit (creating the record doesn't count), as shown in lists.
    const latest = entries.find((e) => e.isEdit)
    return res.json({ entries, lastEdit: latest ? { name: latest.actorName, at: latest.createdAt, entryId: latest.id } : null })
  } catch (err) {
    logError('Get edit history', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { getHistory, ENTITY_MODULES }
