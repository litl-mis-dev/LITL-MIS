// Automatic Return Funds, recording the amount spent, events funded by a
// disbursement, and event reminders. The disbursement never changes: its
// Return Fund becomes released − spent, each change is a new hash-chain
// entry, and the fund is never counted twice. Runs against an in-memory fake
// Prisma — no database, push service or network. Run with: npm test
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
  db = {
    semesters: [], categories: [], payments: [], disbursements: [], returnFunds: [], audits: [],
    users: [], members: [], auditLogs: [], events: [], notifications: [], pushes: [],
  }
  nextId = 1
}
const byId = (rows, id) => rows.find((r) => r.id === id) ?? null
const uniqueError = (target) => Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } })

// Plain-field filters: equality, in, not null, lt, gt, contains, OR.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((c) => matches(row, c))
    const value = row[key]
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value)
      if ('not' in cond) return cond.not === null ? value != null : value !== cond.not
      if ('lt' in cond) return value < cond.lt
      if ('gt' in cond) return value > cond.gt
      if ('contains' in cond) return typeof value === 'string' && value.includes(cond.contains)
      return true // relation filters are applied by the model below
    }
    return value === cond
  })
}
const sum = (rows) => ({ _sum: { amount: rows.reduce((s, r) => s.plus(r.amount), new Decimal(0)) } })
const activeReturns = (disbursementId) => db.returnFunds.filter((rf) => rf.disbursementId === disbursementId && !rf.isArchived)
const withReturnsSummary = (d) => ({ ...d, returnFunds: activeReturns(d.id).map((rf) => ({ ...rf })) })
const eventFor = (disbursementId) => db.events.find((e) => e.disbursementId === disbursementId) ?? null

