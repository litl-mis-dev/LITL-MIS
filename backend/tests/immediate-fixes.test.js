// Regression tests for the immediate audit fixes (SEC-02, SEC-03, SEC-04,
// SEC-05, BE-01, RES-01). Runs against an in-memory fake Prisma with email,
// audit logging and web-push stubbed out — no database, SMTP or network.
// Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-123'
process.env.RESET_TOKEN_SECRET = 'test-reset-secret-that-is-long-enough-456'
process.env.VAPID_PUBLIC_KEY = 'test-public-key'

const backend = path.resolve(__dirname, '..')
const stub = (relPath, exports) => {
  require.cache[require.resolve(path.join(backend, relPath))] = { exports }
}

// ── Fake data stores ──────────────────────────────────────────────────────────
let nextId = 1000
const db = { users: [], otps: [], pending: [], pendingEmail: [], auditLogs: [], pushSubs: [] }
const resetDb = () => { for (const key of Object.keys(db)) db[key] = [] }

const matches = (row, where = {}) => Object.entries(where).every(([key, cond]) => {
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('gte' in cond) return row[key] >= cond.gte
    if ('in' in cond) return cond.in.includes(row[key])
    if ('not' in cond) return row[key] !== cond.not
  }
  return row[key] === cond
})
const applyData = (row, data) => {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value
  }
  return row
}
const newest = (rows) => [...rows].sort((a, b) => b.createdAt - a.createdAt)

const auditFindManyCalls = []
const fakePrisma = {
  user: {
    findUnique: async ({ where }) => db.users.find((u) => matches(u, where)) ?? null,
    update: async ({ where, data }) => applyData(db.users.find((u) => matches(u, where)), data),
  },
  member: { update: async () => ({}) },
  otp: {
    findMany: async ({ where }) => newest(db.otps.filter((o) => matches(o, where))),
    findFirst: async ({ where }) => newest(db.otps.filter((o) => matches(o, where)))[0] ?? null,
    create: async ({ data }) => { const row = { id: nextId++, attempts: 0, used: false, createdAt: new Date(), ...data }; db.otps.push(row); return row },
    update: async ({ where, data }) => applyData(db.otps.find((o) => matches(o, where)), data),
    updateMany: async ({ where, data }) => { const rows = db.otps.filter((o) => matches(o, where)); rows.forEach((r) => applyData(r, data)); return { count: rows.length } },
  },
  pendingRegistration: {
    findUnique: async ({ where }) => db.pending.find((p) => matches(p, where)) ?? null,
    create: async ({ data }) => { const row = { id: nextId++, otpAttempts: 0, ...data }; db.pending.push(row); return row },
    delete: async ({ where }) => { db.pending = db.pending.filter((p) => !matches(p, where)) },
  },
  pendingEmailChange: {
    findUnique: async ({ where }) => db.pendingEmail.find((p) => matches(p, where)) ?? null,
    create: async ({ data }) => { const row = { id: nextId++, otpAttempts: 0, ...data }; db.pendingEmail.push(row); return row },
    delete: async ({ where }) => { db.pendingEmail = db.pendingEmail.filter((p) => !matches(p, where)) },
  },
  auditLog: {
    findMany: async (args) => { auditFindManyCalls.push(args); return db.auditLogs },
    count: async () => db.auditLogs.length,
  },
  pushSubscription: {
    upsert: async ({ where, create, update }) => {
      const { userId, endpoint } = where.userId_endpoint
      const existing = db.pushSubs.find((s) => s.userId === userId && s.endpoint === endpoint)
      if (existing) return Object.assign(existing, update)
      db.pushSubs.push(create)
      return create
    },
    deleteMany: async ({ where }) => { db.pushSubs = db.pushSubs.filter((s) => !matches(s, where)) },
    findMany: async ({ where }) => db.pushSubs.filter((s) => matches(s, where)),
    delete: async () => ({}),
  },
  $transaction: async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(fakePrisma)),
}

const sentEmails = []
let failEmail = false
const audit = []
const pushedTo = []

