const express = require('express')
const router  = express.Router()
const { getAssets, uploadAsset, deleteAsset, getPublicMemberCertificateTemplate } = require('../controllers/documentAsset.controller')
const authMiddleware     = require('../middleware/auth.middleware')
const requireModule      = require('../middleware/permission.middleware')
const { documentAssetUpload } = require('../middleware/upload.middleware')

router.get('/public/member-certificate', getPublicMemberCertificateTemplate)

router.get('/', authMiddleware, getAssets)

// Uploading/removing design assets (letterhead, certificate & disbursement
// templates, etc.) is the Settings ▸ Design module.
router.post(
  '/:assetType',
  authMiddleware,
  requireModule('SETTINGS_DESIGN', 'EDIT'),
  documentAssetUpload.single('file'),
  uploadAsset
)

router.delete(
  '/:assetType',
  authMiddleware,
  requireModule('SETTINGS_DESIGN', 'EDIT'),
  deleteAsset
)

module.exports = router