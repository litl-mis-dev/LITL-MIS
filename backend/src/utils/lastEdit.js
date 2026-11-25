const prisma = require('../lib/prisma')
const { DEVELOPER_ROLE } = require('./roles')

// Who last edited a record and when, read from the Activity Log entries
// written with that record as their `entity` (no extra columns needed).
// Creating a record isn't an edit, so it never counts as the latest edit.
const CREATION_ACTIONS = ['EVENT_CREATED', 'DISBURSEMENT_CREATED', 'CATEGORY_CREATED', 'DOCUMENT_UPLOADED', 'DOCUMENT_FOLDER_CREATED']

const ACTOR_SELECT = { select: { role: true, member: { select: { firstName: true, lastName: true } } } }

function parseDetails(log) {
  try { return log.details ? JSON.parse(log.details) : {} } catch { return {} }
}

// The name shown for whoever wrote a log entry.
function actorNameOf(log, details = parseDetails(log)) {
  if (details.automatic) return 'System (automatic)'
  if (log.actor?.role === DEVELOPER_ROLE) return 'Developer'
  const member = log.actor?.member
  return (member && [member.firstName, member.lastName].filter(Boolean).join(' ')) || 'System'
}

const isEdit = (log) => !CREATION_ACTIONS.includes(log.action)

// { [entityId]: { name, at } } for each record that has been edited.
async function latestEdits(entityType, ids) {
  const wanted = [...new Set(ids.filter((id) => Number.isSafeInteger(id)))]
  if (wanted.length === 0) return {}
  const logs = await prisma.auditLog.findMany({
    where: { entityType, entityId: { in: wanted }, action: { notIn: CREATION_ACTIONS } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { entityId: true, action: true, createdAt: true, details: true, actor: ACTOR_SELECT },
  })
  const result = {}
  for (const log of logs) {
    if (!result[log.entityId]) result[log.entityId] = { name: actorNameOf(log), at: log.createdAt }
  }
  return result
}

// Adds `lastEdit` (or null) to each record; `idOf` picks the record's entity id.
async function withLastEdits(entityType, records, idOf = (r) => r.id) {
  const edits = await latestEdits(entityType, records.map(idOf))
  return records.map((r) => ({ ...r, lastEdit: edits[idOf(r)] ?? null }))
}

module.exports = { CREATION_ACTIONS, ACTOR_SELECT, actorNameOf, parseDetails, isEdit, latestEdits, withLastEdits }