stub('src/lib/prisma', fakePrisma)
stub('src/utils/email', {
  sendOtpEmail: async (to, otp, purpose) => {
    if (failEmail) throw new Error('SMTP down')
    sentEmails.push({ to, otp, purpose })
  },
  sendPaymentReminderEmail: async () => {},
  sendContactFormEmail: async () => {},
  sendRegistrationStatusEmail: async () => {},
})
stub('src/utils/auditLog', { writeAuditLog: async (entry) => { audit.push(entry) } })
require.cache[require.resolve('web-push', { paths: [backend] })] = {
  exports: { setVapidDetails() {}, sendNotification: async (sub) => { pushedTo.push(sub.endpoint) } },
}

const auth = require(path.join(backend, 'src/controllers/auth.controller'))
const notifications = require(path.join(backend, 'src/controllers/notification.controller'))
const { sendPushToUser } = require(path.join(backend, 'src/services/push.service'))
const { listAuditLogs } = require(path.join(backend, 'src/controllers/auditLog.controller'))

// ── Helpers ───────────────────────────────────────────────────────────────────
const call = async (fn, req) => {
  const out = { status: 200, body: undefined, cookies: {}, cleared: [] }
  const res = {
    status(s) { out.status = s; return this },
    json(b) { out.body = b; return this },
    cookie(name, value) { out.cookies[name] = value; return this },
    clearCookie(name) { out.cleared.push(name); return this },
    set() { return this },
  }
  await fn({ body: {}, params: {}, query: {}, cookies: {}, ip: '10.0.0.1', ...req }, res)
  return out
}

const bcrypt = require('bcrypt')
const PASSWORD = 'Correct#Pass1'
let passwordHash
const addUser = async (overrides = {}) => {
  passwordHash ??= await bcrypt.hash(PASSWORD, 4)
  const user = {
    id: nextId++, email: `user${nextId}@cvsu.edu.ph`, studentNumber: `2024-100-${nextId}`,
    emailType: 'CVSU', role: 'MEMBER', status: 'APPROVED', password: passwordHash,
    failedLoginAttempts: 0, lockedUntil: null, tokenVersion: 0, member: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  }
  db.users.push(user)
  return user
}
const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000)
const addResetOtp = (userId, { createdAt, attempts = 0, used = false }) => {
  db.otps.push({ id: nextId++, userId, purpose: 'PASSWORD_RESET', codeHash: 'x', attempts, used,
    createdAt, expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1000) })
}

test.beforeEach(() => {
  resetDb()
  sentEmails.length = 0
  audit.length = 0
  pushedTo.length = 0
  auditFindManyCalls.length = 0
  failEmail = false
})

// ── SEC-02 · password-reset limits ───────────────────────────────────────────
test('SEC-02: a second reset request within 60 s sends no new code', async () => {
  const user = await addUser()
  const first = await call(auth.forgotPassword, { body: { email: user.email } })
  const second = await call(auth.forgotPassword, { body: { email: user.email } })
  assert.equal(sentEmails.length, 1)
  assert.deepEqual(first.body, second.body) // same generic answer — no enumeration
})

test('SEC-02: the 6th code within an hour is refused', async () => {
  const user = await addUser()
  for (let i = 0; i < 5; i++) addResetOtp(user.id, { createdAt: minutesAgo(10 + i), used: true })
  const r = await call(auth.forgotPassword, { body: { email: user.email } })
  assert.equal(r.status, 200)
  assert.equal(sentEmails.length, 0)
})

test('SEC-02: codes older than an hour do not count toward the cap', async () => {
  const user = await addUser()
  for (let i = 0; i < 5; i++) addResetOtp(user.id, { createdAt: minutesAgo(61 + i), used: true })
  await call(auth.forgotPassword, { body: { email: user.email } })
  assert.equal(sentEmails.length, 1)
})

test('SEC-02: issuing a new code invalidates older unused codes', async () => {
  const user = await addUser()
  addResetOtp(user.id, { createdAt: minutesAgo(5) })
  await call(auth.forgotPassword, { body: { email: user.email } })
  const unused = db.otps.filter((o) => !o.used)
  assert.equal(unused.length, 1)
  assert.equal(sentEmails.length, 1)
})

