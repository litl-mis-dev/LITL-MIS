const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/auth.middleware')
const requireModule  = require('../middleware/permission.middleware')
const { uploadCertificate } = require('../middleware/upload.middleware')
const certificationCtrl = require('../controllers/certification.controller')
const { publicVerifyLimiter } = require('../middleware/rateLimit.middleware')

// ── Public — no auth. Must stay ahead of the authMiddleware-gated routes below. ─
router.get('/verify/:publicId', certificationCtrl.verifyCertificate)

// ── Read access — anyone with at least VIEW on Certification ────────────────────
router.get('/tree',                  authMiddleware, requireModule('CERTIFICATION', 'VIEW'), certificationCtrl.getTree)
router.get('/events/:eventId',       authMiddleware, requireModule('CERTIFICATION', 'VIEW'), certificationCtrl.getEventFolder)
router.get('/events/:eventId/certificates/download', authMiddleware, requireModule('CERTIFICATION', 'EDIT'), certificationCtrl.downloadEventCertificatesZip)
router.get('/certificates/:id/download', authMiddleware, requireModule('CERTIFICATION', 'EDIT'), certificationCtrl.downloadCertificate)

// ── Write access — issuing/revoking requires EDIT on Certification ──────────────
router.post('/events/:eventId/certificates', authMiddleware, requireModule('CERTIFICATION', 'EDIT'), uploadCertificate, certificationCtrl.issueCertificate)
router.post('/certificates/:id/revoke',      authMiddleware, requireModule('CERTIFICATION', 'EDIT'), certificationCtrl.revokeCertificate)

router.get('/verify/:publicId', publicVerifyLimiter, certificationCtrl.verifyCertificate)

module.exports = router