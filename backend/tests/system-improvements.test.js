// System-wide improvements: event schedule rules (no past dates, class hours
// 7:00 AM–10:00 PM), event budgets, event status ordering, the fixed 7-day
// Important-announcement expiry, announcement access by recipient group,
// editing finalized fund categories, and the hash-linked ledger accepting
// those edits (but still catching direct database changes). Runs against an
// in-memory fake Prisma — no database, email or network. Run with: npm test
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
  db = { events: [], announcements: [], users: [], categories: [], semesters: [], auditLogs: [] }
  nextId = 1
}

const cond = (value, c) => {
  if (c === undefined) return true
  if (c && typeof c === 'object' && !(c instanceof Date) && !(c instanceof Decimal)) {
    if ('in' in c) return c.in.includes(value)
    if ('not' in c) return value !== c.not
    if ('gt' in c) return value > c.gt
    if ('contains' in c) return typeof value === 'string' && value.includes(c.contains)
  }
  return value === c
}
const matches = (row, where = {}) => Object.entries(where).every(([k, c]) => cond(row[k], c))
const table = (name) => ({
  findMany: async ({ where } = {}) => db[name].filter((r) => matches(r, where)),
  findFirst: async ({ where } = {}) => db[name].find((r) => matches(r, where)) ?? null,
  findUnique: async ({ where }) => db[name].find((r) => matches(r, where)) ?? null,
})

const fakePrisma = {
  event: {
    ...table('events'),
    create: async ({ data }) => {
      const event = { id: nextId++, isArchived: false, createdAt: new Date(), ...data,
        budget: data.budget == null ? null : new Decimal(data.budget) }
      db.events.push(event)
      return event
    },
  },
  announcement: {
    findUnique: async ({ where }) => {
      const a = db.announcements.find((x) => x.id === where.id)
      return a ? { ...a, createdBy: db.users.find((u) => u.id === a.createdById) } : null
    },
    create: async ({ data }) => {
      const a = { id: nextId++, createdAt: new Date(), ...data }
      db.announcements.push(a)
      return { ...a, createdBy: db.users.find((u) => u.id === a.createdById) }
    },
  },
  semester: table('semesters'),
  fundCategory: {
    ...table('categories'),
    update: ({ where, data }) => ({ where, data }),
  },
  auditLog: {
    findMany: async ({ where }) => db.auditLogs.filter((r) => matches(r, where)).sort((a, b) => a.id - b.id),
    findFirst: async ({ where }) => db.auditLogs.find((r) => matches(r, where)) ?? null,
  },
  $transaction: async (ops) => {
    for (const { where, data } of ops) Object.assign(db.categories.find((c) => c.id === where.id), data)
  },
}

const writtenLogs = []
stub('src/lib/prisma.js', fakePrisma)
stub('src/realtime/socket.js', { emitToAll() {}, emitToOfficers() {}, emitToUser() {}, emitToHashChain() {} })
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { writtenLogs.push(entry) } })
stub('src/controllers/certification.controller.js', { ensureEventCertificationFolder: async () => {} })
stub('src/services/notification.service.js', {
  notifyEventCreated: async () => {}, notifyEventStatusChanged: async () => {},
  notifyEventUpdated: async () => {}, notifyEventAccessGrantedToMembers: async () => {},
  notifyAnnouncement: async () => {},
})
// Allocated = ₱1,000 × percentage; spending per category comes from `spent`.
const spent = {}
stub('src/services/calculations.service.js', {
  getFundReport: async () => ({}),
  getTotalCategoryPercentage: async () => new Decimal(0),
  getCategoryFinancials: async (category) => ({
    allocatedAmount: new Decimal(1000).times(category.percentage).div(100).toFixed(2),
    totalDisbursed: (spent[category.id] ?? 0).toFixed(2),
    totalReturned: '0.00',
  }),
})

