const express = require('express')
const router = express.Router()
const { validateIdParams } = require('../middleware/request.middleware')
validateIdParams(router, ['id'])
const authMiddleware = require('../middleware/auth.middleware')
const roleGuard = require('../middleware/role.middleware')
const { ANNOUNCEMENT_MANAGERS } = require('../utils/roles')
const { createAnnouncement, listImportantAnnouncements, getAnnouncement } = require('../controllers/announcement.controller')

router.use(authMiddleware)

// Any authenticated user can see the Important Announcements aimed at them.
router.get('/important', listImportantAnnouncements)

// One announcement's full details — only for users it was sent to.
router.get('/:id', getAnnouncement)

// Only the President, Vice President, and Senator for Publicity and
// Information may send announcements. Enforced server-side — hiding the
// button in the frontend is not sufficient on its own.
router.post('/', roleGuard(ANNOUNCEMENT_MANAGERS), createAnnouncement)

module.exports = router