test('SEC-02: after 10 failed guesses in an hour even the right code is refused', async () => {
  const user = await addUser()
  addResetOtp(user.id, { createdAt: minutesAgo(30), attempts: 5, used: true })
  addResetOtp(user.id, { createdAt: minutesAgo(20), attempts: 5, used: true })
  // Bypass the issuance cap check by issuing the live code directly.
  const otp = '123456'
  db.otps.push({ id: nextId++, userId: user.id, purpose: 'PASSWORD_RESET', codeHash: await bcrypt.hash(otp, 4),
    attempts: 0, used: false, createdAt: new Date(), expiresAt: new Date(Date.now() + 600000) })
  const r = await call(auth.verifyResetOtp, { body: { email: user.email, otp } })
  assert.equal(r.status, 400)
  assert.equal(r.body.resetToken, undefined)
})

test('SEC-02: the right code still works under the failure cap', async () => {
  const user = await addUser()
  await call(auth.forgotPassword, { body: { email: user.email } })
  const r = await call(auth.verifyResetOtp, { body: { email: user.email, otp: sentEmails[0].otp } })
  assert.equal(r.status, 200)
  assert.ok(r.body.resetToken)
})

test('SEC-02: resend-otp for password reset follows the same limits', async () => {
  const user = await addUser()
  await call(auth.forgotPassword, { body: { email: user.email } })
  await call(auth.resendOtp, { body: { purpose: 'PASSWORD_RESET', email: user.email } })
  assert.equal(sentEmails.length, 1)
})

test('SEC-02: unknown email and non-string email are handled without a 500', async () => {
  const unknown = await call(auth.forgotPassword, { body: { email: 'nobody@cvsu.edu.ph' } })
  const bad = await call(auth.forgotPassword, { body: { email: ['a@b.c'] } })
  assert.equal(unknown.status, 200)
  assert.equal(bad.status, 400)
  assert.equal(sentEmails.length, 0)
})

// ── SEC-04 · login lockout ───────────────────────────────────────────────────
test('SEC-04: 5 failures pause sign-in for that IP only; the owner can still log in elsewhere', async () => {
  const user = await addUser()
  for (let i = 0; i < 5; i++) {
    const r = await call(auth.login, { ip: '203.0.113.9', body: { identifier: user.email, password: 'Wrong#Pass1' } })
    assert.equal(r.status, 401)
  }
  const attackerRight = await call(auth.login, { ip: '203.0.113.9', body: { identifier: user.email, password: PASSWORD } })
  assert.equal(attackerRight.status, 401)
  const owner = await call(auth.login, { ip: '198.51.100.7', body: { identifier: user.email, password: PASSWORD } })
  assert.equal(owner.status, 200)
  assert.ok(owner.cookies['LITL-MIS'])
})

test('SEC-04: unknown account, wrong password and paused sign-in look identical', async () => {
  const user = await addUser()
  const unknown = await call(auth.login, { body: { identifier: 'ghost@cvsu.edu.ph', password: 'x' } })
  const wrong = await call(auth.login, { body: { identifier: user.email, password: 'Wrong#Pass1' } })
  for (let i = 0; i < 5; i++) await call(auth.login, { body: { identifier: user.email, password: 'Wrong#Pass1' } })
  const paused = await call(auth.login, { body: { identifier: user.email, password: PASSWORD } })
  assert.equal(unknown.status, 401)
  assert.deepEqual([wrong.status, wrong.body], [unknown.status, unknown.body])
  assert.deepEqual([paused.status, paused.body], [unknown.status, unknown.body])
})

test('SEC-04: 20 failures from many IPs lock the whole account', async () => {
  const user = await addUser()
  for (let i = 0; i < 20; i++) {
    await call(auth.login, { ip: `192.0.2.${i}`, body: { identifier: user.email, password: 'Wrong#Pass1' } })
  }
  assert.ok(user.lockedUntil > new Date())
  assert.equal(audit.at(-1).action, 'ACCOUNT_LOCKED')
  const r = await call(auth.login, { ip: '198.51.100.99', body: { identifier: user.email, password: PASSWORD } })
  assert.equal(r.status, 401)
})

