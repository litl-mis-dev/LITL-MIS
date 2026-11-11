// Audit round 4 fixes: requests without a JSON body (R3-01), unknown paths
// (R3-11), non-numeric IDs in URLs (R3-06) and announcement length limits
// (R3-07).
// Runs a real Express app on a free local port; no database, email or
// network. Run with: npm test
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const express = require('express')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

const { defaultEmptyBody, jsonNotFound, validateIdParams } = require(path.join(backend, 'src/middleware/request.middleware'))

// Starts `app` on a free port, runs `fn(baseUrl)`, then closes it.
async function withServer(app, fn) {
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

// A handler shaped like the real ones: it destructures req.body.
const loginLike = (req, res) => {
  const { identifier } = req.body
  if (!identifier) return res.status(400).json({ message: 'Email or student number is required.' })
  return res.json({ ok: true })
}
const serverError = (err, req, res, next) => res.status(500).json({ message: 'Something went wrong.' }) // eslint-disable-line no-unused-vars

test('R3-01: a request without a JSON body gets 400, not 500', async () => {
  const fixed = express().use(express.json()).use(defaultEmptyBody).post('/login', loginLike).use(serverError)
  await withServer(fixed, async (base) => {
    for (const [type, body] of [['text/plain', 'x'], ['application/x-www-form-urlencoded', 'a=1'], [null, undefined]]) {
      const res = await fetch(`${base}/login`, { method: 'POST', headers: type ? { 'Content-Type': type } : {}, body })
      assert.equal(res.status, 400, `Content-Type ${type}`)
    }
    const ok = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"identifier":"a"}' })
    assert.equal(ok.status, 200)
  })

  // The same app without the fix shows the original bug.
  const broken = express().use(express.json()).post('/login', loginLike).use(serverError)
  await withServer(broken, async (base) => {
    const res = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })
    assert.equal(res.status, 500)
  })
})

test('R3-11: unknown paths get a JSON 404, not the Express HTML page', async () => {
  await withServer(express().use(jsonNotFound), async (base) => {
    for (const p of ['/swagger', '/api/nope', '/']) {
      const res = await fetch(base + p)
      assert.equal(res.status, 404)
      assert.match(res.headers.get('content-type'), /application\/json/)
      assert.deepEqual(await res.json(), { message: 'Not found' })
    }
  })
})

test('R3-06: non-numeric or out-of-range IDs get 400; text parameters are untouched', async () => {
  const router = express.Router()
  validateIdParams(router, ['id'])
  router.get('/docs/:id', (req, res) => res.json({ id: Number(req.params.id) }))
  router.get('/verify/:publicId', (req, res) => res.json({ publicId: req.params.publicId }))
  await withServer(express().use(router), async (base) => {
    for (const bad of ['abc', '0', '-1', '1.5', '1e3', '99999999999', '2147483648', '%20']) {
      assert.equal((await fetch(`${base}/docs/${bad}`)).status, 400, bad)
    }
    assert.deepEqual(await (await fetch(`${base}/docs/42`)).json(), { id: 42 })
    assert.deepEqual(await (await fetch(`${base}/verify/AbC-123`)).json(), { publicId: 'AbC-123' })
  })
})

test('R3-06: every router checks each numeric parameter it uses', () => {
  // Routers load their controllers; none of them touches the database here.
  stub('src/lib/prisma.js', {})
  const routesDir = path.join(backend, 'src/routes')
  const TEXT_PARAMS = new Set(['publicId', 'studentNumber', 'assetType'])
  for (const file of fs.readdirSync(routesDir)) {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8')
    const used = new Set((source.match(/'\/[^']*'/g) ?? []).flatMap((p) => p.match(/:([a-zA-Z]+)/g) ?? []).map((p) => p.slice(1)))
    const numeric = [...used].filter((p) => !TEXT_PARAMS.has(p))
    if (numeric.length === 0) continue
    const router = require(path.join(routesDir, file))
    for (const name of numeric) {
      assert.ok(router.params?.[name]?.length, `${file} does not validate :${name}`)
    }
  }
})

test('R3-07: announcement title and message have length limits', async () => {
  stub('src/lib/prisma.js', { announcement: { create: async () => { throw new Error('must not reach the database') } } })
  stub('src/utils/auditLog.js', { writeAuditLog: async () => {} })
  stub('src/services/notification.service.js', { notifyAnnouncement: async () => {} })
  delete require.cache[require.resolve(path.join(backend, 'src/controllers/announcement.controller'))]
  const { createAnnouncement } = require(path.join(backend, 'src/controllers/announcement.controller'))

  const call = async (body) => {
    const res = { statusCode: 200 }
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (b) => { res.body = b; return res }
    await createAnnouncement({ body, user: { id: 1, role: 'PRESIDENT_ADMIN' } }, res)
    return res
  }
  const base = { recipients: 'BOTH', priority: 'NORMAL' }
  assert.match((await call({ ...base, title: 'x'.repeat(121), message: 'ok' })).body.message, /120 characters/)
  assert.match((await call({ ...base, title: 'ok', message: 'x'.repeat(1001) })).body.message, /1000 characters/)
  assert.equal((await call({ ...base, title: ['a'], message: 'ok' })).statusCode, 400)
  assert.equal((await call({ ...base, title: '   ', message: 'ok' })).statusCode, 400)
})
