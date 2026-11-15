const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
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

// Return Funds are created with their disbursement and only change when its
// amount spent is recorded (PATCH /disbursements/:id/amount-spent), so none
// can be added by hand, not even by calling the API directly.
const createReturnFund = (req, res) => res.status(410).json({
  message: 'Return Funds are now created automatically. Record the amount spent on the disbursement instead.'
})

const archiveReturnFund = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const returnFund = await prisma.returnFund.findUnique({ where: { id } })
    if (!returnFund || returnFund.isArchived) return res.status(404).json({ message: 'Return fund not found.' })
    if (returnFund.autoForDisbursementId != null) {
      return res.status(400).json({ message: 'This Return Fund belongs to its disbursement. Archive the disbursement instead.' })
    }
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