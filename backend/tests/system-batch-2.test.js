// Bulk approve/reject, officers editing a member's details, edit history,
// status rules and the sliding 30-day session. Runs against a small fake
// database — no MySQL, email or network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = 'test-secret-for-system-batch-2-only'

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

let users, members, auditRows, logs, emails, reviewed
const reset = () => {
  users = [
    { id: 1, role: 'PRESIDENT_ADMIN', status: 'APPROVED', tokenVersion: 0, email: 'pres@cvsu.edu.ph', studentNumber: '2023-100-001' },
    { id: 2, role: 'MEMBER', status: 'APPROVED', tokenVersion: 0, email: 'juan@cvsu.edu.ph', studentNumber: '2023-100-002' },
    { id: 3, role: 'MEMBER', status: 'APPROVED', tokenVersion: 0, email: 'taken@cvsu.edu.ph', studentNumber: '2023-100-003' },
  ]
  members = [
    { id: 20, userId: 2, firstName: 'Juan', middleName: null, lastName: 'Dela Cruz', suffix: null, sex: 'MALE', yearLevel: '2nd Year', section: '1', status: 'ACTIVE' },
    { id: 21, userId: 3, firstName: 'Ana', middleName: null, lastName: 'Reyes', suffix: null, sex: 'FEMALE', yearLevel: '1st Year', section: '2', status: 'GRADUATED' },
  ]
  auditRows = []
  logs = []
  emails = []
  reviewed = []
}
reset()

const userById = (id) => users.find((u) => u.id === id)
stub('src/lib/prisma.js', {
  user: {
    findUnique: async ({ where }) => { const u = userById(where.id); return u ? { ...u } : null },
    findFirst: async ({ where }) => users.find((u) => u.id !== where.id.not
      && where.OR.some((cond) => Object.entries(cond).every(([k, v]) => u[k] === v))) ?? null,
    update: ({ where, data }) => ({ apply: () => Object.assign(userById(where.id), data) }),
  },
  member: {
    findUnique: async ({ where }) => {
      const m = members.find((row) => row.id === where.id)
      return m ? { ...m, user: { ...userById(m.userId) } } : null
    },
    update: ({ where, data }) => ({ apply: () => Object.assign(members.find((m) => m.id === where.id), data) }),
  },
  auditLog: {
    findMany: async ({ where }) => auditRows.filter((r) => r.entityType === where.entityType && r.entityId === where.entityId),
  },
  documentItem: { findUnique: async () => null },
  $transaction: async (ops) => (typeof ops === 'function'
    ? ops({ member: { update: async ({ where, data }) => Object.assign(members.find((m) => m.id === where.id), data) }, officerAssignment: { updateMany: async () => ({}) }, user: { update: async () => ({}) } })
    : ops.forEach((op) => op.apply())),
})
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { logs.push(entry) } })
stub('src/utils/email.js', { sendEmailChangedByOfficerEmail: async (to, info) => { emails.push({ to, ...info }) } })
stub('src/realtime/socket.js', { emitToOfficers: () => {}, emitToAll: () => {}, emitToUser: () => {}, emitToHashChain: () => {} })
stub('src/services/notification.service.js', { syncMemberApprovalNotifications: async () => {} })
stub('src/services/signatory.service.js', { resolveSignatories: async () => ({}) })
stub('src/services/memberApproval.service.js', {
  approvePendingUser: async (id) => { reviewed.push(['approve', id]); return { approved: id !== 99 } },
  rejectPendingUser: async (id) => { reviewed.push(['reject', id]); return { rejected: id !== 99 } },
})
let allowedModules = new Set(['EVENT', 'MEMBER_LIST'])
stub('src/services/permissions.service.js', { hasAccess: async (role, module) => allowedModules.has(module) })
stub('src/controllers/auditLog.controller.js', { buildDescription: (action) => `described ${action}` })
stub('src/utils/documentAccess.js', { canView: () => false })