const schedule = require(path.join(backend, 'src/utils/schedule'))
const eventCtrl = require(path.join(backend, 'src/controllers/event.controller'))
const announcementCtrl = require(path.join(backend, 'src/controllers/announcement.controller'))
const categoryCtrl = require(path.join(backend, 'src/controllers/fundCategory.controller'))
const { verifyLedger, buildPayload, computeHash, GENESIS } = require(path.join(backend, 'src/utils/ledger'))

const call = async (handler, req) => {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await handler({ params: {}, body: {}, user: { id: 1, role: 'PRESIDENT_ADMIN', effectiveRole: 'PRESIDENT_ADMIN' }, ...req }, res)
  return res
}

const DAY = 24 * 60 * 60 * 1000
const manilaDate = (offsetDays) => schedule.todayInOrgTimezone(new Date(Date.now() + offsetDays * DAY))

// ── Schedule rules ───────────────────────────────────────────────────────────
test('today is taken in Philippine time, not the server clock', () => {
  assert.equal(schedule.todayInOrgTimezone(new Date('2026-11-10T20:00:00Z')), '2026-11-11')
  assert.equal(schedule.todayInOrgTimezone(new Date('2026-11-10T15:59:00Z')), '2026-11-10')
})

test('past dates are rejected; today and future dates are allowed', () => {
  assert.match(schedule.validateScheduleDate(manilaDate(-1)), /today or a future date/)
  assert.equal(schedule.validateScheduleDate(manilaDate(0)), null)
  assert.equal(schedule.validateScheduleDate(manilaDate(30)), null)
  assert.match(schedule.validateScheduleDate('2026-02-30'), /valid date/)
})

test('only class hours (07:00–22:00) are accepted', () => {
  for (const ok of ['07:00', '12:30', '22:00']) assert.equal(schedule.validateScheduleTime(ok), null, ok)
  for (const bad of ['06:59', '22:01', '23:00', '7:00', 'noon']) assert.notEqual(schedule.validateScheduleTime(bad), null, bad)
})

// ── Events ───────────────────────────────────────────────────────────────────
const eventBody = (overrides = {}) => ({
  title: 'General Assembly', date: manilaDate(3), time: '09:00', location: 'Gym',
  Proponent: 'LITL', description: 'Assembly', status: 'Coming soon', access: ['Officers'],
  budget: '1500', ...overrides,
})

test('creating an event checks the date, the time and the budget', async () => {
  reset()
  assert.equal((await call(eventCtrl.createEvent, { body: eventBody({ date: manilaDate(-1) }) })).statusCode, 400)
  assert.equal((await call(eventCtrl.createEvent, { body: eventBody({ time: '23:00' }) })).statusCode, 400)
  assert.equal((await call(eventCtrl.createEvent, { body: eventBody({ budget: '' }) })).statusCode, 400)
  assert.equal((await call(eventCtrl.createEvent, { body: eventBody({ budget: '-5' }) })).statusCode, 400)
  assert.equal((await call(eventCtrl.createEvent, { body: eventBody({ budget: '12.345' }) })).statusCode, 400)
  assert.equal(db.events.length, 0)

  const res = await call(eventCtrl.createEvent, { body: eventBody() })
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.event.budget, '1500.00')
})

test('events are listed Open, Coming soon, Closed, Cancelled, then by date and time', async () => {
  reset()
  const add = (status, date, time) => db.events.push({
    id: nextId++, title: `${status} ${date} ${time}`, date, time, location: 'x', proponent: 'x',
    description: 'x', status, access: '["Officers"]', isArchived: false, budget: null,
  })
  add('CANCELLED', '2026-12-01', '08:00')
  add('CLOSED', '2026-11-01', '08:00')
  add('COMING_SOON', '2026-12-05', '08:00')
  add('OPEN', '2026-12-10', '08:00')
  add('COMING_SOON', '2026-12-02', '10:00')
  add('COMING_SOON', '2026-12-02', '09:00')
  add('OPEN', '2026-12-01', '08:00')

  const res = await call(eventCtrl.listEvents, {})
  assert.deepEqual(res.body.events.map((e) => [e.status, e.date, e.time]), [
    ['Open', '2026-12-01', '08:00'],
    ['Open', '2026-12-10', '08:00'],
    ['Coming soon', '2026-12-02', '09:00'],
    ['Coming soon', '2026-12-02', '10:00'],
    ['Coming soon', '2026-12-05', '08:00'],
    ['Closed', '2026-11-01', '08:00'],
    ['Cancelled', '2026-12-01', '08:00'],
  ])
})

