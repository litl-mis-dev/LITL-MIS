function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// What to tell someone who can't turn notifications on with one click.
export const HOME_SCREEN_HINT =
  'On iPhone or iPad, tap Share, then Add to Home Screen. Open LITL MIS from your Home Screen to turn on notifications.'
export const BLOCKED_HINT =
  "Notifications are blocked for this site. To get them, allow notifications for this site in your browser's settings."

// iPhones and iPads only offer push to a site opened from the Home Screen:
// in a Safari tab there is no PushManager at all, so nothing can be turned on.
export function needsHomeScreenForPush() {
  const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS reports a Mac
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
  return isAppleMobile && !isStandalone
}

// 'unsupported' | 'default' (never asked) | 'granted' | 'denied'
export function getPushPermission() {
  return isPushSupported() ? Notification.permission : 'unsupported'
}

// Registers the service worker (idempotent) and subscribes the browser to
// push notifications using the server's VAPID public key. Returns null if
// the browser doesn't support push or permission isn't granted.
//
// Only pass { prompt: true } from a click handler: Firefox and Safari refuse
// permission requests that aren't triggered by the user, and Chrome hides them.
export async function enablePushNotifications(vapidPublicKey, { prompt = false } = {}) {
  if (!isPushSupported() || !vapidPublicKey) return null

  const registration = await navigator.serviceWorker.register('/sw.js')

  const permission = prompt ? await Notification.requestPermission() : Notification.permission
  if (permission !== 'granted') return null

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  }

  return subscription.toJSON()
}

// Removes this browser's push subscription, returning its endpoint so the
// caller can also delete it on the server. Used on logout so the next person
// to sign in on a shared computer doesn't receive the previous user's pushes.
export async function disablePushNotifications() {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return null
  const { endpoint } = subscription
  await subscription.unsubscribe()
  return endpoint
}
