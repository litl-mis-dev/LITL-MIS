// Signed member QR codes: only a QR made by this server checks a member in or
// finds them in the Members List scanner, and the code holds no personal
// details. Controllers run against a small fake database — no MySQL or
// network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

process.env.QR_SIGNING_SECRET = 'test-qr-signing-secret-that-is-long-enough-789'

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

// ── Fake database ────────────────────────────────────────────────────────────
let db
let nextId
const reset = () => {
  db = { members: [], events: [{ id: 1, title: 'Seminar', isArchived: false }], attendances: [], auditLogs: [] }
  nextId = 100
}
const addMember = (fields = {}) => {
  const id = fields.id ?? nextId++
  const member = {
    id, firstName: 'Juan', middleName: null, lastName: 'Dela Cruz', suffix: null,
    yearLevel: '3', section: 'A', avatar: 'https://example.r2.dev/avatars/juan.jpg', status: 'ACTIVE',
    user: { id: id + 1000, role: 'MEMBER', status: 'APPROVED', studentNumber: `2023-100-${id}` },
    ...fields,
  }
  db.members.push(member)
  return member
}

const fakePrisma = {
  event: { findUnique: async ({ where }) => db.events.find((e) => e.id === where.id) ?? null },
  member: {
    findUnique: async ({ where }) => db.members.find((m) => m.id === where.id) ?? null,
    findMany: async ({ where }) => db.members.filter((m) => where.id.in.includes(m.id)),
  },
  user: {
    findMany: async ({ where }) => {
      if (where.studentNumber) {
        return db.members.filter((m) => where.studentNumber.in.includes(m.user.studentNumber))
          .map((m) => ({ studentNumber: m.user.studentNumber, member: m }))
      }
      return db.members.map((m) => ({ ...m.user, email: `${m.id}@example.test`, createdAt: new Date(), member: { ...m, payments: [] } }))
    },
  },
  semester: { findFirst: async () => null },
  eventAttendance: {
    // recordAttendance's filter: the exact code, or an older check-in ending in the student number.
    findFirst: async ({ where }) => db.attendances.find((a) => a.eventId === where.eventId && where.OR.some(({ qrCode }) =>
      typeof qrCode === 'string' ? a.qrCode === qrCode : a.qrCode.endsWith(qrCode.endsWith))) ?? null,
    findMany: async ({ where }) => db.attendances.filter((a) => a.eventId === where.eventId),
    create: async ({ data }) => {
      const row = { id: nextId++, checkedInAt: new Date(), ...data }
      db.attendances.push(row)
      return row
    },
  },
}

stub('src/lib/prisma.js', fakePrisma)
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { db.auditLogs.push(entry) } })
stub('src/realtime/socket.js', { emitToOfficers: () => {}, emitToAll: () => {}, emitToUser: () => {}, emitToHashChain: () => {} })
stub('src/controllers/certification.controller.js', { ensureEventCertificationFolder: async () => {} })
stub('src/services/notification.service.js', {})
stub('src/services/memberApproval.service.js', {})
stub('src/services/signatory.service.js', {})
stub('src/utils/email.js', {})

const { buildMemberQrText, parseMemberQrText, INVALID_MEMBER_QR_MESSAGE } = require(path.join(backend, 'src/utils/memberQr'))
const eventCtrl = require(path.join(backend, 'src/controllers/event.controller'))
const officerCtrl = require(path.join(backend, 'src/controllers/officer.controller'))

const call = async (handler, req = {}) => {
  const res = { statusCode: 200 }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await handler({ user: { id: 1, role: 'PRESIDENT_ADMIN', effectiveRole: 'PRESIDENT_ADMIN' }, params: {}, body: {}, query: {}, ...req }, res)
  return res
}
const scan = (qrCode) => call(eventCtrl.recordAttendance, { params: { id: '1' }, body: { qrCode } })
const withSecret = (secret, fn) => {
  const saved = process.env.QR_SIGNING_SECRET
  process.env.QR_SIGNING_SECRET = secret
  try { return fn() } finally { process.env.QR_SIGNING_SECRET = saved }
}