const fakePrisma = {
  $transaction: async (arg) => (typeof arg === 'function' ? arg(fakePrisma) : Promise.all(arg)),
  $queryRaw: async () => [{ got: 1 }],
  semester: {
    findFirst: async ({ where }) => db.semesters.find((s) => matches(s, where)) ?? null,
    findMany: async ({ where }) => db.semesters.filter((s) => matches(s, where)),
  },
  fundCategory: {
    findUnique: async ({ where }) => byId(db.categories, where.id),
    findFirst: async () => null, // no turnover category
  },
  payment: {
    aggregate: async ({ where }) => sum(db.payments.filter((p) => p.semesterId === where.semesterId)),
  },
  user: {
    findFirst: async ({ where }) => {
      const user = db.users.find((u) => u.role === where.role && u.status === 'APPROVED')
      return user ? { member: db.members.find((m) => m.userId === user.id) } : null
    },
    findMany: async ({ where }) => db.users.filter((u) => matches(u, where)).map((u) => ({ id: u.id })),
  },
  disbursement: {
    create: async ({ data }) => {
      const row = { id: nextId++, isArchived: false, createdAt: new Date(), ...data, amount: new Decimal(data.amount) }
      db.disbursements.push(row)
      return { ...row, fundCategory: byId(db.categories, row.fundCategoryId) }
    },
    findUnique: async ({ where, include, select }) => {
      const row = where.id ? byId(db.disbursements, where.id) : db.disbursements.find((d) => d.reference === where.reference)
      if (!row) return null
      const out = { ...row }
      const wants = { ...include, ...select }
      if (wants.audit) out.audit = db.audits.find((a) => a.disbursementId === row.id) ?? null
      if (wants.event) out.event = eventFor(row.id)
      if (wants.semester) out.semester = byId(db.semesters, row.semesterId)
      if (wants.returnFunds) out.returnFunds = activeReturns(row.id)
      return out
    },
    findMany: async ({ where }) => db.disbursements
      .filter((d) => {
        const { OR, ...rest } = where
        const relation = (cond) => (!cond.semester || byId(db.semesters, d.semesterId)?.schoolYear === cond.semester.schoolYear)
          && (!cond.event || (cond.event.is === null ? !eventFor(d.id) : eventFor(d.id)?.id === cond.event.is.id))
        return matches(d, rest) && relation(rest) && (!OR || OR.some(relation))
      })
      .map(withReturnsSummary),
    update: async ({ where, data }) => Object.assign(byId(db.disbursements, where.id), data),
    count: async () => db.disbursements.length,
    aggregate: async ({ where }) => sum(db.disbursements.filter((d) => d.fundCategoryId === where.fundCategoryId && !d.isArchived)),
  },
  returnFund: {
    create: async ({ data }) => {
      if (db.returnFunds.some((rf) => rf.reference === data.reference)) throw uniqueError(['reference'])
      if (data.autoForDisbursementId != null && db.returnFunds.some((rf) => rf.autoForDisbursementId === data.autoForDisbursementId)) {
        throw uniqueError(['autoForDisbursementId'])
      }
      const row = { id: nextId++, isArchived: false, revisedAt: null, autoForDisbursementId: null, createdAt: new Date(), ...data, amount: new Decimal(data.amount) }
      db.returnFunds.push(row)
      return { ...row }
    },
    findMany: async ({ where, include }) => db.returnFunds
      .filter((rf) => matches(rf, where))
      .map((rf) => (include?.audit ? { ...rf, audit: db.audits.find((a) => a.returnFundId === rf.id) ?? null } : { ...rf })),
    findUnique: async ({ where, include }) => {
      const row = where.id ? byId(db.returnFunds, where.id) : db.returnFunds.find((rf) => rf.reference === where.reference)
      if (!row) return null
      return include?.disbursement ? { ...row, disbursement: byId(db.disbursements, row.disbursementId) } : { ...row }
    },
    update: async ({ where, data }) => {
      const row = byId(db.returnFunds, where.id)
      Object.assign(row, data, data.amount !== undefined ? { amount: new Decimal(data.amount) } : {})
      return { ...row }
    },
    count: async ({ where } = {}) => db.returnFunds.filter((rf) => matches(rf, where)).length,
    aggregate: async ({ where }) => sum(db.returnFunds.filter((rf) => !rf.isArchived
      && (where.disbursementId ? rf.disbursementId === where.disbursementId
        : byId(db.disbursements, rf.disbursementId)?.fundCategoryId === where.disbursement.fundCategoryId))),
  },
  audit: {
    create: async ({ data }) => {
      const row = { id: nextId++, status: 'PENDING', ...data }
      db.audits.push(row)
      return row
    },
    update: async ({ where, data }) => Object.assign(byId(db.audits, where.id), data),
  },
  auditLog: {
    create: async ({ data }) => {
      const row = { id: nextId++, createdAt: new Date(), hash: null, previousHash: null, ...data }
      db.auditLogs.push(row)
      return { ...row }
    },
    findFirst: async ({ where, orderBy }) => {
      const rows = db.auditLogs.filter((l) => matches(l, where))
      return (orderBy?.id === 'desc' ? rows.reverse() : rows)[0] ?? null
    },
    findMany: async ({ where }) => db.auditLogs.filter((l) => matches(l, where)).map((l) => ({ ...l, actor: null })),
    update: async ({ where, data }) => Object.assign(byId(db.auditLogs, where.id), data),
  },
  event: {
    create: async ({ data }) => {
      if (data.disbursementId && db.events.some((e) => e.disbursementId === data.disbursementId)) throw uniqueError('Event_disbursementId_key')
      const row = { id: nextId++, isArchived: false, createdAt: new Date(), disbursementId: null, ...data }
      db.events.push(row)
      return eventWithIncludes(row)
    },
    findUnique: async ({ where }) => { const e = byId(db.events, where.id); return e && eventWithIncludes(e) },
    update: async ({ where, data }) => {
      if (data.disbursementId && db.events.some((e) => e.id !== where.id && e.disbursementId === data.disbursementId)) {
        throw uniqueError('Event_disbursementId_key')
      }
      const e = byId(db.events, where.id)
      Object.assign(e, data)
      return eventWithIncludes(e)
    },
    findMany: async ({ where }) => db.events.filter((e) => matches(e, where)).map(eventWithIncludes),
  },
  notification: {
    create: async ({ data }) => {
      const row = { id: nextId++, isRead: false, createdAt: new Date(), ...data }
      db.notifications.push(row)
      return row
    },
    findMany: async ({ where }) => db.notifications.filter((n) => matches(n, where)),
  },
}
function eventWithIncludes(event) {
  const d = event.disbursementId ? byId(db.disbursements, event.disbursementId) : null
  return { ...event, _count: { attendances: 0 }, disbursement: d && withReturnsSummary(d) }
}

stub('src/lib/prisma.js', fakePrisma)
stub('src/realtime/socket.js', { emitToOfficers: () => {}, emitToAll: () => {}, emitToUser: () => {}, emitToHashChain: () => {} })
stub('src/services/push.service.js', { sendPushToUser: async (userId, payload) => { db.pushes.push({ userId, ...payload }) } })
stub('src/controllers/certification.controller.js', { ensureEventCertificationFolder: async () => {} })

