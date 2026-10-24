// Regression checks for the audit fixes, run against a fake Prisma so no
// database is touched. Run with: npm test
const path = require('path')
const backend = path.resolve(__dirname, '..')
const assert = require('assert')

const users = {
  1: { id: 1, role: 'PRESIDENT_ADMIN', status: 'APPROVED' },
  2: { id: 2, role: 'VICE_PRESIDENT_ADMIN', status: 'APPROVED' },
  3: { id: 3, role: 'MEMBER', status: 'APPROVED' },
}
const memberOf = (uid) => ({ id: uid * 10, userId: uid, status: 'ACTIVE', yearLevel: '3rd Year', user: users[uid] })
const STOP = new Error('reached past the guard')
const fakePrisma = {
  member: { findUnique: async ({ where }) => memberOf(where.id / 10) },
  user: { findUnique: async ({ where }) => ({ ...users[where.id], member: memberOf(where.id) }) },
  officerAssignment: { findFirst: async () => { throw STOP } },
  $transaction: async () => { throw STOP },
}
require.cache[require.resolve(path.join(backend, 'src/lib/prisma'))] = { exports: fakePrisma }

const ctrl = require(path.join(backend, 'src/controllers/officer.controller'))
const auth = require(path.join(backend, 'src/controllers/auth.controller'))

const call = async (fn, req) => {
  let status = 200, body
  const res = { status(s) { status = s; return this }, json(b) { body = b; return this }, cookie() { return this } }
  await fn(req, res)
  return { status, body }
}
const as = (uid, extra) => ({ user: { id: uid, role: users[uid].role }, params: {}, body: {}, ...extra })

const results = []
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' -> ' + e.message]) } }

;(async () => {
  await check('VP cannot make themselves President', async () => {
    const r = await call(ctrl.assignOfficerRole, as(2, { body: { memberId: 20, role: 'PRESIDENT_ADMIN' } }))
    assert.strictEqual(r.status, 403)
  })
  await check('VP cannot assign a role to the President', async () => {
    const r = await call(ctrl.assignOfficerRole, as(2, { body: { memberId: 10, role: 'SECRETARY' } }))
    assert.strictEqual(r.status, 403)
  })
  await check('VP can still assign Secretary to a member (passes guard)', async () => {
    const r = await call(ctrl.assignOfficerRole, as(2, { body: { memberId: 30, role: 'SECRETARY' } }))
    assert.notStrictEqual(r.status, 403)
  })
  await check('President can assign VP (passes guard)', async () => {
    const r = await call(ctrl.assignOfficerRole, as(1, { body: { memberId: 30, role: 'VICE_PRESIDENT_ADMIN' } }))
    assert.notStrictEqual(r.status, 403)
  })
  await check('VP cannot remove the President', async () => {
    const r = await call(ctrl.removeOfficerRole, as(2, { params: { userId: '1' } }))
    assert.strictEqual(r.status, 403)
  })
  await check('President can remove the VP (passes guard)', async () => {
    const r = await call(ctrl.removeOfficerRole, as(1, { params: { userId: '2' } }))
    assert.notStrictEqual(r.status, 403)
  })
  await check('VP cannot change the President\'s membership status', async () => {
    const r = await call(ctrl.updateMemberStatus, as(2, { params: { id: '10' }, body: { status: 'INACTIVE' } }))
    assert.strictEqual(r.status, 403)
  })
  await check('Login with non-string identifier returns 400, not 500', async () => {
    const r = await call(auth.login, { body: { identifier: { x: 1 }, password: 'a' } })
    assert.strictEqual(r.status, 400)
  })
  await check('Login with array password returns 400', async () => {
    const r = await call(auth.login, { body: { identifier: 'a@b.c', password: ['x'] } })
    assert.strictEqual(r.status, 400)
  })
  await check('Certificate verify route registered once, behind the rate limiter', async () => {
    const router = require(path.join(backend, 'src/routes/certification.routes'))
    const layers = router.stack.filter((l) => l.route && l.route.path === '/verify/:publicId')
    assert.strictEqual(layers.length, 1)
    assert.strictEqual(layers[0].route.stack.length, 2)
  })
  await check('resend-otp registered once', async () => {
    const router = require(path.join(backend, 'src/routes/auth.routes'))
    assert.strictEqual(router.stack.filter((l) => l.route && l.route.path === '/resend-otp').length, 1)
  })
  for (const [s, n] of results) console.log(s.padEnd(5), n)
  process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0)
})()
