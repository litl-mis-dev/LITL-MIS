const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { getTotalFund, MEMBERSHIP_FEE } = require('../services/calculations.service')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const crypto = require('crypto')
const { sha256 } = require('../utils/ledger')
const { sendPaymentReminderEmail } = require('../utils/email')
const { emitToOfficers, emitToUser } = require('../realtime/socket')
const { evaluateMemberMembershipStatus } = require('../services/membershipStatus.service')
const {
  PAYMENT_UNIT, PaymentValidationError, getUnpaidSemesters, buildAllocation, assertNotAdviser
} = require('../services/membershipPayment.service')
const { NON_MEMBER_ROLES, MEMBERSHIP_USER_FILTER } = require('../utils/roles')

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')

// Same approach as Event Certification: a unique, printable 8-character
// alphanumeric Certificate ID (ambiguous characters like 0/O/1/I excluded).
const CERTIFICATE_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SEMESTER_LABELS_REMINDER = { FIRST: '1st Semester', SECOND: '2nd Semester' }

// Determine whether a member has a settled/paid record for the given active
// semester (mirrors the "isPaid" logic used in officer.controller.getApprovedMembers).
async function isMemberPaidForSemester(memberId, activeSemesterId) {
  const payment = await prisma.payment.findFirst({
    where: {
      memberId,
      semesterId: activeSemesterId,
      obligationSemesterId: activeSemesterId,
      isArchived: false,
    },
    select: { id: true }
  })
  return Boolean(payment)
}

function generateCertificateIdCandidate() {
  let id = ''
  const bytes = crypto.randomBytes(8)
  for (let i = 0; i < 8; i++) {
    id += CERTIFICATE_ID_ALPHABET[bytes[i] % CERTIFICATE_ID_ALPHABET.length]
  }
  return id
}

async function generateUniqueMembershipCertificateId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCertificateIdCandidate()
    const existing = await prisma.membershipCertificate.findUnique({ where: { certificateNumber: candidate } })
    if (!existing) return candidate
  }
  throw new Error('Failed to generate a unique Certificate ID. Please try again.')
}

// Ensures a MembershipCertificate exists for the given payment — created
// automatically the moment a payment is recorded, and lazily backfilled the
// first time an already-paid member's history is read (covers payments that
// existed before this feature shipped). The certificate file itself is never
// stored here or in R2 — only the Certificate ID and a hash of its
// canonical, verifiable data, anchored into the same centralized hash-linked
// ledger used by Event Certification and financial records.
async function ensureMembershipCertificate(payment, member) {
  const existing = await prisma.membershipCertificate.findUnique({ where: { paymentId: payment.id } })
  if (existing) return { ...existing, verificationUrl: `${FRONTEND_URL}/verify/${existing.certificateNumber}` }

  const semesterId = payment.obligationSemesterId ?? payment.semesterId
  const certificateNumber = await generateUniqueMembershipCertificateId()
  const memberName = [member.firstName, member.middleName, member.lastName, member.suffix].filter(Boolean).join(' ')

  const canonicalPayload = JSON.stringify({
    certificateNumber,
    memberId: member.id,
    paymentId: payment.id,
    semesterId,
    memberName,
    issuedAt: new Date(payment.paidAt).toISOString(),
  })
  const certificateHash = sha256(Buffer.from(canonicalPayload))

  const certificate = await prisma.membershipCertificate.create({
    data: {
      certificateNumber,
      paymentId: payment.id,
      memberId: member.id,
      semesterId,
      certificateHash,
      issuedById: payment.recordedById,
    }
  })

  await writeAuditLog({
    actorId: payment.recordedById,
    targetUserId: member.userId,
    action: AUDIT_ACTIONS.MEMBERSHIP_CERTIFICATE_ISSUED,
    details: {
      certificateId: certificate.id,
      certificateNumber,
      paymentId: payment.id,
      memberId: member.id,
      semesterId,
      snapshot: {
        certificateNumber,
        paymentId: payment.id,
        memberId: member.id,
        semesterId,
        certificateHash,
      }
    }
  })

  return { ...certificate, verificationUrl: `${FRONTEND_URL}/verify/${certificateNumber}` }
}

