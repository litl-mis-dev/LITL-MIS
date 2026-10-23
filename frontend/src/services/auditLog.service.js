import api from './api'

// GET /api/audit-logs
// Params: q, action, module, dateFrom, dateTo, page, limit
export const listAuditLogs = (params = {}) => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  })
  const qs = query.toString()
  return api.get(`/audit-logs${qs ? `?${qs}` : ''}`).then(r => r.data)
}