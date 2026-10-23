const express = require('express')
const router = express.Router()

const { submitContactForm } = require('../controllers/contact.controller')
const { contactFormLimiter } = require('../middleware/rateLimit.middleware')

// Public — no authMiddleware. This is the landing page's "Contact" form,
// reachable by anonymous visitors.
router.post('/', contactFormLimiter, submitContactForm)

module.exports = router