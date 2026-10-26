// Tests for the Developer account: created only for the first registration
// on an empty system (once, even under a race), limited to approving
// registrations and assigning the President, switched off once a President
// exists, and kept out of member/officer lists. Runs against an in-memory
// fake Prisma — no database, email or network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const bcrypt = require('bcrypt')

process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-123'
const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

// ── Fake database with transaction rollback ──────────────────────────────────
let db
let nextId
let failDeveloperInsert = false
const reset = () => {
  db = { users: [], members: [], pending: [], developer: [], assignments: [], rolePermissions: [] }
  nextId = 1
  failDeveloperInsert = false
}
const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('in' in v) return v.in.includes(row[k])
    if ('notIn' in v) return !v.notIn.includes(row[k])
    return true // relation filters are not needed by these tests
  }
  return row[k] === v
})
const P2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })

const fakePrisma = {
  user: {
    count: async () => db.users.length,
    findUnique: async ({ where }) => {
      const u = db.users.find((x) => matches(x, where))
      return u ? { ...u, member: db.members.find((m) => m.userId === u.id) ?? null } : null
    },
    findFirst: async ({ where }) => db.users.find((x) => matches(x, where)) ?? null,
    create: async ({ data }) => {
      const { member, ...rest } = data
      if (db.users.some((u) => u.email === rest.email || u.studentNumber === rest.studentNumber)) throw P2002()
      const user = { id: nextId++, failedLoginAttempts: 0, lockedUntil: null, tokenVersion: 0, createdAt: new Date(), ...rest }
      db.users.push(user)
      if (member?.create) db.members.push({ id: nextId++, userId: user.id, status: 'ACTIVE', ...member.create })
      return user
    },
    update: async ({ where, data }) => Object.assign(db.users.find((u) => u.id === where.id), data),
  },
  member: {
    findUnique: async ({ where }) => {
      const m = db.members.find((x) => x.id === where.id)
      return m ? { ...m, user: db.users.find((u) => u.id === m.userId) } : null
    },
    findMany: async () => db.members.map((m) => ({ ...m, user: db.users.find((u) => u.id === m.userId) })),
  },
  developerAccount: {
    create: async ({ data }) => {
      if (failDeveloperInsert || db.developer.some((d) => d.id === data.id)) throw P2002()
      db.developer.push({ ...data })
      return data
    },
    findUnique: async ({ where }) => db.developer.find((d) => d.userId === where.userId) ?? null,
  },
  pendingRegistration: {
    findUnique: async ({ where }) => db.pending.find((p) => matches(p, where)) ?? null,
    delete: async ({ where }) => { db.pending = db.pending.filter((p) => p.id !== where.id) },
  },
  officerAssignment: {
    findFirst: async ({ where }) => db.assignments.find((a) => a.role === where.role && a.status === 'ACTIVE' && a.memberId !== where.memberId.not) ?? null,
    updateMany: async () => ({ count: 0 }),
    create: async ({ data }) => { db.assignments.push({ id: nextId++, ...data }); return data },
  },
  rolePermission: { findMany: async () => db.rolePermissions },
  announcement: { findMany: async () => [{ id: 1, title: 'Officers only' }] },
  // Snapshot + restore so a failed transaction leaves no partial writes.
  $transaction: async (fn) => {
    const snapshot = JSON.parse(JSON.stringify(db))
    try { return await fn(fakePrisma) } catch (err) {
      db = JSON.parse(JSON.stringify(snapshot), (k, v) => (k === 'createdAt' && v ? new Date(v) : v))
      throw err
    }
  },
}

const audit = []
stub('src/lib/prisma', fakePrisma)
stub('src/utils/auditLog', { writeAuditLog: async (e) => { audit.push(e) } })
stub('src/utils/email', { sendOtpEmail: async () => {}, sendRegistrationStatusEmail: async () => {}, sendPaymentReminderEmail: async () => {}, sendContactFormEmail: async () => {} })
stub('src/services/notification.service', new Proxy({}, { get: () => async () => {} }))

const auth = require(path.join(backend, 'src/controllers/auth.controller'))
const officer = require(path.join(backend, 'src/controllers/officer.controller'))
const developer = require(path.join(backend, 'src/controllers/developer.controller'))
const { requireDeveloper, requireNoPresident } = require(path.join(backend, 'src/middleware/developer.middleware'))
const roleGuard = require(path.join(backend, 'src/middleware/role.middleware'))
const { hasAccess, invalidateCache } = require(path.join(backend, 'src/services/permissions.service'))
const roles = require(path.join(backend, 'src/utils/roles'))
const { listImportantAnnouncements } = require(path.join(backend, 'src/controllers/announcement.controller'))
const { updateRolePermissions } = require(path.join(backend, 'src/controllers/rolePermission.controller'))

