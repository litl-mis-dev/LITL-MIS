const Decimal = require('decimal.js')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { getDisbursementRemainingAmount, parseAmount, generateReference } = require('../services/calculations.service')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { emitToOfficers } = require('../realtime/socket')

const INCLUDE_DETAILS = {
  disbursement: {
    select: {
      id: true, reference: true, name: true,
      purposeOfFund: true, titleOfActivities: true,
      fundCategory: { select: { id: true, name: true } }
    }
  }
}

const listReturnFunds = async (req, res) => {
  try {
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const returnFunds = await prisma.returnFund.findMany({
      where: {
        isArchived: false,
        semester: { schoolYear: activeSemester.schoolYear }
      },
      include: INCLUDE_DETAILS,
      orderBy: { createdAt: 'desc' }
    })
    return res.json({ returnFunds })
  } catch (err) {
    logError('List return funds', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const getReturnFund = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const returnFund = await prisma.returnFund.findUnique({ where: { id }, include: INCLUDE_DETAILS })
    if (!returnFund) return res.status(404).json({ message: 'Return fund not found.' })
    return res.json({ returnFund })
  } catch (err) {
    logError('Get return fund', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const createReturnFund = async (req, res) => {
  try {
    const {
      disbursementId, receivedFrom, amount,
      refundedBy, refundedByPosition,
      receivedBy, receivedByPosition,
      auditedBy, auditedByPosition,
      approvedBy, approvedByPosition
    } = req.body

    const { confirmText } = req.body
    if (!confirmText || confirmText.trim() !== 'CONFIRM') {
      return res.status(400).json({ message: 'Transaction confirmation required. Type CONFIRM to proceed.' })
    }

    const TEXT_ONLY = /^[A-Za-z\s'.,-]+$/
    const MAX_AMOUNT = 100000

    const errors = {}

    if (!disbursementId) errors.disbursementId = 'Disbursement reference is required.'

    if (!receivedFrom?.trim()) {
      errors.receivedFrom = 'Received From is required.'
    } else if (receivedFrom.trim().length > 50) {
      errors.receivedFrom = 'Must not exceed 50 characters.'
    } else if (!TEXT_ONLY.test(receivedFrom.trim())) {
      errors.receivedFrom = 'Must contain letters only — no numbers or special characters.'
    }

    if (!refundedBy?.trim()) {
      errors.refundedBy = 'Refunded By is required.'
    } else if (refundedBy.trim().length > 50) {
      errors.refundedBy = 'Must not exceed 50 characters.'
    } else if (!TEXT_ONLY.test(refundedBy.trim())) {
      errors.refundedBy = 'Must contain letters only — no numbers or special characters.'
    }

    if (!refundedByPosition?.trim()) {
      errors.refundedByPosition = 'Position is required.'
    } else if (refundedByPosition.trim().length > 50) {
      errors.refundedByPosition = 'Must not exceed 50 characters.'
    } else if (!TEXT_ONLY.test(refundedByPosition.trim())) {
      errors.refundedByPosition = 'Must contain letters only — no numbers or special characters.'
    }

    if (!receivedBy?.trim()) errors.receivedBy = 'Received By is required.'
    if (!receivedByPosition?.trim()) errors.receivedByPosition = 'Position is required.'
    if (!auditedBy?.trim()) errors.auditedBy = 'Audited By is required.'
    if (!auditedByPosition?.trim()) errors.auditedByPosition = 'Position is required.'
    if (!approvedBy?.trim()) errors.approvedBy = 'Approved By is required.'
    if (!approvedByPosition?.trim()) errors.approvedByPosition = 'Position is required.'

    if (Object.keys(errors).length > 0) return res.status(400).json({ message: 'Validation failed.', errors })

    let parsedAmount
    try { parsedAmount = parseAmount(amount) } catch {
      return res.status(400).json({ message: 'Amount must be a valid number.' })
    }
    if (parsedAmount.lte(0)) return res.status(400).json({ message: 'Amount must be greater than zero.' })
    if (parsedAmount.gt(MAX_AMOUNT)) return res.status(400).json({ message: `Amount cannot exceed ₱${MAX_AMOUNT.toLocaleString('en-PH')}.` })
    if (parsedAmount.decimalPlaces() > 2) return res.status(400).json({ message: 'Max 2 decimal places.' })

    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const disbursement = await prisma.disbursement.findUnique({ where: { id: Number(disbursementId) } })
    if (!disbursement || disbursement.isArchived) {
      return res.status(400).json({ message: 'Invalid disbursement reference.' })
    }

    // Return Funds are only allowed for disbursements that belong to the
    // currently active semester. A 1st Semester disbursement cannot be
    // returned once the 2nd Semester is active.
    if (disbursement.semesterId !== activeSemester.id) {
      return res.status(400).json({
        message: 'Return Funds can only be recorded for disbursements from the currently active semester. This disbursement belongs to a previous semester.'
      })
    }

    let tooMuch = null
    let returnFund
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        returnFund = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Disbursement WHERE id = ${Number(disbursementId)} FOR UPDATE`

      const remainingAmount = await getDisbursementRemainingAmount(Number(disbursementId))
      if (parsedAmount.gt(remainingAmount)) {
        tooMuch = remainingAmount
        return null
      }

      const reference = await generateReference('returnFund')
      const created = await tx.returnFund.create({
        data: {
          reference, receivedFrom: receivedFrom.trim(), amount: parsedAmount.toFixed(2),
          disbursementId: Number(disbursementId), semesterId: activeSemester.id,
          refundedBy: refundedBy.trim(), refundedByPosition: refundedByPosition.trim(),
          receivedBy: receivedBy.trim(), receivedByPosition: receivedByPosition.trim(),
          auditedBy: auditedBy.trim(), auditedByPosition: auditedByPosition.trim(),
          approvedBy: approvedBy.trim(), approvedByPosition: approvedByPosition.trim(),
          createdById: req.user.id
        },
        include: INCLUDE_DETAILS
      })

      // Every Return Fund automatically enters the Auditor's Pending review
      // transaction so a Return Fund never exists without its Audit record.
      await tx.audit.create({ data: { returnFundId: created.id } })

      return created
        })
        break
      } catch (txErr) {
        if (txErr.code === 'P2002' && attempt < 4) continue
        throw txErr
      }
    }

    if (!returnFund) {
      return res.status(400).json({
        message: `Return amount exceeds remaining balance. Maximum returnable: ₱${tooMuch.toFixed(2)}.`
      })
    }

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.RETURN_FUND_CREATED,
      details: {
        reference:             returnFund.reference,
        disbursementReference: disbursement.reference,
        purposeOfFund:         disbursement.purposeOfFund,
        snapshot: {
          id:             returnFund.id,
          reference:      returnFund.reference,
          receivedFrom:   returnFund.receivedFrom,
          amount:         returnFund.amount.toString(),
          disbursementId: returnFund.disbursementId,
          semesterId:     returnFund.semesterId,
          isArchived:     false,
        }
      }
    })

    emitToOfficers('returnFund:changed', { returnFundId: returnFund.id, action: 'created' })

    return res.status(201).json({ message: 'Return fund recorded.', returnFund })
  } catch (err) {
    logError('Create return fund', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const archiveReturnFund = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const returnFund = await prisma.returnFund.findUnique({ where: { id } })
    if (!returnFund || returnFund.isArchived) return res.status(404).json({ message: 'Return fund not found.' })
    await prisma.returnFund.update({ where: { id }, data: { isArchived: true } })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.RETURN_FUND_ARCHIVED,
      details: {
        returnFundId: id,
        reference:    returnFund.reference,
        snapshot: {
          id:        id,
          reference: returnFund.reference,
          amount:    returnFund.amount.toString(),
          isArchived: true,
        }
      }
    })
    
    emitToOfficers('returnFund:changed', { returnFundId: id, action: 'archived' })

    return res.json({ message: 'Return fund archived.' })
  } catch (err) {
    logError('Archive return fund', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { listReturnFunds, getReturnFund, createReturnFund, archiveReturnFund }