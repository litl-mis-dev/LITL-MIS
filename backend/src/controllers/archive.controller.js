const Decimal = require('decimal.js')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const {
  getSemesterFlows, getSemesterEndingBalance, getTurnoverAmount, getFundReport
} = require('../services/calculations.service')
const { compareSemestersOldestFirst } = require('../services/membershipPayment.service')
const { hasAccess } = require('../services/permissions.service')
const { MEMBERSHIP_USER_FILTER } = require('../utils/roles')

// ─── Financial Archive (read-only) ───────────────────────────────────────────
// Lets officers review any semester's financial records. Nothing in this file
// writes: every handler only reads (find / aggregate / count), so viewing the
// archive can never change a balance, a payment, or the hash-linked ledger.
// Routes are mounted behind FINANCIAL ▸ VIEW, like every other Financial read.

const SCHOOL_YEAR_PATTERN = /^(\d{4})-(\d{4})$/
const SEMESTER_LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester' }

// Document signatories. Generating a Disbursement / Return Fund certificate
// needs these, and downloading is an EDIT-level action in the Financial
// module — so callers without FINANCIAL ▸ EDIT never receive them.
const DISBURSEMENT_SIGNATORY_FIELDS = [
  'disbursedBy', 'disbursedByPosition', 'approvedBy', 'approvedByPosition',
  'receivedBy', 'receivedByPosition'
]
const RETURN_FUND_SIGNATORY_FIELDS = [
  'refundedBy', 'refundedByPosition', 'receivedBy', 'receivedByPosition',
  'auditedBy', 'auditedByPosition', 'approvedBy', 'approvedByPosition'
]

// Same shapes the Financial module's own list endpoints return, so the
// existing row mappers and certificate generators work on archive records.
const DISBURSEMENT_INCLUDE = { fundCategory: { select: { id: true, name: true } } }
const RETURN_FUND_INCLUDE = {
  disbursement: {
    select: {
      id: true, reference: true, name: true,
      purposeOfFund: true, titleOfActivities: true,
      fundCategory: { select: { id: true, name: true } }
    }
  }
}

const money = (value) => new Decimal(value).toFixed(2)
const semesterLabel = (s) => `${s.schoolYear} ${SEMESTER_LABELS[s.semester]}`

// ── Filters ──────────────────────────────────────────────────────────────────

function parseFilters(query) {
  const schoolYear = typeof query.schoolYear === 'string' ? query.schoolYear.trim() : ''
  const semester = typeof query.semester === 'string' ? query.semester.trim().toUpperCase() : ''

  const match = SCHOOL_YEAR_PATTERN.exec(schoolYear)
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    return { error: 'Invalid school year. Use format YYYY-YYYY (e.g. 2025-2026).' }
  }
  if (!SEMESTER_LABELS[semester]) {
    return { error: 'Semester must be FIRST or SECOND.' }
  }
  return { schoolYear, semester }
}

// Validates the filters and loads the semester. Sends the error response itself
// and returns null when the request can't proceed.
async function loadSemester(req, res) {
  const filters = parseFilters(req.query)
  if (filters.error) {
    res.status(400).json({ message: filters.error })
    return null
  }
  const semester = await prisma.semester.findUnique({
    where: { schoolYear_semester: { schoolYear: filters.schoolYear, semester: filters.semester } }
  })
  // A semester row that was never activated cannot have any financial records.
  if (!semester || !(semester.hasBeenActivated || semester.isActive)) {
    res.status(404).json({ message: 'No financial records found for that semester.' })
    return null
  }
  return semester
}

// ── Historical balances ──────────────────────────────────────────────────────

// Rebuilds the semester's balances from actual transaction rows, oldest
// semester first, using the same rule the live system uses when it advances a
// semester: Ending = Beginning + Collections − Disbursed + Returned, floored at
// zero, and that ending is carried into the next semester as its Beginning
// (the Turnover Fund). Turnover is never added on top of collections, and the
// Beginning of each semester comes from the previous semester's records — not
// from today's balance or any stored field.
async function rebuildBalances(semester) {
  const all = (await prisma.semester.findMany()).sort(compareSemestersOldestFirst)
  const upToSelected = all.slice(0, all.findIndex((s) => s.id === semester.id) + 1)

  let carried = new Decimal(0)
  let result = null
  for (const s of upToSelected) {
    const flows = await getSemesterFlows(s.id)
    const beginning = carried
    const raw = beginning.plus(flows.collections).minus(flows.disbursed).plus(flows.returned)
    const ending = Decimal.max(raw, 0)
    result = { beginning, ending, raw, ...flows }
    carried = ending
  }
  return result
}