// ── The code itself ──────────────────────────────────────────────────────────
test('a member QR is LITL1, the member ID and a signature, with no name or student number', () => {
  const text = buildMemberQrText(42)
  assert.match(text, /^LITL1\.16\.[A-Za-z0-9_-]{22}$/, '42 is "16" in base 36')
  assert.deepEqual(parseMemberQrText(text), { memberId: 42 })
  assert.equal(buildMemberQrText(42), text, 'the same member always gets the same code')
})

test('homemade, edited or foreign codes are refused', () => {
  const real = buildMemberQrText(42)
  const [prefix, id, signature] = real.split('.')
  assert.deepEqual(parseMemberQrText('Juan Dela Cruz\n2023-100-123'), { error: 'NOT_LITL' }, 'the old plain-text card')
  assert.deepEqual(parseMemberQrText('https://example.com/pay'), { error: 'NOT_LITL' })
  assert.deepEqual(parseMemberQrText(`${prefix}.${'17'}.${signature}`), { error: 'INVALID' }, 'another member ID with this signature')
  const flipped = signature[0] === 'A' ? `B${signature.slice(1)}` : `A${signature.slice(1)}`
  assert.deepEqual(parseMemberQrText(`${prefix}.${id}.${flipped}`), { error: 'INVALID' }, 'one character changed')
  assert.deepEqual(parseMemberQrText(`${prefix}.${id}.`), { error: 'INVALID' })
  const madeElsewhere = withSecret('a-different-secret-somebody-guessed-000000', () => buildMemberQrText(42))
  assert.deepEqual(parseMemberQrText(madeElsewhere), { error: 'INVALID' }, 'signed with another secret')
})

// ── Event attendance ─────────────────────────────────────────────────────────
test('a plain-text or forged QR checks nobody in', async () => {
  reset()
  const member = addMember()
  for (const qr of [`Juan Dela Cruz\n${member.user.studentNumber}`, `LITL1.${member.id.toString(36).toUpperCase()}.AAAAAAAAAAAAAAAAAAAAAA`]) {
    const res = await scan(qr)
    assert.equal(res.statusCode, 400, qr)
    assert.equal(res.body.message, INVALID_MEMBER_QR_MESSAGE)
  }
  assert.equal(db.attendances.length, 0)
})

test('a real member QR checks in once and returns the name and photo', async () => {
  reset()
  const member = addMember()
  const qr = buildMemberQrText(member.id)

  const first = await scan(qr)
  assert.equal(first.statusCode, 201)
  assert.deepEqual(first.body.member, {
    userId: member.user.id, name: 'Juan Dela Cruz', studentNumber: member.user.studentNumber,
    yearLevel: '3', section: 'A', avatar: 'https://example.r2.dev/avatars/juan.jpg',
  })
  assert.equal(db.auditLogs[0].details.studentNumber, member.user.studentNumber, 'the Activity Log says who, not the code')

  const again = await scan(qr)
  assert.equal(again.statusCode, 409)
  assert.equal(db.attendances.length, 1)
})

test('a member checked in before codes were signed is not checked in twice', async () => {
  reset()
  const member = addMember()
  db.attendances.push({ id: 1, eventId: 1, qrCode: `Juan Dela Cruz\n${member.user.studentNumber}`, checkedInAt: new Date() })
  const res = await scan(buildMemberQrText(member.id))
  assert.equal(res.statusCode, 409)
  assert.equal(db.attendances.length, 1)
})

test('a valid signature for a member who does not exist is refused', async () => {
  reset()
  const res = await scan(buildMemberQrText(999))
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.message, INVALID_MEMBER_QR_MESSAGE)
})

test('advisers and the Developer are still refused with their own reason', async () => {
  reset()
  const adviser = addMember({ firstName: 'Ana' })
  adviser.user.role = 'ADVISER_DEPT_CHAIR'
  const developer = addMember({ firstName: 'Dev' })
  developer.user.role = 'DEVELOPER'
  assert.match((await scan(buildMemberQrText(adviser.id))).body.message, /Advisers are not members/)
  assert.match((await scan(buildMemberQrText(developer.id))).body.message, /Developer account/)
})

