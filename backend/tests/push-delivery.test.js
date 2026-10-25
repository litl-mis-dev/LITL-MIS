// End-to-end check of the push pipeline without a browser or network:
// the app's push.service builds the real encrypted Web Push request (VAPID +
// aes128gcm), we act as the browser — verify the VAPID signature, decrypt the
// payload with the subscription's private key — and feed it to the app's real
// frontend/public/sw.js to confirm the notification it would show.
// Run with: npm test
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const backend = path.resolve(__dirname, '..')
const webpush = require('web-push')
const ece = require(require.resolve('http_ece', { paths: [path.dirname(require.resolve('web-push'))] }))

const vapid = webpush.generateVAPIDKeys()
process.env.VAPID_PUBLIC_KEY = vapid.publicKey
process.env.VAPID_PRIVATE_KEY = vapid.privateKey
process.env.VAPID_CONTACT_EMAIL = 'mailto:officers@litltrece.me'

// A browser's subscription keys: P-256 key pair + 16-byte auth secret.
const browserKey = crypto.createECDH('prime256v1')
browserKey.generateKeys()
const authSecret = crypto.randomBytes(16)
const subscription = {
  id: 1, userId: 42,
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-device-token',
  p256dh: browserKey.getPublicKey().toString('base64url'),
  auth: authSecret.toString('base64url'),
}

// Capture what push.service would send instead of hitting the network.
const captured = []
const realWebpush = { ...webpush }
require.cache[require.resolve('web-push')] = {
  exports: {
    ...realWebpush,
    setVapidDetails: webpush.setVapidDetails,
    sendNotification: async (sub, payload, options) => {
      captured.push(webpush.generateRequestDetails(sub, payload, options))
      return { statusCode: 201 }
    },
  },
}
require.cache[require.resolve(path.join(backend, 'src/lib/prisma'))] = {
  exports: { pushSubscription: { findMany: async () => [subscription], delete: async () => ({}) } },
}
const { sendPushToUser } = require(path.join(backend, 'src/services/push.service'))

function runServiceWorker(payloadBuffer) {
  const shown = []
  const listeners = {}
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn },
    registration: { showNotification: async (title, options) => shown.push({ title, options }) },
  }
  const swSource = fs.readFileSync(path.join(backend, '..', 'frontend', 'public', 'sw.js'), 'utf8')
  vm.runInNewContext(swSource, { self, clients: {} })
  let waitFor
  listeners.push({
    data: { json: () => JSON.parse(payloadBuffer.toString('utf8')), text: () => payloadBuffer.toString('utf8') },
    waitUntil: (p) => { waitFor = p },
  })
  return waitFor.then(() => shown)
}

test('push.service produces a request a browser can verify, decrypt and display via sw.js', async () => {
  await sendPushToUser(42, { title: 'Registration approved', message: 'Welcome to LITL!', link: '/members' })
  assert.equal(captured.length, 1)
  const req = captured[0]

  // Goes to the subscription endpoint with the standard Web Push headers.
  assert.equal(req.endpoint, subscription.endpoint)
  assert.equal(req.method, 'POST')
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm')
  assert.ok(Number(req.headers.TTL) > 0)

  // VAPID: "vapid t=<JWT>, k=<server public key>" signed with the private key.
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(req.headers.Authorization)
  assert.ok(match, 'Authorization header is VAPID')
  const [jwt, k] = [match[1], match[2]]
  assert.equal(k, vapid.publicKey)
  const [header, claims, signature] = jwt.split('.')
  const claimSet = JSON.parse(Buffer.from(claims, 'base64url'))
  assert.equal(claimSet.aud, 'https://fcm.googleapis.com')
  assert.equal(claimSet.sub, 'mailto:officers@litltrece.me')
  assert.ok(claimSet.exp * 1000 > Date.now())
  const publicKey = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256',
      x: Buffer.from(vapid.publicKey, 'base64url').subarray(1, 33).toString('base64url'),
      y: Buffer.from(vapid.publicKey, 'base64url').subarray(33, 65).toString('base64url') },
    format: 'jwk',
  })
  const valid = crypto.verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))
  assert.ok(valid, 'VAPID JWT signature verifies with the public key')

  // Browser side: decrypt with the subscription's private key + auth secret.
  const plaintext = ece.decrypt(req.body, { version: 'aes128gcm', privateKey: browserKey, authSecret: authSecret.toString('base64url') })
  assert.deepEqual(JSON.parse(plaintext), { title: 'Registration approved', message: 'Welcome to LITL!', link: '/members' })

  // The app's real service worker turns it into the right notification.
  const shown = await runServiceWorker(plaintext)
  assert.equal(shown.length, 1)
  assert.equal(shown[0].title, 'Registration approved')
  assert.equal(shown[0].options.body, 'Welcome to LITL!')
  assert.equal(shown[0].options.data.link, '/members')
  assert.equal(shown[0].options.icon, '/Logo.png')
})