// Compares the rebuilt balances with every other place the system keeps them.
// Any mismatch means a record was changed (or archived) after the fact, or a
// stored balance drifted — which is exactly what an accountability view must
// surface rather than hide.
async function reconcile(semester, balances) {
  const [turnover, systemEnding] = await Promise.all([
    getTurnoverAmount(semester.id),
    getSemesterEndingBalance(semester.id)
  ])

  const checks = []
  const compare = (key, label, computed, recorded) => {
    checks.push({
      key, label,
      computed: money(computed), recorded: money(recorded),
      ok: computed.equals(recorded), skipped: false
    })
  }

  compare('beginningBalance',
    'Beginning balance matches the balance recorded when the semester was activated',
    balances.beginning, new Decimal(semester.beginningBalance))
  compare('turnoverFund',
    'Turnover Fund carried in matches the previous semester\'s ending balance',
    balances.beginning, turnover)

  if (semester.endingBalance !== null && semester.endingBalance !== undefined) {
    compare('endingBalance',
      'Ending balance matches the balance recorded when the semester closed',
      balances.ending, new Decimal(semester.endingBalance))
  } else {
    // Still the active semester — nothing has been recorded yet.
    checks.push({
      key: 'endingBalance',
      label: 'Ending balance matches the balance recorded when the semester closed',
      computed: money(balances.ending), recorded: null, ok: true, skipped: true
    })
  }

  compare('systemBalance',
    'Ending balance matches the Financial module\'s balance',
    balances.ending, systemEnding)

  checks.push({
    key: 'nonNegative',
    label: 'Disbursements never exceed the funds available',
    computed: money(balances.raw), recorded: null,
    ok: balances.raw.gte(0), skipped: false
  })

  const failed = checks.filter((c) => !c.skipped && !c.ok)
  return { status: failed.length ? 'DISCREPANCY' : 'BALANCED', checks }
}

// ── Member statistics ────────────────────────────────────────────────────────

// Member counts follow the semester a payment was actually RECEIVED in
// (Payment.semesterId) — the same cash-basis rule that decides which semester's
// collections a payment belongs to. The payment itself keeps its original
// obligationSemesterId, so the member's payment history still shows which
// semester the fee was for.
//   PAID    = paid this semester's own fee during this semester.
//   SETTLED = paid an EARLIER semester's unpaid fee during this semester. E.g.
//             a member paying SY 2021-2022 2nd Sem's fee in SY 2022-2023 1st
//             Sem is counted as settled in 2022-2023 1st Sem. (A member can be
//             both Paid and Settled in the same semester.)
// Because both are tied to the receiving semester, a closed semester's
// counts never change after the fact. Both are exact for any semester.
//
// Active / Unpaid need the roster of active members. The active semester uses
// today's members (that IS its current status). A closed semester uses the
// snapshot taken when it closed — never today's status, which has since changed
// through promotions, graduation and deactivation. Semesters that closed before
// the snapshot existed have no roster, so Active/Unpaid are reported as null.
async function getMemberStats(semester) {
  const payments = await prisma.payment.findMany({
    where: {
      semesterId: semester.id,
      isArchived: false,
      member: { user: MEMBERSHIP_USER_FILTER }
    },
    select: { memberId: true, obligationSemesterId: true }
  })

  const paid = new Set()
  const settled = new Set()
  for (const p of payments) {
    // Old rows without an obligation semester were paid for the semester they were received in.
    if (p.obligationSemesterId === null || p.obligationSemesterId === semester.id) paid.add(p.memberId)
    else settled.add(p.memberId)
  }

  let roster = null
  let source = null
  if (semester.isActive) {
    const rows = await prisma.member.findMany({
      where: { status: 'ACTIVE', user: { status: 'APPROVED', ...MEMBERSHIP_USER_FILTER } },
      select: { id: true }
    })
    roster = new Set(rows.map((r) => r.id))
    source = 'live'
  } else if (Array.isArray(semester.activeMemberIds)) {
    roster = new Set(semester.activeMemberIds.map(Number).filter(Number.isInteger))
    source = 'snapshot'
  }

  if (!roster) {
    return {
      rosterAvailable: false, source: null,
      totalActive: null, totalPaid: paid.size, totalSettled: settled.size, totalUnpaid: null
    }
  }

  // Within the roster, Active = Paid + Unpaid always holds. Settled is counted
  // from the payments themselves, so a member who settled old fees is counted
  // even if they were not on the roster.
  const totalPaid = [...paid].filter((id) => roster.has(id)).length
  return {
    rosterAvailable: true, source,
    totalActive: roster.size,
    totalPaid,
    totalSettled: settled.size,
    totalUnpaid: roster.size - totalPaid
  }
}

