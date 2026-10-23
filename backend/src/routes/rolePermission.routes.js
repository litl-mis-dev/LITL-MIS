const express = require('express')
const router  = express.Router()
const authMiddleware = require('../middleware/auth.middleware')
const requireModule  = require('../middleware/permission.middleware')
const { listRolePermissions, updateRolePermissions, getMyPermissions } = require('../controllers/rolePermission.controller')

// Any authenticated officer/member can read their OWN module -> level map —
// this is what the frontend uses to filter nav items and gate pages.
router.get('/mine', authMiddleware, getMyPermissions)

// The full cross-role matrix is admin-only — requires SETTINGS_ROLES access.
router.get('/', authMiddleware, requireModule('SETTINGS_ROLES', 'VIEW'), listRolePermissions)

// Only roles with EDIT on Settings ▸ Manage Roles can change the matrix
router.put('/', authMiddleware, requireModule('SETTINGS_ROLES', 'EDIT'), updateRolePermissions)

module.exports = router