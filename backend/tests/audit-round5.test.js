// Audit round 5: design assets (Settings ▸ Design templates) accept raster
// images only, and a rejected file gets a 400 with its reason instead of a
// generic 500. Runs the real route on a free local port with auth and storage
// stubbed — no database or network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const express = require('express')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

const deleteCalls = []
stub('src/lib/prisma.js', {
  notification: { deleteMany: async (args) => { deleteCalls.push(args); return { count: 0 } } },
})
stub('src/services/storage.service.js', { deleteFiles: async () => {} })
stub('src/middleware/auth.middleware.js', (req, res, next) => { req.user = { id: 1, role: 'PRESIDENT_ADMIN' }; next() })
stub('src/middleware/permission.middleware.js', () => (req, res, next) => next())
stub('src/controllers/documentAsset.controller.js', {
  getAssets: (req, res) => res.json({}),
  deleteAsset: (req, res) => res.json({}),
  getPublicMemberCertificateTemplate: (req, res) => res.json({}),
  uploadAsset: (req, res) => res.status(201).json({ received: req.file.mimetype }),
})

const routes = require(path.join(backend, 'src/routes/documentAsset.routes'))

async function withServer(fn) {
  const app = express()
  app.use('/api/document-assets', routes)
  // Same last-resort handler as index.js.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ message: 'Something went wrong. Please try again.' }))
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const upload = (base, type, name) => {
  const form = new FormData()
  form.append('file', new Blob([Buffer.from('fake image bytes')], { type }), name)
  return fetch(`${base}/api/document-assets/disbursementTemplate`, { method: 'POST', body: form })
}

test('an SVG design asset is refused with a reason, not a server error', async () => {
  await withServer(async (base) => {
    const res = await upload(base, 'image/svg+xml', 'template.svg')
    assert.equal(res.status, 400)
    assert.match((await res.json()).message, /PNG, JPEG, WebP or GIF/)
  })
})

test('PNG, JPEG, WebP and GIF design assets still go through', async () => {
  await withServer(async (base) => {
    for (const [type, name] of [['image/png', 'a.png'], ['image/jpeg', 'a.jpg'], ['image/webp', 'a.webp'], ['image/gif', 'a.gif']]) {
      const res = await upload(base, type, name)
      assert.equal(res.status, 201, type)
    }
  })
})

// ── Old notifications ────────────────────────────────────────────────────────
const { cleanupOldReadNotifications } = require(path.join(backend, 'src/utils/cleanup'))

test('read notifications untouched for 90 days are deleted once a day; unread ones never', async () => {
  const now = Date.parse('2026-11-16T00:00:00Z')
  await cleanupOldReadNotifications(now)
  assert.equal(deleteCalls.length, 1)
  const { where } = deleteCalls[0]
  assert.equal(where.isRead, true, 'only notifications already read')
  assert.equal(where.updatedAt.lt.toISOString(), '2026-08-18T00:00:00.000Z', '90 days before')

  await cleanupOldReadNotifications(now + 15 * 60 * 1000)
  assert.equal(deleteCalls.length, 1, 'not again within the day')
  await cleanupOldReadNotifications(now + 24 * 60 * 60 * 1000)
  assert.equal(deleteCalls.length, 2, 'again the next day')
})
