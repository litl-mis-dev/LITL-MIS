const express = require('express')
const router = express.Router()

const authMiddleware = require('../middleware/auth.middleware')
const { uploadDocuments } = require('../middleware/upload.middleware')
const { documentUploadLimiter } = require('../middleware/rateLimit.middleware')
const { OFFICER_ROLES } = require('../utils/roles')
const documentCtrl = require('../controllers/document.controller')

// Documents has no RBAC — every officer has EDIT access EXCEPT the Adviser /
// Dept. Chair, who is restricted to view-only. This is enforced here (not
// just hidden in the UI) so the restriction can't be bypassed by calling the
// API directly.
function requireDocumentsEdit(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' })
  }
  if (!OFFICER_ROLES.includes(req.user.role) || req.user.role === 'ADVISER_DEPT_CHAIR') {
    return res.status(403).json({ message: 'Access denied' })
  }
  next()
}

// Viewing — members and officers alike (per-document permission is enforced
// inside the controller; a MEMBER or view-only user simply won't see items
// or actions they lack access to)
router.get('/',              authMiddleware, documentCtrl.listDocuments)
router.get('/:id/download',  authMiddleware, documentCtrl.downloadItem)
router.get('/:id/preview',   authMiddleware, documentCtrl.previewItem)

// Managing — every officer except the Adviser/Dept. Chair; fine-grained
// owner/admin checks still happen per-document inside the controller functions.
router.get('/officers',      authMiddleware, requireDocumentsEdit, documentCtrl.getOfficersForSharing)
router.post('/folders',      authMiddleware, requireDocumentsEdit, documentCtrl.createFolder)
router.post('/upload',       authMiddleware, requireDocumentsEdit, documentUploadLimiter, uploadDocuments, documentCtrl.uploadFiles)
router.patch('/:id',         authMiddleware, requireDocumentsEdit, documentCtrl.renameItem)
router.put('/:id/access',    authMiddleware, requireDocumentsEdit, documentCtrl.updateAccess)
router.post('/:id/trash',    authMiddleware, requireDocumentsEdit, documentCtrl.trashItem)
router.post('/:id/restore',  authMiddleware, requireDocumentsEdit, documentCtrl.restoreItem)
router.delete('/:id',        authMiddleware, requireDocumentsEdit, documentCtrl.permanentlyDeleteItem)

module.exports = router