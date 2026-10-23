import api from './api'

export const getNotifications = () => api.get('/notifications').then((r) => r.data.notifications)
export const getUnreadCount = () => api.get('/notifications/unread-count').then((r) => r.data.count)
export const markNotificationRead = (id) => api.patch(`/notifications/${id}/read`).then((r) => r.data)
export const markAllNotificationsRead = () => api.patch('/notifications/read-all').then((r) => r.data)
export const getVapidPublicKey = () => api.get('/notifications/push/public-key').then((r) => r.data.publicKey)
export const subscribePush = (subscription) => api.post('/notifications/push/subscribe', subscription).then((r) => r.data)
export const unsubscribePush = (endpoint) => api.post('/notifications/push/unsubscribe', { endpoint }).then((r) => r.data)
export const deleteNotification = (id) => api.delete(`/notifications/${id}`).then((r) => r.data)
export const clearAllNotifications = () => api.delete('/notifications').then((r) => r.data)