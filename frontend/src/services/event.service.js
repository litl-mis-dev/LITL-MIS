import api from './api'

export const listEvents      = ()           => api.get('/events').then(r => r.data)
export const getEvent        = (id)         => api.get(`/events/${id}`).then(r => r.data)
export const createEvent     = (data)       => api.post('/events', data).then(r => r.data)
export const updateEvent     = (id, data)   => api.put(`/events/${id}`, data).then(r => r.data)
export const archiveEvent    = (id)         => api.delete(`/events/${id}`).then(r => r.data)
export const recordAttendance = (eventId, qrCode) => api.post(`/events/${eventId}/attendance`, { qrCode }).then(r => r.data)
export const getEventAttendance = (id) => api.get(`/events/${id}/attendance`).then(r => r.data)