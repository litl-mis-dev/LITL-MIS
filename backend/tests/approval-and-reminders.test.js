// Member roster (automatic approval by student number + last name),
// payment reminders sent only to the selected members, payment reminders
// pinned with the Important Announcements for 7 days, and adding new fund
// categories from Edit Categories. Runs against an in-memory fake Prisma —
// no database, email or network. Run with: npm test
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
  db = { users: [], members: [], roster: [], notifications: [], announcements: [], semesters: [], categories: [], payments: [] }
  nextId = 1
}
const cond = (value, c) => {
  if (c === undefined) return true
  if (c && typeof c === 'object' && !(c instanceof Date) && !(c instanceof Decimal)) {
    if ('in' in c) return c.in.includes(value)
    if ('notIn' in c) return !c.notIn.includes(value)
    if ('not' in c) return value !== c.not
    if ('gt' in c) return value > c.gt
    return Object.entries(c).every(([k, v]) => cond(value?.[k], v)) // nested relation filter
  }
  return value === c
}
const matches = (row, where = {}) => Object.entries(where).every(([k, c]) => cond(row[k], c))
const withMember = (u) => u && { ...u, member: db.members.find((m) => m.userId === u.id) ?? null }

const fakePrisma = {
  user: {
    findMany: async ({ where } = {}) => db.users.filter((u) => matches(u, where)).map(withMember),
    findUnique: async ({ where }) => withMember(db.users.find((u) => matches(u, where))) ?? null,
    count: async ({ where } = {}) => db.users.filter((u) => matches(u, where)).length,
    updateMany: async ({ where, data }) => {
      const rows = db.users.filter((u) => matches(u, where))
      rows.forEach((u) => Object.assign(u, data))
      return { count: rows.length }
    },
  },
  member: {
    findMany: async ({ where } = {}) => db.members
      .map((m) => ({ ...m, user: db.users.find((u) => u.id === m.userId) }))
      .filter((m) => matches(m, where)),
  },
  payment: { findMany: async ({ where }) => db.payments.filter((p) => matches(p, where)) },
  memberRoster: {
    findMany: async () => db.roster.map((e) => ({ ...e })),
    findUnique: async ({ where }) => db.roster.find((e) => e.studentNumber === where.studentNumber) ?? null,
    deleteMany: ({ where }) => ({ op: 'deleteMany', where }),
    createMany: ({ data }) => ({ op: 'createMany', data }),
    update: ({ where, data }) => ({ op: 'update', where, data }),
  },
  notification: {
    findMany: async ({ where, take }) => db.notifications
      .filter((n) => matches(n, where)).sort((a, b) => b.createdAt - a.createdAt).slice(0, take ?? undefined),
  },
  announcement: { findMany: async () => [] },
  semester: {
    findFirst: async ({ where }) => db.semesters.find((s) => matches(s, where)) ?? null,
    findMany: async ({ where }) => db.semesters.filter((s) => matches(s, where)),
  },
  fundCategory: {
    findMany: async ({ where }) => db.categories.filter((c) => matches(c, where)),
    update: ({ where, data }) => ({ op: 'updateCategory', where, data }),
    create: ({ data }) => ({ op: 'createCategory', data }),
  },
  $transaction: async (ops) => {
    for (const op of ops) {
      if (op.op === 'deleteMany') db.roster = db.roster.filter((e) => !op.where.studentNumber.in.includes(e.studentNumber))
      if (op.op === 'createMany') op.data.forEach((e) => db.roster.push({ id: nextId++, ...e }))
      if (op.op === 'update') Object.assign(db.roster.find((e) => e.studentNumber === op.where.studentNumber), op.data)
      if (op.op === 'updateCategory') Object.assign(db.categories.find((c) => c.id === op.where.id), op.data)
      if (op.op === 'createCategory') db.categories.push({ id: nextId++, isTurnoverFund: false, isArchived: false, ...op.data })
    }
  },
}