test('SEC-04: a successful login resets the failure counters', async () => {
  const user = await addUser()
  for (let i = 0; i < 4; i++) await call(auth.login, { body: { identifier: user.email, password: 'Wrong#Pass1' } })
  const ok = await call(auth.login, { body: { identifier: user.email, password: PASSWORD } })
  assert.equal(ok.status, 200)
  assert.equal(user.failedLoginAttempts, 0)
  for (let i = 0; i < 4; i++) await call(auth.login, { body: { identifier: user.email, password: 'Wrong#Pass1' } })
  const stillOk = await call(auth.login, { body: { identifier: user.email, password: PASSWORD } })
  assert.equal(stillOk.status, 200)
})

// ── SEC-05 · logout audit ────────────────────────────────────────────────────
const cookieFor = (user) => jwt.sign({ id: user.id, role: user.role, tokenVersion: user.tokenVersion }, process.env.JWT_SECRET)

test('SEC-05: an officer logging out is recorded in the audit log', async () => {
  const officer = await addUser({ role: 'SECRETARY' })
  const r = await call(auth.logout, { cookies: { 'LITL-MIS': cookieFor(officer) } })
  assert.equal(r.status, 200)
  assert.deepEqual(audit, [{ actorId: officer.id, action: 'LOGOUT' }])
  assert.ok(r.cleared.includes('LITL-MIS'))
})

test('SEC-05: members, stale tokens and garbage cookies still log out cleanly without an entry', async () => {
  const member = await addUser()
  const officer = await addUser({ role: 'SECRETARY' })
  const staleToken = cookieFor(officer)
  officer.tokenVersion += 1
  for (const token of [cookieFor(member), staleToken, 'not-a-jwt', undefined]) {
    const r = await call(auth.logout, { cookies: token ? { 'LITL-MIS': token } : {} })
    assert.equal(r.status, 200)
    assert.ok(r.cleared.includes('LITL-MIS'))
  }
  assert.equal(audit.length, 0)
})

// ── RES-01 · email failure rollback ──────────────────────────────────────────
const registration = {
  firstName: 'Juan', lastName: 'Cruz', sex: 'MALE', studentNumber: '2024-100-77',
  yearLevel: '1st Year', section: '1', hasCvsuEmail: true, email: 'juan.cruz@cvsu.edu.ph',
  password: 'Strong#Pass1', confirmPassword: 'Strong#Pass1',
}

test('RES-01: a failed verification email removes the pending registration so the student can retry', async () => {
  failEmail = true
  const failed = await call(auth.register, { body: registration })
  assert.equal(failed.status, 500)
  assert.equal(db.pending.length, 0)

  failEmail = false
  const retry = await call(auth.register, { body: registration })
  assert.equal(retry.status, 201)
  assert.equal(db.pending.length, 1)
})

test('RES-01: a failed email-change code removes the pending change', async () => {
  const user = await addUser({ emailType: 'PERSONAL', email: 'juan@gmail.com' })
  failEmail = true
  const r = await call(auth.requestEmailChange, { user: { id: user.id, role: user.role }, body: { newEmail: 'juan.new@cvsu.edu.ph' } })
  assert.equal(r.status, 500)
  assert.equal(db.pendingEmail.length, 0)
})

// ── SEC-03 · push endpoint allow-list ────────────────────────────────────────
const keys = { p256dh: 'BOr-test-p256dh-key', auth: 'test-auth-secret' }

test('SEC-03: internal and look-alike push endpoints are rejected', async () => {
  const user = await addUser()
  const bad = [
    'http://127.0.0.1:5000/api/health',
    'https://127.0.0.1/',
    'https://169.254.169.254/latest/meta-data',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evil.example/fcm.googleapis.com',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://storage.googleapis.com/bucket/x',
    'not a url',
    ['https://fcm.googleapis.com/fcm/send/abc'],
  ]
  for (const endpoint of bad) {
    const r = await call(notifications.subscribePush, { user: { id: user.id }, body: { endpoint, keys } })
    assert.equal(r.status, 400, `should reject ${endpoint}`)
  }
  assert.equal(db.pushSubs.length, 0)
})

