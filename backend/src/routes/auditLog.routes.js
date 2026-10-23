const express = require('express')
const router = express.Router()
const { listAuditLogs } = require('../controllers/auditLog.controller')
const authMiddleware = require('../middleware/auth.middleware')
const requireModule  = require('../middleware/permission.middleware')

router.get('/', authMiddleware, requireModule('ACTIVITY_LOGS', 'VIEW'), listAuditLogs)

module.exports = router