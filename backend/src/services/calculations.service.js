const Decimal = require('decimal.js')
const prisma = require('../lib/prisma')
const { MEMBERSHIP_USER_FILTER } = require('../utils/roles')

const MEMBERSHIP_FEE = new Decimal(100)

// Total Fund = SUM of all non-archived payments this semester ONLY.
// Turnover from a previous semester is intentionally NOT included here —
// it lives as its own separate FundCategory (isTurnoverFund: true) instead,
// so the percentage-based categories never get silently inflated by it.
const getTotalFund = async (semesterId) => {
  const result = await prisma.payment.aggregate({
    where: { semesterId, isArchived: false, member: { user: MEMBERSHIP_USER_FILTER } },
    _sum: { amount: true }
  })
  return new Decimal(result._sum.amount || 0)
}

// Turnover carried in from the previous semester — stored as its own
// FundCategory (isTurnoverFund: true) with a fixed amount, NOT as a
// Payment row, so getTotalFund() never sees it. Shared by every place that
// needs to fold turnover into a total (Remaining Fund, Ending Balance, and
// now the Dashboard's Total Fund card).
const getTurnoverAmount = async (semesterId) => {
  const turnoverCategory = await prisma.fundCategory.findFirst({
    where: { semesterId, isTurnoverFund: true, isArchived: false }
  })
  return new Decimal(turnoverCategory?.fixedAllocationAmount || 0)
}

// semesterIds (optional) limits the total to spending recorded in those
// semesters — used by the Fund Report to show a category "as of" a semester.
// Omitted = all time, which is what every other caller wants.
const getTotalDisbursed = async (fundCategoryId, semesterIds = null) => {
  const result = await prisma.disbursement.aggregate({
    where: { fundCategoryId, isArchived: false, ...(semesterIds && { semesterId: { in: semesterIds } }) },
    _sum: { amount: true }
  })
  return new Decimal(result._sum.amount || 0)
}

const getTotalReturnedByCategory = async (fundCategoryId, semesterIds = null) => {
  const result = await prisma.returnFund.aggregate({
    where: { disbursement: { fundCategoryId }, isArchived: false, ...(semesterIds && { semesterId: { in: semesterIds } }) },
    _sum: { amount: true }
  })
  return new Decimal(result._sum.amount || 0)
}

// For normal categories: Allocated Amount = Total Fund × Percentage.
// For the Turnover Fund category: Allocated Amount is a FIXED value set once
// when the semester was activated — it does not move with new payments.
const getCategoryFinancials = async (category, semesterId, semesterIds = null) => {
  let allocatedAmount

  if (category.isTurnoverFund) {
    allocatedAmount = new Decimal(category.fixedAllocationAmount || 0)
  } else {
    const totalFund = await getTotalFund(semesterId)
    const percentage = new Decimal(category.percentage)
    allocatedAmount = totalFund.times(percentage).div(100).toDecimalPlaces(2)
  }

  const totalDisbursed = await getTotalDisbursed(category.id, semesterIds)
  const totalReturned = await getTotalReturnedByCategory(category.id, semesterIds)
  const availableFund = Decimal.max(allocatedAmount.minus(totalDisbursed).plus(totalReturned), 0)

  return {
    allocatedAmount: allocatedAmount.toFixed(2),
    totalDisbursed: totalDisbursed.toFixed(2),
    totalReturned: totalReturned.toFixed(2),
    availableFund: availableFund.toFixed(2)
  }
}

const getDisbursementRemainingAmount = async (disbursementId) => {
  const disbursement = await prisma.disbursement.findUnique({ where: { id: disbursementId } })
  if (!disbursement) throw new Error('Disbursement not found')

  const result = await prisma.returnFund.aggregate({
    where: { disbursementId, isArchived: false },
    _sum: { amount: true }
  })
  const totalReturned = new Decimal(result._sum.amount || 0)
  return new Decimal(disbursement.amount).minus(totalReturned)
}

// Excludes turnover categories from the 100% check automatically — they're
// stored with percentage: 0, so they contribute nothing to this sum.
const getTotalCategoryPercentage = async (semesterId, excludeCategoryId = null) => {
  const where = { semesterId, isArchived: false }
  if (excludeCategoryId) where.id = { not: excludeCategoryId }
  const result = await prisma.fundCategory.aggregate({ where, _sum: { percentage: true } })
  return new Decimal(result._sum.percentage || 0)
}

