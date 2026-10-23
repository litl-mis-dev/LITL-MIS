import api from './api'

export const getImportantAnnouncements = () =>
  api.get('/announcements/important').then((r) => r.data.announcements)

export const createAnnouncement = (payload) =>
  api.post('/announcements', payload).then((r) => r.data)