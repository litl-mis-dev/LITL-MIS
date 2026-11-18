// Activity Logs: choosing several modules filters on the server, before
// paging, so every page holds up to 10 matching rows. Prisma is faked.
// Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

let lastFindMany
stub('src/lib/prisma.js', {
  auditLog: {
    findMany: (args) => { lastFindMany = args; return [] },
    count: () => 0,
  },
  user: { findMany: async () => [] },
  $transaction: async (queries) => Promise.all(queries),
})

const { listAuditLogs } = require(path.join(backend, 'src/controllers/auditLog.controller'))
const { AUDIT_ACTION_MODULE } = require(path.join(backend, 'src/utils/auditActions'))

const list = async (query) => {
  const res = { statusCode: 200 }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await listAuditLogs({ query, user: { id: 1 } }, res)
  return res
}
const actionsOf = (...modules) => Object.entries(AUDIT_ACTION_MODULE).filter(([, m]) => modules.includes(m)).map(([a]) => a).sort()

test('several modules are filtered on the server, before paging', async () => {
  await list({ module: 'Events,Financial', page: '2', limit: '10' })
  assert.deepEqual([...lastFindMany.where.action.in].sort(), actionsOf('Events', 'Financial'))
  assert.equal(lastFindMany.take, 10)
  assert.equal(lastFindMany.skip, 10)
})

test('one module still works as before', async () => {
  await list({ module: 'Events' })
  assert.deepEqual([...lastFindMany.where.action.in].sort(), actionsOf('Events'))
})
