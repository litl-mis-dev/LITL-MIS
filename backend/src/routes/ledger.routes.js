const express  = require('express')
const router   = express.Router()
const { verify } = require('../controllers/ledger.controller')
const authMiddleware = require('../middleware/auth.middleware')
const roleGuard = require('../middleware/role.middleware')
const { HASH_CHAIN_ROLES } = require('../utils/roles')

// No RBAC on Hash Chain — every officer can view it EXCEPT the Adviser /
// Dept. Chair, who has no access to this module at all.
router.get('/verify', authMiddleware, roleGuard(HASH_CHAIN_ROLES), verify)

module.exports = router