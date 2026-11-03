// Adviser / Department Chair invitations: President-only management, seat
// limits (2 Advisers + 1 Department Chair), one-time 48-hour links, accept,
// resend, revoke, deactivate (sessions end, history kept), reactivate and
// title change. Runs against an in-memory fake Prisma — no database, email or
// network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-123'
process.env.FRONTEND_URL = 'https://litltrece.me'
const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

// ── Fake database ────────────────────────────────────────────────────────────
let db
let nextId
const reset = () => { db = { users: [], members: [], invites: [], pushSubs: [] }; nextId = 1 }

const cond = (value, c) => {
  if (c === null) return value === null || value === undefined
  if (c && typeof c === 'object' && !(c instanceof Date)) {
    if ('gt' in c) return value > c.gt
    if ('not' in c) return value !== c.not
    if ('in' in c) return c.in.includes(value)
    if ('notIn' in c) return !c.notIn.includes(value)
  }
  return value === c
}
const matches = (row, where = {}) => Object.entries(where).every(([k, c]) => cond(row[k], c))
const withMember = (u) => u && { ...u, member: db.members.find((m) => m.userId === u.id) ?? null }
const P2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })

let lockCalls = 0
const fakePrisma = {
  user: {
    count: async ({ where }) => db.users.filter((u) => matches(u, where)).length,
    findUnique: async ({ where }) => withMember(db.users.find((u) => matches(u, where))) ?? null,
    findMany: async ({ where }) => db.users.filter((u) => matches(u, where)).map(withMember),
    create: async ({ data }) => {
      const { member, ...rest } = data
      if (db.users.some((u) => u.email === rest.email)) throw P2002()
      const user = { id: nextId++, tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null, studentNumber: null, adviserTitle: null, createdAt: new Date(), updatedAt: new Date(), ...rest }
      db.users.push(user)
      if (member?.create) db.members.push({ id: nextId++, userId: user.id, yearLevel: null, section: null, status: 'ACTIVE', ...member.create })
      return user
    },
    update: async ({ where, data }) => {
      const u = db.users.find((x) => x.id === where.id)
      for (const [k, v] of Object.entries(data)) u[k] = v && typeof v === 'object' && 'increment' in v ? u[k] + v.increment : v
      return u
    },
  },
  adviserInvite: {
    count: async ({ where }) => db.invites.filter((i) => matches(i, where)).length,
    findFirst: async ({ where }) => db.invites.find((i) => matches(i, where)) ?? null,
    findUnique: async ({ where }) => db.invites.find((i) => matches(i, where)) ?? null,
    findMany: async ({ where }) => db.invites.filter((i) => matches(i, where)),
    create: async ({ data }) => {
      const row = { id: nextId++, suffix: null, acceptedAt: null, acceptedUserId: null, revokedAt: null, createdAt: new Date(), ...data }
      db.invites.push(row)
      return row
    },
    update: async ({ where, data }) => Object.assign(db.invites.find((i) => i.id === where.id), data),
  },
  pushSubscription: { deleteMany: async ({ where }) => { db.pushSubs = db.pushSubs.filter((s) => s.userId !== where.userId) } },
  $queryRaw: async () => { lockCalls++; return [{ got: 1 }] },
  $transaction: async (arg) => {
    if (Array.isArray(arg)) return Promise.all(arg)
    const snapshot = JSON.stringify(db)
    try { return await arg(fakePrisma) } catch (err) {
      db = JSON.parse(snapshot, (k, v) => (/At$/.test(k) && v ? new Date(v) : v))
      throw err
    }
  },
}

const sentEmails = []
let failEmail = false
const audit = []
const disconnected = []
stub('src/lib/prisma', fakePrisma)
stub('src/utils/auditLog', { writeAuditLog: async (e) => { audit.push(e) } })
stub('src/utils/email', {
  sendAdviserInviteEmail: async (m) => { if (failEmail) throw new Error('SMTP down'); sentEmails.push(m) },
  sendOtpEmail: async () => { sentEmails.push({ otp: true }) },
  sendRegistrationStatusEmail: async () => {}, sendPaymentReminderEmail: async () => {}, sendContactFormEmail: async () => {},
})
stub('src/realtime/socket', new Proxy({}, { get: (_, name) => (name === 'disconnectUser' ? (id) => disconnected.push(id) : () => {}) }))
stub('src/services/notification.service', new Proxy({}, { get: () => async () => {} }))

