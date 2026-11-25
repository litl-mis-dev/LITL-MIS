import api from './api'

// A record's edit history: { entries: [{ id, actionLabel, actorName, createdAt, changes, description }] }.
// type: 'event' | 'disbursement' | 'fundCategory' | 'member' | 'audit' | 'document'
export const getEditHistory = (type, id) =>
  api.get(`/history/${encodeURIComponent(type)}/${encodeURIComponent(id)}`).then(r => r.data)