const officer = require(path.join(backend, 'src/controllers/officer.controller'))
const { getHistory } = require(path.join(backend, 'src/controllers/history.controller'))
const { diffChanges } = require(path.join(backend, 'src/utils/changes'))
const authMiddleware = require(path.join(backend, 'src/middleware/auth.middleware'))

function call(handler, { params = {}, body = {}, user = { id: 1, role: 'PRESIDENT_ADMIN' }, cookies = {}, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, cookiesSet: [],
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload, res: this }); return this },
      cookie(name, value, options) { this.cookiesSet.push({ name, value, options }) },
    }
    const maybe = handler({ params, body, user, cookies, headers }, res, () => resolve({ status: 'next', res }))
    if (maybe?.catch) maybe.catch((err) => resolve({ status: 'threw', body: err }))
  })
}

// ── Bulk approve / reject ────────────────────────────────────────────────────
test('bulk review: checks the action and the selection', async () => {
  reset()
  assert.equal((await call(officer.bulkReviewUsers, { body: { action: 'delete', userIds: [5] } })).status, 400)
  assert.equal((await call(officer.bulkReviewUsers, { body: { action: 'approve', userIds: [] } })).status, 400)
  assert.equal((await call(officer.bulkReviewUsers, { body: { action: 'approve', userIds: ['abc'] } })).status, 400)
  const tooMany = Array.from({ length: 201 }, (_, i) => i + 1)
  assert.match((await call(officer.bulkReviewUsers, { body: { action: 'approve', userIds: tooMany } })).body.message, /at most 200/)
  assert.deepEqual(reviewed, [], 'nothing reviewed when the request is invalid')
})

test('bulk review: each selected registration once; ones no longer pending are skipped', async () => {
  reset()
  const { status, body } = await call(officer.bulkReviewUsers, { body: { action: 'reject', userIds: [5, 6, 5, 99] } })
  assert.equal(status, 200)
  assert.deepEqual(reviewed, [['reject', 5], ['reject', 6], ['reject', 99]])
  assert.equal(body.done, 2)
  assert.equal(body.skipped, 1)
  assert.match(body.message, /2 registrations rejected\. 1 skipped/)
})

// ── Editing a member's details ───────────────────────────────────────────────
const juan = (fields = {}) => ({
  firstName: 'Juan', middleName: '', lastName: 'Dela Cruz', suffix: '', sex: 'MALE', yearLevel: '2nd Year',
  section: '1', email: 'juan@cvsu.edu.ph', studentNumber: '2023-100-002', ...fields,
})

test('member edit: invalid fields come back per field and nothing is saved', async () => {
  reset()
  const { status, body } = await call(officer.updateMemberInfo, {
    params: { id: '20' }, body: juan({ firstName: 'J', sex: 'PREFER_NOT_TO_SAY', suffix: 'Esq.', section: '0', email: 'nope' }),
  })
  assert.equal(status, 400)
  assert.deepEqual(Object.keys(body.errors).sort(), ['email', 'firstName', 'section', 'sex', 'suffix'])
  assert.equal(members[0].firstName, 'Juan')
  assert.equal(logs.length, 0)
})

test('member edit: an email or student number another account uses is refused', async () => {
  reset()
  assert.equal((await call(officer.updateMemberInfo, { params: { id: '20' }, body: juan({ email: 'taken@cvsu.edu.ph' }) })).status, 409)
  const dup = await call(officer.updateMemberInfo, { params: { id: '20' }, body: juan({ studentNumber: '2023-100-003' }) })
  assert.equal(dup.status, 409)
  assert.match(dup.body.message, /student number/)
})

