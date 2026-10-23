import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { connectSocket, disconnectSocket, getSocket } from '../services/socket'
import {
  getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
  getVapidPublicKey, subscribePush, deleteNotification, clearAllNotifications,
} from '../services/notification.service'
import { getImportantAnnouncements } from '../services/announcement.service'
import { enablePushNotifications } from '../utils/push'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [importantAnnouncements, setImportantAnnouncements] = useState([])
  const pushEnabledRef = useRef(false)

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

    // Best-effort: ask for push permission once per session and register
    // the subscription with the server. Silently no-ops if unsupported.
    if (!pushEnabledRef.current) {
      pushEnabledRef.current = true
      getVapidPublicKey()
        .then((publicKey) => enablePushNotifications(publicKey))
        .then((subscription) => subscription && subscribePush(subscription))
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
      importantAnnouncements, refreshAnnouncements,
    }}>
      {children}
    </NotificationContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationContext)