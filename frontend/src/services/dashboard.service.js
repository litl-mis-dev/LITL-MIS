import api from './api'

export const getDashboardStats = () => api.get('/dashboard').then(res => res.data)