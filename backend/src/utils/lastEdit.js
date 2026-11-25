const prisma = require('../lib/prisma')
const { DEVELOPER_ROLE } = require('./roles')
const { summarize } = require('./historySummary')

// Who last edited a record and when, read from the Activity Log entries
// written with that record as their `entity` (no extra columns needed).
// Creating the record counts too, so a new record already shows its creator.

const ACTOR_SELECT = { select: { role: true, member: { select: { firstName: true, lastName: true } } } }

function parseDetails(log) {
  try { return log.details ? JSON.parse(log.details) : {} } catch { return {} }
}

// The name shown for whoever wrote a log entry. Entries with no actor were
// made by the system itself (e.g. an approval from the Members List).
function actorNameOf(log, details = parseDetails(log)) {
  if (details.automatic || !log.actor) return 'System (automatic)'
  if (log.actor.role === DEVELOPER_ROLE) return 'Developer'
  const member = log.actor.member
  return (member && [member.firstName, member.lastName].filter(Boolean).join(' ')) || 'System'
}

// { [entityId]: { name, at, summary, summaryFull } } for each record that has
// an entry. `prefer`: see historySummary.summarize.
async function latestEdits(entityType, ids, { prefer } = {}) {
  const wanted = [...new Set(ids.filter((id) => Number.isSafeInteger(id)))]
  if (wanted.length === 0) return {}
  const logs = await prisma.auditLog.findMany({
    where: { entityType, entityId: { in: wanted } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { entityId: true, action: true, createdAt: true, details: true, actor: ACTOR_SELECT },
  })
  const result = {}
  for (const log of logs) {
    if (result[log.entityId]) continue
    const details = parseDetails(log)
    result[log.entityId] = { name: actorNameOf(log, details), at: log.createdAt, ...summarize(log.action, details, { prefer }) }
  }
  return result
}

// Adds `lastEdit` (or null) to each record; `idOf` picks the record's entity id.
async function withLastEdits(entityType, records, idOf = (r) => r.id, options = {}) {
  const edits = await latestEdits(entityType, records.map(idOf), options)
  return records.map((r) => ({ ...r, lastEdit: edits[idOf(r)] ?? null }))
}

module.exports = { ACTOR_SELECT, actorNameOf, parseDetails, latestEdits, withLastEdits }