test('the attendance list names members from signed codes and from older plain-text check-ins', async () => {
  reset()
  const juan = addMember()
  const ana = addMember({ firstName: 'Ana', lastName: 'Cruz' })
  db.attendances.push({ id: 1, eventId: 1, qrCode: buildMemberQrText(juan.id), checkedInAt: new Date() })
  db.attendances.push({ id: 2, eventId: 1, qrCode: `Ana Cruz\n${ana.user.studentNumber}`, checkedInAt: new Date() })

  const res = await call(eventCtrl.getAttendance, { params: { id: '1' } })
  assert.deepEqual(res.body.attendances.map((a) => a.member?.name).sort(), ['Ana Cruz', 'Juan Dela Cruz'])
})

// ── Members List scanner ─────────────────────────────────────────────────────
test('the Members List scanner finds a member only from a real QR', async () => {
  reset()
  const member = addMember()
  const ok = await call(officerCtrl.scanMemberQr, { body: { qrCode: buildMemberQrText(member.id) } })
  assert.deepEqual(ok.body, { memberId: member.id })

  const plain = await call(officerCtrl.scanMemberQr, { body: { qrCode: member.user.studentNumber } })
  assert.equal(plain.statusCode, 400)
  assert.equal(plain.body.message, INVALID_MEMBER_QR_MESSAGE)
})

test('the Members List scanner does not find a member who is not approved', async () => {
  reset()
  const pending = addMember()
  pending.user.status = 'PENDING_OFFICER_APPROVAL'
  const res = await call(officerCtrl.scanMemberQr, { body: { qrCode: buildMemberQrText(pending.id) } })
  assert.equal(res.statusCode, 404)
})

test('cards downloaded from the Members List carry the signed code', async () => {
  reset()
  const member = addMember()
  const res = await call(officerCtrl.getApprovedMembers)
  assert.equal(res.body.members[0].qrCodePayload, buildMemberQrText(member.id))
})

// ── Settings check at startup ────────────────────────────────────────────────
test('production refuses to start with a missing, short or reused QR_SIGNING_SECRET', () => {
  const validateEnv = require(path.join(backend, 'src/utils/validateEnv'))
  const base = {
    NODE_ENV: 'production', DATABASE_URL: 'mysql://x', FRONTEND_URL: 'https://litltrece.me',
    JWT_SECRET: 'j'.repeat(40), RESET_TOKEN_SECRET: 'r'.repeat(40), QR_SIGNING_SECRET: 'q'.repeat(40),
    SMTP_USER: 'x', SMTP_PASS: 'x', EMAIL_FROM: 'x', R2_ACCOUNT_ID: 'x', R2_ACCESS_KEY_ID: 'x',
    R2_SECRET_ACCESS_KEY: 'x', R2_BUCKET: 'x', R2_PUBLIC_URL: 'x',
    VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'x', VAPID_CONTACT_EMAIL: 'mailto:a@b.c',
  }
  const exits = (overrides) => {
    const saved = { ...process.env }
    const { exit, error } = { exit: process.exit, error: console.error }
    let exited = false
    process.exit = () => { exited = true; throw new Error('exit') }
    console.error = () => {}
    Object.assign(process.env, base, overrides)
    for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete process.env[key]
    try { validateEnv() } catch { /* the fake exit */ } finally {
      process.exit = exit
      console.error = error
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
      Object.assign(process.env, saved)
    }
    return exited
  }
  assert.equal(exits({}), false, 'a good configuration starts')
  assert.equal(exits({ QR_SIGNING_SECRET: undefined }), true, 'missing')
  assert.equal(exits({ QR_SIGNING_SECRET: 'short' }), true, 'too short')
  assert.equal(exits({ QR_SIGNING_SECRET: 'j'.repeat(40) }), true, 'same as JWT_SECRET')
})
