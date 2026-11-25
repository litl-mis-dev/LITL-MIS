const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { hasAccess } = require('../services/permissions.service')
const { AUDIT_ACTION_LABELS } = require('../utils/auditActions')
const { buildDescription } = require('./auditLog.controller')
const { canView } = require('../utils/documentAccess')
const { changesOf, summarize } = require('../utils/historySummary')
const { ACTOR_SELECT, actorNameOf, parseDetails } = require('../utils/lastEdit')
const { formatMemberName } = require('../utils/documentAccess')

// GET /api/history/:entityType/:entityId
// A record's edit history — who changed it, when, and what changed — read
// from the Activity Log entries written with that record as their `entity`.
// Each record type needs the same module access as the page it's shown on.
const ENTITY_MODULES = {
  event: 'EVENT',
  disbursement: 'FINANCIAL',
  fundCategories: 'FINANCIAL', // a school year's whole set of fund categories (id: their semester)
  member: 'MEMBER_LIST',
  audit: 'AUDIT',
  document: null, // per item: whoever can see the document (utils/documentAccess.js)
}

const getHistory = async (req, res) => {
  try {
    const { entityType } = req.params
    const entityId = Number(req.params.entityId)
    if (!Object.hasOwn(ENTITY_MODULES, entityType) || !Number.isSafeInteger(entityId) || entityId <= 0) {
      return res.status(404).json({ message: 'History not found.' })
    }
    const module = ENTITY_MODULES[entityType]
    const document = module ? null
      : await prisma.documentItem.findUnique({ where: { id: entityId }, include: { groupAccess: true, officerAccess: true, owner: { include: { member: true } } } })
    const allowed = module ? await hasAccess(req.user.role, module, 'VIEW') : canView(document, req.user)
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
        actorName: actorNameOf(log, details),
        createdAt: log.createdAt,
        changes: changesOf(log.action, details),
        description: buildDescription(log.action, details, null),
      }
    })

    // The latest entry, creation included, with a one-line summary. Files
    // uploaded several at a time share one log entry, so a document with
    // none shows its uploader.
    const latest = logs[0]
    const lastEdit = latest ? { name: entries[0].actorName, at: latest.createdAt, ...summarize(latest.action, parseDetails(latest)) }
      : document ? {
        name: formatMemberName(document.owner) ?? 'System', at: document.createdAt,
        summary: document.type === 'FOLDER' ? 'Folder created' : 'Uploaded',
        summaryFull: document.type === 'FOLDER' ? 'Folder created' : 'Uploaded',
      }
      : null
    return res.json({ entries, lastEdit })
  } catch (err) {
    logError('Get edit history', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { getHistory, ENTITY_MODULES }
