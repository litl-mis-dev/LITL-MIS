const express = require('express')
const router  = express.Router()
const authMiddleware = require('../middleware/auth.middleware')
const roleGuard = require('../middleware/role.middleware')
const { OFFICER_ROLES } = require('../utils/roles')
const { getDashboardStats } = require('../controllers/dashboard.controller')

// No RBAC on Dashboard — every officer can view it. There are no edit
// actions on this page, so no EDIT-level gate is needed either.
router.get('/', authMiddleware, roleGuard(OFFICER_ROLES), getDashboardStats)

module.exports = router