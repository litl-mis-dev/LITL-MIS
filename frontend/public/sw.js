self.addEventListener('push', function (event) {
  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'LITL-MIS', message: event.data ? event.data.text() : '' }
  }

  // The same notification (same tag) replaces its earlier popup instead of
  // stacking a duplicate; renotify still alerts when a grouped one changes.
  const options = {
    body: data.message || '',
    icon: '/Logo.png',
    data: { link: data.link || '/' },
    ...(data.tag && { tag: data.tag, renotify: true }),
  }

  event.waitUntil(self.registration.showNotification(data.title || 'LITL-MIS', options))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const link = event.notification.data?.link || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'notification-click', link })
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(link)
    })
  )
})