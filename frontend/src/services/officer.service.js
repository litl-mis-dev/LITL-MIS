import api from './api'

export const getPublicOfficerRoster = () => {
  return api.get('/officer/public-roster').then(res => res.data)
}

export const getPendingUsers = () => {
  return api.get('/officer/pending-users').then(res => res.data)
}

export const approveUser = (userId) => {
  return api.put(`/officer/approve/${userId}`).then(res => res.data)
}

export const rejectUser = (userId) => {
  return api.put(`/officer/reject/${userId}`).then(res => res.data)
}

export const getSignatories = () => {
  return api.get('/officer/signatories').then(res => res.data)
}

export const getApprovedMembers = () => {
  return api.get('/officer/members').then(res => res.data)
}

// Adviser / Dept. Chair accounts — used by Manage Roles only (not members).
export const getAdvisers = () => {
  return api.get('/officer/advisers').then(res => res.data)
}

// ─── Officer assignment ─────────────────────────────────────────────────────

export const assignOfficerRole = (memberId, role) => {
  return api.post('/officer/assign-role', { memberId, role }).then(res => res.data)
}

export const removeOfficerRole = (userId) => {
  return api.put(`/officer/remove-role/${userId}`).then(res => res.data)
}

export const getOfficerAssignments = () => {
  return api.get('/officer/assignments').then(res => res.data)
}

// ─── Member lifecycle status ─────────────────────────────────────────────────

export const updateMemberStatus = (memberId, status) => {
  return api.put(`/officer/members/${memberId}/status`, { status }).then(res => res.data)
}
