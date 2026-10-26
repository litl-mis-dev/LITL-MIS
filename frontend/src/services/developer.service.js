import api from './api'

// Developer account only (see backend routes/developer.routes.js). Every
// action is refused by the server once a President has been assigned.
export const getDeveloperStatus = () => api.get('/developer/status').then((r) => r.data)
export const getDeveloperPendingUsers = () => api.get('/developer/pending-users').then((r) => r.data.users)
export const developerApproveUser = (userId) => api.put(`/developer/approve/${userId}`).then((r) => r.data)
export const developerRejectUser = (userId) => api.put(`/developer/reject/${userId}`).then((r) => r.data)
export const getPresidentCandidates = () => api.get('/developer/members').then((r) => r.data.members)
export const assignPresident = (memberId) => api.post('/developer/assign-president', { memberId }).then((r) => r.data)
