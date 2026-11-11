const express = require('express')
const router = express.Router()
const { validateIdParams } = require('../middleware/request.middleware')
validateIdParams(router, ['id', 'userId'])
const authMiddleware = require('../middleware/auth.middleware')
const roleGuard = require('../middleware/role.middleware')
const { adviserInviteLinkLimiter, adviserInviteSendLimiter } = require('../middleware/rateLimit.middleware')
const ctrl = require('../controllers/adviser.controller')

// Public — the invited person opening their email link. The token travels in
// the request body, never in the URL.
router.post('/invites/lookup', adviserInviteLinkLimiter, ctrl.lookupInvite)
router.post('/invites/accept', adviserInviteLinkLimiter, ctrl.acceptInvite)

// Everything else: the President only (not the VP, other officers, the
// Developer, or advisers themselves).
router.use(authMiddleware, roleGuard(['PRESIDENT_ADMIN']))

router.get('/', ctrl.listAdvisers)
router.post('/invites', adviserInviteSendLimiter, ctrl.createInvite)
router.post('/invites/:id/resend', adviserInviteSendLimiter, ctrl.resendInvite)
router.post('/invites/:id/revoke', ctrl.revokeInvite)
router.post('/:userId/deactivate', ctrl.deactivateAdviser)
router.post('/:userId/reactivate', ctrl.reactivateAdviser)
router.patch('/:userId/title', ctrl.changeAdviserTitle)

module.exports = router