const disbursementCtrl = require(path.join(backend, 'src/controllers/disbursement.controller'))
const returnFundCtrl = require(path.join(backend, 'src/controllers/returnFund.controller'))
const eventCtrl = require(path.join(backend, 'src/controllers/event.controller'))
const { getCategoryFinancials } = require(path.join(backend, 'src/services/calculations.service'))
const { verifyLedger } = require(path.join(backend, 'src/utils/ledger'))
const { notifyEventReminders } = require(path.join(backend, 'src/services/notification.service'))

// ── Helpers ──────────────────────────────────────────────────────────────────
const call = async (handler, req = {}) => {
  const res = { statusCode: 200 }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await handler({ user: { id: 1, effectiveRole: 'PRESIDENT_ADMIN' }, params: {}, body: {}, query: {}, ...req }, res)
  return res
}
const addUser = (role, firstName) => {
  const user = { id: nextId++, role, status: 'APPROVED' }
  db.users.push(user)
  db.members.push({ userId: user.id, firstName, lastName: 'Test' })
  return user
}
// Active semester with ₱5,000 collected; one category gets 100% of it.
const setup = () => {
  reset()
  const semester = { id: nextId++, schoolYear: '2026-2027', semester: 'FIRST', isActive: true }
  db.semesters.push(semester)
  const category = { id: nextId++, name: 'Events and Activities', percentage: '100.00', semesterId: semester.id, isArchived: false, isTurnoverFund: false }
  db.categories.push(category)
  db.payments.push({ id: nextId++, semesterId: semester.id, amount: new Decimal(5000) })
  addUser('PRESIDENT_ADMIN', 'Jose')
  addUser('SEN_FINANCE', 'Maria')
  addUser('SEN_AUDIT', 'Ana')
  return { semester, category }
}
const createDisbursement = (category, amount = '1000') => call(disbursementCtrl.createDisbursement, {
  body: {
    name: 'Juan Dela Cruz', amount, purposeOfFund: 'Activity expenses', titleOfActivities: 'IT Week booth',
    fundCategoryId: category.id, disbursedBy: 'Maria Test', disbursedByPosition: 'Senator for Finance',
    approvedBy: 'Jose Test', approvedByPosition: 'President', receivedBy: 'Juan Dela Cruz', receivedByPosition: 'Member',
    confirmText: 'CONFIRM',
  },
})
const recordSpent = (id, amountSpent, confirmText = 'CONFIRM') =>
  call(disbursementCtrl.recordAmountSpent, { params: { id: String(id) }, body: { amountSpent, confirmText } })
const available = async (category, semester) => (await getCategoryFinancials(category, semester.id)).availableFund
const autoReturnOf = (disbursementId) => db.returnFunds.find((rf) => rf.autoForDisbursementId === disbursementId)

// ── Automatic Return Fund ────────────────────────────────────────────────────
test('creating a disbursement also creates its ₱0 Return Fund, linked and in the hash chain', async () => {
  const { category } = setup()
  const res = await createDisbursement(category)
  assert.equal(res.statusCode, 201)

  const disbursement = db.disbursements[0]
  const rf = autoReturnOf(disbursement.id)
  assert.ok(rf, 'automatic return created')
  assert.equal(rf.amount.toFixed(2), '0.00')
  assert.equal(rf.disbursementId, disbursement.id)
  assert.equal(rf.receivedFrom, 'Juan Dela Cruz')
  assert.equal(rf.refundedBy, 'Juan Dela Cruz')
  assert.equal(rf.refundedByPosition, 'Member')
  assert.equal(rf.auditedBy, 'Ana Test')
  assert.equal(db.audits.filter((a) => a.returnFundId === rf.id).length, 0, 'a ₱0 return is not sent to the Auditor')
  assert.deepEqual(db.auditLogs.map((l) => l.action), ['DISBURSEMENT_CREATED', 'RETURN_FUND_CREATED'])
})

test('the disbursement amount is still checked against the available fund', async () => {
  const { category } = setup()
  const res = await createDisbursement(category, '6000')
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /exceeds available fund/i)
  assert.equal(db.returnFunds.length, 0)
})