// ── Announcements ────────────────────────────────────────────────────────────
const president = { id: 1, role: 'PRESIDENT_ADMIN', adviserTitle: null, member: { firstName: 'Juan', lastName: 'Dela Cruz', suffix: null } }

test('Important announcements always expire 7 days after posting', async () => {
  reset()
  db.users.push(president)
  const before = Date.now()
  const res = await call(announcementCtrl.createAnnouncement, {
    body: { title: 'Fees', message: 'Pay', recipients: 'MEMBERS', priority: 'IMPORTANT', expiresAt: '2030-01-01' },
  })
  assert.equal(res.statusCode, 201)
  const expires = new Date(res.body.announcement.expiresAt).getTime()
  assert.ok(Math.abs(expires - (before + 7 * DAY)) < 5000)
  assert.deepEqual(res.body.announcement.createdBy, { name: 'Juan Dela Cruz', position: 'President' })

  const normal = await call(announcementCtrl.createAnnouncement, {
    body: { title: 'Hi', message: 'Hello', recipients: 'BOTH', priority: 'NORMAL', expiresAt: '2030-01-01' },
  })
  assert.equal(normal.body.announcement.expiresAt, null)
})

test('an announcement can only be opened by its recipient group', async () => {
  reset()
  db.users.push(president)
  db.announcements.push({ id: 50, title: 'Officers only', message: 'm', recipients: 'OFFICERS', priority: 'NORMAL', expiresAt: null, createdById: 1 })
  db.announcements.push({ id: 51, title: 'Members only', message: 'm', recipients: 'MEMBERS', priority: 'NORMAL', expiresAt: null, createdById: 1 })

  const as = (role, effectiveRole, id) => call(announcementCtrl.getAnnouncement, {
    params: { id: String(id) }, user: { id: 9, role, effectiveRole: effectiveRole ?? role },
  })
  assert.equal((await as('MEMBER', 'MEMBER', 50)).statusCode, 404)
  assert.equal((await as('MEMBER', 'MEMBER', 51)).statusCode, 200)
  assert.equal((await as('SECRETARY', 'SECRETARY', 50)).body.announcement.createdBy.name, 'Juan Dela Cruz')
  assert.equal((await as('ADVISER_DEPT_CHAIR', 'ADVISER_DEPT_CHAIR', 51)).statusCode, 404)
  assert.equal((await as('DEVELOPER', 'DEVELOPER', 50)).statusCode, 404)
  assert.equal((await as('MEMBER', 'MEMBER', 'abc')).statusCode, 404)
})

// ── Fund categories ──────────────────────────────────────────────────────────
const seedCategories = () => {
  reset()
  writtenLogs.length = 0
  db.semesters.push({ id: 1, schoolYear: '2026-2027', semester: 'FIRST', isActive: true })
  db.categories.push(
    { id: 10, name: 'Events', percentage: new Decimal('60.00'), semesterId: 1, isTurnoverFund: false, isArchived: false },
    { id: 11, name: 'Supplies', percentage: new Decimal('40.00'), semesterId: 1, isTurnoverFund: false, isArchived: false },
  )
}
const update = (categories) => call(categoryCtrl.updateCategories, { body: { categories, confirmText: 'CONFIRM' } })

