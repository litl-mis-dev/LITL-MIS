// Audit round 6: a deleted event lets go of its disbursement, attendance
// counts each registered member once, and the member fund summary returns
// only what the member dashboard shows. Controllers run against a small fake
// database — no MySQL or network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const Decimal = require('decimal.js')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

// ── Fake database ────────────────────────────────────────────────────────────
let db
let nextId
const reset = () => {
  db = { events: [], disbursements: [], attendances: [], users: [], semesters: [], auditLogs: [] }
  nextId = 100
}
const byId = (rows, id) => rows.find((r) => r.id === id) ?? null
const withIncludes = (event) => ({ ...event, _count: { attendances: 0 }, disbursement: null })

// The QR filters recordAttendance uses: equality, or "ends with".
const qrMatches = (qrCode, cond) => (typeof cond === 'string' ? qrCode === cond : qrCode.endsWith(cond.endsWith))

const fakePrisma = {
  event: {
    findUnique: async ({ where }) => {
      const event = byId(db.events, where.id)
      return event && withIncludes(event)
    },
    update: async ({ where, data }) => {
      const event = byId(db.events, where.id)
      Object.assign(event, data)
      return withIncludes(event)
    },
  },
  disbursement: {
    findUnique: async ({ where }) => {
      const d = byId(db.disbursements, where.id)
      if (!d) return null
      const event = db.events.find((e) => e.disbursementId === d.id) ?? null
      return { ...d, semester: { schoolYear: '2026-2027' }, event: event && { id: event.id, title: event.title } }
    },
  },
  user: {
    findUnique: async ({ where, select }) => {
      const user = db.users.find((u) => u.studentNumber === where.studentNumber) ?? null
      if (!user) return null
      return { role: user.role, ...(select?.member && { member: user.hasMember ? { id: user.id } : null }) }
    },
  },
  eventAttendance: {
    findFirst: async ({ where }) => db.attendances.find((a) => a.eventId === where.eventId
      && where.OR.some((c) => qrMatches(a.qrCode, c.qrCode))) ?? null,
    create: async ({ data }) => {
      if (db.attendances.some((a) => a.eventId === data.eventId && a.qrCode === data.qrCode)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      }
      const row = { id: nextId++, checkedInAt: new Date(), ...data }
      db.attendances.push(row)
      return row
    },
  },
  semester: {
    findFirst: async ({ where, select }) => {
      const semester = db.semesters.find((s) => s.isActive === where.isActive) ?? null
      if (!semester || !select) return semester
      return Object.fromEntries(Object.keys(select).map((key) => [key, semester[key]]))
    },
  },
}

stub('src/lib/prisma.js', fakePrisma)
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { db.auditLogs.push(entry) } })
stub('src/realtime/socket.js', { emitToOfficers: () => {}, emitToAll: () => {}, emitToUser: () => {}, emitToHashChain: () => {} })
stub('src/controllers/certification.controller.js', { ensureEventCertificationFolder: async () => {}, ensureCertificationArchive: async () => {} })
stub('src/services/notification.service.js', {})
stub('src/services/membershipStatus.service.js', {})
stub('src/services/calculations.service.js', {
  RETURNS_SUMMARY_INCLUDE: {},
  summarizeReturns: () => ({ amountSpent: '0.00' }),
  getTotalFund: async () => new Decimal('1500'),
  getTurnoverAmount: async () => new Decimal('500'),
  getSemesterEndingBalance: async () => new Decimal('1200'),
})

const eventCtrl = require(path.join(backend, 'src/controllers/event.controller'))
const semesterCtrl = require(path.join(backend, 'src/controllers/semester.controller'))

const call = async (handler, req = {}) => {
  const res = { statusCode: 200 }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await handler({ user: { id: 1, effectiveRole: 'PRESIDENT_ADMIN' }, params: {}, body: {}, query: {}, ...req }, res)
  return res
}
const addEvent = (fields = {}) => {
  const event = { id: nextId++, title: 'Seminar', isArchived: false, disbursementId: null, ...fields }
  db.events.push(event)
  return event
}
const scan = (eventId, qrCode) => call(eventCtrl.recordAttendance, { params: { id: String(eventId) }, body: { qrCode } })