const auditLogs = []
const emails = []
const approvalNotices = []
const reminderNotices = []
stub('src/lib/prisma.js', fakePrisma)
stub('src/realtime/socket.js', { emitToAll() {}, emitToOfficers() {}, emitToUser() {}, emitToHashChain() {} })
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { auditLogs.push(entry) } })
stub('src/utils/email.js', {
  sendRegistrationStatusEmail: async (to) => { emails.push({ kind: 'approved', to }) },
  sendPaymentReminderEmail: async (to) => { emails.push({ kind: 'reminder', to }) },
})
stub('src/services/notification.service.js', {
  notifyRegistrationApproved: async (userId) => { approvalNotices.push(userId) },
  notifyPaymentReminder: async (userId) => { reminderNotices.push(userId) },
  notifyAnnouncement: async () => {},
  syncMemberApprovalNotifications: async () => {},
})
stub('src/services/calculations.service.js', {
  getTotalFund: async () => new Decimal(0), MEMBERSHIP_FEE: new Decimal(100),
  getFundReport: async () => ({}), getTotalCategoryPercentage: async () => new Decimal(0),
  getCategoryFinancials: async (category) => ({
    allocatedAmount: new Decimal(1000).times(category.percentage).div(100).toFixed(2), totalDisbursed: '0.00', totalReturned: '0.00',
  }),
})
stub('src/services/membershipStatus.service.js', { evaluateMemberMembershipStatus: async () => {} })
stub('src/services/membershipPayment.service.js', {
  PAYMENT_UNIT: 100, PaymentValidationError: class extends Error {},
  getUnpaidSemesters: async () => [], buildAllocation: () => [], assertNotAdviser: () => {},
})

const roster = require(path.join(backend, 'src/services/memberRoster.service'))
const rosterCtrl = require(path.join(backend, 'src/controllers/memberRoster.controller'))
const paymentCtrl = require(path.join(backend, 'src/controllers/payment.controller'))
const announcementCtrl = require(path.join(backend, 'src/controllers/announcement.controller'))
const categoryCtrl = require(path.join(backend, 'src/controllers/fundCategory.controller'))

const call = async (handler, req) => {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await handler({ params: {}, body: {}, user: { id: 1, role: 'PRESIDENT_ADMIN', effectiveRole: 'PRESIDENT_ADMIN' }, ...req }, res)
  return res
}
const clearLogs = () => { auditLogs.length = 0; emails.length = 0; approvalNotices.length = 0; reminderNotices.length = 0 }

const addUser = ({ studentNumber, lastName, firstName = 'Ana', status = 'PENDING_OFFICER_APPROVAL', role = 'MEMBER' }) => {
  const user = { id: nextId++, email: `${studentNumber}@cvsu.edu.ph`, studentNumber, status, role }
  db.users.push(user)
  db.members.push({ id: nextId++, userId: user.id, firstName, lastName, status: 'ACTIVE' })
  return user
}

// ── Roster matching ──────────────────────────────────────────────────────────
test('last names match regardless of case, spacing, accents and punctuation', () => {
  const same = (a, b) => assert.equal(roster.normalizeLastName(a), roster.normalizeLastName(b), `${a} / ${b}`)
  same('Dela Cruz', 'dela cruz')
  same('De La Cruz', 'Dela Cruz')
  same('Peña', 'Pena')
  same("O'Neil", 'ONeil')
  assert.notEqual(roster.normalizeLastName('Santos'), roster.normalizeLastName('Reyes'))
})

test('roster rows are validated and bad rows explained', () => {
  const { entries, invalid } = roster.validateRosterRows([
    { row: 2, studentNumber: '2023-100-123', lastName: 'Dela Cruz' },
    { row: 3, studentNumber: '2023-100-123', lastName: 'dela cruz' }, // same student again: fine
    { row: 4, studentNumber: '2023-100-123', lastName: 'Santos' },    // conflicting duplicate
    { row: 5, studentNumber: '12345', lastName: 'Reyes' },
    { row: 6, studentNumber: '2023-200-9', lastName: '' },
    { row: 7, studentNumber: '', lastName: '' },                      // blank line, ignored
  ])
  assert.deepEqual([...entries.keys()], ['2023-100-123'])
  assert.deepEqual(invalid.map((r) => r.row), [4, 5, 6])
})

