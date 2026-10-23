const prisma = require('../lib/prisma')
const { NON_MEMBER_ROLES, MEMBERSHIP_USER_FILTER } = require('../utils/roles')

// ─── AUTOMATIC MEMBER STATUS (based on membership payments) ─────────────────
//
// Rules implemented here:
//   1. A semester must be finished (isActive: false) before it is counted.
//   2. The currently active semester is never counted.
//   3. When a new semester becomes active, look at the 2 completed semesters
//      immediately preceding it.
//   4. If a member has an Unpaid membership payment (no non-archived Payment
//      whose obligationSemesterId matches) for BOTH of those semesters, they
//      are automatically switched to INACTIVE.
//   5. If an INACTIVE member settles enough of those unpaid obligations that
//      the "both unpaid" condition no longer holds, they are automatically
//      switched back to ACTIVE.
//
// This module is intentionally decoupled from the request/response layer so
// it can run either inside a Prisma transaction (semester advancement) or
// against the default client (right after a single payment is recorded).

// Returns the 2 completed semesters immediately preceding `referenceSemesterId`,
// in chronological order. Returns fewer than 2 if there isn't enough history
// yet — callers must treat that as "not enough data to judge".
async function getPrecedingCompletedSemesters(referenceSemesterId, tx = prisma) {
  const semesters = await tx.semester.findMany({ orderBy: { id: 'asc' } })
  const idx = semesters.findIndex((s) => s.id === referenceSemesterId)
  if (idx <= 0) return []
  return semesters.slice(Math.max(0, idx - 2), idx)
}

// A member only "owes" a semester if they had already joined by the time it
// started — otherwise an unpaid obligation for a semester before they existed
// would unfairly count against them.
function semesterAppliesToMember(memberJoinedAt, semester) {
  return new Date(memberJoinedAt) <= new Date(semester.createdAt)
}

async function isMemberObligationUnpaid(memberId, semesterId, tx = prisma) {
  const payment = await tx.payment.findFirst({
    where: { memberId, obligationSemesterId: semesterId, isArchived: false },
    select: { id: true }
  })
  return !payment
}

// Evaluates (and, if needed, updates) a single member's ACTIVE/INACTIVE status
// against the 2 completed semesters immediately preceding `referenceSemesterId`.
// Leaves GRADUATED/ARCHIVED members untouched. Returns null if nothing changed
// or if there isn't enough semester history yet, otherwise an outcome object.
async function evaluateMemberMembershipStatus({ memberId, referenceSemesterId, tx = prisma }) {
  const member = await tx.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      userId: true,
      status: true,
      firstName: true,
      middleName: true,
      lastName: true,
      suffix: true,
      user: { select: { createdAt: true, role: true } }
    }
  })
  if (!member || !['ACTIVE', 'INACTIVE'].includes(member.status)) return null
  // Advisers are not members: no active/inactive status is ever evaluated.
  if (NON_MEMBER_ROLES.includes(member.user.role)) return null

  const precedingSemesters = await getPrecedingCompletedSemesters(referenceSemesterId, tx)
  if (precedingSemesters.length < 2) return null

  const applicable = precedingSemesters.every((s) => semesterAppliesToMember(member.user.createdAt, s))
  if (!applicable) return null

  const unpaidFlags = await Promise.all(
    precedingSemesters.map((s) => isMemberObligationUnpaid(member.id, s.id, tx))
  )
  const bothUnpaid = unpaidFlags.every(Boolean)

  const memberName = [member.firstName, member.middleName, member.lastName, member.suffix]
    .filter(Boolean)
    .join(' ')
  const checkedSemesterIds = precedingSemesters.map((s) => s.id)

  if (bothUnpaid && member.status === 'ACTIVE') {
    await tx.member.update({ where: { id: member.id }, data: { status: 'INACTIVE' } })

    // A non-active member cannot remain an officer — same guard used by the
    // manual member-status endpoint.
    let officerRoleRevoked = false
    if (member.user.role !== 'MEMBER') {
      await tx.officerAssignment.updateMany({
        where: { memberId: member.id, status: 'ACTIVE' },
        data: { status: 'ENDED', endDate: new Date() }
      })
      await tx.user.update({ where: { id: member.userId }, data: { role: 'MEMBER' } })
      officerRoleRevoked = true
    }

    return {
      action: 'DEACTIVATED',
      memberId: member.id,
      userId: member.userId,
      memberName,
      checkedSemesterIds,
      officerRoleRevoked
    }
  }

  if (!bothUnpaid && member.status === 'INACTIVE') {
    await tx.member.update({ where: { id: member.id }, data: { status: 'ACTIVE' } })
    return {
      action: 'REACTIVATED',
      memberId: member.id,
      userId: member.userId,
      memberName,
      checkedSemesterIds,
      officerRoleRevoked: false
    }
  }

  return null
}

// Runs the evaluation above for every ACTIVE/INACTIVE approved member. Meant
// to be called right after a new semester is activated.
async function syncMembershipStatusesForSemester({ referenceSemesterId, tx = prisma }) {
  const members = await tx.member.findMany({
    where: { status: { in: ['ACTIVE', 'INACTIVE'] }, user: { status: 'APPROVED', ...MEMBERSHIP_USER_FILTER } },
    select: { id: true }
  })

  const outcomes = []
  for (const m of members) {
    const outcome = await evaluateMemberMembershipStatus({ memberId: m.id, referenceSemesterId, tx })
    if (outcome) outcomes.push(outcome)
  }
  return outcomes
}

module.exports = {
  getPrecedingCompletedSemesters,
  isMemberObligationUnpaid,
  evaluateMemberMembershipStatus,
  syncMembershipStatusesForSemester
}