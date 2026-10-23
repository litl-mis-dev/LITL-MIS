const express = require('express')
const router = express.Router()

const {
  getPendingUsers, getApprovedMembers, getAdvisers, approveUser, rejectUser, getSignatories,
  assignOfficerRole, removeOfficerRole, getOfficerAssignments, updateMemberStatus, getPublicOfficerRoster
} = require('../controllers/officer.controller')
const authMiddleware = require('../middleware/auth.middleware')
const roleGuard      = require('../middleware/role.middleware')
const requireModule  = require('../middleware/permission.middleware')
const { OFFICER_ROLES, OFFICER_MANAGERS } = require('../utils/roles')

// Public — no authMiddleware. Powers the landing page's "Current Leadership"
// section for anonymous visitors.
router.get('/public-roster', getPublicOfficerRoster)

// Used internally across several modules (signatory blocks on documents,
// financial records, etc.) — any officer may read it, regardless of their
// per-module permissions.
router.get('/signatories', authMiddleware, roleGuard(OFFICER_ROLES), getSignatories)

// Member List module
router.get('/members', authMiddleware, requireModule('MEMBER_LIST', 'VIEW'), getApprovedMembers)

// Advisers are not members, so they are not in /members. Manage Roles reads
// them from here so their officer-side permissions stay configurable.
router.get('/advisers', authMiddleware, requireModule('SETTINGS_ROLES', 'VIEW'), getAdvisers)

// Members Approval module — viewing the pending list only requires VIEW;
// acting on it (approve/reject) requires EDIT. This must stay independent
// from the MEMBER_LIST permission — each module gates only its own access.
router.get('/pending-users',   authMiddleware, requireModule('MEMBERS_APPROVAL', 'VIEW'), getPendingUsers)
router.put('/approve/:userId', authMiddleware, requireModule('MEMBERS_APPROVAL', 'EDIT'), approveUser)
router.put('/reject/:userId',  authMiddleware, requireModule('MEMBERS_APPROVAL', 'EDIT'), rejectUser)

// Officer assignment — history is visible to anyone who can see the Member
// List; making the actual assignment is a standing power reserved for
// President + Vice President and isn't part of the per-module permission
// matrix.
router.get('/assignments', authMiddleware, requireModule('MEMBER_LIST', 'VIEW'), getOfficerAssignments)
router.post('/assign-role',        authMiddleware, roleGuard(OFFICER_MANAGERS), assignOfficerRole)
router.put('/remove-role/:userId', authMiddleware, roleGuard(OFFICER_MANAGERS), removeOfficerRole)

// Member lifecycle status — only active members are eligible for officer positions
router.put('/members/:id/status', authMiddleware, roleGuard(OFFICER_MANAGERS), updateMemberStatus)

module.exports = router