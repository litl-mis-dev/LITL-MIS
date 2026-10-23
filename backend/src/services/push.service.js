const webpush = require('web-push')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

// Sends a push notification to every device/browser this user has
// subscribed on. Cleans up subscriptions the browser has revoked (410/404).
async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return // push not configured — skip silently

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
  if (subscriptions.length === 0) return

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        )
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        } else {
          logError('Send push notification', err)
        }
      }
    })
  )
}

module.exports = { sendPushToUser }