const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/auth.middleware')
const {
  listNotifications, getUnreadCount, markAsRead, markAllAsRead,
  getPublicVapidKey, subscribePush, unsubscribePush,
  deleteNotification, clearAllNotifications,
} = require('../controllers/notification.controller')

router.use(authMiddleware)

router.get('/', listNotifications)
router.get('/unread-count', getUnreadCount)
router.patch('/read-all', markAllAsRead)
router.patch('/:id/read', markAsRead)
router.delete('/:id', deleteNotification)
router.delete('/', clearAllNotifications)

router.get('/push/public-key', getPublicVapidKey)
router.post('/push/subscribe', subscribePush)
router.post('/push/unsubscribe', unsubscribePush)

module.exports = router