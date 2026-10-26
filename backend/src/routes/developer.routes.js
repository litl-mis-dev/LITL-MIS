const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/auth.middleware')
const { requireDeveloper, requireNoPresident } = require('../middleware/developer.middleware')
const { getPendingUsers, approveUser, rejectUser } = require('../controllers/officer.controller')
const { getStatus, listPresidentCandidates, assignPresident } = require('../controllers/developer.controller')

// Developer account only. Its actions stop working as soon as a President
// exists (requireNoPresident is checked on every request, not just in the UI).
router.use(authMiddleware, requireDeveloper)

router.get('/status', getStatus)

router.get('/pending-users',    requireNoPresident, getPendingUsers)
router.put('/approve/:userId',  requireNoPresident, approveUser)
router.put('/reject/:userId',   requireNoPresident, rejectUser)
router.get('/members',          requireNoPresident, listPresidentCandidates)
router.post('/assign-president', requireNoPresident, assignPresident)

module.exports = router
