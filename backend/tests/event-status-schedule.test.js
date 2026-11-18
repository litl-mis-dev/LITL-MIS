// Event status on a schedule: Coming soon -> Open at the start date and time,
// Open -> Closed at 11:59 PM that day (Philippine time), done by the server.
// Manual changes only move forward. Runs against a small fake database — no
// MySQL or network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

let events
let auditLogs
let notices
const reset = (rows) => { events = rows; auditLogs = []; notices = [] }
const matches = (row, where) => Object.entries(where).every(([key, cond]) => {
  if (cond && typeof cond === 'object') {
    if ('in' in cond) return cond.in.includes(row[key])
    if ('lte' in cond) return row[key] <= cond.lte
  }
  return row[key] === cond
})

stub('src/lib/prisma.js', {
  event: {
    findMany: async ({ where }) => events.filter((e) => matches(e, where)).map((e) => ({ ...e })),
    findUnique: async ({ where }) => { const e = events.find((row) => row.id === where.id); return e ? { ...e } : null },
    updateMany: async ({ where, data }) => {
      const hits = events.filter((e) => matches(e, where))
      hits.forEach((e) => Object.assign(e, data))
      return { count: hits.length }
    },
    update: async ({ where, data }) => {
      const e = events.find((row) => row.id === where.id)
      Object.assign(e, data)
      return { ...e, _count: { attendances: 0 }, disbursement: null }
    },
  },
})
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { auditLogs.push(entry) } })
stub('src/realtime/socket.js', { emitToOfficers: () => {}, emitToAll: () => {}, emitToUser: () => {}, emitToHashChain: () => {} })
stub('src/controllers/certification.controller.js', { ensureEventCertificationFolder: async () => {} })
stub('src/services/notification.service.js', {
  notifyEventStatusChanged: async (event, from, to) => { notices.push({ id: event.id, from, to }) },
  notifyEventUpdated: async () => {},
  notifyEventAccessGrantedToMembers: async () => {},
  notifyEventCreated: async () => {},
})

const { scheduledStatus, statusChangeError, applyScheduledStatuses } = require(path.join(backend, 'src/services/eventStatus.service'))
const eventCtrl = require(path.join(backend, 'src/controllers/event.controller'))

// Philippine time is UTC+8.
const at = (manila) => new Date(`${manila}+08:00`)
const seminar = (fields = {}) => ({ id: 1, title: 'Seminar', date: '2026-11-09', time: '10:00', status: 'COMING_SOON', isArchived: false, access: '["Members"]', ...fields })

// ── The schedule ─────────────────────────────────────────────────────────────
test('the example: Coming soon before 10:00 AM, Open at 10:00 AM, Closed at 11:59 PM', () => {
  assert.equal(scheduledStatus(seminar(), at('2026-11-09T09:59:00')), null, 'still Coming soon')
  assert.equal(scheduledStatus(seminar(), at('2026-11-09T10:00:00')), 'OPEN')
  assert.equal(scheduledStatus(seminar({ status: 'OPEN' }), at('2026-11-09T23:58:00')), null, 'still Open')
  assert.equal(scheduledStatus(seminar({ status: 'OPEN' }), at('2026-11-09T23:59:00')), 'CLOSED')
  assert.equal(scheduledStatus(seminar({ status: 'OPEN' }), at('2026-11-10T08:00:00')), 'CLOSED')
})

test('uses Philippine time, not the server\'s UTC clock', () => {
  // 02:00 UTC on Nov 9 is 10:00 AM in Manila; 23:00 UTC on Nov 8 is 7:00 AM on Nov 9.
  assert.equal(scheduledStatus(seminar(), new Date('2026-11-09T02:00:00Z')), 'OPEN')
  assert.equal(scheduledStatus(seminar(), new Date('2026-11-08T23:00:00Z')), null)
})

test('an event missed while the server was down goes straight to Closed', () => {
  assert.equal(scheduledStatus(seminar(), at('2026-11-11T09:00:00')), 'CLOSED')
})

test('Closed and Cancelled events are left alone', () => {
  assert.equal(scheduledStatus(seminar({ status: 'CLOSED' }), at('2026-11-12T09:00:00')), null)
  assert.equal(scheduledStatus(seminar({ status: 'CANCELLED' }), at('2026-11-09T10:30:00')), null)
})