const listPayments = async (req, res) => {
  try {
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const payments = await prisma.payment.findMany({
      where: { semesterId: activeSemester.id, isArchived: false, member: { user: MEMBERSHIP_USER_FILTER } },
      include: {
        member: {
          select: {
            id: true, firstName: true, middleName: true, lastName: true,
            suffix: true, yearLevel: true, section: true,
            user: { select: { studentNumber: true, email: true } }
          }
        },
        recordedBy: {
          select: { member: { select: { firstName: true, lastName: true } } }
        }
      },
      orderBy: { paidAt: 'desc' }
    })

    const totalFund = await getTotalFund(activeSemester.id)
    return res.json({
      semester: activeSemester,
      payments,
      summary: { paidCount: payments.length, totalFund: totalFund.toFixed(2) }
    })
  } catch (err) {
    logError('List payments', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const SEMESTER_LABELS_PAY = { FIRST: '1st Semester', SECOND: '2nd Semester' }

function semesterLabelOf(s) {
  return `${s.schoolYear} ${SEMESTER_LABELS_PAY[s.semester]}`
}

function assertMemberCanPay(member) {
  assertNotAdviser(member.user)
  if (member.user.status !== 'APPROVED') throw new PaymentValidationError('Member account is not approved.')
  // Inactive members are allowed to pay so they can settle the unpaid dues
  // that caused their automatic deactivation (see membershipStatus.service).
  if (!['ACTIVE', 'INACTIVE'].includes(member.status)) {
    throw new PaymentValidationError('Only active or inactive members can have payments recorded.')
  }
}

function sendPaymentError(res, err, label) {
  if (err instanceof PaymentValidationError) return res.status(err.status).json({ message: err.message })
  logError(label, err)
  return res.status(500).json({ message: 'Something went wrong.' })
}

// POST /api/financial/payments/preview  { memberId, amount }
// Read-only verification step used by the confirmation dialog. Returns exactly
// which semesters the amount would pay (oldest unpaid first) without saving.
const previewPayment = async (req, res) => {
  try {
    const memberId = Number(req.body.memberId)
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ message: 'Member ID is required.' })

    const { member, activeSemester, unpaid } = await getUnpaidSemesters(memberId)
    assertMemberCanPay(member)

    const { amount, units, allocation } = buildAllocation({ rawAmount: req.body.amount, unpaid, activeSemester })

    return res.json({
      amount,
      units,
      unpaidCount: unpaid.length,
      maxAmount: unpaid.length * PAYMENT_UNIT,
      allocation: allocation.map((s) => ({
        semesterId: s.id,
        schoolYear: s.schoolYear,
        semester: s.semester,
        semesterLabel: semesterLabelOf(s),
        isActive: s.isActive,
        status: s.id === activeSemester.id ? 'PAID' : 'SETTLED',
        amount: PAYMENT_UNIT,
      })),
      remainingUnpaid: unpaid.slice(units).map((s) => ({ semesterId: s.id, semesterLabel: semesterLabelOf(s) })),
    })
  } catch (err) {
    return sendPaymentError(res, err, 'Preview payment')
  }
}

// POST /api/financial/payments  { memberId, amount, expectedSemesterIds? }
// Amount is in ₱100 increments. It is applied automatically to the member's
// oldest unpaid semester first, then the next, and so on. One Payment row
// (₱100) is created per semester so every existing financial rule
// (Total Fund, certificates, settled/paid status) keeps working unchanged.
const recordPayment = async (req, res) => {
  try {
    const memberId = Number(req.body.memberId)
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ message: 'Member ID is required.' })

    const expectedSemesterIds = req.body.expectedSemesterIds
    if (expectedSemesterIds !== undefined && !Array.isArray(expectedSemesterIds)) {
      return res.status(400).json({ message: 'Invalid payment verification data.' })
    }

    // Everything that decides + writes happens in one transaction, with the
    // member row locked, so a double click / two officers can't double-pay.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Member WHERE id = ${memberId} FOR UPDATE`

      const { member, activeSemester, unpaid } = await getUnpaidSemesters(memberId, tx)
      assertMemberCanPay(member)

      const { amount, allocation } = buildAllocation({
        rawAmount: req.body.amount, unpaid, activeSemester, expectedSemesterIds
      })

      const created = []
      for (const sem of allocation) {
        const payment = await tx.payment.create({
          data: {
            memberId,
            semesterId: activeSemester.id,
            obligationSemesterId: sem.id,
            amount: MEMBERSHIP_FEE.toFixed(2),
            recordedById: req.user.id,
          }
        })
        created.push({ payment, semester: sem })
      }

      // Post-write verification: every allocated semester must now be paid,
      // exactly once, and nothing else was touched.
      const check = await tx.payment.findMany({
        where: { memberId, isArchived: false, obligationSemesterId: { in: allocation.map((s) => s.id) } },
        select: { obligationSemesterId: true }
      })
      const counts = new Map()
      check.forEach((p) => counts.set(p.obligationSemesterId, (counts.get(p.obligationSemesterId) ?? 0) + 1))
      if (allocation.some((s) => counts.get(s.id) !== 1)) {
        throw new PaymentValidationError('Payment verification failed. No payment was saved.', 409)
      }

      return { member, activeSemester, created, amount }
    })

    const { member, activeSemester, created, amount } = result
    const memberName = [member.firstName, member.middleName, member.lastName, member.suffix].filter(Boolean).join(' ')

    for (const { payment, semester } of created) {
      const isSettled = semester.id !== activeSemester.id
      await writeAuditLog({
        actorId: req.user.id,
        targetUserId: member.user.id,
        action: AUDIT_ACTIONS.PAYMENT_RECORDED,
        details: {
          paymentId:            payment.id,
          memberId:             member.id,
          memberUserId:         member.user.id,
          memberName,
          semesterLabel:        semesterLabelOf(semester),
          activeSemesterId:     activeSemester.id,
          obligationSemesterId: semester.id,
          status:               isSettled ? 'SETTLED' : 'PAID',
          totalAmountTendered:  amount.toFixed(2),
          snapshot: {
            id:                   payment.id,
            memberId:             payment.memberId,
            semesterId:           payment.semesterId,
            obligationSemesterId: payment.obligationSemesterId,
            amount:               MEMBERSHIP_FEE.toFixed(2),
            isArchived:           false,
          }
        }
      })

      await ensureMembershipCertificate(payment, {
        id: member.id,
        userId: member.user.id,
        firstName: member.firstName,
        middleName: member.middleName,
        lastName: member.lastName,
        suffix: member.suffix,
      }).catch((err) => logError('Auto-create membership certificate', err))

      emitToOfficers('payment:changed', { paymentId: payment.id, memberId: member.id, action: 'recorded' })
      emitToUser(member.user.id, 'payment:self-changed', { paymentId: payment.id })
    }

    // Automatic member status update — evaluated once after all payments.
    const statusOutcome = await evaluateMemberMembershipStatus({
      memberId: member.id,
      referenceSemesterId: activeSemester.id
    }).catch((err) => {
      logError('Evaluate membership status after payment', err)
      return null
    })

    if (statusOutcome) {
      await writeAuditLog({
        actorId: req.user.id,
        targetUserId: member.user.id,
        action: statusOutcome.action === 'DEACTIVATED'
          ? AUDIT_ACTIONS.MEMBER_STATUS_AUTO_DEACTIVATED
          : AUDIT_ACTIONS.MEMBER_STATUS_AUTO_REACTIVATED,
        details: {
          memberId: statusOutcome.memberId,
          memberName: statusOutcome.memberName,
          triggeredByPaymentId: created[created.length - 1].payment.id,
          checkedSemesterIds: statusOutcome.checkedSemesterIds,
          officerRoleRevoked: statusOutcome.officerRoleRevoked
        }
      })
      emitToOfficers('membership:changed', {
        memberId: statusOutcome.memberId,
        action: statusOutcome.action === 'DEACTIVATED' ? 'autoDeactivated' : 'autoReactivated'
      })
    }

    return res.status(201).json({
      message: `Payment of ₱${amount.toLocaleString('en-PH')} recorded for ${created.length} semester${created.length === 1 ? '' : 's'}.`,
      payments: created.map(({ payment }) => payment),
      semesters: created.map(({ semester }) => ({
        semesterId: semester.id,
        semesterLabel: semesterLabelOf(semester),
        status: semester.id === activeSemester.id ? 'PAID' : 'SETTLED',
      })),
      totalAmount: amount,
      membershipStatusChange: statusOutcome ? statusOutcome.action : null
    })
  } catch (err) {
    return sendPaymentError(res, err, 'Record payment')
  }
}


