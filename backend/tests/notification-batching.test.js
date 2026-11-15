// Notifying many users at once (announcements, events) must not flood the
// database: on 14 Nov 2026 a full fan-out ran it out of connections and
// notifications were lost. Users are notified in small batches, and one
// failure doesn't stop the rest. In-memory fakes only. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let inFlight = 0
let maxInFlight = 0
let created = []
let pushed = []
let failFor = new Set()
const track = async (fn) => {
  inFlight += 1
  maxInFlight = Math.max(maxInFlight, inFlight)
  try { await sleep(2); return await fn() } finally { inFlight -= 1 }
}

stub('src/lib/prisma.js', {
  notification: {
    create: ({ data }) => track(async () => {
      if (failFor.has(data.userId)) throw new Error('Database unavailable')
      const row = { id: created.length + 1, isRead: false, ...data }
      created.push(row)
      return row
    }),
  },
})
stub('src/realtime/socket.js', { emitToUser: () => {}, emitToAll: () => {}, emitToOfficers: () => {}, emitToHashChain: () => {} })
stub('src/services/push.service.js', { sendPushToUser: (userId) => track(async () => { pushed.push(userId) }) })

const { createNotificationForUsers } = require(path.join(backend, 'src/services/notification.service'))

const reset = () => { inFlight = 0; maxInFlight = 0; created = []; pushed = []; failFor = new Set() }
const userIds = (n) => Array.from({ length: n }, (_, i) => i + 1)
const data = { type: 'ANNOUNCEMENT', title: 'General Assembly', message: 'Friday, 1 PM', link: '/members' }

test('a large fan-out reaches everyone without running hundreds of queries at once', async () => {
  reset()
  await createNotificationForUsers(userIds(300), data)
  assert.equal(created.length, 300)
  assert.equal(pushed.length, 300, 'every user is pushed')
  assert.ok(maxInFlight <= 50, `at most one batch of writes and pushes at a time (saw ${maxInFlight})`)
})

test('one failed user does not stop the users after them', async () => {
  reset()
  failFor = new Set([3, 40])
  await createNotificationForUsers(userIds(60), data)
  assert.equal(created.length, 58)
  assert.ok(created.some((n) => n.userId === 60), 'the last user still gets it')
})
