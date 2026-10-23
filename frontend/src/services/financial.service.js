import api from './api'

// Semesters
export const getActiveSemester = () => api.get('/financial/semesters/active').then(r => r.data)

export const listSemesters = () => api.get('/financial/semesters').then(r => r.data)


// Archive (read-only history of any semester) — Settings ▸ Archive
const archiveParams = (schoolYear, semester) => ({ params: { schoolYear, semester } })

export const getArchiveSummary = (schoolYear, semester) => api.get('/financial/archive/summary', archiveParams(schoolYear, semester)).then(r => r.data)

export const getArchiveFundReport = (schoolYear, semester) => api.get('/financial/archive/fund-report', archiveParams(schoolYear, semester)).then(r => r.data)

export const listArchiveDisbursements = (schoolYear, semester) => api.get('/financial/archive/disbursements', archiveParams(schoolYear, semester)).then(r => r.data)

export const listArchiveReturnFunds = (schoolYear, semester) => api.get('/financial/archive/return-funds', archiveParams(schoolYear, semester)).then(r => r.data)

export const getActiveSemesterStats = () => api.get('/financial/semesters/active/stats').then(r => r.data)

export const getMemberFundSummary = () => api.get('/financial/semesters/active/member-summary').then(r => r.data)

export const advanceSemester = (confirmText) => api.post('/financial/semesters/advance', { confirmText }).then(r => r.data)

export const initFirstSemester = (schoolYear, semester, confirmText) => api.post('/financial/semesters/init', { schoolYear, semester, confirmText }).then(r => r.data)

// Payments
export const listPayments = () => api.get('/financial/payments').then(r => r.data)

export const previewPayment = (memberId, amount) => api.post('/financial/payments/preview', { memberId, amount }).then(r => r.data)

export const recordPayment = (memberId, amount, expectedSemesterIds) => api.post('/financial/payments', { memberId, amount, expectedSemesterIds }).then(r => r.data)

export const getMemberPaymentHistory = (memberId) => api.get(`/financial/members/${memberId}/payment-history`).then(r => r.data)

// Payment reminder emails
export const sendPaymentReminder = (memberId) => api.post(`/financial/members/${memberId}/send-reminder`).then(r => r.data)

export const sendBulkPaymentReminders = () => api.post('/financial/payments/send-reminders').then(r => r.data)

// Fund Categories
export const listCategories = () => api.get('/financial/categories').then(r => r.data)

export const createCategoriesBatch = (categories, confirmText) => api.post('/financial/categories/batch', { categories, confirmText }).then(r => r.data)

export const archiveCategory = (id) => api.delete(`/financial/categories/${id}`).then(r => r.data)

// Disbursements
export const listDisbursements = () => api.get('/financial/disbursements').then(r => r.data)

export const getDisbursement = (id) => api.get(`/financial/disbursements/${id}`).then(r => r.data)

export const createDisbursement = (data) => api.post('/financial/disbursements', data).then(r => r.data)

export const updateDisbursement = (id, data) => api.put(`/financial/disbursements/${id}`, data).then(r => r.data)

export const archiveDisbursement = (id) => api.delete(`/financial/disbursements/${id}`).then(r => r.data)

// Return Funds
export const listReturnFunds = () => api.get('/financial/return-funds').then(r => r.data)

export const createReturnFund = (data) => api.post('/financial/return-funds', data).then(r => r.data)

export const updateReturnFund = (id, data) => api.put(`/financial/return-funds/${id}`, data).then(r => r.data)

export const archiveReturnFund = (id) => api.delete(`/financial/return-funds/${id}`).then(r => r.data)

export const getMyPaymentHistory = () => api.get('/auth/my-payment-history').then(r => r.data)

// Audit — automated review queue for Disbursements & Return Funds.
export const listAudits = () => api.get('/financial/audits').then(r => r.data)

export const reviewAudit = (id, status, remarks) => api.patch(`/financial/audits/${id}`, { status, remarks }).then(r => r.data)

