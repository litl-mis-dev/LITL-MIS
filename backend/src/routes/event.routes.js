const express = require('express')
const router = express.Router()
const authMiddleware = require('../middleware/auth.middleware')
const requireModule  = require('../middleware/permission.middleware')
const eventCtrl = require('../controllers/event.controller')

// Viewing — both members and officers (access filtering happens in controller)
router.get('/',    authMiddleware, eventCtrl.listEvents)
router.get('/:id', authMiddleware, eventCtrl.getEvent)

// Managing — requires EDIT on the Event module
router.post('/',    authMiddleware, requireModule('EVENT', 'EDIT'), eventCtrl.createEvent)
router.put('/:id',  authMiddleware, requireModule('EVENT', 'EDIT'), eventCtrl.updateEvent)
router.delete('/:id', authMiddleware, requireModule('EVENT', 'EDIT'), eventCtrl.archiveEvent)

// Attendance — requires EDIT on the Event module (QR scanning)
router.post('/:id/attendance', authMiddleware, requireModule('EVENT', 'EDIT'), eventCtrl.recordAttendance)
router.get('/:id/attendance',  authMiddleware, requireModule('EVENT', 'VIEW'), eventCtrl.getAttendance)

module.exports = router