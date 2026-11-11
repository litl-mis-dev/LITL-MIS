// GET /api/auth/avatar/:userId/image — the profile picture used on a
// membership card when the browser can't load it from R2 directly. Only the
// owner, or an officer who can view the Member List, may read it. Runs with
// stubbed storage and database. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-that-is-long-enough-123'
const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

const members = [
  { userId: 5, avatarPath: 'profiles/5-1700000000000.png' },
  { userId: 6, avatarPath: null },
]
stub('src/lib/prisma.js', {
  member: { findUnique: async ({ where }) => members.find((m) => m.userId === where.userId) ?? null },
})
stub('src/services/storage.service.js', {
  downloadFile: async (p) => Buffer.from(`bytes-of-${p}`),
  uploadFile: async () => ({}), deleteFile: async () => {}, deleteFiles: async () => {}, getSignedUrl: async () => '',
})
stub('src/services/permissions.service.js', {
  hasAccess: async (role, module, level) => role === 'SECRETARY' && module === 'MEMBER_LIST' && level === 'VIEW',
  loadPermissions: async () => ({}),
})

const { getAvatarImage } = require(path.join(backend, 'src/controllers/auth.controller'))

const call = async (userId, user) => {
  const res = { statusCode: 200, headers: {}, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  res.set = (k, v) => { res.headers[k] = v; return res }
  res.send = (body) => { res.body = body; return res }
  await getAvatarImage({ params: { userId: String(userId) }, user }, res)
  return res
}

test('members can read their own profile picture', async () => {
  const res = await call(5, { id: 5, role: 'MEMBER' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'image/png')
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
  assert.equal(res.body.toString(), 'bytes-of-profiles/5-1700000000000.png')
})

test("officers with Member List access can read members' pictures; others can't", async () => {
  assert.equal((await call(5, { id: 9, role: 'SECRETARY' })).statusCode, 200)
  assert.equal((await call(5, { id: 9, role: 'MEMBER' })).statusCode, 403)
  assert.equal((await call(5, { id: 9, role: 'SEN_SPORTS_ARTS_CULTURE' })).statusCode, 403)
})

test('missing pictures and bad ids return 404', async () => {
  assert.equal((await call(6, { id: 6, role: 'MEMBER' })).statusCode, 404)
  assert.equal((await call(77, { id: 77, role: 'MEMBER' })).statusCode, 404)
  assert.equal((await call('abc', { id: 5, role: 'MEMBER' })).statusCode, 404)
})
