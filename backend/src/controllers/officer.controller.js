const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { ROLE_POSITION_LABELS, ALL_ROLES, YEAR_REP_TO_YEAR_LEVEL, MEMBERSHIP_USER_FILTER, NON_MEMBER_ROLES, ASSIGNABLE_OFFICER_ROLES, LEADERSHIP_ROLES, DEVELOPER_ROLE, positionLabel } = require('../utils/roles')
const {
  VALID_MEMBER_STATUSES, VALID_SUFFIXES, VALID_YEAR_LEVELS,
  isValidName, isValidEmail, isCvsuEmail, isValidStudentNumber, isValidSection, isValidSex,
} = require('../utils/validators')
const { diffChanges } = require('../utils/changes')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { syncMemberApprovalNotifications } = require('../services/notification.service')
const { approvePendingUser, rejectPendingUser } = require('../services/memberApproval.service')
const { resolveSignatories } = require('../services/signatory.service')
const { emitToOfficers } = require('../realtime/socket')
const { sendEmailChangedByOfficerEmail } = require('../utils/email')
const { buildMemberQrText, parseMemberQrText, INVALID_MEMBER_QR_MESSAGE } = require('../utils/memberQr')

// The President and VP seats can only be granted, changed or removed by the
// President. Without this, a VP (also an OFFICER_MANAGER) could assign
// PRESIDENT_ADMIN to themselves, which silently demotes the real President.
const TOP_OFFICER_ROLES = ['PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN']
const requiresPresident = (actorRole, ...targetRoles) =>
  actorRole !== 'PRESIDENT_ADMIN' && targetRoles.some((role) => TOP_OFFICER_ROLES.includes(role))

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
    const userId = Number(req.params.userId)

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.status !== 'PENDING_OFFICER_APPROVAL') {
      return res.status(400).json({ message: 'This user is not awaiting approval' })
    }

    const { approved } = await approvePendingUser(userId, { actorId: req.user.id })
    if (!approved) {
      return res.status(400).json({ message: 'This user is not awaiting approval' })
    }

    await syncMemberApprovalNotifications()
    emitToOfficers('membership:changed', { userId, action: 'approved' })

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

    const { rejected } = await rejectPendingUser(Number(userId), { actorId: req.user.id })
    if (!rejected) {
      return res.status(400).json({ message: 'This user is not awaiting approval' })
    }
    await syncMemberApprovalNotifications()
    emitToOfficers('membership:changed', { userId: Number(userId), action: 'rejected' })

    return res.json({ message: 'User rejected' })
  } catch (err) {
    console.error('Reject user error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// POST /api/officer/pending-users/bulk   body: { action: 'approve' | 'reject', userIds: [..] }
// Approves or rejects several pending registrations at once (Member
// Approval checkboxes). Accounts no longer pending — e.g. another officer
// just acted — are skipped. Emails go out in the background.
const MAX_BULK_APPROVALS = 200
const bulkReviewUsers = async (req, res) => {
  try {
    const { action, userIds } = req.body ?? {}
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ message: 'Choose Approve or Reject.' })
    }
    const ids = Array.isArray(userIds) ? [...new Set(userIds.map(Number))] : []
    if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return res.status(400).json({ message: 'Select at least one registration.' })
    }
    if (ids.length > MAX_BULK_APPROVALS) {
      return res.status(400).json({ message: `Select at most ${MAX_BULK_APPROVALS} registrations at a time.` })
    }

    let done = 0
    for (const id of ids) {
      const result = action === 'approve'
        ? await approvePendingUser(id, { actorId: req.user.id, waitForEmail: false })
        : await rejectPendingUser(id, { actorId: req.user.id, waitForEmail: false })
      if (result.approved || result.rejected) done++
    }

    await syncMemberApprovalNotifications()
    emitToOfficers('membership:changed', { action: action === 'approve' ? 'approved' : 'rejected' })

    const verb = action === 'approve' ? 'approved' : 'rejected'
    const skipped = ids.length - done
    return res.json({
      done, skipped,
      message: `${done} registration${done === 1 ? '' : 's'} ${verb}.${skipped ? ` ${skipped} skipped (no longer pending).` : ''}`,
    })
  } catch (err) {
    logError('Bulk review registrations', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// GET /api/officer/signatories
const getSignatories = async (req, res) => {
  try {
    return res.json({ signatories: await resolveSignatories() })
  } catch (err) {
    console.error('Get signatories error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// GET /api/officer/public-officers
// Public — no auth. Powers the landing page's "Current Leadership" section.
// Returns only the currently assigned holders of the 14 fixed leadership
// roles, in the required display/sort order.
const getPublicOfficers = async (req, res) => {
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
    console.error('Get public officers list error:', err)
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
            sex: true,
            yearLevel: true,
            section: true,
            status: true,
            avatar: true,
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
        firstName: m?.firstName ?? '',
        middleName: m?.middleName ?? '',
        lastName: m?.lastName ?? '',
        suffix: m?.suffix ?? '',
        sex: m?.sex ?? '',
        yearLevel: m?.yearLevel ?? '',
        section: m?.section ?? '',
        isPaid: (m?.payments?.length ?? 0) > 0,
        paymentId: m?.payments?.[0]?.id ?? null,
        // Profile picture, so membership cards downloaded here show it.
        avatar: m?.avatar ?? null,
        // The signed text of the member's QR, drawn on cards downloaded here.
        qrCodePayload: m ? buildMemberQrText(m.id) : null,
      }
    })

    return res.json({ members })
  } catch (err) {
    console.error('Get approved members error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// POST /api/officer/members/scan-qr   body: { qrCode }
// Members List ▸ Scan Member QR. Checks the QR was made by this system (see
// utils/memberQr.js) and says which approved member it belongs to; the
// scanner then shows that member from the list it already has.
const scanMemberQr = async (req, res) => {
  try {
    const result = parseMemberQrText(req.body?.qrCode)
    if (result.error) return res.status(400).json({ message: INVALID_MEMBER_QR_MESSAGE })

    const member = await prisma.member.findUnique({
      where: { id: result.memberId },
      select: { id: true, user: { select: { status: true, role: true } } }
    })
    const isApprovedMember = member && member.user.status === 'APPROVED'
      && !NON_MEMBER_ROLES.includes(member.user.role) && member.user.role !== DEVELOPER_ROLE
    if (!isApprovedMember) return res.status(404).json({ message: 'No approved member matched this QR code.' })

    return res.json({ memberId: member.id })
  } catch (err) {
    console.error('Scan member QR error:', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// PUT /api/officer/members/:id/info   body: { firstName, middleName, lastName, suffix, sex, yearLevel, section, email, studentNumber }
// Lets officers with Members List EDIT fix typos in a member's details. Every
// change is logged with its old and new value (the member's edit history). A
// changed email is told to both addresses; the President and VP's details can
// only be changed by the President, as with their status.
const MEMBER_INFO_FIELDS = {
  firstName: 'First name', middleName: 'Middle name', lastName: 'Last name', suffix: 'Suffix',
  sex: 'Sex', yearLevel: 'Year level', section: 'Section', email: 'Email', studentNumber: 'Student number',
}
const updateMemberInfo = async (req, res) => {
  try {
    const member = await prisma.member.findUnique({ where: { id: Number(req.params.id) }, include: { user: true } })
    if (!member) return res.status(404).json({ message: 'Member not found.' })
    if (NON_MEMBER_ROLES.includes(member.user.role) || member.user.role === DEVELOPER_ROLE) {
      return res.status(400).json({ message: 'Only member accounts can be edited here.' })
    }
    if (requiresPresident(req.user.role, member.user.role)) {
      return res.status(403).json({ message: 'Only the President can change the President or Vice President\'s details.' })
    }

    const text = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')
    const next = {
      firstName: text(req.body.firstName), middleName: text(req.body.middleName), lastName: text(req.body.lastName),
      suffix: text(req.body.suffix), sex: text(req.body.sex), yearLevel: text(req.body.yearLevel),
      section: text(req.body.section), email: text(req.body.email).toLowerCase(), studentNumber: text(req.body.studentNumber),
    }

    const errors = {}
    if (!isValidName(next.firstName)) errors.firstName = 'Enter a first name of 2 to 50 letters.'
    if (next.middleName && !isValidName(next.middleName)) errors.middleName = 'The middle name must be 2 to 50 letters.'
    if (!isValidName(next.lastName)) errors.lastName = 'Enter a last name of 2 to 50 letters.'
    if (next.suffix && !VALID_SUFFIXES.includes(next.suffix)) errors.suffix = 'Choose a valid suffix.'
    if (!isValidSex(next.sex)) errors.sex = 'Choose Male or Female.'
    if (!VALID_YEAR_LEVELS.includes(next.yearLevel)) errors.yearLevel = 'Choose a year level.'
    if (!isValidSection(next.section)) errors.section = 'Enter a section number from 1 to 99.'
    if (!isValidEmail(next.email) || next.email.length > 254) errors.email = 'Enter a valid email address.'
    if (!isValidStudentNumber(next.studentNumber)) errors.studentNumber = 'Student number must look like 2023-100-123.'
    if (Object.keys(errors).length) return res.status(400).json({ message: 'Check the highlighted fields.', errors })

    const before = {
      firstName: member.firstName, middleName: member.middleName ?? '', lastName: member.lastName, suffix: member.suffix ?? '',
      sex: member.sex, yearLevel: member.yearLevel ?? '', section: member.section ?? '',
      email: member.user.email, studentNumber: member.user.studentNumber ?? '',
    }
    const changes = diffChanges(before, next, MEMBER_INFO_FIELDS)
    if (changes.length === 0) return res.json({ message: 'No changes to save.', changes })

    // Email and student number identify an account, so they must stay unique.
    const taken = await prisma.user.findFirst({
      where: { id: { not: member.userId }, OR: [{ email: next.email }, { studentNumber: next.studentNumber }] },
      select: { email: true },
    })
    if (taken) {
      return res.status(409).json({
        message: taken.email === next.email ? 'Another account already uses that email.' : 'Another account already uses that student number.',
      })
    }

    await prisma.$transaction([
      prisma.member.update({
        where: { id: member.id },
        data: {
          firstName: next.firstName, middleName: next.middleName || null, lastName: next.lastName,
          suffix: next.suffix || null, sex: next.sex, yearLevel: next.yearLevel, section: next.section,
        },
      }),
      prisma.user.update({
        where: { id: member.userId },
        data: {
          email: next.email, studentNumber: next.studentNumber,
          ...(next.email !== before.email && { emailType: isCvsuEmail(next.email) ? 'CVSU' : 'PERSONAL' }),
        },
      }),
    ])

    const memberName = [next.firstName, next.middleName, next.lastName, next.suffix].filter(Boolean).join(' ')
    await writeAuditLog({
      actorId: req.user.id,
      targetUserId: member.userId,
      action: AUDIT_ACTIONS.MEMBER_INFO_UPDATED,
      entity: { type: 'member', id: member.id },
      details: { memberId: member.id, memberName, changes },
    })

    if (next.email !== before.email) {
      for (const [to, isOldAddress] of [[before.email, true], [next.email, false]]) {
        sendEmailChangedByOfficerEmail(to, { memberName, newEmail: next.email, isOldAddress })
          .catch((err) => logError('Email-changed notice failed', err))
      }
    }
    emitToOfficers('membership:changed', { memberId: member.id, action: 'infoUpdated' })

    return res.json({ message: 'Member details saved.', changes })
  } catch (err) {
    logError('Update member info', err)
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
        adviserTitle: true,
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
      adviserTitle: u.adviserTitle,
      position: positionLabel(u),
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
    // The Developer can only ever fill the empty President seat — its route
    // (routes/developer.routes.js) already refuses once a President exists.
    const developerAssigningPresident = req.user.role === DEVELOPER_ROLE && role === 'PRESIDENT_ADMIN'
    if (req.user.role === DEVELOPER_ROLE && !developerAssigningPresident) {
      return res.status(403).json({ message: 'The Developer account can only assign the President.' })
    }
    if (!developerAssigningPresident && requiresPresident(req.user.role, role, member.user.role)) {
      return res.status(403).json({ message: 'Only the President can assign or change the President and Vice President positions.' })
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
        // each other — this is what makes the guarantee hold on MySQL too.
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
    if (requiresPresident(req.user.role, user.role)) {
      return res.status(403).json({ message: 'Only the President can remove the President or Vice President.' })
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
    if (requiresPresident(req.user.role, member.user.role)) {
      return res.status(403).json({ message: 'Only the President can change the President or Vice President\'s membership status.' })
    }

    // Graduated is final; Active, Inactive and Archived can change back.
    if (member.status === 'GRADUATED' && status !== 'GRADUATED') {
      return res.status(400).json({ message: 'This member has graduated. Graduated is final and can no longer be changed.' })
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
      entity: { type: 'member', id: member.id },
      details: {
        memberId: member.id,
        previousStatus,
        newStatus: status,
        memberName,
        officerRoleRevoked: isLeavingActive && hadOfficerRole,
        changes: [{ field: 'status', label: 'Member status', from: previousStatus, to: status }],
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
  assignOfficerRole, removeOfficerRole, getOfficerAssignments, updateMemberStatus, getPublicOfficers,
  scanMemberQr,
  bulkReviewUsers, updateMemberInfo
}