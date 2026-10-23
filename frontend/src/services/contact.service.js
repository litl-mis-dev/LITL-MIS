import api from './api'

// Landing page "Contact" form — public, unauthenticated endpoint.
export const submitContactForm = (data) => api.post('/contact', data).then(r => r.data)