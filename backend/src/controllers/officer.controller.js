const prisma = require('../lib/prisma')
const { ROLE_POSITION_LABELS, SIGNATORY_ROLES, ALL_ROLES, YEAR_REP_TO_YEAR_LEVEL, MEMBERSHIP_USER_FILTER, NON_MEMBER_ROLES, ASSIGNABLE_OFFICER_ROLES, LEADERSHIP_ROLES } = require('../utils/roles')
const { VALID_MEMBER_STATUSES } = require('../utils/validators')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { notifyRegistrationApproved, notifyRegistrationRejected, syncMemberApprovalNotifications } = require('../services/notification.service')
const { emitToOfficers } = require('../realtime/socket')
const { sendRegistrationStatusEmail } = require('../utils/email')

// List all users pending officer approval
const getPendingUsers = async (req, res) => {
  try {
    const pendingUsers = await prisma.user.findMany({
      where: { status: 'PENDING_OFFICER_APPROVAL' },
      select: {
        id: true,
        studentNumber: true,
        email: true,
        emailType: true,
        createdAt: true,
        member: {
          select: {
            firstName: true,
            middleName: true,
            lastName: true,
            suffix: true,
            sex: true,
            yearLevel: true,
            section: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    return res.json({ users: pendingUsers })
  } catch (err) {
    console.error('Get pending users error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// Approve a pending user
const approveUser = async (req, res) => {
  try {
    const { userId } = req.params

    //const user = await prisma.user.findUnique({ where: { id: Number(userId) } })
    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      include: { member: { select: { firstName: true, lastName: true } } }
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.status !== 'PENDING_OFFICER_APPROVAL') {
      return res.status(400).json({ message: 'This user is not awaiting approval' })
    }

    await prisma.user.update({
      where: { id: Number(userId) },
      data: { status: 'APPROVED' }
    })

    const memberName = user.member ? `${user.member.firstName} ${user.member.lastName}` : null
    await writeAuditLog({
      actorId: req.user.id,
      targetUserId: Number(userId),
      action: AUDIT_ACTIONS.USER_APPROVED,
      details: { memberName }
    })

    await notifyRegistrationApproved(Number(userId), memberName)
    // Best-effort: a failed email must never block the approval itself.
    await sendRegistrationStatusEmail(user.email, memberName, true).catch((e) => console.error('Approval email failed:', e))
    await syncMemberApprovalNotifications()
    emitToOfficers('membership:changed', { userId: Number(userId), action: 'approved' })

    return res.json({ message: 'User approved successfully' })
  } catch (err) {
    console.error('Approve user error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// Reject a pending user
const rejectUser = async (req, res) => {
  try {
    const { userId } = req.params

    //const user = await prisma.user.findUnique({ where: { id: Number(userId) } })
    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      include: { member: { select: { firstName: true, lastName: true } } }
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.status !== 'PENDING_OFFICER_APPROVAL') {
      return res.status(400).json({ message: 'This user is not awaiting approval' })
    }

    await prisma.user.update({
      where: { id: Number(userId) },
      data: { status: 'REJECTED' }
    })

    const memberName = user.member ? `${user.member.firstName} ${user.member.lastName}` : null
    await writeAuditLog({
      actorId: req.user.id,
      targetUserId: Number(userId),
      action: AUDIT_ACTIONS.USER_REJECTED,
      details: { memberName }
    }) 

    await notifyRegistrationRejected(Number(userId), memberName)
    await sendRegistrationStatusEmail(user.email, memberName, false).catch((e) => console.error('Rejection email failed:', e))
    await syncMemberApprovalNotifications()
    emitToOfficers('membership:changed', { userId: Number(userId), action: 'rejected' })

    return res.json({ message: 'User rejected' })
  } catch (err) {
    console.error('Reject user error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// Resolves a signatory's full name and position label from their role.
async function resolveSignatory(role) {
  const user = await prisma.user.findFirst({
    where: { role, status: 'APPROVED' },
    select: {
      member: { select: { firstName: true, middleName: true, lastName: true, suffix: true } }
    }
  })

  if (!user?.member) return null

  const { firstName, middleName, lastName, suffix } = user.member
  const parts = [firstName, middleName, lastName, suffix].filter(Boolean)

  return {
    name: parts.join(' '),
    position: ROLE_POSITION_LABELS[role] ?? role,
  }
}

// GET /api/officer/signatories
const getSignatories = async (req, res) => {
  try {
    const [president, senFinance, senAudit] = await Promise.all([
      resolveSignatory(SIGNATORY_ROLES.president),
      resolveSignatory(SIGNATORY_ROLES.senFinance),
      resolveSignatory(SIGNATORY_ROLES.senAudit),
    ])

    return res.json({ signatories: { president, senFinance, senAudit } })
  } catch (err) {
    console.error('Get signatories error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// GET /api/officer/public-roster
// Public — no auth. Powers the landing page's "Current Leadership" section.
// Returns only the currently assigned holders of the 14 fixed leadership
// roles, in the required display/sort order.
const getPublicOfficerRoster = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: LEADERSHIP_ROLES }, status: 'APPROVED' },
      select: {
        role: true,
        member: {
          select: { id: true, firstName: true, middleName: true, lastName: true, suffix: true, avatar: true }
        }
      }
    })

    const ROLE_RANK = Object.fromEntries(LEADERSHIP_ROLES.map((role, index) => [role, index]))

    const officers = users
      .filter(u => u.member) // only members can hold these roles, but guard anyway
      .sort((a, b) => (ROLE_RANK[a.role] ?? 999) - (ROLE_RANK[b.role] ?? 999))
      .map(u => ({
        id: u.member.id,
        position: ROLE_POSITION_LABELS[u.role] ?? u.role,
        name: [u.member.firstName, u.member.middleName, u.member.lastName, u.member.suffix].filter(Boolean).join(' '),
        avatar: u.member.avatar ?? null,
      }))

    return res.json({ officers })
  } catch (err) {
    console.error('Get public officer roster error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

const getApprovedMembers = async (req, res) => {
  try {
    const activeSemester = await prisma.semester.findFirst({
      where: { isActive: true }
    })
    const activeSemesterId = activeSemester?.id ?? null

    const users = await prisma.user.findMany({
      where: {
        status: 'APPROVED',
        // Advisers are not members — never listed, never counted.
        ...MEMBERSHIP_USER_FILTER,
        member: { status: { not: 'GRADUATED' } }
      },
      select: {
        id: true,
        studentNumber: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        member: {
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            suffix: true,
            yearLevel: true,
            section: true,
            status: true,
            payments: {
              where: { semesterId: activeSemesterId ?? 0, obligationSemesterId: activeSemesterId ?? 0, isArchived: false },
              select: { id: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    // Officers in the exact fixed order defined by ALL_ROLES (President down
    // to Adviser/Dept. Chair), then MEMBER accounts ordered by year level,
    // then section, then name (A–Z).
    const YEAR_LEVEL_ORDER = ['1st Year', '2nd Year', '3rd Year', '4th Year']
    const ROLE_RANK = Object.fromEntries(ALL_ROLES.map((role, index) => [role, index]))

    const sortedUsers = [...users].sort((a, b) => {
      const aIsOfficer = a.role !== 'MEMBER'
      const bIsOfficer = b.role !== 'MEMBER'
      if (aIsOfficer !== bIsOfficer) return aIsOfficer ? -1 : 1

      if (aIsOfficer && bIsOfficer) {
        return (ROLE_RANK[a.role] ?? 999) - (ROLE_RANK[b.role] ?? 999)
      }

      const aYearIdx = YEAR_LEVEL_ORDER.indexOf(a.member?.yearLevel)
      const bYearIdx = YEAR_LEVEL_ORDER.indexOf(b.member?.yearLevel)
      const yearCompare = (aYearIdx === -1 ? 999 : aYearIdx) - (bYearIdx === -1 ? 999 : bYearIdx)
      if (yearCompare !== 0) return yearCompare

      const sectionCompare = (a.member?.section ?? '').localeCompare(b.member?.section ?? '')
      if (sectionCompare !== 0) return sectionCompare

      const aName = [a.member?.firstName, a.member?.lastName].filter(Boolean).join(' ')
      const bName = [b.member?.firstName, b.member?.lastName].filter(Boolean).join(' ')
      return aName.localeCompare(bName)
    })

    const members = sortedUsers.map(u => {
      const m = u.member
      const fullName = m
        ? [m.firstName, m.middleName, m.lastName, m.suffix].filter(Boolean).join(' ')
        : u.email
      return {
        id: u.id,
        memberId: m?.id ?? null,
        studentNumber: u.studentNumber,
        email: u.email,
        role: u.role,
        status: u.status,
        memberStatus: m?.status ?? null,
        name: fullName,
        yearLevel: m?.yearLevel ?? '',
        section: m?.section ?? '',
        isPaid: (m?.payments?.length ?? 0) > 0,
        paymentId: m?.payments?.[0]?.id ?? null,
      }
    })

    return res.json({ members })
  } catch (err) {
    console.error('Get approved members error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// GET /api/officer/advisers
// Lists Adviser / Dept. Chair accounts for Settings ▸ Manage Roles ONLY, so
// their officer-side permissions can be managed. Advisers are still not
// members: no member status, no payment data, and they never appear in the
// Members List (getApprovedMembers above excludes them).
const getAdvisers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { status: 'APPROVED', role: { in: NON_MEMBER_ROLES } },
      select: {
        id: true,
        studentNumber: true,
        email: true,
        role: true,
        status: true,
        member: { select: { id: true, firstName: true, middleName: true, lastName: true, suffix: true } }
      },
      orderBy: { createdAt: 'asc' }
    })

    const advisers = users.map((u) => ({
      id: u.id,
      memberId: u.member?.id ?? null,
      studentNumber: u.studentNumber,
      email: u.email,
      role: u.role,
      status: u.status,
      memberStatus: null,
      isAdviser: true,
      name: u.member
        ? [u.member.firstName, u.member.middleName, u.member.lastName, u.member.suffix].filter(Boolean).join(' ')
        : u.email,
      yearLevel: '',
      section: '',
      isPaid: false,
      paymentId: null,
    }))

    return res.json({ advisers })
  } catch (err) {
    console.error('Get advisers error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ─── OFFICER ASSIGNMENT ─────────────────────────────────────────────────────────

// POST /api/officer/assign-role
// Assigns an officer role to an approved, active member. Closes any previous
// ACTIVE assignment for that member and opens a new one — history preserved,
// nothing is overwritten. Also updates User.role so existing auth middleware
// keeps working exactly as before (no changes needed there).
const assignOfficerRole = async (req, res) => {
  try {
    const { memberId, role } = req.body
    const actorId = req.user.id

    if (!memberId || !role) {
      return res.status(400).json({ message: 'Member ID and role are required.' })
    }
    if (!ALL_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role.' })
    }
    if (role === 'MEMBER') {
      return res.status(400).json({ message: 'Use the remove-role endpoint to revert someone to MEMBER.' })
    }
    if (!ASSIGNABLE_OFFICER_ROLES.includes(role)) {
      return res.status(400).json({ message: 'The Adviser / Dept. Chair is not a member position and cannot be assigned to a member.' })
    }

    const member = await prisma.member.findUnique({
      where: { id: Number(memberId) },
      include: { user: true }
    })
    if (!member) return res.status(404).json({ message: 'Member not found.' })
    if (NON_MEMBER_ROLES.includes(member.user.role)) {
      return res.status(400).json({ message: 'Advisers are not members and cannot be assigned a member officer role.' })
    }
    if (member.user.status !== 'APPROVED') {
      return res.status(400).json({ message: 'Only approved users can be assigned an officer role.' })
    }
    if (member.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Only active members are eligible for officer positions.' })
    }

    // A Year Representative role must match the member's actual year level
    // (e.g. a 2nd Year student can only be YEAR_REP_2, never YEAR_REP_3).
    const requiredYearLevel = YEAR_REP_TO_YEAR_LEVEL[role]
    if (requiredYearLevel && member.yearLevel !== requiredYearLevel) {
      return res.status(400).json({
        message: `${ROLE_POSITION_LABELS[role]} can only be assigned to a ${requiredYearLevel} student. This member is ${member.yearLevel}.`
      })
    }

    let result
    try {
      result = await prisma.$transaction(async (tx) => {
        // Enforce one active holder per role — e.g. only one Secretary at a
        // time. If another member currently holds this role, their assignment
        // is closed out and their account reverts to MEMBER, just like the
        // remove-role endpoint does. The @@unique([activeRole]) constraint on
        // OfficerAssignment is the real, DB-level backstop for this — this
        // lookup just lets us also revert the previous holder's User.role and
        // write a clean audit trail instead of only relying on a DB error.
        const previousHolderAssignment = await tx.officerAssignment.findFirst({
          where: { role, status: 'ACTIVE', memberId: { not: member.id } },
          include: { member: { select: { id: true, userId: true, firstName: true, middleName: true, lastName: true, suffix: true } } }
        })

        if (previousHolderAssignment) {
          await tx.officerAssignment.updateMany({
            where: { memberId: previousHolderAssignment.memberId, status: 'ACTIVE' },
            data: { status: 'ENDED', endDate: new Date(), activeRole: null }
          })
          await tx.user.update({
            where: { id: previousHolderAssignment.member.userId },
            data: { role: 'MEMBER' }
          })
        }

        // Close any currently active assignment for this member
        await tx.officerAssignment.updateMany({
          where: { memberId: member.id, status: 'ACTIVE' },
          data: { status: 'ENDED', endDate: new Date(), activeRole: null }
        })

        // Create the new assignment — preserved as history, never overwritten.
        // activeRole = role here, and the unique index on activeRole is what
        // makes this call fail (P2002) instead of silently creating a
        // duplicate holder if two assignment requests for the same role race
        // each other — this is what makes the guarantee hold on Aiven too.
        const assignment = await tx.officerAssignment.create({
          data: {
            memberId: member.id,
            role,
            activeRole: role,
            assignedById: actorId,
            status: 'ACTIVE'
          }
        })

        // Update the live permission field used by auth middleware
        await tx.user.update({
          where: { id: member.userId },
          data: { role }
        })

        return { assignment, previousHolder: previousHolderAssignment?.member ?? null }
      })
    } catch (txErr) {
      // On MySQL, Prisma reports the unique index NAME as a string in
      // meta.target (not an array of field names as on Postgres), so check
      // both shapes to be safe.
      const target = txErr.meta?.target
      const hitsActiveRoleIndex = typeof target === 'string'
        ? target.includes('activeRole')
        : Array.isArray(target) && target.includes('activeRole')

      if (txErr.code === 'P2002' && hitsActiveRoleIndex) {
        return res.status(409).json({
          message: `${ROLE_POSITION_LABELS[role]} is already held by another officer. Please refresh and try again.`
        })
      }
      throw txErr
    }

    const memberName = [member.firstName, member.middleName, member.lastName, member.suffix].filter(Boolean).join(' ')
    await writeAuditLog({
      actorId,
      targetUserId: member.userId,
      action: AUDIT_ACTIONS.OFFICER_ASSIGNED,
      details: { memberId: member.id, role, roleName: ROLE_POSITION_LABELS[role], memberName }
    })

    if (result.previousHolder) {
      const previousHolderName = [
        result.previousHolder.firstName, result.previousHolder.middleName,
        result.previousHolder.lastName, result.previousHolder.suffix
      ].filter(Boolean).join(' ')
      await writeAuditLog({
        actorId,
        targetUserId: result.previousHolder.userId,
        action: AUDIT_ACTIONS.OFFICER_REMOVED,
        details: {
          memberId: result.previousHolder.id,
          previousRole: role,
          previousRoleName: ROLE_POSITION_LABELS[role],
          memberName: previousHolderName,
          reassignedTo: memberName
        }
      })
      emitToOfficers('officerRole:changed', { memberId: result.previousHolder.id, action: 'removed' })
    }

    emitToOfficers('officerRole:changed', { memberId: member.id, role, action: 'assigned' })

    return res.status(201).json({ message: 'Officer role assigned.', assignment: result.assignment })
  } catch (err) {
    console.error('Assign officer role error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// PUT /api/officer/remove-role/:userId
// Ends the member's current officer assignment and reverts them to MEMBER.
const removeOfficerRole = async (req, res) => {
  try {
    const { userId } = req.params
    const actorId = req.user.id

    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      include: { member: true }
    })
    if (!user || !user.member) return res.status(404).json({ message: 'User or member profile not found.' })
    if (user.role === 'MEMBER') {
      return res.status(400).json({ message: 'This user does not currently hold an officer role.' })
    }
    if (NON_MEMBER_ROLES.includes(user.role)) {
      return res.status(400).json({ message: 'Advisers are not members and cannot be reverted to a Member.' })
    }

    const previousRole = user.role

    await prisma.$transaction(async (tx) => {
      await tx.officerAssignment.updateMany({
        where: { memberId: user.member.id, status: 'ACTIVE' },
        data: { status: 'ENDED', endDate: new Date(), activeRole: null }
      })

      await tx.user.update({
        where: { id: user.id },
        data: { role: 'MEMBER' }
      })
    })

    const memberName = user.member ? [user.member.firstName, user.member.lastName].filter(Boolean).join(' ') : null
    await writeAuditLog({
      actorId,
      targetUserId: user.id,
      action: AUDIT_ACTIONS.OFFICER_REMOVED,
      details: {
        memberId: user.member.id,
        previousRole,
        previousRoleName: ROLE_POSITION_LABELS[previousRole],
        memberName
      }
    })

    emitToOfficers('officerRole:changed', { memberId: user.member.id, action: 'removed' })

    return res.json({ message: 'Officer role removed.' })
  } catch (err) {
    console.error('Remove officer role error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// GET /api/officer/assignments — full officer history, never deleted
const getOfficerAssignments = async (req, res) => {
  try {
    const assignments = await prisma.officerAssignment.findMany({
      include: {
        member: { select: { firstName: true, middleName: true, lastName: true, suffix: true } },
        assignedBy: { select: { member: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: { startDate: 'desc' }
    })
    return res.json({ assignments })
  } catch (err) {
    console.error('Get officer assignments error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ─── MEMBER LIFECYCLE STATUS ────────────────────────────────────────────────────

// PUT /api/officer/members/:id/status
// Changes a member's lifecycle status. If a member leaves ACTIVE status while
// holding an officer role, that role is automatically revoked in the same
// transaction — a non-active member cannot remain an officer.
const updateMemberStatus = async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body
    const actorId = req.user.id

    if (!VALID_MEMBER_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid member status.' })
    }

    const member = await prisma.member.findUnique({
      where: { id: Number(id) },
      include: { user: true }
    })
    if (!member) return res.status(404).json({ message: 'Member not found.' })
    if (NON_MEMBER_ROLES.includes(member.user.role)) {
      return res.status(400).json({ message: 'Advisers are not members and have no membership status.' })
    }

    const previousStatus = member.status
    const isLeavingActive = previousStatus === 'ACTIVE' && status !== 'ACTIVE'
    const hadOfficerRole = member.user.role !== 'MEMBER'

    await prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id: member.id }, data: { status } })

      if (isLeavingActive && hadOfficerRole) {
        await tx.officerAssignment.updateMany({
          where: { memberId: member.id, status: 'ACTIVE' },
          data: { status: 'ENDED', endDate: new Date(), activeRole: null }
        })
        await tx.user.update({ where: { id: member.userId }, data: { role: 'MEMBER' } })
      }
    })

    const memberName = [member.firstName, member.middleName, member.lastName, member.suffix].filter(Boolean).join(' ')
    await writeAuditLog({
      actorId,
      targetUserId: member.userId,
      action: AUDIT_ACTIONS.MEMBER_STATUS_CHANGED,
      details: {
        memberId: member.id,
        previousStatus,
        newStatus: status,
        memberName,
        officerRoleRevoked: isLeavingActive && hadOfficerRole
      }
    })

    emitToOfficers('membership:changed', { memberId: member.id, action: 'statusChanged' })
    if (isLeavingActive && hadOfficerRole) {
      emitToOfficers('officerRole:changed', { memberId: member.id, action: 'revoked' })
    }

    return res.json({ message: 'Member status updated.' })
  } catch (err) {
    console.error('Update member status error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

module.exports = {
  getPendingUsers, getApprovedMembers, getAdvisers, approveUser, rejectUser, getSignatories,
  assignOfficerRole, removeOfficerRole, getOfficerAssignments, updateMemberStatus, getPublicOfficerRoster
}