// Soft-archives a payment. Financial records are never hard-deleted — this
// preserves the record for audit purposes while removing it from active
// totals and freeing the member to be paid again for the semester.
const archivePayment = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const payment = await prisma.payment.findUnique({ where: { id } })
    if (!payment || payment.isArchived) return res.status(404).json({ message: 'Payment not found.' })

    const paymentWithMember = await prisma.payment.findUnique({
      where: { id },
      include: {
        member: { select: { firstName: true, middleName: true, lastName: true, suffix: true, userId: true } },
        obligationSemester: { select: { schoolYear: true, semester: true } }
      }
    })
    const memberName = [
      paymentWithMember?.member?.firstName,
      paymentWithMember?.member?.middleName,
      paymentWithMember?.member?.lastName,
      paymentWithMember?.member?.suffix
    ].filter(Boolean).join(' ')
    const LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester' }
    const semLabel = paymentWithMember?.obligationSemester
      ? `${paymentWithMember.obligationSemester.schoolYear} ${LABELS[paymentWithMember.obligationSemester.semester]}`
      : '—'

    await prisma.payment.update({ where: { id }, data: { isArchived: true } })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.PAYMENT_ARCHIVED,
      details: {
        paymentId: id,
        memberName,
        semesterLabel: semLabel,
        amount: payment.amount.toString(),
        snapshot: {
          id,
          memberId:             payment.memberId,
          semesterId:           payment.semesterId,
          obligationSemesterId: payment.obligationSemesterId,
          amount:               payment.amount.toString(),
          isArchived:           true, // what it will become
        }
      }
    })

    emitToOfficers('payment:changed', { paymentId: id, memberId: payment.memberId, action: 'archived' })
    if (paymentWithMember?.member?.userId) {
      emitToUser(paymentWithMember.member.userId, 'payment:self-changed', { paymentId: id })
    }

    return res.json({ message: 'Payment archived.' })
  } catch (err) {
    logError('Archive payment', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const SEMESTER_LABELS_H = { FIRST: '1st Semester', SECOND: '2nd Semester' }

const getMemberPaymentHistory = async (req, res) => {
  try {
    const memberId = Number(req.params.memberId)
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      include: { user: { select: { id: true, createdAt: true, role: true } } }
    })
    if (!member) return res.status(404).json({ message: 'Member not found.' })
    if (NON_MEMBER_ROLES.includes(member.user.role)) {
      return res.status(400).json({ message: 'Advisers are not members and have no membership payments.' })
    }

    const allSemesters = await prisma.semester.findMany({
      orderBy: [{ schoolYear: 'asc' }, { semester: 'asc' }]
    })

    const memberJoinedAt = member.user.createdAt
    const relevantSemesters = allSemesters.filter(
      s => new Date(s.createdAt) >= new Date(memberJoinedAt) || s.isActive
    )

    const payments = await prisma.payment.findMany({
      where: { memberId, isArchived: false },
      include: {
        semester: { select: { id: true, isActive: true } }
      }
    })

    // Map by obligationSemesterId (falls back to semesterId for old records)
    const paymentByObligation = new Map()
    for (const p of payments) {
      const key = p.obligationSemesterId ?? p.semesterId
      paymentByObligation.set(key, p)
    }

    const memberForCertificate = {
      id: member.id,
      userId: member.user.id,
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      suffix: member.suffix,
    }

    const history = await Promise.all(relevantSemesters.map(async s => {
      const payment = paymentByObligation.get(s.id)
      let status = 'UNPAID'
      let paymentInfo = null

      if (payment) {
        // Settled = money received in a different (active) semester
        const isSettled = payment.semesterId !== s.id
        status = isSettled ? 'SETTLED' : 'PAID'
        const certificate = await ensureMembershipCertificate(payment, memberForCertificate).catch((err) => {
          logError('Ensure membership certificate', err)
          return null
        })
        paymentInfo = {
          paymentId: payment.id,
          paidAt: payment.paidAt,
          amount: payment.amount.toString(),
          status,
          certificate: certificate
            ? { certificateNumber: certificate.certificateNumber, verificationUrl: certificate.verificationUrl }
            : null,
        }
      }

      return {
        semesterId: s.id,
        schoolYear: s.schoolYear,
        semester: s.semester,
        semesterLabel: `${s.schoolYear} ${SEMESTER_LABELS_H[s.semester]}`,
        isActive: s.isActive,
        status,
        payment: paymentInfo
      }
    }))

    return res.json({ history })
  } catch (err) {
    logError('Get member payment history', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const getMyPaymentHistory = async (req, res) => {
  try {
    const member = await prisma.member.findUnique({
      where: { userId: req.user.id },
      select: {
        id: true,
        section: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
        user: { select: { id: true, createdAt: true, role: true } }
      }
    })
    if (!member) return res.status(404).json({ message: 'Member profile not found.' })
    if (NON_MEMBER_ROLES.includes(member.user.role)) {
      return res.status(403).json({ message: 'Advisers are not members and have no membership payments.' })
    }

    const allSemesters = await prisma.semester.findMany({
      orderBy: [{ schoolYear: 'asc' }, { semester: 'asc' }]
    })

    const memberJoinedAt = member.user.createdAt
    const relevantSemesters = allSemesters.filter(
      s => new Date(s.createdAt) >= new Date(memberJoinedAt) || s.isActive
    )

    const payments = await prisma.payment.findMany({
      where: { memberId: member.id, isArchived: false }
    })

    const paymentByObligation = new Map()
    for (const p of payments) {
      const key = p.obligationSemesterId ?? p.semesterId
      paymentByObligation.set(key, p)
    }

    const LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester' }

    const memberForCertificate = {
      id: member.id,
      userId: member.user.id,
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      suffix: member.suffix,
    }

    const history = await Promise.all(relevantSemesters.map(async s => {
      const payment = paymentByObligation.get(s.id)
      let status = 'UNPAID'
      let paymentInfo = null

      if (payment) {
        const isSettled = payment.semesterId !== s.id
        status = isSettled ? 'SETTLED' : 'PAID'
        const certificate = await ensureMembershipCertificate(payment, memberForCertificate).catch((err) => {
          logError('Ensure membership certificate', err)
          return null
        })
        paymentInfo = {
          paymentId: payment.id,
          paidAt:    payment.paidAt,
          amount:    payment.amount.toString(),
          status,
          certificate: certificate
            ? { certificateNumber: certificate.certificateNumber, verificationUrl: certificate.verificationUrl }
            : null,
        }
      }

      return {
        semesterId:    s.id,
        schoolYear:    s.schoolYear,
        semester:      s.semester,
        semesterLabel: `${s.schoolYear} ${LABELS[s.semester]}`,
        isActive:      s.isActive,
        status,
        payment:       paymentInfo,
        section:       member.section   // current section — historical section not tracked
      }
    }))

    return res.json({ history })
  } catch (err) {
    logError('Get my payment history', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// POST /api/financial/members/:memberId/send-reminder
// Sends a payment reminder email to a single member — only if they are
// unpaid/have an unsettled membership fee for the current active semester.
const sendPaymentReminder = async (req, res) => {
  try {
    const memberId = Number(req.params.memberId)

    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const member = await prisma.member.findUnique({
      where: { id: memberId },
      include: { user: { select: { id: true, email: true, status: true, role: true } } }
    })
    if (!member) return res.status(404).json({ message: 'Member not found.' })
    if (NON_MEMBER_ROLES.includes(member.user?.role)) {
      return res.status(400).json({ message: 'Advisers are not members and have no membership payments.' })
    }
    if (!member.user?.email) return res.status(400).json({ message: 'Member has no email address on file.' })

    const alreadyPaid = await isMemberPaidForSemester(memberId, activeSemester.id)
    if (alreadyPaid) {
      return res.status(400).json({ message: 'This member has already paid for the current semester.' })
    }

    const memberName = [member.firstName, member.middleName, member.lastName, member.suffix].filter(Boolean).join(' ')
    const semesterLabel = `${activeSemester.schoolYear} ${SEMESTER_LABELS_REMINDER[activeSemester.semester]}`

    await sendPaymentReminderEmail(member.user.email, memberName, semesterLabel)

    await writeAuditLog({
      actorId: req.user.id,
      targetUserId: member.user.id,
      action: AUDIT_ACTIONS.PAYMENT_REMINDER_SENT,
      details: {
        memberId: member.id,
        memberName,
        email: member.user.email,
        semesterLabel,
        activeSemesterId: activeSemester.id,
        recipientCount: 1,
      }
    })

    return res.json({ message: `Reminder email sent to ${memberName || member.user.email}.` })
  } catch (err) {
    logError('Send payment reminder', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// POST /api/financial/payments/send-reminders
// Sends a payment reminder email to every APPROVED, ACTIVE member who is
// unpaid/has an unsettled membership fee for the current active semester.
// Paid members (and members without an email address) are skipped.
const sendBulkPaymentReminders = async (req, res) => {
  try {
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    const members = await prisma.member.findMany({
      where: { status: 'ACTIVE', user: { status: 'APPROVED', ...MEMBERSHIP_USER_FILTER } },
      include: { user: { select: { id: true, email: true } } }
    })

    const paidRows = await prisma.payment.findMany({
      where: {
        semesterId: activeSemester.id,
        obligationSemesterId: activeSemester.id,
        isArchived: false,
        memberId: { in: members.map((m) => m.id) },
      },
      select: { memberId: true },
    })
    const paidMemberIds = new Set(paidRows.map((p) => p.memberId))
    const unpaidMembers = members.filter((m) => m.user?.email && !paidMemberIds.has(m.id))

    if (unpaidMembers.length === 0) {
      return res.json({ message: 'No unpaid members to remind — everyone is settled for this semester.', sentCount: 0 })
    }

    const semesterLabel = `${activeSemester.schoolYear} ${SEMESTER_LABELS_REMINDER[activeSemester.semester]}`
    const EMAIL_BATCH_SIZE = 5
    const EMAIL_BATCH_PAUSE_MS = 1200
    const results = []
    for (let i = 0; i < unpaidMembers.length; i += EMAIL_BATCH_SIZE) {
      const batch = unpaidMembers.slice(i, i + EMAIL_BATCH_SIZE)
      const settled = await Promise.allSettled(
        batch.map(member => {
          const memberName = [member.firstName, member.middleName, member.lastName, member.suffix].filter(Boolean).join(' ')
          return sendPaymentReminderEmail(member.user.email, memberName, semesterLabel)
        })
      )
      results.push(...settled)
      if (i + EMAIL_BATCH_SIZE < unpaidMembers.length) {
        await new Promise((resolve) => setTimeout(resolve, EMAIL_BATCH_PAUSE_MS))
      }
    }

    const sent = unpaidMembers.filter((_, i) => results[i].status === 'fulfilled')
    const failed = unpaidMembers.filter((_, i) => results[i].status === 'rejected')

    if (sent.length > 0) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.PAYMENT_REMINDER_SENT,
        details: {
          semesterLabel,
          activeSemesterId: activeSemester.id,
          recipientCount: sent.length,
          failedCount: failed.length,
          memberIds: sent.map(m => m.id),
        }
      })
    }

    return res.json({
      message: `Reminder emails sent to ${sent.length} member${sent.length !== 1 ? 's' : ''}.${failed.length ? ` ${failed.length} failed to send.` : ''}`,
      sentCount: sent.length,
      failedCount: failed.length,
    })
  } catch (err) {
    logError('Send bulk payment reminders', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = {
  listPayments, recordPayment, previewPayment, getMemberPaymentHistory, archivePayment, getMyPaymentHistory,
  sendPaymentReminder, sendBulkPaymentReminders
}