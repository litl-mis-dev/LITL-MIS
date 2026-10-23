import api from './api'

export const verifyLedger = () => api.get('/ledger/verify').then(r => r.data)