// ── The server applies it ────────────────────────────────────────────────────
test('the server opens and closes due events, logs it as automatic and notifies', async () => {
  reset([
    seminar(),
    seminar({ id: 2, title: 'Fun Run', date: '2026-11-08', status: 'OPEN' }),
    seminar({ id: 3, title: 'Next week', date: '2026-11-16' }),
    seminar({ id: 4, title: 'Cancelled', status: 'CANCELLED' }),
  ])
  const changed = await applyScheduledStatuses(at('2026-11-09T10:00:00'))
  assert.equal(changed, 2)
  assert.deepEqual(events.map((e) => e.status), ['OPEN', 'CLOSED', 'COMING_SOON', 'CANCELLED'])
  assert.deepEqual(auditLogs.map((l) => [l.action, l.actorId, l.details.from, l.details.to, l.details.automatic]), [
    ['EVENT_STATUS_CHANGED', null, 'Coming soon', 'Open', true],
    ['EVENT_STATUS_CHANGED', null, 'Open', 'Closed', true],
  ])
  assert.equal(notices.length, 2)

  assert.equal(await applyScheduledStatuses(at('2026-11-09T10:01:00')), 0, 'nothing to do the next minute')
})

// ── Manual changes only move forward ─────────────────────────────────────────
test('allowed and refused manual status changes', () => {
  for (const [from, to] of [['COMING_SOON', 'OPEN'], ['COMING_SOON', 'CANCELLED'], ['OPEN', 'CLOSED'], ['OPEN', 'CANCELLED'], ['OPEN', 'OPEN']]) {
    assert.equal(statusChangeError(from, to), null, `${from} -> ${to}`)
  }
  assert.match(statusChangeError('OPEN', 'COMING_SOON'), /can't go back to Coming soon/)
  assert.match(statusChangeError('CLOSED', 'OPEN'), /Closed, so its status can no longer be changed/)
  assert.match(statusChangeError('CANCELLED', 'COMING_SOON'), /Cancelled/)
  assert.match(statusChangeError('COMING_SOON', 'CLOSED'), /Coming soon can't be changed to Closed\. Open it first\./)
})

const call = async (handler, req) => {
  const res = { statusCode: 200 }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await handler({ user: { id: 1, effectiveRole: 'PRESIDENT_ADMIN' }, params: {}, body: {}, query: {}, ...req }, res)
  return res
}

test('the API refuses to move an Open event back to Coming soon', async () => {
  reset([seminar({ status: 'OPEN', date: '2099-01-01' })])
  const res = await call(eventCtrl.updateEvent, { params: { id: '1' }, body: { status: 'Coming soon' } })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /can't go back to Coming soon/)
  assert.equal(events[0].status, 'OPEN')
})

test('the API logs a manual forward change', async () => {
  reset([seminar({ status: 'OPEN', date: '2099-01-01' })])
  const res = await call(eventCtrl.updateEvent, { params: { id: '1' }, body: { status: 'Closed' } })
  assert.equal(res.statusCode, 200)
  assert.equal(events[0].status, 'CLOSED')
  const log = auditLogs.find((l) => l.action === 'EVENT_STATUS_CHANGED')
  assert.deepEqual([log.actorId, log.details.from, log.details.to, log.details.automatic], [1, 'Open', 'Closed', false])
})

test('an Open event cannot be rescheduled', async () => {
  reset([seminar({ status: 'OPEN', date: '2099-01-01' })])
  const res = await call(eventCtrl.updateEvent, { params: { id: '1' }, body: { date: '2099-02-01' } })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /only be changed while the event is Coming soon/)
})

test('a new event cannot start as Closed or Cancelled', async () => {
  reset([])
  const body = { title: 'Seminar', date: '2099-01-01', time: '10:00', location: 'Gym', Proponent: 'LITL', description: 'x', access: ['Members'] }
  for (const status of ['Closed', 'Cancelled']) {
    const res = await call(eventCtrl.createEvent, { body: { ...body, status } })
    assert.equal(res.statusCode, 400, status)
    assert.match(res.body.message, /starts as Coming soon or Open/)
  }
})
