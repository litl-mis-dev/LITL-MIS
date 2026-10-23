const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { notifyAuditStatusChanged } = require('../services/notification.service')

const VALID_STATUSES = ['PENDING', 'REVIEW', 'FOR_CLARIFICATION', 'CLEARED']

const INCLUDE_DETAILS = {
  disbursement: {
    select: {
      id: true, reference: true, name: true, amount: true,
      purposeOfFund: true, titleOfActivities: true, createdAt: true,
      disbursedBy: true,
      fundCategory: { select: { id: true, name: true } }
    }
  },
  returnFund: {
    select: {
      id: true, reference: true, amount: true, receivedFrom: true, createdAt: true,
      refundedBy: true,
      disbursement: {
        select: { id: true, reference: true, purposeOfFund: true, titleOfActivities: true }
      }
    }
  },
  reviewedBy: { select: { id: true, member: { select: { firstName: true, lastName: true } } } }
}

// GET /financial/audits — list every automated audit record (Disbursements
// and Return Funds each get exactly one, created automatically on submit).
const listAudits = async (req, res) => {
  try {
    const semester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!semester) return res.json({ audits: [], schoolYear: null })
    // Exclude audits whose underlying Disbursement/Return Fund has since been
    // archived — an archived record no longer counts toward real fund
    // movement, so it must not be counted toward "Audited Disbursed" /
    // "Audited Return Fund" totals either (each Audit row has exactly one of
    // disbursement/returnFund set, see schema).
    const audits = await prisma.audit.findMany({
      where: {
        OR: [
          { disbursementId: { not: null }, disbursement: { isArchived: false, semester: { schoolYear: semester.schoolYear } } },
          { returnFundId: { not: null }, returnFund: { isArchived: false, semester: { schoolYear: semester.schoolYear } } }
        ]
      },
      include: INCLUDE_DETAILS,
      orderBy: { createdAt: 'desc' }
    })
    return res.json({ audits, schoolYear: semester.schoolYear })
  } catch (err) {
    logError('List audits', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// PATCH /financial/audits/:id — Auditor updates the review status of a
// record. Restricted to AUDIT-module EDIT at the route level (requireModule).
// Workflow: PENDING -> REVIEW / FOR_CLARIFICATION -> CLEARED.
// Once a record is CLEARED it is locked and can no longer be changed.
const reviewAudit = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { status, remarks } = req.body

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid audit record ID.' })
    }
    if (remarks !== undefined && remarks !== null && typeof remarks !== 'string') {
      return res.status(400).json({ message: 'Remarks must be text.' })
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Status must be one of: Pending, Review, For Clarification, Cleared.' })
    }

    const audit = await prisma.audit.findUnique({ where: { id } })
    if (!audit) return res.status(404).json({ message: 'Audit record not found.' })

    if (audit.status === 'CLEARED') {
      return res.status(400).json({ message: 'This record has already been cleared and can no longer be changed.' })
    }

    const isBeingCleared = status === 'CLEARED'
    const reviewRemarks = remarks === undefined ? audit.remarks : remarks?.trim() || null
    if (status === 'FOR_CLARIFICATION' && !reviewRemarks) {
      return res.status(400).json({ message: 'Enter remarks explaining what needs clarification.' })
    }

    const updated = await prisma.audit.update({
      // Compare the status atomically so a concurrent clearance cannot be overwritten.
      where: { id, status: audit.status, updatedAt: audit.updatedAt },
      data: {
        status,
        remarks: reviewRemarks,
        reviewedById: req.user.id,
        reviewedAt: new Date()
      },
      include: INCLUDE_DETAILS
    })

    const displayId = audit.disbursementId
      ? `AUD-DIS-${audit.disbursementId}`
      : `AUD-RET-${audit.returnFundId}`

    await writeAuditLog({
      actorId: req.user.id,
      action: isBeingCleared ? AUDIT_ACTIONS.AUDIT_CLEARED : AUDIT_ACTIONS.AUDIT_STATUS_UPDATED,
      details: {
        auditId: id,
        displayId,
        disbursementId: audit.disbursementId,
        returnFundId: audit.returnFundId,
        reference: updated.disbursement?.reference || updated.returnFund?.reference || null,
        previousStatus: audit.status,
        newStatus: status,
        remarks: reviewRemarks
      }
    })

    const subjectLabel =
      updated.disbursement?.titleOfActivities ||
      updated.disbursement?.name ||
      updated.returnFund?.receivedFrom ||
      displayId

    try {
      await notifyAuditStatusChanged(subjectLabel, audit.status, status)
    } catch (err) {
      logError('Audit notification failed after save', err)
    }

    return res.json({ message: `Audit record marked as ${status.replace('_', ' ').toLowerCase()}.`, audit: updated })
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(409).json({ message: 'This audit record changed during your review. Refresh before trying again.' })
    }
    logError('Review audit', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { listAudits, reviewAudit }