test('saving a roster approves matching pending members and leaves mismatches pending', async () => {
  reset(); clearLogs()
  const match = addUser({ studentNumber: '2023-100-1', lastName: 'Dela Cruz' })
  const mismatch = addUser({ studentNumber: '2023-100-2', lastName: 'Santos' })
  const unlisted = addUser({ studentNumber: '2023-100-3', lastName: 'Reyes' })

  const rows = [
    { row: 2, studentNumber: '2023-100-1', lastName: 'de la cruz' },
    { row: 3, studentNumber: '2023-100-2', lastName: 'Garcia' },
    { row: 4, studentNumber: '2023-100-9', lastName: 'Lim' }, // not registered yet
  ]
  const preview = await call(rosterCtrl.previewRoster, { body: { rows, mode: 'add' } })
  assert.equal(preview.statusCode, 200)
  assert.deepEqual(preview.body.willApprove.map((u) => u.userId), [match.id])
  assert.deepEqual(preview.body.nameMismatch.map((u) => u.userId), [mismatch.id])
  assert.equal(preview.body.notRegisteredYet, 1)
  assert.equal(preview.body.pendingNotListed, 1)
  assert.equal(db.roster.length, 0, 'preview changes nothing')

  const saved = await call(rosterCtrl.applyRoster, { body: { rows, mode: 'add' } })
  assert.equal(saved.statusCode, 200)
  assert.equal(saved.body.approvedCount, 1)
  assert.equal(db.users.find((u) => u.id === match.id).status, 'APPROVED')
  assert.equal(db.users.find((u) => u.id === mismatch.id).status, 'PENDING_OFFICER_APPROVAL')
  assert.equal(db.users.find((u) => u.id === unlisted.id).status, 'PENDING_OFFICER_APPROVAL')
  assert.equal(db.roster.length, 3)
  assert.deepEqual(approvalNotices, [match.id])
  assert.deepEqual(emails, [{ kind: 'approved', to: match.email }])
  const approvedLog = auditLogs.find((l) => l.action === 'USER_APPROVED')
  assert.equal(approvedLog.details.via, 'ROSTER')
  const rosterLog = auditLogs.find((l) => l.action === 'MEMBER_ROSTER_UPDATED')
  assert.equal(rosterLog.details.added, 3)
  assert.equal(JSON.stringify(rosterLog.details).includes('2023-100'), false, 'no student numbers in the activity log')
})

test('adding to a roster updates names; replacing removes students not on the new list', async () => {
  reset(); clearLogs()
  db.roster.push({ id: 90, studentNumber: '2023-100-1', lastName: 'Santos' }, { id: 91, studentNumber: '2023-100-2', lastName: 'Reyes' })
  const pending = addUser({ studentNumber: '2023-100-1', lastName: 'Garcia' })

  const fix = await call(rosterCtrl.applyRoster, { body: { rows: [{ row: 1, studentNumber: '2023-100-1', lastName: 'Garcia' }], mode: 'add' } })
  assert.equal(fix.body.updated, 1)
  assert.equal(fix.body.approvedCount, 1, 'corrected name approves the waiting member')
  assert.equal(db.users.find((u) => u.id === pending.id).status, 'APPROVED')
  assert.equal(db.roster.length, 2)

  const replace = await call(rosterCtrl.applyRoster, { body: { rows: [{ row: 1, studentNumber: '2024-100-5', lastName: 'Lim' }], mode: 'replace' } })
  assert.equal(replace.body.removed, 2)
  assert.deepEqual(db.roster.map((e) => e.studentNumber), ['2024-100-5'])
  assert.equal(db.users.find((u) => u.id === pending.id).status, 'APPROVED', 'removal never undoes an approval')
})

test('a registrant on the roster is approved right after email verification', async () => {
  reset(); clearLogs()
  db.roster.push({ id: 90, studentNumber: '2023-100-1', lastName: 'Dela Cruz' })
  const listed = addUser({ studentNumber: '2023-100-1', lastName: 'DELA CRUZ' })
  const wrongName = addUser({ studentNumber: '2023-100-1x', lastName: 'Dela Cruz' })
  const adviser = addUser({ studentNumber: '2023-100-1', lastName: 'Dela Cruz', role: 'ADVISER_DEPT_CHAIR' })

  assert.equal(await roster.approveFromRosterIfListed(listed.id), true)
  assert.equal(db.users.find((u) => u.id === listed.id).status, 'APPROVED')
  assert.equal(await roster.approveFromRosterIfListed(listed.id), false, 'not approved twice')
  assert.equal(await roster.approveFromRosterIfListed(wrongName.id), false)
  assert.equal(await roster.approveFromRosterIfListed(adviser.id), false)
  assert.equal(auditLogs.filter((l) => l.action === 'USER_APPROVED').length, 1)
  assert.equal(auditLogs[0].actorId, null)
})

test('roster requests are rejected when empty, too large or in an unknown mode', async () => {
  reset()
  assert.equal((await call(rosterCtrl.applyRoster, { body: { rows: [], mode: 'add' } })).statusCode, 400)
  assert.equal((await call(rosterCtrl.applyRoster, { body: { rows: [{ studentNumber: '2023-100-1', lastName: 'A' }], mode: 'wipe' } })).statusCode, 400)
  const tooMany = Array.from({ length: roster.MAX_ROSTER_ROWS + 1 }, (_, i) => ({ studentNumber: `2023-100-${i}`, lastName: 'A' }))
  assert.equal((await call(rosterCtrl.applyRoster, { body: { rows: tooMany, mode: 'add' } })).statusCode, 400)
  assert.equal((await call(rosterCtrl.applyRoster, { body: undefined })).statusCode, 400)
})

