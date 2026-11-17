// Deleting an event: only events that haven't happened (Coming soon or
// Cancelled) can be deleted. Open and Closed events are refused by the API,
// not just hidden in the page. Runs against a small fake database — no MySQL
// or network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

let events
let auditLogs
stub('src/lib/prisma.js', {
  event: {
    findUnique: async ({ where }) => events.find((e) => e.id === where.id) ?? null,
    update: async ({ where, data }) => Object.assign(events.find((e) => e.id === where.id), data),
  },
})
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { auditLogs.push(entry) } })
stub('src/realtime/socket.js', { emitToOfficers: () => {}, emitToAll: () => {}, emitToUser: () => {}, emitToHashChain: () => {} })
stub('src/controllers/certification.controller.js', { ensureEventCertificationFolder: async () => {} })
stub('src/services/notification.service.js', {})

const { archiveEvent } = require(path.join(backend, 'src/controllers/event.controller'))

const remove = async (status) => {
  events = [{ id: 1, title: 'Seminar', status, isArchived: false, disbursementId: null }]
  auditLogs = []
  const res = { statusCode: 200 }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await archiveEvent({ user: { id: 1 }, params: { id: '1' }, body: {} }, res)
  return res
}

test('an Open event cannot be deleted', async () => {
  const res = await remove('OPEN')
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /open, so it can't be deleted/)
  assert.equal(events[0].isArchived, false, 'still listed')
  assert.equal(auditLogs.length, 0)
})

test('a Closed event cannot be deleted', async () => {
  const res = await remove('CLOSED')
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /has ended/)
  assert.equal(events[0].isArchived, false)
})

test('Coming soon and Cancelled events can still be deleted', async () => {
  for (const status of ['COMING_SOON', 'CANCELLED']) {
    const res = await remove(status)
    assert.equal(res.statusCode, 200, status)
    assert.equal(events[0].isArchived, true, status)
    assert.equal(auditLogs[0].action, 'EVENT_ARCHIVED', status)
  }
})
