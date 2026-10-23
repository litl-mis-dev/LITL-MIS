const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')

const listNotifications = async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return res.json({ notifications })
  } catch (err) {
    logError('List notifications', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const getUnreadCount = async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false },
    })
    return res.json({ count })
  } catch (err) {
    logError('Get unread notification count', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const markAsRead = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const notification = await prisma.notification.findUnique({ where: { id } })
    if (!notification || notification.userId !== req.user.id) {
      return res.status(404).json({ message: 'Notification not found.' })
    }
    await prisma.notification.update({ where: { id }, data: { isRead: true } })
    return res.json({ message: 'Marked as read.' })
  } catch (err) {
    logError('Mark notification read', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const markAllAsRead = async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    })
    return res.json({ message: 'All notifications marked as read.' })
  } catch (err) {
    logError('Mark all notifications read', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const getPublicVapidKey = (req, res) => {
  return res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null })
}

const subscribePush = async (req, res) => {
  try {
    const { endpoint, keys } = req.body
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'Invalid push subscription.' })
    }

    await prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId: req.user.id, endpoint } },
      update: { p256dh: keys.p256dh, auth: keys.auth },
      create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    })

    return res.status(201).json({ message: 'Subscribed to push notifications.' })
  } catch (err) {
    logError('Subscribe push', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const unsubscribePush = async (req, res) => {
  try {
    const { endpoint } = req.body
    if (!endpoint) return res.status(400).json({ message: 'Endpoint is required.' })

    await prisma.pushSubscription.deleteMany({ where: { userId: req.user.id, endpoint } })
    return res.json({ message: 'Unsubscribed.' })
  } catch (err) {
    logError('Unsubscribe push', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const deleteNotification = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const notification = await prisma.notification.findUnique({ where: { id } })
    if (!notification || notification.userId !== req.user.id) {
      return res.status(404).json({ message: 'Notification not found.' })
    }
    await prisma.notification.delete({ where: { id } })
    return res.json({ message: 'Notification removed.' })
  } catch (err) {
    logError('Delete notification', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const clearAllNotifications = async (req, res) => {
  try {
    await prisma.notification.deleteMany({ where: { userId: req.user.id } })
    return res.json({ message: 'All notifications cleared.' })
  } catch (err) {
    logError('Clear notifications', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = {
  listNotifications, getUnreadCount, markAsRead, markAllAsRead,
  getPublicVapidKey, subscribePush, unsubscribePush,
  deleteNotification, clearAllNotifications,
}