test('SEC-03: real browser push services are accepted', async () => {
  const user = await addUser()
  const good = [
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]
  for (const endpoint of good) {
    const r = await call(notifications.subscribePush, { user: { id: user.id }, body: { endpoint, keys } })
    assert.equal(r.status, 201, `should accept ${endpoint}`)
  }
})

test('Push: a browser endpoint belongs only to the user who signed in last', async () => {
  const studentA = await addUser()
  const studentB = await addUser()
  const endpoint = 'https://fcm.googleapis.com/fcm/send/shared-lab-pc'
  await call(notifications.subscribePush, { user: { id: studentA.id }, body: { endpoint, keys } })
  await call(notifications.subscribePush, { user: { id: studentB.id }, body: { endpoint, keys } })
  assert.deepEqual(db.pushSubs.map((s) => s.userId), [studentB.id])
  // Re-subscribing the same user just refreshes the keys — no duplicates.
  await call(notifications.subscribePush, { user: { id: studentB.id }, body: { endpoint, keys: { ...keys, auth: 'rotated-auth' } } })
  assert.equal(db.pushSubs.length, 1)
  assert.equal(db.pushSubs[0].auth, 'rotated-auth')
})

test('SEC-03: previously stored non-push endpoints are never contacted', async () => {
  db.pushSubs.push(
    { id: 1, userId: 7, endpoint: 'http://127.0.0.1:3306/', ...keys },
    { id: 2, userId: 7, endpoint: 'https://fcm.googleapis.com/fcm/send/ok', ...keys },
  )
  await sendPushToUser(7, { title: 't' })
  assert.deepEqual(pushedTo, ['https://fcm.googleapis.com/fcm/send/ok'])
})

// ── BE-01 · activity log search ──────────────────────────────────────────────
const officerReq = (query) => ({ user: { id: 1, role: 'PRESIDENT_ADMIN' }, query })
const logRow = (id, action) => ({ id, action, details: null, createdAt: new Date(), actor: null, targetUser: null })

test('BE-01: search runs in the database query, not on the fetched page', async () => {
  db.auditLogs = [logRow(1, 'PAYMENT_RECORDED'), logRow(2, 'LOGIN_SUCCESS')]
  const r = await call(listAuditLogs, officerReq({ q: 'juan cruz', page: '3' }))
  assert.equal(r.status, 200)
  const { where, skip } = auditFindManyCalls[0]
  assert.ok(Array.isArray(where.OR))
  assert.deepEqual(where.OR[0], { details: { contains: 'juan cruz' } })
  assert.equal(where.OR[1].actor.member.AND.length, 2) // every word must match a name part
  assert.equal(skip, 100)
  assert.equal(r.body.logs.length, 2) // rows returned by the query are not filtered again
})

test('BE-01: searching an action label matches its action keys', async () => {
  await call(listAuditLogs, officerReq({ q: 'login' }))
  const actionClause = auditFindManyCalls[0].where.OR.find((c) => c.action)
  assert.ok(actionClause.action.in.includes('LOGIN_SUCCESS'))
})

test('BE-01: no search term adds no OR clause', async () => {
  await call(listAuditLogs, officerReq({}))
  assert.equal(auditFindManyCalls[0].where.OR, undefined)
})

test('BE-03: array or invalid query params return 400 or are ignored, never 500', async () => {
  const arrays = await call(listAuditLogs, officerReq({ q: ['a', 'b'], action: ['X', 'Y'] }))
  assert.equal(arrays.status, 200)
  assert.equal(auditFindManyCalls[0].where.action, undefined)
  const badDate = await call(listAuditLogs, officerReq({ dateFrom: 'not-a-date' }))
  assert.equal(badDate.status, 400)
})