const call = async (fn, req) => {
  const out = { status: 200, body: undefined }
  const res = {
    status(s) { out.status = s; return this },
    json(b) { out.body = b; return this },
    cookie() { return this }, clearCookie() { return this }, set() { return this },
  }
  await fn({ body: {}, params: {}, query: {}, cookies: {}, ip: '10.0.0.1', ...req }, res)
  return out
}
const runMiddleware = async (mw, req) => {
  let passed = false
  const out = await call((rq, rs) => mw(rq, rs, () => { passed = true }), req)
  return { passed, status: out.status }
}

const OTP = '123456'
let otpHash
const addPending = async (n) => {
  otpHash ??= await bcrypt.hash(OTP, 4)
  const p = {
    id: nextId++, token: `token-${n}`, firstName: 'Juan', middleName: null, lastName: `Cruz${n}`, suffix: null,
    sex: 'MALE', studentNumber: `2024-100-${n}`, yearLevel: '1st Year', section: '1',
    email: `user${n}@cvsu.edu.ph`, emailType: 'CVSU', password: 'hashed', otpCodeHash: otpHash,
    otpExpiresAt: new Date(Date.now() + 600000), otpAttempts: 0,
  }
  db.pending.push(p)
  return p
}
const verify = (p) => call(auth.verifyEmailOtp, { body: { otp: OTP, verificationToken: p.token } })
const developerUser = () => db.users.find((u) => u.role === 'DEVELOPER')

test.beforeEach(() => { reset(); audit.length = 0 })

// ── 1. First registration ────────────────────────────────────────────────────
test('the first registration becomes the approved Developer with no member profile', async () => {
  const r = await verify(await addPending(1))
  assert.equal(r.status, 200)
  assert.match(r.body.message, /Developer/)
  const dev = developerUser()
  assert.equal(dev.status, 'APPROVED')
  assert.equal(db.members.length, 0, 'no Member row, so it never appears in member lists')
  assert.deepEqual(db.developer, [{ id: 1, userId: dev.id, displayName: 'Juan Cruz1' }])
  assert.equal(db.pending.length, 0)
})

test('later registrations are normal members awaiting approval', async () => {
  await verify(await addPending(1))
  await verify(await addPending(2))
  const second = db.users.find((u) => u.email === 'user2@cvsu.edu.ph')
  assert.equal(second.role, 'MEMBER')
  assert.equal(second.status, 'PENDING_OFFICER_APPROVAL')
  assert.equal(db.users.filter((u) => u.role === 'DEVELOPER').length, 1)
})

test('existing systems (users already present) never get a Developer', async () => {
  db.users.push({ id: 99, email: 'old@cvsu.edu.ph', studentNumber: '2020-100-1', role: 'PRESIDENT_ADMIN', status: 'APPROVED' })
  await verify(await addPending(1))
  assert.equal(developerUser(), undefined)
  assert.equal(db.developer.length, 0)
})

test('losing the race for the single Developer row falls back to a normal registration', async () => {
  const p = await addPending(1)
  failDeveloperInsert = true // another first registration committed DeveloperAccount id=1 just before
  const r = await verify(p)
  assert.equal(r.status, 200)
  assert.equal(developerUser(), undefined, 'the partial Developer user was rolled back')
  const u = db.users.find((x) => x.email === 'user1@cvsu.edu.ph')
  assert.equal(u.role, 'MEMBER')
  assert.equal(u.status, 'PENDING_OFFICER_APPROVAL')
})

test('the database refuses a second DeveloperAccount row (fixed id = 1)', async () => {
  await verify(await addPending(1))
  await assert.rejects(() => fakePrisma.developerAccount.create({ data: { id: 1, userId: 5, displayName: 'x' } }), { code: 'P2002' })
})

// ── 2/3/4. Developer powers and their limits ─────────────────────────────────
const asDeveloper = () => ({ user: { id: developerUser().id, role: 'DEVELOPER' } })

test('only the Developer can use the developer routes', async () => {
  for (const role of ['MEMBER', 'PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SECRETARY']) {
    const r = await runMiddleware(requireDeveloper, { user: { id: 1, role } })
    assert.equal(r.passed, false, role)
    assert.equal(r.status, 403)
  }
  assert.equal((await runMiddleware(requireDeveloper, { user: { id: 1, role: 'DEVELOPER' } })).passed, true)
})

test('Developer can approve a registration and assign that member as President', async () => {
  await verify(await addPending(1))
  await verify(await addPending(2))
  const applicant = db.users.find((u) => u.email === 'user2@cvsu.edu.ph')
  assert.equal((await runMiddleware(requireNoPresident, asDeveloper())).passed, true)

  const approved = await call(officer.approveUser, { ...asDeveloper(), params: { userId: String(applicant.id) } })
  assert.equal(approved.status, 200)
  assert.equal(applicant.status, 'APPROVED')

  const memberId = db.members.find((m) => m.userId === applicant.id).id
  const assigned = await call(developer.assignPresident, { ...asDeveloper(), body: { memberId, role: 'SECRETARY' } })
  assert.equal(assigned.status, 201)
  assert.equal(applicant.role, 'PRESIDENT_ADMIN', 'the role is fixed to President even if another is sent')
})