test('member edit: saves, logs each change for the history, and tells both email addresses', async () => {
  reset()
  const { status, body } = await call(officer.updateMemberInfo, {
    params: { id: '20' }, body: juan({ lastName: 'Dela  Cruz-Santos ', email: 'Juan.New@cvsu.edu.ph' }),
  })
  assert.equal(status, 200)
  assert.equal(members[0].lastName, 'Dela Cruz-Santos', 'spaces tidied')
  assert.equal(users[1].email, 'juan.new@cvsu.edu.ph', 'email lowercased')
  assert.deepEqual(body.changes.map((c) => c.field), ['lastName', 'email'])

  assert.equal(logs.length, 1)
  assert.equal(logs[0].action, 'MEMBER_INFO_UPDATED')
  assert.deepEqual(logs[0].entity, { type: 'member', id: 20 })
  assert.deepEqual(logs[0].details.changes[0], { field: 'lastName', label: 'Last name', from: 'Dela Cruz', to: 'Dela Cruz-Santos' })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(emails.map((e) => [e.to, e.isOldAddress]), [['juan@cvsu.edu.ph', true], ['juan.new@cvsu.edu.ph', false]])
})

test('member edit: saving without changes writes nothing', async () => {
  reset()
  const { status, body } = await call(officer.updateMemberInfo, { params: { id: '20' }, body: juan() })
  assert.equal(status, 200)
  assert.equal(body.message, 'No changes to save.')
  assert.equal(logs.length, 0)
})

// ── Status rules ─────────────────────────────────────────────────────────────
test('member status: Graduated is final; other statuses can change back', async () => {
  reset()
  const graduated = await call(officer.updateMemberStatus, { params: { id: '21' }, body: { status: 'ACTIVE' } })
  assert.equal(graduated.status, 400)
  assert.match(graduated.body.message, /final/)

  assert.equal((await call(officer.updateMemberStatus, { params: { id: '20' }, body: { status: 'ARCHIVED' } })).status, 200)
  assert.equal((await call(officer.updateMemberStatus, { params: { id: '20' }, body: { status: 'ACTIVE' } })).status, 200)
  assert.equal(members[0].status, 'ACTIVE')
  assert.deepEqual(logs.map((l) => l.details.changes[0].to), ['ARCHIVED', 'ACTIVE'])
  assert.deepEqual(logs[0].entity, { type: 'member', id: 20 })
})

// ── Edit history ─────────────────────────────────────────────────────────────
test('diffChanges lists only what changed, with labels and formatting', () => {
  const changes = diffChanges(
    { title: 'Seminar', budget: '100', location: 'Room 1', access: '["Members"]' },
    { title: 'Seminar', budget: 150, location: '', access: '["Members","Officers"]' },
    { title: 'Title', budget: { label: 'Budget', format: (v) => Number(v).toFixed(2) }, location: 'Location', access: { label: 'Access', format: (v) => JSON.parse(v).join(', ') } },
  )
  assert.deepEqual(changes, [
    { field: 'budget', label: 'Budget', from: '100.00', to: '150.00' },
    { field: 'location', label: 'Location', from: 'Room 1', to: null },
    { field: 'access', label: 'Access', from: 'Members', to: 'Members, Officers' },
  ])
})

test('history: unknown record types are 404 and the record\'s module access is required', async () => {
  reset()
  assert.equal((await call(getHistory, { params: { entityType: 'constructor', entityId: '1' } })).status, 404)
  assert.equal((await call(getHistory, { params: { entityType: 'event', entityId: '0' } })).status, 404)
  allowedModules = new Set(['EVENT'])
  assert.equal((await call(getHistory, { params: { entityType: 'disbursement', entityId: '1' } })).status, 403)
  assert.equal((await call(getHistory, { params: { entityType: 'document', entityId: '1' } })).status, 403, 'documents: per item')
  allowedModules = new Set(['EVENT', 'MEMBER_LIST'])
})