test('finalized categories can be renamed and re-weighted, keeping 100% total', async () => {
  seedCategories()
  const res = await update([{ id: 10, name: 'Activities', percentage: 70 }, { id: 11, name: 'Supplies', percentage: 30 }])
  assert.equal(res.statusCode, 200, res.body.message)
  assert.equal(db.categories[0].name, 'Activities')
  assert.equal(db.categories[0].percentage, '70.00')
  assert.equal(db.categories[1].percentage, '30.00')
  assert.equal(writtenLogs.length, 2)
  assert.equal(writtenLogs[0].action, 'CATEGORY_UPDATED')
  assert.deepEqual(writtenLogs[0].details.snapshot, { id: 10, name: 'Activities', percentage: '70.00' })
})

test('category edits are refused when the total is not 100%, the list is stale or nothing changed', async () => {
  seedCategories()
  assert.match((await update([{ id: 10, name: 'Events', percentage: 50 }, { id: 11, name: 'Supplies', percentage: 40 }])).body.message, /exactly 100%/)
  assert.match((await update([{ id: 10, name: 'Events', percentage: 100 }])).body.message, /out of date/)
  assert.match((await update([{ id: 10, name: 'Same', percentage: 60 }, { id: 11, name: 'same', percentage: 40 }])).body.message, /more than once/)
  assert.match((await update([{ id: 10, name: 'Events', percentage: 60 }, { id: 11, name: 'Supplies', percentage: 40 }])).body.message, /No changes/)
  assert.match((await call(categoryCtrl.updateCategories, { body: { categories: [], confirmText: 'nope' } })).body.message, /CONFIRM/)
  assert.equal(writtenLogs.length, 0)
})

test("a category's share can't drop below what it has already spent", async () => {
  seedCategories()
  spent[11] = 350 // Supplies: ₱350 of its ₱400 used
  const res = await update([{ id: 10, name: 'Events', percentage: 70 }, { id: 11, name: 'Supplies', percentage: 30 }])
  delete spent[11]
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /already used ₱350\.00/)
  assert.equal(db.categories[1].percentage.toString(), '40')
})

// ── Hash-linked ledger ───────────────────────────────────────────────────────
const chain = (entries) => {
  let previousHash = GENESIS
  for (const { action, details } of entries) {
    const log = { id: nextId++, action, actorId: 1, targetUserId: null, details: JSON.stringify(details), createdAt: new Date() }
    log.previousHash = previousHash
    log.hash = computeHash(previousHash, buildPayload(log))
    previousHash = log.hash
    db.auditLogs.push(log)
  }
}

test('the ledger accepts categories edited through the app but flags direct database edits', async () => {
  seedCategories()
  db.categories[0].name = 'Activities'
  db.categories[0].percentage = new Decimal('70.00')
  db.categories[1].percentage = new Decimal('30.00')
  chain([
    { action: 'CATEGORY_CREATED', details: { names: ['Events', 'Supplies'], percentages: [60, 40] } },
    { action: 'CATEGORY_UPDATED', details: { categoryId: 10, semesterId: 1, previousName: 'Events', name: 'Activities', previousPercentage: 60, percentage: 70, snapshot: { id: 10, name: 'Activities', percentage: '70.00' } } },
    { action: 'CATEGORY_UPDATED', details: { categoryId: 11, semesterId: 1, previousName: 'Supplies', name: 'Supplies', previousPercentage: 40, percentage: 30, snapshot: { id: 11, name: 'Supplies', percentage: '30.00' } } },
  ])

  const intact = await verifyLedger()
  assert.equal(intact.status, 'INTACT', JSON.stringify(intact.links.map((l) => l.reasons)))

  db.categories[1].percentage = new Decimal('45.00') // changed outside the app
  const tampered = await verifyLedger()
  assert.equal(tampered.status, 'TAMPERED')
  const flagged = tampered.links.find((l) => l.status === 'TAMPERED')
  assert.match(flagged.reasons.join(' '), /percentage was changed/)
})
