import api from './api'

export const getPublicOfficers = () => {
  return api.get('/officer/public-officers').then(res => res.data)
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

// Checks a scanned member QR on the server; resolves to { memberId }.
export const scanMemberQr = (qrCode) => {
  return api.post('/officer/members/scan-qr', { qrCode }).then(res => res.data)
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

// ─── Member lifecycle status ─────────────────────────────────────────────────

export const updateMemberStatus = (memberId, status) => {
  return api.put(`/officer/members/${memberId}/status`, { status }).then(res => res.data)
}

// ─── Members List (automatic approval) ──────────────────────────────────────

export const getMembersList = () => {
  return api.get('/officer/members-list').then(res => res.data)
}

// rows: [{ row, studentNumber, lastName }]; mode: 'add' | 'replace'
export const previewMembersList = (rows, mode) => {
  return api.post('/officer/members-list/preview', { rows, mode }).then(res => res.data)
}

export const saveMembersList = (rows, mode) => {
  return api.post('/officer/members-list', { rows, mode }).then(res => res.data)
}

export const removeMembersListEntry = (studentNumber) => {
  return api.delete(`/officer/members-list/${encodeURIComponent(studentNumber)}`).then(res => res.data)
}
