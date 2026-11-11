// Audit round 4 fixes: requests without a JSON body (R3-01) and unknown
// paths (R3-11).
// Runs a real Express app on a free local port; no database, email or
// network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const express = require('express')

const backend = path.resolve(__dirname, '..')

const { defaultEmptyBody, jsonNotFound } = require(path.join(backend, 'src/middleware/request.middleware'))

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