// ── Payment reminders ────────────────────────────────────────────────────────
test('payment reminders go only to the selected, eligible members', async () => {
  reset(); clearLogs()
  db.semesters.push({ id: 1, schoolYear: '2026-2027', semester: 'FIRST', isActive: true })
  const memberOf = (user) => db.members.find((m) => m.userId === user.id)
  const a = addUser({ studentNumber: '2023-100-1', lastName: 'A', status: 'APPROVED' })
  const b = addUser({ studentNumber: '2023-100-2', lastName: 'B', status: 'APPROVED' })
  const paid = addUser({ studentNumber: '2023-100-3', lastName: 'C', status: 'APPROVED' })
  const notSelected = addUser({ studentNumber: '2023-100-4', lastName: 'D', status: 'APPROVED' })
  db.payments.push({ memberId: memberOf(paid).id, semesterId: 1, obligationSemesterId: 1, isArchived: false })

  assert.equal((await call(paymentCtrl.sendBulkPaymentReminders, { body: {} })).statusCode, 400)
  assert.equal((await call(paymentCtrl.sendBulkPaymentReminders, { body: { memberIds: ['x'] } })).statusCode, 400)

  const res = await call(paymentCtrl.sendBulkPaymentReminders, {
    body: { memberIds: [memberOf(a).id, memberOf(b).id, memberOf(paid).id] },
  })
  assert.equal(res.statusCode, 200, res.body.message)
  assert.equal(res.body.sentCount, 2)
  assert.equal(res.body.skippedCount, 1)
  assert.deepEqual(emails.map((e) => e.to).sort(), [a.email, b.email].sort())
  assert.deepEqual(reminderNotices.sort(), [a.id, b.id].sort())
  assert.equal(emails.some((e) => e.to === notSelected.email || e.to === paid.email), false)
})

test('a payment reminder is pinned with Important Announcements for 7 days', async () => {
  reset()
  const DAY = 24 * 60 * 60 * 1000
  db.notifications.push(
    { id: 1, userId: 5, type: 'PAYMENT_REMINDER', title: 'Membership Payment Reminder', message: 'Pay', createdAt: new Date(Date.now() - 2 * DAY) },
    { id: 2, userId: 5, type: 'PAYMENT_REMINDER', title: 'Old', message: 'Old', createdAt: new Date(Date.now() - 8 * DAY) },
    { id: 3, userId: 6, type: 'PAYMENT_REMINDER', title: 'Someone else', message: 'x', createdAt: new Date() },
  )
  const res = await call(announcementCtrl.listImportantAnnouncements, { user: { id: 5, role: 'MEMBER', effectiveRole: 'MEMBER' } })
  assert.equal(res.body.announcements.length, 1)
  const [pinned] = res.body.announcements
  assert.equal(pinned.kind, 'PAYMENT_REMINDER')
  assert.equal(pinned.id, 'payment-reminder-1')
  assert.equal(new Date(pinned.expiresAt).getTime() - db.notifications[0].createdAt.getTime(), 7 * DAY)
})

// ── Categories ───────────────────────────────────────────────────────────────
test('Edit Categories can add new categories while keeping the 100% total', async () => {
  reset(); clearLogs()
  db.semesters.push({ id: 1, schoolYear: '2026-2027', semester: 'SECOND', isActive: true }, { id: 7, schoolYear: '2026-2027', semester: 'FIRST', isActive: false })
  db.categories.push({ id: 10, name: 'Events', percentage: new Decimal('100.00'), semesterId: 7, isTurnoverFund: false, isArchived: false })

  const over = await call(categoryCtrl.updateCategories, { body: { confirmText: 'CONFIRM', categories: [
    { id: 10, name: 'Events', percentage: 100 }, { id: null, name: 'Supplies', percentage: 10 },
  ] } })
  assert.match(over.body.message, /exactly 100%/)

  const res = await call(categoryCtrl.updateCategories, { body: { confirmText: 'CONFIRM', categories: [
    { id: 10, name: 'Events', percentage: 80 }, { id: null, name: 'Supplies', percentage: 20 },
  ] } })
  assert.equal(res.statusCode, 200, res.body.message)
  assert.match(res.body.message, /added 1 new category/)
  const added = db.categories.find((c) => c.name === 'Supplies')
  assert.equal(added.semesterId, 7, "joins the school year's existing categories")
  assert.equal(added.percentage, '20.00')
  const created = auditLogs.find((l) => l.action === 'CATEGORY_CREATED')
  assert.deepEqual(created.details, { names: ['Supplies'], percentages: [20], semesterId: 7 })
  assert.equal(auditLogs.filter((l) => l.action === 'CATEGORY_UPDATED').length, 1)
})
