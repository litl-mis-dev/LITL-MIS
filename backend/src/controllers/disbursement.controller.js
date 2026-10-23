const Decimal = require('decimal.js')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { getCategoryFinancials, parseAmount, generateReference } = require('../services/calculations.service')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { emitToOfficers } = require('../realtime/socket')

const INCLUDE_DETAILS = {
  fundCategory: { select: { id: true, name: true } },
  createdBy: { select: { member: { select: { firstName: true, lastName: true } } } }
}

const listDisbursements = async (req, res) => {
  try {
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const disbursements = await prisma.disbursement.findMany({
      where: {
        isArchived: false,
        semester: { schoolYear: activeSemester.schoolYear }
      },
      include: INCLUDE_DETAILS,
      orderBy: { createdAt: 'desc' }
    })
    return res.json({ disbursements })
  } catch (err) {
    logError('List disbursements', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const getDisbursement = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const disbursement = await prisma.disbursement.findUnique({
      where: { id },
      include: {
        fundCategory: { select: { id: true, name: true } },
        returnFunds: { where: { isArchived: false } }
      }
    })
    if (!disbursement) return res.status(404).json({ message: 'Disbursement not found.' })

    const totalReturned = disbursement.returnFunds.reduce(
      (sum, rf) => new Decimal(sum).plus(rf.amount), new Decimal(0)
    )
    return res.json({
      disbursement: {
        ...disbursement,
        totalReturned: totalReturned.toFixed(2),
        remainingAmount: new Decimal(disbursement.amount).minus(totalReturned).toFixed(2)
      }
    })
  } catch (err) {
    logError('Get disbursement', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const createDisbursement = async (req, res) => {
  try {
    const {
      name, amount, purposeOfFund, titleOfActivities, fundCategoryId,
      disbursedBy, disbursedByPosition, approvedBy, approvedByPosition,
      receivedBy, receivedByPosition
    } = req.body

    const { confirmText } = req.body
    if (!confirmText || confirmText.trim() !== 'CONFIRM') {
      return res.status(400).json({ message: 'Transaction confirmation required. Type CONFIRM to proceed.' })
    }

    const TEXT_ONLY = /^[A-Za-z\s'.,-]+$/
    const MAX_AMOUNT = 100000

    const errors = {}

    if (!name?.trim()) {
      errors.name = 'Name is required.'
    } else if (name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters.'
    } else if (name.trim().length > 50) {
      errors.name = 'Name must not exceed 50 characters.'
    } else if (!TEXT_ONLY.test(name.trim())) {
      errors.name = 'Name must contain letters only — no numbers or special characters.'
    }

    if (!purposeOfFund?.trim()) {
      errors.purposeOfFund = 'Purpose of fund is required.'
    } else if (purposeOfFund.trim().length < 5) {
      errors.purposeOfFund = 'Purpose must be at least 5 characters.'
    } else if (purposeOfFund.trim().length > 50) {
      errors.purposeOfFund = 'Purpose must not exceed 50 characters.'
    } else if (!TEXT_ONLY.test(purposeOfFund.trim())) {
      errors.purposeOfFund = 'Purpose must contain letters only — no numbers or special characters.'
    }

    if (!titleOfActivities?.trim()) {
      errors.titleOfActivities = 'Title of activity is required.'
    } else if (titleOfActivities.trim().length < 2) {
      errors.titleOfActivities = 'Title must be at least 2 characters.'
    } else if (titleOfActivities.trim().length > 50) {
      errors.titleOfActivities = 'Title must not exceed 50 characters.'
    } 
    
    //else if (!TEXT_ONLY.test(titleOfActivities.trim())) {
      //errors.titleOfActivities = 'Title must contain letters only — no numbers or special characters.'
    //}

    if (!fundCategoryId) errors.fundCategoryId = 'Source of fund is required.'
    if (!disbursedBy?.trim()) errors.disbursedBy = 'Disbursed By is required.'
    if (!disbursedByPosition?.trim()) errors.disbursedByPosition = 'Position is required.'
    if (!approvedBy?.trim()) errors.approvedBy = 'Approved By is required.'
    if (!approvedByPosition?.trim()) errors.approvedByPosition = 'Position is required.'

    if (!receivedBy?.trim()) {
      errors.receivedBy = 'Received By is required.'
    } else if (receivedBy.trim().length > 50) {
      errors.receivedBy = 'Must not exceed 50 characters.'
    } else if (!TEXT_ONLY.test(receivedBy.trim())) {
      errors.receivedBy = 'Must contain letters only — no numbers or special characters.'
    }

    if (!receivedByPosition?.trim()) {
      errors.receivedByPosition = 'Position is required.'
    } else if (receivedByPosition.trim().length > 50) {
      errors.receivedByPosition = 'Must not exceed 50 characters.'
    } else if (!TEXT_ONLY.test(receivedByPosition.trim())) {
      errors.receivedByPosition = 'Must contain letters only — no numbers or special characters.'
    }

    if (Object.keys(errors).length > 0) return res.status(400).json({ message: 'Validation failed.', errors })

    let parsedAmount
    try { parsedAmount = parseAmount(amount) } catch {
      return res.status(400).json({ message: 'Amount must be a valid number.' })
    }
    if (parsedAmount.lte(0)) return res.status(400).json({ message: 'Amount must be greater than zero.' })
    if (parsedAmount.gt(MAX_AMOUNT)) return res.status(400).json({ message: `Amount cannot exceed ₱${MAX_AMOUNT.toLocaleString('en-PH')}.` })
    if (parsedAmount.decimalPlaces() > 2) return res.status(400).json({ message: 'Amount cannot have more than 2 decimal places.' })

    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const category = await prisma.fundCategory.findUnique({ where: { id: Number(fundCategoryId) } })
    if (!category || category.isArchived) {
      return res.status(400).json({ message: 'Invalid fund category.' })
    }

    const semestersInSchoolYear = await prisma.semester.findMany({
      where: { schoolYear: activeSemester.schoolYear },
      select: { id: true }
    })
    const validSemesterIds = semestersInSchoolYear.map(s => s.id)
    if (!validSemesterIds.includes(category.semesterId)) {
      return res.status(400).json({ message: 'Invalid fund category: this category belongs to a different school year.' })
    }

    let insufficient = null
    let disbursement
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        disbursement = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM FundCategory WHERE id = ${Number(fundCategoryId)} FOR UPDATE`

      const financials = await getCategoryFinancials(category, activeSemester.id)
      const availableFund = new Decimal(financials.availableFund)
      if (parsedAmount.gt(availableFund)) {
        insufficient = availableFund
        return null
      }

      const reference = await generateReference('disbursement')
      const created = await tx.disbursement.create({
        data: {
          reference, name: name.trim(), amount: parsedAmount.toFixed(2),
          purposeOfFund: purposeOfFund.trim(), titleOfActivities: titleOfActivities.trim(),
          fundCategoryId: Number(fundCategoryId), semesterId: activeSemester.id,
          disbursedBy: disbursedBy.trim(), disbursedByPosition: disbursedByPosition.trim(),
          approvedBy: approvedBy.trim(), approvedByPosition: approvedByPosition.trim(),
          receivedBy: receivedBy.trim(), receivedByPosition: receivedByPosition.trim(),
          createdById: req.user.id
        },
        include: INCLUDE_DETAILS
      })

      // Every Disbursement automatically enters the Auditor's Pending review
      // transaction so a Disbursement never exists without its Audit record.
      await tx.audit.create({ data: { disbursementId: created.id } })

      return created
        })
        break
      } catch (txErr) {
        if (txErr.code === 'P2002' && attempt < 4) continue
        throw txErr
      }
    }

    if (!disbursement) {
      return res.status(400).json({
        message: `Amount exceeds available fund. Available: ₱${insufficient.toFixed(2)}, Requested: ₱${parsedAmount.toFixed(2)}.`
      })
    }

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DISBURSEMENT_CREATED,
      details: {
        reference:         disbursement.reference,
        categoryName:      disbursement.fundCategory?.name ?? '',
        snapshot: {
          id:                 disbursement.id,
          reference:          disbursement.reference,
          name:               disbursement.name,
          amount:             disbursement.amount.toString(),
          purposeOfFund:      disbursement.purposeOfFund,
          titleOfActivities:  disbursement.titleOfActivities,
          fundCategoryId:     disbursement.fundCategoryId,
          semesterId:         disbursement.semesterId,
          disbursedBy:        disbursement.disbursedBy,
          approvedBy:         disbursement.approvedBy,
          receivedBy:         disbursement.receivedBy,
          isArchived:         false,
        }
      }
    })

    emitToOfficers('disbursement:changed', { disbursementId: disbursement.id, action: 'created' })

    return res.status(201).json({ message: 'Disbursement recorded.', disbursement })
  } catch (err) {
    logError('Create disbursement', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const archiveDisbursement = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const disbursement = await prisma.disbursement.findUnique({ where: { id } })
    if (!disbursement || disbursement.isArchived) return res.status(404).json({ message: 'Disbursement not found.' })

    const returnCount = await prisma.returnFund.count({ where: { disbursementId: id, isArchived: false } })
    if (returnCount > 0) {
      return res.status(400).json({ message: 'Cannot archive a disbursement with active return fund records.' })
    }
    await prisma.disbursement.update({ where: { id }, data: { isArchived: true } })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DISBURSEMENT_ARCHIVED,
      details: {
        disbursementId: id,
        reference:      disbursement.reference,
        snapshot: {
          id:        id,
          reference: disbursement.reference,
          amount:    disbursement.amount.toString(),
          isArchived: true,
        }
      }
    })

    emitToOfficers('disbursement:changed', { disbursementId: id, action: 'archived' })

    return res.json({ message: 'Disbursement archived.' })
  } catch (err) {
    logError('Archive disbursement', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { listDisbursements, getDisbursement, createDisbursement, archiveDisbursement }