// Ending Balance for a semester = Total Fund − Total Disbursed + Total Returned,
// computed SYSTEM-WIDE across ALL categories (including any turnover category
// that semester had). This correctly captures whatever is left over — whether
// it came from new payments or from a previous turnover — so turnover
// compounds correctly across multiple semester transitions.
const getSemesterEndingBalance = async (semesterId) => {
  // Membership payments received this semester
  const totalFund = await getTotalFund(semesterId)

  // Turnover carried in from the previous semester — stored as a FundCategory
  // with fixedAllocationAmount, NOT as a payment, so getTotalFund misses it.
  // We must add it explicitly so the turnover compounds correctly across transitions.
  const turnoverCategory = await prisma.fundCategory.findFirst({
    where: { semesterId, isTurnoverFund: true, isArchived: false }
  })
  const turnoverAmount = new Decimal(turnoverCategory?.fixedAllocationAmount || 0)

  const disbursedResult = await prisma.disbursement.aggregate({
    where: { semesterId, isArchived: false },
    _sum: { amount: true }
  })
  const totalDisbursed = new Decimal(disbursedResult._sum.amount || 0)

  const returnedResult = await prisma.returnFund.aggregate({
    where: { semesterId, isArchived: false },
    _sum: { amount: true }
  })
  const totalReturned = new Decimal(returnedResult._sum.amount || 0)

  // Ending Balance = Payments + Turnover Carried In − Disbursed + Returned
  return Decimal.max(
    totalFund.plus(turnoverAmount).minus(totalDisbursed).plus(totalReturned),
    0
  )
}

// The Fund Report for one semester. This is the single source for BOTH the
// Financial module's Fund Report (called with the active semester) and
// Settings ▸ Archive (called with any past semester), so the two can never show
// different data. Categories belong to the school year; the Turnover Fund
// belongs to this exact semester.
//
// Disbursements/returns are counted only up to the semester being shown (the
// school year's 1st semester, plus this one). For the active semester that is
// everything recorded so far — identical to the module's behaviour — while for
// a past semester it excludes spending that happened after it, so the report
// shows what the module showed when that semester was current.
const getFundReport = async (semester) => {
  const semestersInSchoolYear = await prisma.semester.findMany({
    where: { schoolYear: semester.schoolYear },
    select: { id: true, semester: true }
  })
  const semesterIds = semestersInSchoolYear.map(s => s.id)
  const countedSemesterIds = semestersInSchoolYear
    .filter(s => s.semester === 'FIRST' || s.id === semester.id)
    .map(s => s.id)

  const categories = await prisma.fundCategory.findMany({
    where: {
      isArchived: false,
      OR: [
        { semesterId: { in: semesterIds }, isTurnoverFund: false },
        { semesterId: semester.id, isTurnoverFund: true }
      ]
    },
    orderBy: { createdAt: 'asc' }
  })

  const totalFund = await getTotalFund(semester.id)
  const totalPercentage = await getTotalCategoryPercentage(semester.id)

  const categoriesWithFinancials = await Promise.all(
    categories.map(async (category) => {
      const financials = await getCategoryFinancials(category, semester.id, countedSemesterIds)
      return {
        id: category.id,
        name: category.name,
        percentage: category.percentage,
        isTurnoverFund: category.isTurnoverFund,
        ...financials
      }
    })
  )

  const overall = categoriesWithFinancials.reduce(
    (acc, cat) => ({
      allocatedAmount: new Decimal(acc.allocatedAmount).plus(cat.allocatedAmount).toFixed(2),
      totalDisbursed: new Decimal(acc.totalDisbursed).plus(cat.totalDisbursed).toFixed(2),
      totalReturned: new Decimal(acc.totalReturned).plus(cat.totalReturned).toFixed(2),
      availableFund: new Decimal(acc.availableFund).plus(cat.availableFund).toFixed(2)
    }),
    { allocatedAmount: '0', totalDisbursed: '0', totalReturned: '0', availableFund: '0' }
  )

  const regularCategoryCount = categoriesWithFinancials.filter(c => !c.isTurnoverFund).length

  return {
    semester,
    totalFund: totalFund.toFixed(2),
    totalPercentage: totalPercentage.toFixed(2),
    isPercentageComplete: totalPercentage.equals(100),
    categories: categoriesWithFinancials,
    overall,
    categoriesLocked: regularCategoryCount > 0
  }
}