// ── Recording the amount spent ───────────────────────────────────────────────
test('recording ₱700 spent of ₱1,000 returns ₱300 and the fund counts it once', async () => {
  const { semester, category } = setup()
  await createDisbursement(category)
  const disbursement = db.disbursements[0]
  assert.equal(await available(category, semester), '4000.00')

  const res = await recordSpent(disbursement.id, '700')
  assert.equal(res.statusCode, 200, res.body.message)
  assert.equal(autoReturnOf(disbursement.id).amount.toFixed(2), '300.00')
  assert.equal(disbursement.amount.toFixed(2), '1000.00', 'the disbursement itself never changes')
  assert.equal(await available(category, semester), '4300.00', '5,000 − 1,000 + 300, not counted twice')
  assert.ok(autoReturnOf(disbursement.id).revisedAt instanceof Date)
  assert.equal(db.audits.find((a) => a.returnFundId === autoReturnOf(disbursement.id).id)?.status, 'PENDING')

  const update = db.auditLogs.at(-1)
  assert.equal(update.action, 'RETURN_FUND_UPDATED')
  const details = JSON.parse(update.details)
  assert.equal(details.previousAmount, '0.00')
  assert.equal(details.newAmount, '300.00')
  assert.equal(details.amount, '300.00', 'the Activity Log adds what came back with this update')
})

test('the amount spent can only go down, never above the released amount', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const { id } = db.disbursements[0]

  assert.equal((await recordSpent(id, '700')).statusCode, 200)
  assert.equal((await recordSpent(id, '600')).statusCode, 200)
  assert.equal(autoReturnOf(id).amount.toFixed(2), '400.00')

  for (const amount of ['650', '600', '1200']) {
    const res = await recordSpent(id, amount)
    assert.equal(res.statusCode, 400, `${amount} should be refused`)
    assert.match(res.body.message, /lower than the current ₱600\.00/)
  }
  assert.equal((await recordSpent(id, '-1')).statusCode, 400)
  assert.equal((await recordSpent(id, '10.123')).statusCode, 400)
  assert.equal((await recordSpent(id, '500', 'confirm')).statusCode, 400)
  assert.equal(autoReturnOf(id).amount.toFixed(2), '400.00', 'refused updates change nothing')
  assert.equal((await recordSpent(id, '0')).statusCode, 200, 'everything can be returned')
  assert.equal(autoReturnOf(id).amount.toFixed(2), '1000.00')
})

test('a cleared disbursement or one from a past semester cannot be changed', async () => {
  const { semester, category } = setup()
  await createDisbursement(category)
  const { id } = db.disbursements[0]

  db.audits.find((a) => a.disbursementId === id).status = 'CLEARED'
  let res = await recordSpent(id, '700')
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /cleared by the Auditor/)

  db.audits.find((a) => a.disbursementId === id).status = 'PENDING'
  semester.isActive = false
  db.semesters.push({ id: nextId++, schoolYear: '2026-2027', semester: 'SECOND', isActive: true })
  res = await recordSpent(id, '700')
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /active semester/)
})

test('a disbursement from before automatic returns gets exactly one when the amount spent is recorded', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const { id } = db.disbursements[0]
  db.returnFunds = [] // as if it was created before this change

  assert.equal((await recordSpent(id, '800')).statusCode, 200)
  assert.equal((await recordSpent(id, '750')).statusCode, 200)
  assert.equal(db.returnFunds.filter((rf) => rf.disbursementId === id).length, 1, 'no duplicate')
  assert.equal(autoReturnOf(id).amount.toFixed(2), '250.00')
})

test('disbursements with returns recorded by hand are left as they are', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const { id } = db.disbursements[0]
  autoReturnOf(id).autoForDisbursementId = null // a return recorded by hand

  const res = await recordSpent(id, '700')
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /recorded by hand/)
})

// ── Hash chain ───────────────────────────────────────────────────────────────
test('the hash chain stays intact through real updates and flags a direct database change', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const { id } = db.disbursements[0]
  await recordSpent(id, '700')
  await recordSpent(id, '600')

  let result = await verifyLedger()
  assert.equal(result.status, 'INTACT', JSON.stringify(result.tamperedLinks.map((l) => l.reasons)))
  assert.equal(result.totalLinks, 4)

  autoReturnOf(id).amount = new Decimal('999.00') // edited outside the app
  result = await verifyLedger()
  assert.equal(result.status, 'TAMPERED')
  assert.ok(result.tamperedLinks.some((l) => l.action === 'RETURN_FUND_UPDATED'
    && l.reasons.some((r) => r.includes('changed from ₱400.00 to ₱999.00 directly in the database'))))

  autoReturnOf(id).amount = new Decimal('400.00')
  db.disbursements[0].amount = new Decimal('1500.00') // the disbursement edited outside the app
  result = await verifyLedger()
  assert.equal(result.status, 'TAMPERED')
})

