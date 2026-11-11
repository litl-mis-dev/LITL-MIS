// Profile pictures on membership cards. GET /api/auth/avatar/:userId/image
// is used when the browser can't load the photo from R2 directly — only the
// owner, or an officer who can view the Member List, may read it. The
// officers' Members List must carry each photo, or cards downloaded there
// have none. Runs with stubbed storage and database. Run with: npm test
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
  semester: { findFirst: async () => ({ id: 1 }) },
  user: {
    findMany: async ({ select }) => [{
      id: 5, studentNumber: '2023-100-1', email: 'a@cvsu.edu.ph', role: 'MEMBER', status: 'APPROVED', createdAt: new Date(),
      member: {
        id: 50, firstName: 'Ana', middleName: null, lastName: 'Cruz', suffix: null, yearLevel: '1st Year', section: '1', status: 'ACTIVE',
        payments: [],
        // Only returned when the query asks for it, like the real database.
        ...(select.member.select.avatar && { avatar: 'https://pub.r2.dev/profiles/5.png' }),
      },
    }],
  },
})
stub('src/realtime/socket.js', { emitToAll() {}, emitToOfficers() {}, emitToUser() {}, emitToHashChain() {} })
stub('src/utils/auditLog.js', { writeAuditLog: async () => {} })
stub('src/utils/email.js', { sendRegistrationStatusEmail: async () => {} })
stub('src/services/notification.service.js', { notifyRegistrationRejected: async () => {}, syncMemberApprovalNotifications: async () => {} })
stub('src/services/memberApproval.service.js', { approvePendingUser: async () => ({ approved: false }) })
stub('src/services/storage.service.js', {
  downloadFile: async (p) => Buffer.from(`bytes-of-${p}`),
  uploadFile: async () => ({}), deleteFile: async () => {}, deleteFiles: async () => {}, getSignedUrl: async () => '',
})
stub('src/services/permissions.service.js', {
  hasAccess: async (role, module, level) => role === 'SECRETARY' && module === 'MEMBER_LIST' && level === 'VIEW',
  loadPermissions: async () => ({}),
})

const { getAvatarImage } = require(path.join(backend, 'src/controllers/auth.controller'))
const { getApprovedMembers } = require(path.join(backend, 'src/controllers/officer.controller'))

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

test("the officers' Members List includes each member's profile picture", async () => {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await getApprovedMembers({ user: { id: 9, role: 'SECRETARY' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.members[0].avatar, 'https://pub.r2.dev/profiles/5.png')
  assert.equal(res.body.members[0].id, 5, 'account id, used for the photo fallback')
})
