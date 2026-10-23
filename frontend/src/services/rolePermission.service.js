import api from './api'

// Caller's own module -> level map — used for nav filtering/route guarding.
export const getMyPermissions = () => api.get('/role-permissions/mine').then(res => res.data)

// Full cross-role matrix — admin-only (Settings ▸ Manage Roles).
export const getRolePermissions = () => api.get('/role-permissions').then(res => res.data)

export const updateRolePermissions = (permissions) => api.put('/role-permissions', { permissions }).then(res => res.data)