test('Developer cannot assign any role other than President', async () => {
  await verify(await addPending(1))
  await verify(await addPending(2))
  const applicant = db.users.find((u) => u.email === 'user2@cvsu.edu.ph')
  applicant.status = 'APPROVED'
  const memberId = db.members.find((m) => m.userId === applicant.id).id
  for (const role of ['VICE_PRESIDENT_ADMIN', 'SECRETARY', 'SEN_FINANCE']) {
    const r = await call(officer.assignOfficerRole, { ...asDeveloper(), body: { memberId, role } })
    assert.equal(r.status, 403, role)
  }
  assert.equal(applicant.role, 'MEMBER')
})

test('Developer can never use the general officer routes (role guard + empty permission matrix)', async () => {
  const { OFFICER_MANAGERS } = roles
  assert.equal((await runMiddleware(roleGuard(OFFICER_MANAGERS), { user: { id: 1, role: 'DEVELOPER' } })).passed, false)
  assert.equal((await runMiddleware(roleGuard(roles.OFFICER_ROLES), { user: { id: 1, role: 'DEVELOPER' } })).passed, false)
  db.rolePermissions = [{ role: 'PRESIDENT_ADMIN', module: 'MEMBERS_APPROVAL', level: 'EDIT' }]
  invalidateCache()
  for (const m of ['MEMBERS_APPROVAL', 'MEMBER_LIST', 'FINANCIAL', 'SETTINGS_ROLES']) {
    assert.equal(await hasAccess('DEVELOPER', m, 'VIEW'), false, m)
  }
})

test('permissions can never be granted to the Developer role', async () => {
  const r = await call(updateRolePermissions, {
    user: { id: 1, role: 'PRESIDENT_ADMIN' },
    body: { permissions: [{ role: 'DEVELOPER', module: 'MEMBERS_APPROVAL', level: 'EDIT' }] },
  })
  assert.equal(r.status, 400)
})

test('once a President exists, every Developer action is refused', async () => {
  await verify(await addPending(1))
  db.users.push({ id: 50, email: 'p@cvsu.edu.ph', studentNumber: '2020-100-9', role: 'PRESIDENT_ADMIN', status: 'APPROVED' })
  const r = await runMiddleware(requireNoPresident, asDeveloper())
  assert.equal(r.passed, false)
  assert.equal(r.status, 403)
  const status = await call(developer.getStatus, asDeveloper())
  assert.deepEqual(status.body, { presidentAssigned: true })
})

test('developer routes put every action behind both guards', () => {
  const router = require(path.join(backend, 'src/routes/developer.routes'))
  const routeLayers = router.stack.filter((l) => l.route)
  for (const l of routeLayers) {
    const names = l.route.stack.map((s) => s.handle.name)
    if (l.route.path !== '/status') assert.ok(names.includes('requireNoPresident'), l.route.path)
  }
  const routerLevel = router.stack.filter((l) => !l.route).map((l) => l.handle.name)
  assert.ok(routerLevel.includes('requireDeveloper'))
  assert.ok(routerLevel.includes('authMiddleware'))
})

// ── 5. Never a member or officer ─────────────────────────────────────────────
test('the Developer role is outside every member/officer role list', () => {
  for (const list of ['ALL_ROLES', 'OFFICER_ROLES', 'HASH_CHAIN_ROLES', 'MEMBER_SIDE_ROLES', 'ASSIGNABLE_OFFICER_ROLES', 'LEADERSHIP_ROLES', 'OFFICER_MANAGERS', 'NON_MEMBER_ROLES']) {
    assert.ok(!roles[list].includes('DEVELOPER'), list)
  }
  assert.ok(roles.MEMBERSHIP_USER_FILTER.role.notIn.includes('DEVELOPER'))
  assert.equal(roles.ROLE_POSITION_LABELS.DEVELOPER, undefined)
})

test('Developer gets no officer or member announcements', async () => {
  const r = await call(listImportantAnnouncements, { user: { id: 1, role: 'DEVELOPER', effectiveRole: 'DEVELOPER' } })
  assert.deepEqual(r.body, { announcements: [] })
})

test('Developer is excluded from the President candidate list and login shows its name', async () => {
  await verify(await addPending(1))
  const list = await call(developer.listPresidentCandidates, asDeveloper())
  assert.equal(list.status, 200)
  assert.ok(!list.body.members.some((m) => m.studentNumber === '2024-100-1'))

  const dev = developerUser()
  dev.password = await bcrypt.hash('Dev#Pass123', 4)
  const login = await call(auth.login, { body: { identifier: dev.email, password: 'Dev#Pass123' } })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.role, 'DEVELOPER')
  assert.equal(login.body.user.name, 'Juan Cruz1')
  assert.equal(login.body.user.member, null)
})
