const prisma = require('../lib/prisma')
const { NON_MEMBER_ROLES } = require('../utils/roles')

// One "payment unit" = one semester of membership fee. Kept in sync with
// MEMBERSHIP_FEE in calculations.service.js (₱100 per semester).
const PAYMENT_UNIT = 100
const MAX_UNITS_PER_TRANSACTION = 50

class PaymentValidationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'PaymentValidationError'
    this.status = status
  }
}

// Advisers are not members — they have no membership payments at all.
function assertNotAdviser(user) {
  if (user && NON_MEMBER_ROLES.includes(user.role)) {
    throw new PaymentValidationError('Advisers are not members and have no membership payments.', 400)
  }
}

// Semesters are ordered oldest → newest by school year, then 1st before 2nd.
function compareSemestersOldestFirst(a, b) {
  const ay = parseInt(String(a.schoolYear).split('-')[0], 10) || 0
  const by = parseInt(String(b.schoolYear).split('-')[0], 10) || 0
  if (ay !== by) return ay - by
  const ao = a.semester === 'SECOND' ? 2 : 1
  const bo = b.semester === 'SECOND' ? 2 : 1
  if (ao !== bo) return ao - bo
  return a.id - b.id
}

// Validates the amount the officer entered. Must be a whole multiple of ₱100.
function parseAndValidateAmount(rawAmount) {
  if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
    throw new PaymentValidationError('Payment amount is required.')
  }
  const amount = Number(rawAmount)
  if (!Number.isFinite(amount)) throw new PaymentValidationError('Payment amount must be a valid number.')
  if (!Number.isInteger(amount)) throw new PaymentValidationError(`Payment amount must be in whole ₱${PAYMENT_UNIT} increments.`)
  if (amount < PAYMENT_UNIT) throw new PaymentValidationError(`Minimum payment is ₱${PAYMENT_UNIT}.`)
  if (amount % PAYMENT_UNIT !== 0) throw new PaymentValidationError(`Payment amount must be in ₱${PAYMENT_UNIT} increments (₱100, ₱200, ₱300…).`)
  const units = amount / PAYMENT_UNIT
  if (units > MAX_UNITS_PER_TRANSACTION) throw new PaymentValidationError('Payment amount is too large.')
  return { amount, units }
}

// Returns the member's unpaid semesters, oldest first. Uses the same rules as
// the payment-history endpoint: a semester counts if it was created on/after
// the member joined (or is the active one), and it is "paid" if a non-archived
// payment exists for it (matched by obligationSemesterId, falling back to
// semesterId for old records). Semesters newer than the active one are never
// included.
async function getUnpaidSemesters(memberId, tx = prisma) {
  const member = await tx.member.findUnique({
    where: { id: memberId },
    include: { user: { select: { id: true, status: true, createdAt: true, role: true } } }
  })
  if (!member) throw new PaymentValidationError('Member not found.', 404)
  assertNotAdviser(member.user)

  const activeSemester = await tx.semester.findFirst({ where: { isActive: true } })
  if (!activeSemester) throw new PaymentValidationError('No active semester.')

  const all = (await tx.semester.findMany()).sort(compareSemestersOldestFirst)
  const activeIdx = all.findIndex((s) => s.id === activeSemester.id)
  const joinedAt = new Date(member.user.createdAt)
  const relevant = all.filter((s, i) => i <= activeIdx && (new Date(s.createdAt) >= joinedAt || s.isActive))

  const payments = await tx.payment.findMany({
    where: { memberId, isArchived: false },
    select: { semesterId: true, obligationSemesterId: true }
  })
  const paidIds = new Set(payments.map((p) => p.obligationSemesterId ?? p.semesterId))

  const unpaid = relevant.filter((s) => !paidIds.has(s.id))
  return { member, activeSemester, unpaid }
}

// Builds the allocation (which semesters an amount pays) and verifies it.
// Rules enforced:
//   - amount is valid and in ₱100 increments
//   - units never exceed the actual number of unpaid semesters
//   - the allocation is always the OLDEST unpaid semesters, in order
//   - the current (active) semester is only paid once every previous unpaid
//     semester is included in the same allocation
//   - if the client supplied expectedSemesterIds, they must match exactly
function buildAllocation({ rawAmount, unpaid, activeSemester, expectedSemesterIds }) {
  const { amount, units } = parseAndValidateAmount(rawAmount)

  if (unpaid.length === 0) {
    throw new PaymentValidationError('This member has no unpaid semesters.')
  }
  if (units > unpaid.length) {
    throw new PaymentValidationError(
      `Payment of ₱${amount} covers ${units} semesters, but the member only has ${unpaid.length} unpaid semester${unpaid.length === 1 ? '' : 's'} (max ₱${unpaid.length * PAYMENT_UNIT}).`
    )
  }

  const allocation = unpaid.slice(0, units)

  // Oldest-first sanity check.
  for (let i = 0; i < allocation.length; i++) {
    if (allocation[i].id !== unpaid[i].id) {
      throw new PaymentValidationError('Payment must be applied to the oldest unpaid semester first.')
    }
  }
  // Current semester may not be paid while an older one is still unpaid.
  const activeInAllocation = allocation.some((s) => s.id === activeSemester.id)
  if (activeInAllocation) {
    const olderUnpaid = unpaid.filter((s) => s.id !== activeSemester.id)
    const olderCovered = olderUnpaid.every((s) => allocation.some((a) => a.id === s.id))
    if (!olderCovered) {
      throw new PaymentValidationError('Previous unpaid semesters must be settled before the current semester.')
    }
  }

  if (Array.isArray(expectedSemesterIds)) {
    const actual = allocation.map((s) => s.id)
    const expected = expectedSemesterIds.map(Number)
    const same = actual.length === expected.length && actual.every((id, i) => id === expected[i])
    if (!same) {
      throw new PaymentValidationError(
        'The member\'s unpaid semesters changed since this payment was reviewed. Please review and try again.',
        409
      )
    }
  }

  return { amount, units, allocation }
}

module.exports = {
  PAYMENT_UNIT,
  PaymentValidationError,
  assertNotAdviser,
  compareSemestersOldestFirst,
  parseAndValidateAmount,
  getUnpaidSemesters,
  buildAllocation,
}