const ctrl = require(path.join(backend, 'src/controllers/adviser.controller'))
const auth = require(path.join(backend, 'src/controllers/auth.controller'))
const authMiddleware = require(path.join(backend, 'src/middleware/auth.middleware'))
const roleGuard = require(path.join(backend, 'src/middleware/role.middleware'))
const roles = require(path.join(backend, 'src/utils/roles'))

const call = async (fn, req) => {
  const out = { status: 200, body: undefined }
  const res = {
    status(s) { out.status = s; return this },
    json(b) { out.body = b; return this },
    cookie() { return this }, clearCookie() { return this }, set() { return this },
  }
  await fn({ body: {}, params: {}, query: {}, cookies: {}, headers: {}, ip: '10.0.0.1', ...req }, res)
  return out
}
const runMiddleware = async (mw, req) => {
  let passed = false
  const out = await call((rq, rs) => mw(rq, rs, () => { passed = true }), req)
  return { passed, status: out.status }
}

let president
const asPresident = () => ({ user: { id: president.id, role: 'PRESIDENT_ADMIN' } })
const tokenFrom = (email) => new URL(email.link).hash.replace('#token=', '')
const invite = async (overrides = {}) => {
  const n = nextId
  const r = await call(ctrl.createInvite, { ...asPresident(), body: { firstName: 'Maria', lastName: 'Santos', email: `adviser${n}@cvsu.edu.ph`, title: 'ADVISER', ...overrides } })
  return { ...r, token: r.status === 201 ? tokenFrom(sentEmails.at(-1)) : null }
}
const accept = (token, overrides = {}) => call(ctrl.acceptInvite, {
  body: { token, firstName: 'Maria', lastName: 'Santos', sex: 'FEMALE', password: 'Strong#Pass1', confirmPassword: 'Strong#Pass1', ...overrides },
})
const adviserUsers = () => db.users.filter((u) => u.role === 'ADVISER_DEPT_CHAIR')
// A refused request rolls the fake DB back to fresh row objects — always re-read.
const userById = (id) => db.users.find((u) => u.id === id)

test.beforeEach(() => {
  reset()
  sentEmails.length = 0
  audit.length = 0
  disconnected.length = 0
  failEmail = false
  president = { id: nextId++, email: 'president@cvsu.edu.ph', role: 'PRESIDENT_ADMIN', status: 'APPROVED', tokenVersion: 0, adviserTitle: null }
  db.users.push(president)
})

