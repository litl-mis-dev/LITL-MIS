import axios from 'axios'

// Uses VITE_API_URL when set (production/deployment build), otherwise falls
// back to localhost for local development. Never hardcode a machine-specific
// URL here — every client (including other users' devices) loads this same
// bundle, so a hardcoded localhost only ever works on the developer's PC.
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
})

let _viewAsRole = null

export function setViewAsRole(role) { _viewAsRole = role }
export function clearViewAsRole()   { _viewAsRole = null }

api.interceptors.request.use((config) => {
  if (_viewAsRole) {
    config.headers['X-View-As'] = _viewAsRole
  }
  return config
})

export default api