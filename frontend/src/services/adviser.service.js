import api from './api'

// President only (the server refuses everyone else).
export const getAdvisers = () => api.get('/advisers').then((r) => r.data)
export const inviteAdviser = (data) => api.post('/advisers/invites', data).then((r) => r.data)
export const resendAdviserInvite = (id) => api.post(`/advisers/invites/${id}/resend`).then((r) => r.data)
export const revokeAdviserInvite = (id) => api.post(`/advisers/invites/${id}/revoke`).then((r) => r.data)
export const deactivateAdviser = (userId) => api.post(`/advisers/${userId}/deactivate`).then((r) => r.data)
export const reactivateAdviser = (userId) => api.post(`/advisers/${userId}/reactivate`).then((r) => r.data)
export const changeAdviserTitle = (userId, title) => api.patch(`/advisers/${userId}/title`, { title }).then((r) => r.data)

// Public — the invited person. The token goes in the body, never the URL.
export const lookupAdviserInvite = (token) => api.post('/advisers/invites/lookup', { token }).then((r) => r.data.invite)
export const acceptAdviserInvite = (data) => api.post('/advisers/invites/accept', data).then((r) => r.data)