// ── Inviting ─────────────────────────────────────────────────────────────────
test('President invite: emails a one-time link (token in #fragment), stores only its hash, expires in 48 h', async () => {
  const r = await invite({ title: 'DEPT_CHAIR' })
  assert.equal(r.status, 201)
  const mail = sentEmails[0]
  assert.match(mail.link, /^https:\/\/litltrece\.me\/adviser-invite#token=[A-Za-z0-9_-]{40,}$/)
  assert.equal(mail.titleLabel, 'Department Chair')
  const row = db.invites[0]
  assert.equal(row.tokenHash, ctrl.hashToken(r.token))
  assert.ok(!JSON.stringify(row).includes(r.token), 'the raw token is never stored')
  const hours = (row.expiresAt - Date.now()) / 3600000
  assert.ok(hours > 47.9 && hours <= 48)
  assert.equal(audit.at(-1).action, 'ADVISER_INVITED')
})

test('seat limits: 2 Advisers and 1 Department Chair, counting pending invites', async () => {
  assert.equal((await invite()).status, 201)
  assert.equal((await invite()).status, 201)
  const third = await invite()
  assert.equal(third.status, 409)
  assert.match(third.body.message, /Adviser seats are taken \(2\/2\)/)
  assert.equal((await invite({ title: 'DEPT_CHAIR' })).status, 201)
  assert.equal((await invite({ title: 'DEPT_CHAIR' })).status, 409)
  assert.ok(lockCalls > 0, 'seat checks run under the database lock')
})

test('no duplicate invites and no invites to existing accounts', async () => {
  await invite({ email: 'dup@cvsu.edu.ph' })
  assert.equal((await invite({ email: 'dup@cvsu.edu.ph' })).status, 409)
  assert.equal((await invite({ email: 'president@cvsu.edu.ph' })).status, 409)
})

test('invalid invite input is rejected', async () => {
  for (const body of [{ firstName: '' }, { lastName: 'X1' }, { email: 'not-an-email' }, { title: 'PRESIDENT_ADMIN' }, { suffix: '<b>' }, { firstName: ['Maria'] }]) {
    assert.equal((await invite(body)).status, 400, JSON.stringify(body))
  }
  assert.equal(db.invites.length, 0)
})

test('if the invitation email fails, the invite is revoked so its seat is freed', async () => {
  failEmail = true
  const r = await invite()
  assert.equal(r.status, 502)
  assert.ok(db.invites[0].revokedAt)
  failEmail = false
  assert.equal((await invite()).status, 201)
  assert.equal((await invite()).status, 201)
})

// ── The invited person ───────────────────────────────────────────────────────
test('lookup prefills the accept page; bad, expired or revoked links are refused', async () => {
  const { token } = await invite()
  const ok = await call(ctrl.lookupInvite, { body: { token } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.invite.titleLabel, 'Adviser')
  assert.equal((await call(ctrl.lookupInvite, { body: { token: 'x'.repeat(43) } })).status, 410)
  assert.equal((await call(ctrl.lookupInvite, { body: { token: ['a'] } })).status, 400)
  db.invites[0].expiresAt = new Date(Date.now() - 1000)
  assert.equal((await call(ctrl.lookupInvite, { body: { token } })).status, 410)
})

test('accepting creates an approved adviser with only the needed data, and the link works once', async () => {
  const { token } = await invite({ title: 'DEPT_CHAIR', email: 'Chair@CvSU.edu.ph' })
  const r = await accept(token, { suffix: 'Jr.' })
  assert.equal(r.status, 201)
  const user = adviserUsers()[0]
  assert.equal(user.email, 'chair@cvsu.edu.ph')
  assert.equal(user.status, 'APPROVED')
  assert.equal(user.adviserTitle, 'DEPT_CHAIR')
  assert.equal(user.studentNumber, null)
  assert.equal(user.emailType, 'CVSU')
  assert.ok(await bcrypt.compare('Strong#Pass1', user.password))
  const member = db.members.find((m) => m.userId === user.id)
  assert.deepEqual([member.firstName, member.lastName, member.suffix, member.sex, member.yearLevel, member.section], ['Maria', 'Santos', 'Jr.', 'FEMALE', null, null])
  assert.ok(db.invites[0].acceptedAt)
  assert.equal(audit.at(-1).action, 'ADVISER_JOINED')
  assert.equal((await accept(token)).status, 410, 'second use of the same link fails')
})

test('accept validates every field and never crashes on wrong types', async () => {
  const { token } = await invite()
  for (const bad of [{ password: 'weak' }, { confirmPassword: 'Other#Pass1' }, { sex: 'OTHER' }, { firstName: 42 }, { lastName: '' }, { password: ['x'] }]) {
    const r = await accept(token, bad)
    assert.equal(r.status, 400, JSON.stringify(bad))
  }
  assert.equal(adviserUsers().length, 0)
})

test('accept is refused when active advisers already fill the title', async () => {
  const { token } = await invite()
  db.users.push({ id: nextId++, email: 'a1@x.ph', role: 'ADVISER_DEPT_CHAIR', status: 'APPROVED', adviserTitle: 'ADVISER' },
                { id: nextId++, email: 'a2@x.ph', role: 'ADVISER_DEPT_CHAIR', status: 'APPROVED', adviserTitle: 'ADVISER' })
  assert.equal((await accept(token)).status, 409)
  assert.equal(adviserUsers().length, 2)
})

test('resend issues a new link and kills the old one; revoke kills the link and frees the seat', async () => {
  const first = await invite()
  const resent = await call(ctrl.resendInvite, { ...asPresident(), params: { id: String(db.invites[0].id) } })
  assert.equal(resent.status, 200)
  const newToken = tokenFrom(sentEmails.at(-1))
  assert.notEqual(newToken, first.token)
  assert.equal((await call(ctrl.lookupInvite, { body: { token: first.token } })).status, 410)
  assert.equal((await call(ctrl.lookupInvite, { body: { token: newToken } })).status, 200)

  await invite()
  assert.equal((await invite()).status, 409)
  const revoked = await call(ctrl.revokeInvite, { ...asPresident(), params: { id: String(db.invites[0].id) } })
  assert.equal(revoked.status, 200)
  assert.equal((await call(ctrl.lookupInvite, { body: { token: newToken } })).status, 410)
  assert.equal((await invite()).status, 201, 'the revoked seat is free again')
})

test('an expired invite releases its seat; resending it needs a free seat again', async () => {
  await invite()
  await invite()
  db.invites[0].expiresAt = new Date(Date.now() - 1000)
  assert.equal((await invite()).status, 201, 'expired invite no longer holds a seat')
  const r = await call(ctrl.resendInvite, { ...asPresident(), params: { id: String(db.invites[0].id) } })
  assert.equal(r.status, 409)
})

// ── Managing advisers ────────────────────────────────────────────────────────
const joinedAdviser = async (title = 'ADVISER') => {
  const { token } = await invite({ title })
  await accept(token)
  return adviserUsers().at(-1)
}

test('deactivate blocks login, ends sessions and push, frees the seat, keeps the account', async () => {
  const adviser = await joinedAdviser()
  adviser.password = await bcrypt.hash('Strong#Pass1', 4)
  db.pushSubs.push({ userId: adviser.id, endpoint: 'https://fcm.googleapis.com/x' })
  const oldCookie = jwt.sign({ id: adviser.id, role: adviser.role, tokenVersion: adviser.tokenVersion }, process.env.JWT_SECRET)

  const r = await call(ctrl.deactivateAdviser, { ...asPresident(), params: { userId: String(adviser.id) } })
  assert.equal(r.status, 200)
  assert.equal(adviser.status, 'DEACTIVATED')
  assert.equal(adviser.tokenVersion, 1)
  assert.deepEqual(disconnected, [adviser.id])
  assert.equal(db.pushSubs.length, 0)
  assert.ok(db.users.includes(adviser), 'account and history are kept')

  const session = await runMiddleware(authMiddleware, { cookies: { 'LITL-MIS': oldCookie } })
  assert.equal(session.passed, false)
  assert.equal(session.status, 401)
  const login = await call(auth.login, { body: { identifier: adviser.email, password: 'Strong#Pass1' } })
  assert.equal(login.status, 403)
  assert.match(login.body.message, /deactivated/)

  assert.equal((await invite()).status, 201)
  assert.equal((await invite()).status, 201, 'both Adviser seats are free again')
})

test('a deactivated account gets no password-reset codes', async () => {
  const adviser = await joinedAdviser()
  await call(ctrl.deactivateAdviser, { ...asPresident(), params: { userId: String(adviser.id) } })
  sentEmails.length = 0
  db.otps = []
  const r = await call(auth.forgotPassword, { body: { email: adviser.email } })
  assert.equal(r.status, 200)
  assert.equal(sentEmails.length, 0)
})

test('reactivate only into a free seat', async () => {
  const adviser = await joinedAdviser()
  await call(ctrl.deactivateAdviser, { ...asPresident(), params: { userId: String(adviser.id) } })
  await invite()
  await invite()
  const blocked = await call(ctrl.reactivateAdviser, { ...asPresident(), params: { userId: String(adviser.id) } })
  assert.equal(blocked.status, 409)
  await call(ctrl.revokeInvite, { ...asPresident(), params: { id: String(db.invites.at(-1).id) } })
  const ok = await call(ctrl.reactivateAdviser, { ...asPresident(), params: { userId: String(adviser.id) } })
  assert.equal(ok.status, 200)
  assert.equal(userById(adviser.id).status, 'APPROVED')
})

test('title change only into a free seat', async () => {
  const chair = await joinedAdviser('DEPT_CHAIR')
  const adviser = await joinedAdviser('ADVISER')
  const full = await call(ctrl.changeAdviserTitle, { ...asPresident(), params: { userId: String(adviser.id) }, body: { title: 'DEPT_CHAIR' } })
  assert.equal(full.status, 409)
  const same = await call(ctrl.changeAdviserTitle, { ...asPresident(), params: { userId: String(chair.id) }, body: { title: 'DEPT_CHAIR' } })
  assert.equal(same.status, 400)
  const ok = await call(ctrl.changeAdviserTitle, { ...asPresident(), params: { userId: String(chair.id) }, body: { title: 'ADVISER' } })
  assert.equal(ok.status, 200)
  assert.equal(userById(chair.id).adviserTitle, 'ADVISER')
  assert.equal((await call(ctrl.changeAdviserTitle, { ...asPresident(), params: { userId: String(chair.id) }, body: { title: 'NOPE' } })).status, 400)
})

test('management actions refuse non-advisers', async () => {
  const r = await call(ctrl.deactivateAdviser, { ...asPresident(), params: { userId: String(president.id) } })
  assert.equal(r.status, 404)
  assert.equal(president.status, 'APPROVED')
})

test('the overview reports seats, active, open invites and past advisers', async () => {
  const adviser = await joinedAdviser()
  await invite({ title: 'DEPT_CHAIR' })
  const past = await joinedAdviser()
  await call(ctrl.deactivateAdviser, { ...asPresident(), params: { userId: String(past.id) } })
  const r = await call(ctrl.listAdvisers, asPresident())
  assert.deepEqual(r.body.seats.ADVISER, { label: 'Adviser', limit: 2, used: 1 })
  assert.deepEqual(r.body.seats.DEPT_CHAIR, { label: 'Department Chair', limit: 1, used: 1 })
  assert.deepEqual(r.body.active.map((a) => a.userId), [adviser.id])
  assert.equal(r.body.invites.length, 1)
  assert.deepEqual(r.body.past.map((a) => a.userId), [past.id])
})

// ── Who may do what ─────────────────────────────────────────────────────────
test('only the President may manage advisers; the invite link endpoints are public', async () => {
  const guard = roleGuard(['PRESIDENT_ADMIN'])
  for (const role of ['VICE_PRESIDENT_ADMIN', 'SECRETARY', 'ADVISER_DEPT_CHAIR', 'DEVELOPER', 'MEMBER']) {
    assert.equal((await runMiddleware(guard, { user: { id: 1, role } })).passed, false, role)
  }
  assert.equal((await runMiddleware(guard, { user: { id: 1, role: 'PRESIDENT_ADMIN' } })).passed, true)

  const router = require(path.join(backend, 'src/routes/adviser.routes'))
  const guardIndex = router.stack.findIndex((l) => !l.route && l.handle.name === 'authMiddleware')
  const indexOf = (p) => router.stack.findIndex((l) => l.route?.path === p)
  assert.ok(indexOf('/invites/lookup') < guardIndex && indexOf('/invites/accept') < guardIndex, 'public link routes come first')
  for (const p of ['/', '/invites', '/invites/:id/resend', '/invites/:id/revoke', '/:userId/deactivate', '/:userId/reactivate', '/:userId/title']) {
    assert.ok(indexOf(p) > guardIndex, `${p} is behind the President guard`)
  }
})

test('both titles share one role, outside every member list; labels differ', () => {
  assert.ok(roles.MEMBERSHIP_USER_FILTER.role.notIn.includes('ADVISER_DEPT_CHAIR'))
  assert.ok(!roles.ASSIGNABLE_OFFICER_ROLES.includes('ADVISER_DEPT_CHAIR'), 'cannot be assigned through Manage Roles')
  assert.equal(roles.positionLabel({ role: 'ADVISER_DEPT_CHAIR', adviserTitle: 'ADVISER' }), 'Adviser')
  assert.equal(roles.positionLabel({ role: 'ADVISER_DEPT_CHAIR', adviserTitle: 'DEPT_CHAIR' }), 'Department Chair')
  assert.equal(roles.positionLabel({ role: 'SEN_FINANCE' }), 'Senator for Finance')
})