// ── Archiving and manual returns ─────────────────────────────────────────────
test('archiving a disbursement archives its automatic return with it', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const { id } = db.disbursements[0]

  const res = await call(disbursementCtrl.archiveDisbursement, { params: { id: String(id) } })
  assert.equal(res.statusCode, 200, res.body.message)
  assert.equal(db.disbursements[0].isArchived, true)
  assert.equal(autoReturnOf(id).isArchived, true)
  assert.deepEqual(db.auditLogs.slice(-2).map((l) => l.action), ['RETURN_FUND_ARCHIVED', 'DISBURSEMENT_ARCHIVED'])
  assert.equal((await verifyLedger()).status, 'INTACT')
})

test('Return Funds cannot be added or archived by hand', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const rf = autoReturnOf(db.disbursements[0].id)

  const created = await call(returnFundCtrl.createReturnFund, { body: { disbursementId: db.disbursements[0].id, amount: '100', confirmText: 'CONFIRM' } })
  assert.equal(created.statusCode, 410)
  const archived = await call(returnFundCtrl.archiveReturnFund, { params: { id: String(rf.id) } })
  assert.equal(archived.statusCode, 400)
  assert.equal(rf.isArchived, false)
})

// ── Events funded by a disbursement ──────────────────────────────────────────
const eventBody = (extra) => ({
  title: 'IT Week', date: '2099-01-10', time: '09:00', location: 'Gym', Proponent: 'LITL',
  description: 'Week of activities', access: ['Members'], ...extra,
})

test('an event shows its disbursement\'s amount spent as its budget, one event per disbursement', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const { id } = db.disbursements[0]

  let res = await call(eventCtrl.createEvent, { body: eventBody({ disbursementId: id }) })
  assert.equal(res.statusCode, 201, res.body.message)
  assert.equal(res.body.event.budget, '1000.00')
  assert.equal(res.body.event.disbursement.reference, db.disbursements[0].reference)

  await recordSpent(id, '700')
  res = await call(eventCtrl.getEvent, { params: { id: String(db.events[0].id) } })
  assert.equal(res.body.event.budget, '700.00', 'follows the amount spent')

  res = await call(eventCtrl.createEvent, { body: eventBody({ title: 'Another', disbursementId: id }) })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /already funds the event "IT Week"/)

  const list = await call(eventCtrl.listAvailableDisbursements)
  assert.deepEqual(list.body.disbursements, [], 'a used disbursement is not offered')
  const own = await call(eventCtrl.listAvailableDisbursements, { query: { eventId: String(db.events[0].id) } })
  assert.equal(own.body.disbursements.length, 1, 'but stays offered to its own event')

  res = await call(disbursementCtrl.archiveDisbursement, { params: { id: String(id) } })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /funds the event/)
})

test('an event and its disbursement keep the same title when either is saved', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const disbursement = db.disbursements[0]
  const renames = () => db.auditLogs.filter((l) => l.action === 'DISBURSEMENT_TITLE_UPDATED')

  // Choosing the disbursement fills the event title with its Title of Activity.
  let res = await call(eventCtrl.createEvent, { body: eventBody({ title: 'IT Week booth', disbursementId: disbursement.id }) })
  assert.equal(res.statusCode, 201, res.body.message)
  assert.equal(renames().length, 0, 'same title: nothing to rename')

  const eventId = String(db.events[0].id)
  res = await call(eventCtrl.updateEvent, { params: { id: eventId }, body: { title: 'IT Week 2026' } })
  assert.equal(res.statusCode, 200, res.body.message)
  assert.equal(disbursement.titleOfActivities, 'IT Week 2026')
  assert.equal(res.body.event.disbursement.title, 'IT Week 2026')
  assert.deepEqual(JSON.parse(renames()[0].details), {
    disbursementId: disbursement.id, reference: disbursement.reference, eventId: db.events[0].id,
    from: 'IT Week booth', to: 'IT Week 2026',
  })

  res = await call(eventCtrl.updateEvent, { params: { id: eventId }, body: { location: 'Court' } })
  assert.equal(renames().length, 1, 'saving without a title change renames nothing')
  await call(eventCtrl.updateEvent, { params: { id: eventId }, body: { title: 'IT Week Finale' } })
  assert.equal(disbursement.titleOfActivities, 'IT Week Finale')

  let result = await verifyLedger()
  assert.equal(result.status, 'INTACT', JSON.stringify(result.tamperedLinks.map((l) => l.reasons)))

  disbursement.titleOfActivities = 'Something else' // edited outside the app
  result = await verifyLedger()
  assert.equal(result.status, 'TAMPERED')
  assert.ok(result.tamperedLinks.some((l) => l.action === 'DISBURSEMENT_TITLE_UPDATED'
    && l.reasons.some((r) => r.includes('changed from "IT Week Finale" to "Something else" directly in the database'))))
})