// Same category scope the Fund Report uses: the school year's categories plus
// the Turnover Fund that belongs to this exact semester.
async function countFundCategories(semester) {
  const semestersInYear = await prisma.semester.findMany({
    where: { schoolYear: semester.schoolYear },
    select: { id: true }
  })
  return prisma.fundCategory.count({
    where: {
      isArchived: false,
      OR: [
        { semesterId: { in: semestersInYear.map((s) => s.id) }, isTurnoverFund: false },
        { semesterId: semester.id, isTurnoverFund: true }
      ]
    }
  })
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// GET /api/financial/archive/summary?schoolYear=2025-2026&semester=FIRST
const getArchiveSummary = async (req, res) => {
  try {
    const semester = await loadSemester(req, res)
    if (!semester) return

    const balances = await rebuildBalances(semester)
    const [reconciliation, members, categoryCount, paymentCount, disbursementCount, returnFundCount] =
      await Promise.all([
        reconcile(semester, balances),
        getMemberStats(semester),
        countFundCategories(semester),
        prisma.payment.count({
          where: { semesterId: semester.id, isArchived: false, member: { user: MEMBERSHIP_USER_FILTER } }
        }),
        prisma.disbursement.count({ where: { semesterId: semester.id, isArchived: false } }),
        prisma.returnFund.count({ where: { semesterId: semester.id, isArchived: false } })
      ])

    return res.json({
      semester: {
        id: semester.id,
        schoolYear: semester.schoolYear,
        semester: semester.semester,
        label: semesterLabel(semester),
        isActive: semester.isActive
      },
      summary: {
        beginningBalance: money(balances.beginning),
        endingBalance: money(balances.ending),
        // Membership payments received in the semester, turnover excluded.
        // "Total Membership Collections" is the same money, so both read from
        // this one figure instead of being calculated twice.
        totalCollectionsFund: money(balances.collections),
        totalMembershipCollections: money(balances.collections),
        totalDisbursements: money(balances.disbursed),
        totalReturnedFunds: money(balances.returned)
      },
      members,
      counts: {
        payments: paymentCount,
        fundCategories: categoryCount,
        disbursements: disbursementCount,
        returnFunds: returnFundCount
      },
      reconciliation
    })
  } catch (err) {
    logError('Archive summary', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// GET /api/financial/archive/fund-report?schoolYear=2025-2026&semester=FIRST
// Same payload as the Financial module's GET /categories, for any semester.
const getArchiveFundReport = async (req, res) => {
  try {
    const semester = await loadSemester(req, res)
    if (!semester) return
    return res.json(await getFundReport(semester))
  } catch (err) {
    logError('Archive fund report', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const withoutFields = (record, fields) => {
  const copy = { ...record }
  for (const field of fields) delete copy[field]
  return copy
}

// GET /api/financial/archive/disbursements?schoolYear=2025-2026&semester=FIRST
const listArchiveDisbursements = async (req, res) => {
  try {
    const semester = await loadSemester(req, res)
    if (!semester) return

    const [records, canDownload] = await Promise.all([
      prisma.disbursement.findMany({
        where: { semesterId: semester.id, isArchived: false },
        include: DISBURSEMENT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      }),
      hasAccess(req.user.role, 'FINANCIAL', 'EDIT')
    ])

    return res.json({
      canDownload,
      disbursements: canDownload ? records : records.map((r) => withoutFields(r, DISBURSEMENT_SIGNATORY_FIELDS))
    })
  } catch (err) {
    logError('Archive disbursements', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// GET /api/financial/archive/return-funds?schoolYear=2025-2026&semester=FIRST
const listArchiveReturnFunds = async (req, res) => {
  try {
    const semester = await loadSemester(req, res)
    if (!semester) return

    const [records, canDownload] = await Promise.all([
      prisma.returnFund.findMany({
        where: { semesterId: semester.id, isArchived: false },
        include: RETURN_FUND_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      }),
      hasAccess(req.user.role, 'FINANCIAL', 'EDIT')
    ])

    return res.json({
      canDownload,
      returnFunds: canDownload ? records : records.map((r) => withoutFields(r, RETURN_FUND_SIGNATORY_FIELDS))
    })
  } catch (err) {
    logError('Archive return funds', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { getArchiveSummary, getArchiveFundReport, listArchiveDisbursements, listArchiveReturnFunds }