// ── A deleted event lets go of its disbursement ──────────────────────────────
test('deleting a funded event frees its disbursement for another event', async () => {
  reset()
  db.disbursements.push({ id: 7, reference: 'DISB-7', isArchived: false })
  const event = addEvent({ title: 'Seminar', disbursementId: 7 })

  const res = await call(eventCtrl.archiveEvent, { params: { id: String(event.id) } })
  assert.equal(res.statusCode, 200)
  assert.equal(event.isArchived, true)
  assert.equal(event.disbursementId, null, 'the link is cleared')

  const log = db.auditLogs.find((l) => l.action === 'EVENT_ARCHIVED')
  assert.equal(log.details.disbursementId, 7, 'the Activity Log keeps which disbursement funded it')

  const disbursement = await fakePrisma.disbursement.findUnique({ where: { id: 7 } })
  assert.equal(disbursement.event, null, 'no event holds it any more')
})

test('deleting an event without a disbursement logs no disbursement', async () => {
  reset()
  const event = addEvent()
  await call(eventCtrl.archiveEvent, { params: { id: String(event.id) } })
  assert.equal('disbursementId' in db.auditLogs[0].details, false)
})

// ── Attendance counts each registered member once ────────────────────────────
test('a QR code that is not a member card is refused with a reason', async () => {
  reset()
  const event = addEvent()
  const res = await scan(event.id, 'https://example.com/some-other-qr')
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /doesn't belong to a registered member/)
  assert.equal(db.attendances.length, 0, 'nothing is counted')
})

test('a member is checked in once even when their card shows an older name', async () => {
  reset()
  db.users.push({ id: 1, studentNumber: '2023-100-123', role: 'MEMBER', hasMember: true })
  const event = addEvent()

  const first = await scan(event.id, 'Juan Dela Cruz\n2023-100-123')
  assert.equal(first.statusCode, 201)

  const renamed = await scan(event.id, 'Juan P. Dela Cruz\n2023-100-123')
  assert.equal(renamed.statusCode, 409, 'same student number, different name text')
  assert.equal(db.attendances.length, 1)

  const sameCard = await scan(event.id, 'Juan Dela Cruz\n2023-100-123')
  assert.equal(sameCard.statusCode, 409)
})

test('another member with a similar student number still checks in', async () => {
  reset()
  db.users.push({ id: 1, studentNumber: '2023-100-123', role: 'MEMBER', hasMember: true })
  db.users.push({ id: 2, studentNumber: '2023-100-1234', role: 'MEMBER', hasMember: true })
  const event = addEvent()
  assert.equal((await scan(event.id, 'Ana Cruz\n2023-100-1234')).statusCode, 201)
  assert.equal((await scan(event.id, 'Juan Cruz\n2023-100-123')).statusCode, 201)
})

test('advisers and the Developer are still refused with their own reason', async () => {
  reset()
  db.users.push({ id: 1, studentNumber: '2020-000-001', role: 'ADVISER_DEPT_CHAIR', hasMember: false })
  db.users.push({ id: 2, studentNumber: '2020-000-002', role: 'DEVELOPER', hasMember: false })
  const event = addEvent()
  assert.match((await scan(event.id, 'Adviser\n2020-000-001')).body.message, /Advisers are not members/)
  assert.match((await scan(event.id, 'Dev\n2020-000-002')).body.message, /Developer account/)
})

// ── Member fund summary ──────────────────────────────────────────────────────
test('the member fund summary does not list every active member', async () => {
  reset()
  db.semesters.push({
    id: 3, schoolYear: '2026-2027', semester: 'FIRST', isActive: true,
    activeMemberIds: [11, 12, 13], beginningBalance: '900.00', endingBalance: null,
  })
  const res = await call(semesterCtrl.getActiveSemesterMemberSummary, { user: { id: 9, effectiveRole: 'MEMBER' } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.semester, { id: 3, schoolYear: '2026-2027', semester: 'FIRST', isActive: true })
  assert.equal(res.body.totalFund, '2000.00')
  assert.equal(res.body.remainingFund, '1200.00')
})