test('history: who changed the record, when, and what — automatic changes say so', async () => {
  reset()
  const actor = { role: 'MEMBER', member: { firstName: 'Maria', lastName: 'Santos' } }
  auditRows = [
    { id: 7, entityType: 'event', entityId: 4, action: 'EVENT_STATUS_CHANGED', createdAt: new Date('2026-11-25T02:00:00Z'), actor: null,
      details: JSON.stringify({ from: 'COMING_SOON', to: 'OPEN', automatic: true }) },
    { id: 6, entityType: 'event', entityId: 4, action: 'EVENT_UPDATED', createdAt: new Date('2026-11-24T02:00:00Z'), actor,
      details: JSON.stringify({ changes: [{ field: 'location', label: 'Location', from: 'Room 1', to: 'Gym' }] }) },
    { id: 5, entityType: 'event', entityId: 9, action: 'EVENT_UPDATED', createdAt: new Date(), actor, details: '{}' },
  ]
  const { status, body } = await call(getHistory, { params: { entityType: 'event', entityId: '4' } })
  assert.equal(status, 200)
  assert.deepEqual(body.entries.map((e) => e.id), [7, 6], 'only this event')
  assert.equal(body.entries[0].actorName, 'System (automatic)')
  assert.deepEqual(body.entries[0].changes, [{ field: 'status', label: 'Status', from: 'COMING_SOON', to: 'OPEN' }])
  assert.equal(body.entries[1].actorName, 'Maria Santos')
  assert.equal(body.entries[1].changes[0].to, 'Gym')
  assert.deepEqual(body.lastEdit, {
    name: 'System (automatic)', at: body.entries[0].createdAt,
    summary: 'Status: Coming soon → Open', summaryFull: 'Status: Coming soon → Open',
  }, 'the latest entry, summarized')
})

test('history: a new record shows its creator as the last edit', async () => {
  reset()
  auditRows = [
    { id: 9, entityType: 'event', entityId: 5, action: 'EVENT_CREATED', createdAt: new Date('2026-11-25T03:00:00Z'),
      actor: { role: 'PRESIDENT_ADMIN', member: { firstName: 'Juan', lastName: 'Dela Cruz' } }, details: '{}' },
  ]
  const { body } = await call(getHistory, { params: { entityType: 'event', entityId: '5' } })
  assert.equal(body.entries.length, 1)
  assert.deepEqual(body.lastEdit, { name: 'Juan Dela Cruz', at: body.entries[0].createdAt, summary: 'Created', summaryFull: 'Created' })
})

// ── Sliding session ──────────────────────────────────────────────────────────
const tokenIssued = (secondsAgo) => jwt.sign(
  { id: 2, role: 'MEMBER', tokenVersion: 0, iat: Math.floor(Date.now() / 1000) - secondsAgo },
  process.env.JWT_SECRET, { expiresIn: '30d', algorithm: 'HS256' },
)

test('session: a token under a day old is kept; an older one is renewed for another 30 days', async () => {
  reset()
  const fresh = await call(authMiddleware, { cookies: { 'LITL-MIS': tokenIssued(60 * 60) } })
  assert.equal(fresh.status, 'next')
  assert.equal(fresh.res.cookiesSet.length, 0)

  const old = await call(authMiddleware, { cookies: { 'LITL-MIS': tokenIssued(3 * 24 * 60 * 60) } })
  assert.equal(old.status, 'next')
  assert.equal(old.res.cookiesSet.length, 1)
  const [cookie] = old.res.cookiesSet
  assert.equal(cookie.name, 'LITL-MIS')
  assert.equal(cookie.options.maxAge, 30 * 24 * 60 * 60 * 1000)
  assert.equal(cookie.options.httpOnly, true)
  const renewed = jwt.verify(cookie.value, process.env.JWT_SECRET)
  assert.ok(Math.floor(Date.now() / 1000) - renewed.iat < 5, 'a new token')
})

test('session: logging out (tokenVersion bump) ends every copy, renewed or not', async () => {
  reset()
  users[1].tokenVersion = 1
  const { status } = await call(authMiddleware, { cookies: { 'LITL-MIS': tokenIssued(3 * 24 * 60 * 60) } })
  assert.equal(status, 401)
})
