const Decimal = require('decimal.js')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const {
  getCategoryFinancials, parseAmount, generateReference, RETURNS_SUMMARY_INCLUDE, summarizeReturns,
} = require('../services/calculations.service')
const { resolveReturnFundSignatories } = require('../services/signatory.service')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { emitToOfficers, emitToAll } = require('../realtime/socket')

const INCLUDE_DETAILS = {
  fundCategory: { select: { id: true, name: true } },
  createdBy: { select: { member: { select: { firstName: true, lastName: true } } } }
}

const INCLUDE_LIST_DETAILS = {
  ...INCLUDE_DETAILS,
  ...RETURNS_SUMMARY_INCLUDE,
  audit: { select: { status: true } },
  event: { select: { id: true, title: true } },
}

const { withLastEdits } = require('../utils/lastEdit')

const listDisbursements = async (req, res) => {
  try {
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const disbursements = await prisma.disbursement.findMany({
      where: {
        isArchived: false,
        semester: { schoolYear: activeSemester.schoolYear }
      },
      include: INCLUDE_LIST_DETAILS,
      orderBy: { createdAt: 'desc' }
    })
    return res.json({
      disbursements: await withLastEdits('disbursement', disbursements.map(({ returnFunds, audit, ...d }) => {
        const summary = summarizeReturns({ ...d, returnFunds })
        return {
          ...d,
          ...summary,
          auditStatus: audit?.status ?? null,
          // Mirrors the checks in recordAmountSpent, so the action is only
          // offered when it can succeed.
          canRecordAmountSpent: d.semesterId === activeSemester.id && audit?.status !== 'CLEARED'
            && !summary.hasManualReturns && new Decimal(summary.amountSpent).gt(0),
        }
      }), (d) => d.id, { prefer: 'amountSpent' })
    })
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

    const returnSignatories = await resolveReturnFundSignatories()

    let insufficient = null
    let disbursement
    let returnFund
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

      // Its Return Fund starts at ₱0 and only changes when the amount spent
      // is recorded. It reaches the Auditor once something is returned.
      returnFund = await tx.returnFund.create({
        data: {
          reference: await generateReference('returnFund'),
          amount: '0.00',
          disbursementId: created.id,
          autoForDisbursementId: created.id,
          semesterId: activeSemester.id,
          receivedFrom: created.receivedBy,
          refundedBy: created.receivedBy,
          refundedByPosition: created.receivedByPosition,
          ...returnSignatories.data,
          createdById: req.user.id
        }
      })

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
      entity: { type: 'disbursement', id: disbursement.id },
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

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.RETURN_FUND_CREATED,
      details: returnFundCreatedDetails(returnFund, disbursement)
    })

    emitToOfficers('disbursement:changed', { disbursementId: disbursement.id, action: 'created' })
    emitToOfficers('returnFund:changed', { returnFundId: returnFund.id, action: 'created' })

    return res.status(201).json({ message: 'Disbursement recorded.', disbursement })
  } catch (err) {
    logError('Create disbursement', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const archiveDisbursement = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const disbursement = await prisma.disbursement.findUnique({
      where: { id },
      include: { event: { select: { title: true, isArchived: true } } }
    })
    if (!disbursement || disbursement.isArchived) return res.status(404).json({ message: 'Disbursement not found.' })

    if (disbursement.event && !disbursement.event.isArchived) {
      return res.status(400).json({
        message: `This disbursement funds the event "${disbursement.event.title}". Choose another budget for that event first.`
      })
    }

    // Its automatic Return Fund is archived with it; returns recorded by hand
    // still have to be archived first, as before.
    const activeReturns = await prisma.returnFund.findMany({ where: { disbursementId: id, isArchived: false } })
    if (activeReturns.some((rf) => rf.autoForDisbursementId == null)) {
      return res.status(400).json({ message: 'Cannot archive a disbursement with active return fund records.' })
    }
    const autoReturn = activeReturns[0] ?? null
    await prisma.$transaction([
      ...(autoReturn ? [prisma.returnFund.update({ where: { id: autoReturn.id }, data: { isArchived: true } })] : []),
      prisma.disbursement.update({ where: { id }, data: { isArchived: true } }),
    ])

    if (autoReturn) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.RETURN_FUND_ARCHIVED,
        details: {
          returnFundId: autoReturn.id,
          reference:    autoReturn.reference,
          snapshot: {
            id:        autoReturn.id,
            reference: autoReturn.reference,
            amount:    autoReturn.amount.toString(),
            isArchived: true,
          }
        }
      })
    }

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
    if (autoReturn) emitToOfficers('returnFund:changed', { returnFundId: autoReturn.id, action: 'archived' })

    return res.json({ message: 'Disbursement archived.' })
  } catch (err) {
    logError('Archive disbursement', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// Same details as a Return Fund recorded by hand, so the ledger checks and
// the Activity Log treat both alike.
function returnFundCreatedDetails(returnFund, disbursement) {
  return {
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
}

// PATCH /financial/disbursements/:id/amount-spent
// Records how much of the released amount was actually spent. The
// disbursement itself never changes; its automatic Return Fund becomes
// released − spent, and every change is a new hash-chain entry.
const recordAmountSpent = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { amountSpent, confirmText } = req.body
    if (!confirmText || confirmText.trim() !== 'CONFIRM') {
      return res.status(400).json({ message: 'Transaction confirmation required. Type CONFIRM to proceed.' })
    }

    let spent
    try { spent = parseAmount(amountSpent) } catch {
      return res.status(400).json({ message: 'Amount spent must be a valid number.' })
    }
    if (spent.lt(0)) return res.status(400).json({ message: 'Amount spent cannot be negative.' })
    if (spent.decimalPlaces() > 2) return res.status(400).json({ message: 'Amount spent cannot have more than 2 decimal places.' })

    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const disbursement = await prisma.disbursement.findUnique({
      where: { id },
      include: { audit: { select: { status: true } }, event: { select: { id: true } } }
    })
    if (!disbursement || disbursement.isArchived) return res.status(404).json({ message: 'Disbursement not found.' })
    if (disbursement.semesterId !== activeSemester.id) {
      return res.status(400).json({ message: 'The amount spent can only be recorded for disbursements from the active semester.' })
    }
    if (disbursement.audit?.status === 'CLEARED') {
      return res.status(400).json({ message: 'This disbursement has been cleared by the Auditor and can no longer be changed.' })
    }

    const signatories = await resolveReturnFundSignatories()
    if (signatories.missing.length) {
      return res.status(400).json({ message: `Assign an officer as ${signatories.missing.join(', ')} before recording the amount spent; they sign the Return Fund.` })
    }

    let rejection = null
    let result
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        result = await prisma.$transaction(async (tx) => {
          // One update at a time per disbursement.
          await tx.$queryRaw`SELECT id FROM Disbursement WHERE id = ${id} FOR UPDATE`

          const returns = await tx.returnFund.findMany({
            where: { disbursementId: id, isArchived: false },
            include: { audit: { select: { id: true, status: true } } }
          })
          if (returns.some((rf) => rf.autoForDisbursementId == null)) {
            rejection = 'This disbursement has returns recorded by hand, so its amount spent can\'t be recorded here.'
            return null
          }

          const released = new Decimal(disbursement.amount)
          let autoReturn = returns[0] ?? null
          const previousReturned = new Decimal(autoReturn?.amount ?? 0)
          const currentSpent = released.minus(previousReturned)
          if (!spent.lt(currentSpent)) {
            rejection = `Amount spent must be lower than the current ₱${currentSpent.toFixed(2)}. It can only go down.`
            return null
          }
          if (autoReturn?.audit?.status === 'CLEARED') {
            rejection = 'Its Return Fund has been cleared by the Auditor and can no longer be changed.'
            return null
          }

          const newReturned = released.minus(spent)
          const data = { amount: newReturned.toFixed(2), revisedAt: new Date(), ...signatories.data }
          let created = false
          if (autoReturn) {
            autoReturn = await tx.returnFund.update({ where: { id: autoReturn.id }, data })
          } else {
            // Disbursements made before Return Funds were automatic.
            autoReturn = await tx.returnFund.create({
              data: {
                ...data,
                reference: await generateReference('returnFund'),
                disbursementId: id,
                autoForDisbursementId: id,
                semesterId: activeSemester.id,
                receivedFrom: disbursement.receivedBy,
                refundedBy: disbursement.receivedBy,
                refundedByPosition: disbursement.receivedByPosition,
                createdById: req.user.id
              }
            })
            created = true
          }

          // Something is returned now, so the Auditor reviews it (again).
          const existingAudit = returns[0]?.audit
          if (existingAudit) {
            await tx.audit.update({
              where: { id: existingAudit.id },
              data: { status: 'PENDING', reviewedById: null, reviewedAt: null }
            })
          } else {
            await tx.audit.create({ data: { returnFundId: autoReturn.id } })
          }

          return { autoReturn, previousReturned, newReturned, created }
        })
        break
      } catch (txErr) {
        if (txErr.code === 'P2002' && attempt < 4) continue
        throw txErr
      }
    }
    if (!result) return res.status(400).json({ message: rejection })

    const { autoReturn, previousReturned, newReturned, created } = result
    if (created) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.RETURN_FUND_CREATED,
        details: returnFundCreatedDetails({ ...autoReturn, amount: '0.00' }, disbursement)
      })
    }
    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.RETURN_FUND_UPDATED,
      // Shown in the disbursement's edit history (and on Returns, through it).
      entity: { type: 'disbursement', id },
      details: {
        reference:             autoReturn.reference,
        disbursementReference: disbursement.reference,
        returnFundId:          autoReturn.id,
        previousAmount:        previousReturned.toFixed(2),
        newAmount:             newReturned.toFixed(2),
        // What came back with this update: the Activity Log adds this much.
        amount:                newReturned.minus(previousReturned).toFixed(2),
        amountSpent:           spent.toFixed(2),
        // For the history: the disbursement's amount spent and its Return
        // Fund's amount, before and after (released − spent = returned).
        changes: [
          { field: 'amountSpent', label: 'Amount spent', from: new Decimal(disbursement.amount).minus(previousReturned).toFixed(2), to: spent.toFixed(2) },
          { field: 'amountReturned', label: 'Amount returned', from: previousReturned.toFixed(2), to: newReturned.toFixed(2) },
        ],
        snapshot: {
          id:             autoReturn.id,
          reference:      autoReturn.reference,
          amount:         newReturned.toFixed(2),
          disbursementId: id,
          released:       new Decimal(disbursement.amount).toFixed(2),
        }
      }
    })

    emitToOfficers('disbursement:changed', { disbursementId: id, action: 'updated' })
    emitToOfficers('returnFund:changed', { returnFundId: autoReturn.id, action: created ? 'created' : 'updated' })
    // A linked event shows this amount spent as its budget.
    if (disbursement.event) emitToAll('event:changed', { eventId: disbursement.event.id, action: 'updated' })

    return res.json({
      message: `Amount spent recorded. ₱${newReturned.toFixed(2)} is returned to the fund.`,
      amountSpent: spent.toFixed(2),
      totalReturned: newReturned.toFixed(2),
    })
  } catch (err) {
    logError('Record amount spent', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { listDisbursements, getDisbursement, createDisbursement, archiveDisbursement, recordAmountSpent }