// The three money movements getSemesterEndingBalance combines, exposed one by
// one so the Archive can rebuild a historical balance semester by semester from
// real transaction rows. Same filters as the rest of this file: non-archived
// records only, and collections are getTotalFund (membership payments received
// in the semester — turnover is never a Payment, so it can't be double-counted).
const getSemesterFlows = async (semesterId) => {
  const [collections, disbursedResult, returnedResult] = await Promise.all([
    getTotalFund(semesterId),
    prisma.disbursement.aggregate({
      where: { semesterId, isArchived: false },
      _sum: { amount: true }
    }),
    prisma.returnFund.aggregate({
      where: { semesterId, isArchived: false },
      _sum: { amount: true }
    })
  ])
  return {
    collections,
    disbursed: new Decimal(disbursedResult._sum.amount || 0),
    returned: new Decimal(returnedResult._sum.amount || 0)
  }
}

// Audited (CLEARED) totals — mirrors getTotalDisbursed/getTotalReturnedByCategory
// but only counts Disbursements/Return Funds whose Audit record has been
// CLEARED. Pending/Review/For-Clarification records haven't been certified
// yet, so they shouldn't be reported as "Audited Disbursed" or "Audited
// Return Fund" on the Audit page or dashboard.
const getAuditedTotalDisbursed = async (semesterId) => {
  const result = await prisma.disbursement.aggregate({
    where: { semesterId, isArchived: false, audit: { status: 'CLEARED' } },
    _sum: { amount: true }
  })
  return new Decimal(result._sum.amount || 0)
}

const getAuditedTotalReturned = async (semesterId) => {
  const result = await prisma.returnFund.aggregate({
    where: { semesterId, isArchived: false, audit: { status: 'CLEARED' } },
    _sum: { amount: true }
  })
  return new Decimal(result._sum.amount || 0)
}

// "Remaining Fund" shown on the officer Dashboard. Uses the same Total Fund +
// Turnover baseline as getSemesterEndingBalance, but nets out only the
// AUDITED (CLEARED) Disbursed and Return Fund amounts — so the headline
// figure always agrees with the "Audited Disbursed" / "Audited Return Fund"
// totals shown on the Audit page, instead of silently including
// still-pending/under-review transactions.
// NOTE: this is a reporting figure only. getSemesterEndingBalance (real,
// all-non-archived-transactions balance) remains the source of truth used for
// turnover carry-forward on semester advancement — that must reflect actual
// cash movement regardless of audit status.
const getAuditedRemainingFund = async (semesterId) => {
  const totalFund = await getTotalFund(semesterId)

  const turnoverCategory = await prisma.fundCategory.findFirst({
    where: { semesterId, isTurnoverFund: true, isArchived: false }
  })
  const turnoverAmount = new Decimal(turnoverCategory?.fixedAllocationAmount || 0)

  const auditedDisbursed = await getAuditedTotalDisbursed(semesterId)
  const auditedReturned = await getAuditedTotalReturned(semesterId)

  return Decimal.max(
    totalFund.plus(turnoverAmount).minus(auditedDisbursed).plus(auditedReturned),
    0
  )
}

const parseAmount = (value) => {
  if (value === null || value === undefined || value === '') throw new Error('Amount is required')
  const cleaned = String(value).replace(/[₱,\s]/g, '')
  const parsed = new Decimal(cleaned)
  if (parsed.isNaN() || !parsed.isFinite()) throw new Error('Invalid amount format')
  return parsed
}

/*const generateReference = async (type) => {
  const prefix = type === 'disbursement' ? 'DIS' : 'RET'
  const count = type === 'disbursement'
    ? await prisma.disbursement.count()
    : await prisma.returnFund.count()
  return `${prefix}-${String(count + 1).padStart(3, '0')}`
}*/

const generateReference = async (type) => {
  const prefix = type === 'disbursement' ? 'DIS' : 'RET'
  const model  = type === 'disbursement' ? prisma.disbursement : prisma.returnFund

  // Count all records (including archived) to get a starting point,
  // then keep incrementing until we find a reference that doesn't exist yet.
  // This handles gaps caused by failed transactions or deleted test records.
  let count = await model.count()

  while (true) {
    count++
    const candidate = `${prefix}-${String(count).padStart(3, '0')}`

    const existing = await model.findUnique({
      where: { reference: candidate },
      select: { reference: true }
    })

    if (!existing) return candidate
  }
}

module.exports = {
  getTotalFund, getTurnoverAmount, getTotalDisbursed, getTotalReturnedByCategory,
  getCategoryFinancials, getDisbursementRemainingAmount,
  getTotalCategoryPercentage, getSemesterEndingBalance, getSemesterFlows, getFundReport,
  getAuditedTotalDisbursed, getAuditedTotalReturned, getAuditedRemainingFund,
  parseAmount, generateReference,
  MEMBERSHIP_FEE
}