test('a funded event title follows the disbursement title length rule', async () => {
  const { category } = setup()
  await createDisbursement(category)
  const long = 'A'.repeat(51)

  let res = await call(eventCtrl.createEvent, { body: eventBody({ title: long, disbursementId: db.disbursements[0].id }) })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.message, 'Event title must not exceed 50 characters.')
  assert.equal(db.events.length, 0)

  res = await call(eventCtrl.createEvent, { body: eventBody({ disbursementId: db.disbursements[0].id }) })
  res = await call(eventCtrl.updateEvent, { params: { id: String(db.events[0].id) }, body: { title: long } })
  assert.equal(res.statusCode, 400)
  assert.equal(db.disbursements[0].titleOfActivities, 'IT Week')
})

test('an event can be created before its disbursement exists', async () => {
  setup()
  const res = await call(eventCtrl.createEvent, { body: eventBody({ disbursementId: null }) })
  assert.equal(res.statusCode, 201, res.body.message)
  assert.equal(res.body.event.budget, null)
})

test('members see the budget but not which disbursement funds it', async () => {
  const { category } = setup()
  await createDisbursement(category)
  await call(eventCtrl.createEvent, { body: eventBody({ disbursementId: db.disbursements[0].id }) })

  const res = await call(eventCtrl.listEvents, { user: { id: 99, effectiveRole: 'MEMBER' } })
  assert.equal(res.body.events[0].budget, '1000.00')
  assert.equal('disbursement' in res.body.events[0], false)
})

// ── Event reminders ──────────────────────────────────────────────────────────
// 10:00 AM in Manila on 2026-11-15, so "tomorrow" is 2026-11-16.
const MORNING = new Date('2026-11-15T02:00:00Z')

test('the day before an event, everyone who can see it is reminded once, with a push', async () => {
  setup()
  const member = addUser('MEMBER', 'Pedro')
  db.events.push({ id: nextId++, title: 'Seminar', date: '2026-11-16', time: '09:00', location: 'AVR', status: 'COMING_SOON', access: '["Members"]', isArchived: false })
  db.events.push({ id: nextId++, title: 'Officers Meeting', date: '2026-11-16', time: '13:00', location: 'Room 1', status: 'OPEN', access: '["Officers"]', isArchived: false })
  db.events.push({ id: nextId++, title: 'Cancelled Event', date: '2026-11-16', time: '09:00', location: 'Gym', status: 'CANCELLED', access: '["Members"]', isArchived: false })

  const sent = await notifyEventReminders(MORNING)
  assert.equal(sent, 3 + 1 + 3, 'three officers and the member for the Seminar; officers only for the meeting')
  const memberReminders = db.notifications.filter((n) => n.userId === member.id)
  assert.equal(memberReminders.length, 1)
  assert.equal(memberReminders[0].type, 'EVENT_REMINDER')
  assert.equal(memberReminders[0].title, 'Reminder: Seminar is tomorrow')
  assert.equal(memberReminders[0].link, '/members/events')
  assert.equal(db.pushes.length, sent, 'every reminder is pushed')
  assert.ok(db.pushes.every((p) => p.tag?.startsWith('group:event-reminder:')), 'one popup per reminder on a device')

  assert.equal(await notifyEventReminders(MORNING), 0, 'never twice')
})

test('no reminders are sent overnight', async () => {
  setup()
  db.events.push({ id: nextId++, title: 'Seminar', date: '2026-11-16', time: '09:00', location: 'AVR', status: 'OPEN', access: '["Members"]', isArchived: false })
  assert.equal(await notifyEventReminders(new Date('2026-11-14T18:00:00Z')), 0) // 2 AM in Manila
  assert.equal(await notifyEventReminders(new Date('2026-11-15T14:00:00Z')), 0) // 10 PM in Manila
  assert.equal(db.notifications.length, 0)
})
