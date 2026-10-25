import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { connectSocket, disconnectSocket, getSocket } from '../services/socket'
import {
  getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
  getVapidPublicKey, subscribePush, deleteNotification, clearAllNotifications,
} from '../services/notification.service'
import { getImportantAnnouncements } from '../services/announcement.service'
import { enablePushNotifications, getPushPermission } from '../utils/push'

const NotificationContext = createContext(null)

// Subscribes this browser and registers it with the server. `prompt` must
// only be true when called from a click (see utils/push.js).
async function registerPush(publicKey, { prompt }) {
  const subscription = await enablePushNotifications(publicKey, { prompt })
  if (!subscription) return false
  await subscribePush(subscription)
  return true
}

export function NotificationProvider({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [importantAnnouncements, setImportantAnnouncements] = useState([])
  const [pushPermission, setPushPermission] = useState(getPushPermission)
  // The server's VAPID public key; null until loaded or when push isn't
  // configured on the server (then no "Turn on" button is shown).
  const [vapidPublicKey, setVapidPublicKey] = useState(null)
  const pushEnabledRef = useRef(false)

  // Clicking a push notification while the app is already open: sw.js
  // focuses this tab and asks it to open the notification's link.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handleMessage = (event) => {
      const link = event.data?.type === 'notification-click' ? event.data.link : null
      if (typeof link === 'string' && link.startsWith('/')) navigate(link)
    }
    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [navigate])

  // Called from the "Turn on notifications" button — a user click, so the
  // browser will actually show its permission prompt.
  const enablePush = useCallback(async () => {
    if (!vapidPublicKey) return
    try {
      await registerPush(vapidPublicKey, { prompt: true })
    } catch {
      // subscription failed — leave permission state as the browser reports it
    }
    setPushPermission(getPushPermission())
  }, [vapidPublicKey])

  const refreshAnnouncements = useCallback(async () => {
    try {
      const list = await getImportantAnnouncements()
      setImportantAnnouncements(list)
    } catch {
      // not logged in yet / request failed — ignore, keep previous state
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([getNotifications(), getUnreadCount()])
      setNotifications(list)
      setUnreadCount(count)
    } catch {
      // not logged in yet / request failed — ignore
    }
    refreshAnnouncements()
  }, [refreshAnnouncements])

  useEffect(() => {
    if (!user) {
      disconnectSocket()
      setNotifications([])
      setUnreadCount(0)
      setImportantAnnouncements([])
      pushEnabledRef.current = false
      return
    }

    refresh()

    const socket = connectSocket()
    const handleNew = (notification) => {
      setNotifications((prev) => {
        const withoutDuplicate = prev.filter((n) => n.id !== notification.id)
        return [notification, ...withoutDuplicate].slice(0, 50)
      })
      setUnreadCount((prev) => prev + (notification.isRead ? 0 : 1))

      // A new ANNOUNCEMENT-type notification means an officer just sent one —
      // refetch the pinned Important Announcements list in case this one
      // (or another the officer sent alongside it) belongs there.
      if (notification.type === 'ANNOUNCEMENT') {
        refreshAnnouncements()
      }
    }
    socket.on('notification:new', handleNew)

    // Once per session: if this browser already allowed notifications,
    // (re)register its subscription for the signed-in user. Never prompts
    // here — asking without a click is blocked by Firefox and Safari.
    if (!pushEnabledRef.current) {
      pushEnabledRef.current = true
      setPushPermission(getPushPermission())
      getVapidPublicKey()
        .then((publicKey) => {
          setVapidPublicKey(publicKey || null)
          if (publicKey && getPushPermission() === 'granted') {
            return registerPush(publicKey, { prompt: false })
          }
        })
        .catch(() => {})
    }

    return () => {
      socket.off('notification:new', handleNew)
    }
  }, [user, refresh, refreshAnnouncements])

  const markRead = useCallback(async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    try {
      await markNotificationRead(id)
    } catch {
      refresh()
    }
  }, [refresh])

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setUnreadCount(0)
    try {
      await markAllNotificationsRead()
    } catch {
      refresh()
    }
  }, [refresh])

  const removeNotification = useCallback(async (id) => {
    let wasUnread = false
    setNotifications((prev) => {
      wasUnread = prev.find((n) => n.id === id)?.isRead === false
      return prev.filter((n) => n.id !== id)
    })
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1))

    try {
      await deleteNotification(id)
    } catch {
      refresh()
    }
  }, [refresh])

  const clearAll = useCallback(async () => {
    setNotifications([])
    setUnreadCount(0)
    try {
      await clearAllNotifications()
    } catch {
      refresh()
    }
  }, [refresh])

  return (
    <NotificationContext.Provider value={{
      notifications, unreadCount, markRead, markAllRead, removeNotification, clearAll, refresh,
      importantAnnouncements, refreshAnnouncements, enablePush,
      // Show the "Turn on" button only when the server supports push and
      // this browser hasn't been asked yet.
      canEnablePush: Boolean(vapidPublicKey) && pushPermission === 'default',
    }}>
      {children}
    </NotificationContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationContext)