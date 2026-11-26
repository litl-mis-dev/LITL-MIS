// Sign-in limits per person (not per shared Wi-Fi), upload limits that fit
// in memory, and a readiness check that notices missing migrations.
// Runs a real Express app on a free local port; no database, email or
// network. Run with: npm test
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const express = require('express')
const cookieParser = require('cookie-parser')

const backend = path.resolve(__dirname, '..')
// The hash-chain lookups read the Activity Log through this fake.
let lookupQueries = 0
const lookupRows = [
  { id: 5, action: 'RETURN_FUND_UPDATED', details: '{"returnFundId":7,"newAmount":"100.00"}' },
  { id: 9, action: 'RETURN_FUND_UPDATED', details: '{"returnFundId":7,"newAmount":"50.00"}' },
  { id: 12, action: 'DISBURSEMENT_ARCHIVED', details: '{"reference":"DIS-001"}' },
  { id: 14, action: 'CATEGORY_UPDATED', details: '{"previousName":"Events","name":"Events Fund"}' },
]
require.cache[require.resolve(path.join(backend, 'src/lib/prisma.js'))] = {
  exports: { auditLog: { findMany: async ({ where }) => { lookupQueries++; return lookupRows.filter((r) => where.action.in.includes(r.action)) } } },
}
const { buildLogLookup } = require(path.join(backend, 'src/utils/ledger'))
delete process.env.DOCUMENTS_MAX_FILE_SIZE_MB
delete process.env.CERTIFICATE_MAX_FILE_SIZE_MB
const limits = require(path.join(backend, 'src/middleware/rateLimit.middleware'))
const upload = require(path.join(backend, 'src/middleware/upload.middleware'))
const { pendingMigrations, shippedMigrations } = require(path.join(backend, 'src/utils/migrationStatus'))

// Every request comes from the same IP here, like students on campus Wi-Fi.
const app = express()
app.use(express.json())
app.use(cookieParser())
app.post('/login', limits.loginIpLimiter, limits.loginLimiter, (req, res) =>
  (req.body.password === 'right' ? res.json({ ok: true }) : res.status(401).json({ message: 'Invalid credentials' })))
app.post('/register', limits.registerIpLimiter, limits.registerLimiter, (req, res) => res.status(201).json({ ok: true }))

let base
let server
test.before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
test.after(() => new Promise((resolve) => server.close(resolve)))

const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('login: many people on one network can all sign in', async () => {
  for (let i = 0; i < 30; i++) {
    const res = await post('/login', { identifier: `student${i}@cvsu.edu.ph`, password: 'right' })
    assert.equal(res.status, 200, `student ${i}`)
  }
})

test('login: one account is blocked after 10 failed tries, others on the network are not', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await post('/login', { identifier: 'Target@cvsu.edu.ph', password: 'wrong' })).status, 401)
  }
  // Same account, any spelling of its email: blocked.
  assert.equal((await post('/login', { identifier: ' target@CVSU.edu.ph ', password: 'right' })).status, 429)
  // Someone else on the same Wi-Fi: fine.
  assert.equal((await post('/login', { identifier: 'neighbour@cvsu.edu.ph', password: 'right' })).status, 200)
})

test('login: successful sign-ins never count toward the limit', async () => {
  for (let i = 0; i < 15; i++) {
    assert.equal((await post('/login', { identifier: 'regular@cvsu.edu.ph', password: 'right' })).status, 200)
  }
})

test('register: a class can register from one network; one email is capped at 5 tries', async () => {
  for (let i = 0; i < 12; i++) {
    assert.equal((await post('/register', { email: `new${i}@cvsu.edu.ph` })).status, 201)
  }
  for (let i = 0; i < 5; i++) assert.equal((await post('/register', { email: 'repeat@cvsu.edu.ph' })).status, 201)
  assert.equal((await post('/register', { email: 'repeat@cvsu.edu.ph' })).status, 429)
})

test('uploads: defaults keep one request within about 100–150 MB of memory', () => {
  assert.equal(upload.MAX_DOCUMENT_SIZE_MB, 20)
  assert.equal(upload.MAX_CERTIFICATE_SIZE_MB, 5)
  assert.equal(upload.MAX_CERTIFICATE_FILES, 30)
  const source = fs.readFileSync(path.join(backend, 'src/middleware/upload.middleware.js'), 'utf8')
  assert.match(source, /const MAX_FILES_PER_UPLOAD\s+= 5\b/)
})

test('readiness: migrations shipped with the code but not applied are reported', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'litl-migrations-'))
  try {
    for (const name of ['20260101000000_first', '20260201000000_second']) fs.mkdirSync(path.join(dir, name))
    fs.writeFileSync(path.join(dir, 'migration_lock.toml'), 'provider = "mysql"')
    assert.deepEqual(shippedMigrations(dir), ['20260101000000_first', '20260201000000_second'], 'folders only')

    const fakePrisma = (rows) => ({ $queryRaw: async () => rows })
    assert.deepEqual(await pendingMigrations(fakePrisma([{ migration_name: '20260101000000_first' }]), dir), ['20260201000000_second'])
    assert.deepEqual(await pendingMigrations(fakePrisma([{ migration_name: '20260101000000_first' }, { migration_name: '20260201000000_second' }]), dir), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('hash chain: related entries are loaded once and matched in memory', async () => {
  lookupQueries = 0
  const lookup = await buildLogLookup()
  assert.equal(lookupQueries, 1, 'one query, however many links are checked')

  assert.equal(lookup.find('DISBURSEMENT_ARCHIVED', '"reference":"DIS-001"').id, 12)
  assert.equal(lookup.find('DISBURSEMENT_ARCHIVED', '"reference":"DIS-002"'), null)
  // Case-insensitive, like the database's text search.
  assert.equal(lookup.find('CATEGORY_UPDATED', '"previousName":"EVENTS",').id, 14)
  // "A later update of this record": only entries after the given one.
  assert.equal(lookup.find('RETURN_FUND_UPDATED', '"returnFundId":7,', { afterId: 5 }).id, 9)
  assert.equal(lookup.find('RETURN_FUND_UPDATED', '"returnFundId":7,', { afterId: 9 }), null)
  // Only the named action is searched.
  assert.equal(lookup.find('RETURN_FUND_ARCHIVED', '"returnFundId":7,'), null)
  assert.equal(lookupQueries, 1)
})

test('readiness: the real migrations folder is found', () => {
  assert.ok(shippedMigrations().includes('20261116130000_initial_schema'))
})
