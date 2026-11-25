const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { notifyAuditStatusChanged } = require('../services/notification.service')
const { RETURNS_SUMMARY_INCLUDE, summarizeReturns } = require('../services/calculations.service')
const { withLastEdits, latestEdits } = require('../utils/lastEdit')

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
    return res.json({ audits: await withLastEdits('audit', audits), schoolYear: semester.schoolYear })
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
    if (typeof remarks === 'string' && remarks.trim().length > 1000) {
      return res.status(400).json({ message: 'Remarks must not exceed 1000 characters.' })
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
    // A clarification remark belongs to For Clarification: moving to any other
    // status clears it (the record's history keeps what it said).
    const leavingClarification = audit.status === 'FOR_CLARIFICATION' && status !== 'FOR_CLARIFICATION'
    const reviewRemarks = leavingClarification ? null
      : remarks === undefined ? audit.remarks : remarks?.trim() || null
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
      entity: { type: 'audit', id },
      details: {
        auditId: id,
        displayId,
        disbursementId: audit.disbursementId,
        returnFundId: audit.returnFundId,
        reference: updated.disbursement?.reference || updated.returnFund?.reference || null,
        previousStatus: audit.status,
        newStatus: status,
        remarks: reviewRemarks,
        changes: [
          { field: 'status', label: 'Status', from: audit.status, to: status },
          { field: 'remarks', label: 'Remarks', from: audit.remarks ?? null, to: reviewRemarks ?? null },
        ].filter((c) => (c.from ?? '') !== (c.to ?? ''))
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

    const lastEdit = (await latestEdits('audit', [id]))[id] ?? null
    return res.json({ message: `Audit record marked as ${status.replace('_', ' ').toLowerCase()}.`, audit: { ...updated, lastEdit } })
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(409).json({ message: 'This audit record changed during your review. Refresh before trying again.' })
    }
    logError('Review audit', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// GET /financial/audits/:id/document — the disbursement or return fund being
// audited, shaped like the Financial lists, so the auditor can read its
// certificate before deciding. Audit VIEW is enough: this is for reading only.
const getAuditDocument = async (req, res) => {
  try {
    const audit = await prisma.audit.findUnique({
      where: { id: Number(req.params.id) },
      select: { disbursementId: true, returnFundId: true },
    })
    if (!audit) return res.status(404).json({ message: 'Audit record not found.' })

    if (audit.disbursementId) {
      const found = await prisma.disbursement.findUnique({
        where: { id: audit.disbursementId },
        include: { fundCategory: { select: { id: true, name: true } }, ...RETURNS_SUMMARY_INCLUDE },
      })
      if (!found) return res.status(404).json({ message: 'Disbursement not found.' })
      const { returnFunds, ...disbursement } = found
      return res.json({ kind: 'disbursement', record: { ...disbursement, ...summarizeReturns({ ...disbursement, returnFunds }) } })
    }

    const returnFund = await prisma.returnFund.findUnique({
      where: { id: audit.returnFundId },
      include: {
        disbursement: {
          select: { id: true, reference: true, name: true, purposeOfFund: true, titleOfActivities: true, fundCategory: { select: { id: true, name: true } } },
        },
      },
    })
    if (!returnFund) return res.status(404).json({ message: 'Return fund not found.' })
    return res.json({ kind: 'returnFund', record: returnFund })
  } catch (err) {
    logError('Audit document', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { listAudits, reviewAudit, getAuditDocument }
