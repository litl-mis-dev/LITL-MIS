function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

// Registers the service worker (idempotent) and subscribes the browser to
// push notifications using the server's VAPID public key. Returns null if
// the browser doesn't support push or the user denies permission.
export async function enablePushNotifications(vapidPublicKey) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !vapidPublicKey) {
    return null
  }

  const registration = await navigator.serviceWorker.register('/sw.js')

  const permission = await Notification.requestPermission()
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