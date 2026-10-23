const Decimal = require('decimal.js')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { getSemesterEndingBalance, getTotalFund, getTurnoverAmount } = require('../services/calculations.service')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { ensureCertificationArchive } = require('./certification.controller')
const { syncMembershipStatusesForSemester } = require('../services/membershipStatus.service')
const { emitToOfficers } = require('../realtime/socket')
const { YEAR_REP_TO_YEAR_LEVEL, MEMBERSHIP_USER_FILTER } = require('../utils/roles')

const SEMESTER_LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester' }
const CONFIRM_KEYWORD = 'ACTIVATE'

// ── Helpers ──────────────────────────────────────────────────────────────────

// Compute the next academic period from the given semester.
// FIRST → SECOND (same school year)
// SECOND → FIRST (next school year: e.g. "2026-2027" → "2027-2028")
function computeNextSemester(current) {
  if (current.semester === 'FIRST') {
    return { schoolYear: current.schoolYear, semester: 'SECOND' }
  }
  const endYear = Number(current.schoolYear.split('-')[1])
  return { schoolYear: `${endYear}-${endYear + 1}`, semester: 'FIRST' }
}

// ── Controllers ───────────────────────────────────────────────────────────────

const listSemesters = async (req, res) => {
  try {
    const semesters = await prisma.semester.findMany({
      orderBy: [{ schoolYear: 'desc' }, { semester: 'desc' }]
    })
    return res.json({ semesters })
  } catch (err) {
    logError('List semesters', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const getActiveSemester = async (req, res) => {
  try {
    const semester = await prisma.semester.findFirst({ where: { isActive: true } })
    return res.json({ semester })
  } catch (err) {
    logError('Get active semester', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// GET /api/financial/semesters/active/member-summary
// Member-facing equivalent of getActiveSemesterStats: the same Total Fund /
// Remaining Fund figures shown on the officer Financial dashboard
// (getTotalFund + turnover, and getSemesterEndingBalance), but exposed on a
// route any authenticated member can read — the officer-only route requires
// the FINANCIAL module permission, which members never have, so this data
// was previously unreachable for the member dashboard and had to fall back
// to raw, non-authoritative Semester fields.
const getActiveSemesterMemberSummary = async (req, res) => {
  try {
    const semester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!semester) {
      return res.json({ semester: null, totalFund: '0.00', remainingFund: '0.00' })
    }

    const [fund, turnover, remainingFund] = await Promise.all([
      getTotalFund(semester.id),
      getTurnoverAmount(semester.id),
      getSemesterEndingBalance(semester.id)
    ])
    const totalFund = fund.plus(turnover)

    return res.json({
      semester,
      totalFund: totalFund.toFixed(2),
      remainingFund: remainingFund.toFixed(2)
    })
  } catch (err) {
    logError('Get active semester member summary', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// GET /api/financial/semesters/active/stats
// Returns everything the SemesterManager UI needs: active semester, remaining
// balance, active member count, and the computed next semester label.
const getActiveSemesterStats = async (req, res) => {
  try {
    const semester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!semester) {
      return res.json({
        semester: null,
        remainingBalance: '0.00',
        activeMemberCount: 0,
        nextSemester: null,
        isSchoolYearChange: false
      })
    }

    const [remainingBalance, activeMemberCount] = await Promise.all([
      getSemesterEndingBalance(semester.id),
      prisma.member.count({ where: { status: 'ACTIVE', user: { status: 'APPROVED', ...MEMBERSHIP_USER_FILTER } } })
    ])

    const next = computeNextSemester(semester)
    const isSchoolYearChange = semester.semester === 'SECOND'

    return res.json({
      semester,
      remainingBalance: remainingBalance.toFixed(2),
      activeMemberCount,
      nextSemester: next,
      isSchoolYearChange,
      nextSemesterLabel: `${next.schoolYear} | ${SEMESTER_LABELS[next.semester]}`
    })
  } catch (err) {
    logError('Get active semester stats', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// POST /api/financial/semesters/advance
// The single automated semester-advancement endpoint. Never takes a school year
// or semester as input — always derives the next period from the currently
// active semester. Requires confirmText === 'ACTIVATE' to prevent accidents.
//
// On school-year change (2nd → 1st of new year), also promotes all active
// members: year 1→2, 2→3, 3→4, and 4th years → GRADUATED (officer role
// automatically revoked). Everything runs in a single DB transaction.
const advanceSemester = async (req, res) => {
  try {
    const { confirmText } = req.body

    if (!confirmText || confirmText.trim() !== CONFIRM_KEYWORD) {
      return res.status(400).json({ message: `You must type ${CONFIRM_KEYWORD} to confirm this action.` })
    }

    const currentActive = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!currentActive) {
      return res.status(400).json({ message: 'No active semester found.' })
    }

    const next = computeNextSemester(currentActive)
    const isSchoolYearChange = currentActive.semester === 'SECOND'

    // Check if the target next semester already exists and has been activated
    const existingNext = await prisma.semester.findUnique({
      where: { schoolYear_semester: { schoolYear: next.schoolYear, semester: next.semester } }
    })
    if (existingNext?.hasBeenActivated) {
      return res.status(400).json({ message: 'This transition has already been completed.' })
    }

    // Compute ending balance BEFORE the transaction — read-only, won't be
    // affected by the changes inside the transaction.
    const carriedBalance = await getSemesterEndingBalance(currentActive.id)

    // Track promotion results outside the transaction so they're available for
    // the audit log call after it commits.
    const promotionResults = { promoted: 0, graduated: 0 }
    let yearRepChanges = 0 // Year Rep seats advanced or vacated on rollover
    let nextSemesterId
    let certificationArchiveCreated = false
    let membershipStatusOutcomes = []

    await prisma.$transaction(async (tx) => {
      // 1. Close the current semester, freezing who was an active member right
      // now. This has to happen before steps 5–6, which promote, graduate and
      // (de)activate members: Member.status keeps no history, so this snapshot
      // is the only way the Archive can later report the semester's roster.
      // Same definition of "active member" as getActiveSemesterStats.
      const closingRoster = await tx.member.findMany({
        where: { status: 'ACTIVE', user: { status: 'APPROVED', ...MEMBERSHIP_USER_FILTER } },
        select: { id: true },
        orderBy: { id: 'asc' }
      })
      await tx.semester.update({
        where: { id: currentActive.id },
        data: {
          isActive: false,
          endingBalance: carriedBalance.toFixed(2),
          activeMemberIds: closingRoster.map((m) => m.id)
        }
      })

      // 2. Create the next semester row if it doesn't exist yet
      let nextRow = existingNext
      if (!nextRow) {
        nextRow = await tx.semester.create({
          data: { schoolYear: next.schoolYear, semester: next.semester, isActive: false }
        })
      }
      nextSemesterId = nextRow.id

      // 3. Activate the next semester
      await tx.semester.update({
        where: { id: nextRow.id },
        data: { isActive: true, hasBeenActivated: true, beginningBalance: carriedBalance.toFixed(2) }
      })

      // 4. Auto-create the Turnover Fund category if there is a carried balance
      if (carriedBalance.gt(0)) {
        await tx.fundCategory.create({
          data: {
            name: 'Turnover Fund',
            percentage: 0,
            isTurnoverFund: true,
            fixedAllocationAmount: carriedBalance.toFixed(2),
            semesterId: nextRow.id,
            createdById: req.user.id
          }
        })
      }

      // 4b. On a school-year change, automatically create the Certification
      // archive for the new academic year — officers never create this by hand.
      if (isSchoolYearChange) {
        const { created } = await ensureCertificationArchive(next.schoolYear, req.user.id, tx)
        certificationArchiveCreated = created
      }

      // 5. Member promotion — ONLY on school year change
      if (isSchoolYearChange) {
        const activeMembers = await tx.member.findMany({
          // Advisers are not students/members — never promoted or graduated.
          where: { status: 'ACTIVE', user: MEMBERSHIP_USER_FILTER },
          select: { id: true, userId: true, yearLevel: true, user: { select: { role: true } } }
        })

        const YEAR_PROGRESSION = {
          '1st Year': '2nd Year',
          '2nd Year': '3rd Year',
          '3rd Year': '4th Year',
          '4th Year': null,
        }

        // Process Year Representatives from the highest seat down (4th → 1st)
        // so each seat is freed by its holder's move/graduation before the
        // next holder takes it (the DB allows only one active holder per role).
        const YEAR_REP_ORDER = ['YEAR_REP_4', 'YEAR_REP_3', 'YEAR_REP_2', 'YEAR_REP_1']
        const repRank = (m) => {
          const i = YEAR_REP_ORDER.indexOf(m.user?.role)
          return i === -1 ? YEAR_REP_ORDER.length : i
        }
        activeMembers.sort((a, b) => repRank(a) - repRank(b))

        for (const member of activeMembers) {
          const nextLevel = YEAR_PROGRESSION[member.yearLevel]
          if (nextLevel === null) {
            await tx.officerAssignment.updateMany({
              where: { memberId: member.id, status: 'ACTIVE' },
              data: { status: 'ENDED', endDate: new Date(), activeRole: null }
            })
            await tx.user.update({ where: { id: member.userId }, data: { role: 'MEMBER' } })
            await tx.member.update({ where: { id: member.id }, data: { status: 'GRADUATED' } })
            promotionResults.graduated++
            // A graduating 4th Year Representative no longer holds the seat.
            if (YEAR_REP_TO_YEAR_LEVEL[member.user?.role]) yearRepChanges++
          } else if (nextLevel) {
            await tx.member.update({
              where: { id: member.id },
              data: { yearLevel: nextLevel }
            })

            // A promoted Year Representative moves up with their year level
            // (YEAR_REP_1 → 2 → 3 → 4), keeping the seat that matches their
            // new year. If the role never matched their year, the seat is
            // vacated as before.
            const currentRole = member.user?.role
            const requiredYearLevel = YEAR_REP_TO_YEAR_LEVEL[currentRole]
            if (requiredYearLevel) {
              const nextRole = Object.keys(YEAR_REP_TO_YEAR_LEVEL)
                .find((r) => YEAR_REP_TO_YEAR_LEVEL[r] === nextLevel)

              await tx.officerAssignment.updateMany({
                where: { memberId: member.id, status: 'ACTIVE' },
                data: { status: 'ENDED', endDate: new Date(), activeRole: null }
              })

              if (nextRole && requiredYearLevel === member.yearLevel) {
                // Defensive: free the target seat if anyone else still holds it.
                const otherHolders = await tx.officerAssignment.findMany({
                  where: { role: nextRole, status: 'ACTIVE', memberId: { not: member.id } },
                  include: { member: { select: { userId: true } } }
                })
                for (const holder of otherHolders) {
                  await tx.officerAssignment.update({
                    where: { id: holder.id },
                    data: { status: 'ENDED', endDate: new Date(), activeRole: null }
                  })
                  await tx.user.update({ where: { id: holder.member.userId }, data: { role: 'MEMBER' } })
                }

                await tx.officerAssignment.create({
                  data: {
                    memberId: member.id,
                    role: nextRole,
                    activeRole: nextRole,
                    assignedById: req.user.id,
                    status: 'ACTIVE'
                  }
                })
                await tx.user.update({ where: { id: member.userId }, data: { role: nextRole } })
              } else {
                await tx.user.update({ where: { id: member.userId }, data: { role: 'MEMBER' } })
              }
              yearRepChanges++
            }

            promotionResults.promoted++
          }
        }
      }

      // 6. Automatic member status update — check the 2 completed semesters
      // immediately preceding the one that just became active. Members with
      // an Unpaid membership payment for BOTH are switched to Inactive;
      // members who no longer meet that condition are switched back to Active.
      membershipStatusOutcomes = await syncMembershipStatusesForSemester({
        referenceSemesterId: nextRow.id,
        tx
      })
    })

    // ── Audit logs ────────────────────────────────────────────────────────────
    const prevLabel = `${currentActive.schoolYear} | ${SEMESTER_LABELS[currentActive.semester]}`
    const nextLabel = `${next.schoolYear} | ${SEMESTER_LABELS[next.semester]}`

    await writeAuditLog({
      actorId: req.user.id,
      action: isSchoolYearChange
        ? AUDIT_ACTIONS.SCHOOL_YEAR_ADVANCED
        : AUDIT_ACTIONS.NEXT_SEMESTER_ACTIVATED,
      details: {
        previousSemester: prevLabel,
        nextSemester: nextLabel,
        carriedBalance: carriedBalance.toFixed(2),
        amount: carriedBalance.toFixed(2), // used by FINANCIAL_ACTIONS amount display
        ...(isSchoolYearChange && {
          membersPromoted: promotionResults.promoted,
          membersGraduated: promotionResults.graduated,
        })
      }
    })

    if (certificationArchiveCreated) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.CERTIFICATION_ARCHIVE_CREATED,
        details: { schoolYear: next.schoolYear },
      })
    }

    if (yearRepChanges > 0) {
      emitToOfficers('officerRole:changed', { action: 'yearRepsAdvanced' })
    }

    // Realtime notify per member (so individual member rows update live),
    // but the Activity Log only gets ONE summary entry per direction —
    // not one entry per member.
    const deactivatedMembers = membershipStatusOutcomes.filter(o => o.action === 'DEACTIVATED')
    const reactivatedMembers = membershipStatusOutcomes.filter(o => o.action === 'REACTIVATED')

    for (const outcome of membershipStatusOutcomes) {
      emitToOfficers('membership:changed', {
        memberId: outcome.memberId,
        action: outcome.action === 'DEACTIVATED' ? 'autoDeactivated' : 'autoReactivated'
      })
      if (outcome.officerRoleRevoked) {
        emitToOfficers('officerRole:changed', { memberId: outcome.memberId, action: 'revoked' })
      }
    }

    if (deactivatedMembers.length > 0) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.MEMBER_STATUS_AUTO_DEACTIVATED,
        details: {
          count: deactivatedMembers.length,
          memberIds: deactivatedMembers.map(o => o.memberId),
          triggeredBySemester: nextLabel
        }
      })
    }

    if (reactivatedMembers.length > 0) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.MEMBER_STATUS_AUTO_REACTIVATED,
        details: {
          count: reactivatedMembers.length,
          memberIds: reactivatedMembers.map(o => o.memberId),
          triggeredBySemester: nextLabel
        }
      })
    }

    return res.json({
      message: isSchoolYearChange
        ? `School year ${next.schoolYear} activated. ${promotionResults.promoted} member(s) promoted, ${promotionResults.graduated} graduated.`
        : `${SEMESTER_LABELS[next.semester]} of ${next.schoolYear} activated.`,
      nextSemester: next,
      nextSemesterLabel: nextLabel,
      carriedBalance: carriedBalance.toFixed(2),
      isSchoolYearChange,
      promotionResults,
      membershipStatusChanges: membershipStatusOutcomes.map(o => ({
        memberId: o.memberId,
        action: o.action
      }))
    })
  } catch (err) {
    logError('Advance semester', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

const initFirstSemester = async (req, res) => {
  try {
    const { schoolYear, semester, confirmText } = req.body

    if (!confirmText || confirmText.trim() !== 'ACTIVATE') {
      return res.status(400).json({ message: 'You must type ACTIVATE to confirm.' })
    }

    const existing = await prisma.semester.findFirst()
    if (existing) {
      return res.status(400).json({ message: 'A semester already exists. Use the advance endpoint instead.' })
    }

    const SY_REGEX = /^(\d{4})-(\d{4})$/
    const match = SY_REGEX.exec(schoolYear?.trim() ?? '')
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      return res.status(400).json({ message: 'Invalid school year. Use format YYYY-YYYY (e.g. 2025-2026).' })
    }

    if (!['FIRST', 'SECOND'].includes(semester)) {
      return res.status(400).json({ message: 'Semester must be FIRST or SECOND.' })
    }

    const newSemester = await prisma.semester.create({
      data: {
        schoolYear: schoolYear.trim(),
        semester,
        isActive: true,
        hasBeenActivated: true,
        beginningBalance: '0.00'
      }
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.NEXT_SEMESTER_ACTIVATED,
      details: {
        nextSemester: `${newSemester.schoolYear} | ${SEMESTER_LABELS[newSemester.semester]}`,
        carriedBalance: '0.00',
        amount: '0.00',
        isInitial: true
      }
    })

    const { created: archiveCreated } = await ensureCertificationArchive(newSemester.schoolYear, req.user.id)
    if (archiveCreated) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.CERTIFICATION_ARCHIVE_CREATED,
        details: { schoolYear: newSemester.schoolYear },
      })
    }

    return res.status(201).json({ message: `${newSemester.schoolYear} ${SEMESTER_LABELS[newSemester.semester]} activated.`, semester: newSemester })
  } catch (err) {
    logError('Init first semester', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

module.exports = { listSemesters, getActiveSemester, getActiveSemesterMemberSummary, getActiveSemesterStats, advanceSemester, initFirstSemester }