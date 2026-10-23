const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/auth.middleware')
const requireModule  = require('../middleware/permission.middleware')

const semesterCtrl     = require('../controllers/semester.controller')
const paymentCtrl      = require('../controllers/payment.controller')
const categoryCtrl     = require('../controllers/fundCategory.controller')
const disbursementCtrl = require('../controllers/disbursement.controller')
const returnFundCtrl   = require('../controllers/returnFund.controller')
const auditCtrl        = require('../controllers/audit.controller')
const archiveCtrl      = require('../controllers/archive.controller')

router.use(authMiddleware)

// Semesters
router.get('/semesters',              requireModule('FINANCIAL', 'VIEW'), semesterCtrl.listSemesters)
router.get('/semesters/active',       requireModule('FINANCIAL', 'VIEW'), semesterCtrl.getActiveSemester)
router.get('/semesters/active/member-summary', semesterCtrl.getActiveSemesterMemberSummary)
router.get('/semesters/active/stats', requireModule('FINANCIAL', 'VIEW'), semesterCtrl.getActiveSemesterStats)
router.post('/semesters/advance',     requireModule('FINANCIAL', 'EDIT'), semesterCtrl.advanceSemester)
router.post('/semesters/init',        requireModule('FINANCIAL', 'EDIT'), semesterCtrl.initFirstSemester)

// Payments
router.get('/payments',       requireModule('FINANCIAL', 'VIEW'), paymentCtrl.listPayments)
router.post('/payments/preview', requireModule('FINANCIAL', 'EDIT'), paymentCtrl.previewPayment)
router.post('/payments',      requireModule('FINANCIAL', 'EDIT'), paymentCtrl.recordPayment)
router.get('/members/:memberId/payment-history', requireModule('FINANCIAL', 'VIEW'), paymentCtrl.getMemberPaymentHistory)

router.post('/members/:memberId/send-reminder', requireModule('FINANCIAL', 'EDIT'), paymentCtrl.sendPaymentReminder)
router.post('/payments/send-reminders',         requireModule('FINANCIAL', 'EDIT'), paymentCtrl.sendBulkPaymentReminders)

// Fund Categories
router.get('/categories',        requireModule('FINANCIAL', 'VIEW'), categoryCtrl.listCategories)
router.post('/categories/batch', requireModule('FINANCIAL', 'EDIT'), categoryCtrl.createCategoriesBatch)
router.delete('/categories/:id', requireModule('FINANCIAL', 'EDIT'), categoryCtrl.archiveCategory)

// Disbursements
router.get('/disbursements',        requireModule('FINANCIAL', 'VIEW'), disbursementCtrl.listDisbursements)
router.get('/disbursements/:id',    requireModule('FINANCIAL', 'VIEW'), disbursementCtrl.getDisbursement)
router.post('/disbursements',       requireModule('FINANCIAL', 'EDIT'), disbursementCtrl.createDisbursement)
router.delete('/disbursements/:id', requireModule('FINANCIAL', 'EDIT'), disbursementCtrl.archiveDisbursement)

// Return Funds
router.get('/return-funds',        requireModule('FINANCIAL', 'VIEW'), returnFundCtrl.listReturnFunds)
router.get('/return-funds/:id',    requireModule('FINANCIAL', 'VIEW'), returnFundCtrl.getReturnFund)
router.post('/return-funds',       requireModule('FINANCIAL', 'EDIT'), returnFundCtrl.createReturnFund)
router.delete('/return-funds/:id', requireModule('FINANCIAL', 'EDIT'), returnFundCtrl.archiveReturnFund)

// Archive — read-only history of any semester (Settings ▸ Archive). GET only,
// and FINANCIAL VIEW like every other Financial read. The disbursement /
// return-fund lists withhold document signatories unless the caller also has
// FINANCIAL EDIT, mirroring who can download certificates.
router.get('/archive/summary',       requireModule('FINANCIAL', 'VIEW'), archiveCtrl.getArchiveSummary)
router.get('/archive/fund-report',   requireModule('FINANCIAL', 'VIEW'), archiveCtrl.getArchiveFundReport)
router.get('/archive/disbursements', requireModule('FINANCIAL', 'VIEW'), archiveCtrl.listArchiveDisbursements)
router.get('/archive/return-funds',  requireModule('FINANCIAL', 'VIEW'), archiveCtrl.listArchiveReturnFunds)

// Audit — automated review queue for Disbursements & Return Funds. This is
// the separate AUDIT module (Senator for Audit's home turf), not FINANCIAL.
router.get('/audits',       requireModule('AUDIT', 'VIEW'), auditCtrl.listAudits)
router.patch('/audits/:id', requireModule('AUDIT', 'EDIT'), auditCtrl.reviewAudit)

module.exports = router