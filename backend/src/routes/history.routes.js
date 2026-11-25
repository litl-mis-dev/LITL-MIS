const express = require('express')
const router = express.Router()
const { validateIdParams } = require('../middleware/request.middleware')
validateIdParams(router, ['entityId'])
const { getHistory } = require('../controllers/history.controller')
const authMiddleware = require('../middleware/auth.middleware')
const roleGuard = require('../middleware/role.middleware')
const { OFFICER_ROLES } = require('../utils/roles')

// A record's edit history (who changed it, when, what changed). Officers
// only; the controller also checks the record's own module permission.
router.get('/:entityType/:entityId', authMiddleware, roleGuard(OFFICER_ROLES), getHistory)

module.exports = router
