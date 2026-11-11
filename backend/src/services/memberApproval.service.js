const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { notifyRegistrationApproved } = require('./notification.service')
const { sendRegistrationStatusEmail } = require('../utils/email')

// Approves one registration that is waiting for officer approval. Used by the
// officers' Approve button and by the member roster, so both give the member
// exactly the same result: approved account, notification, email and an
// activity log entry. `actorId` is null when the system approves from the
// roster at registration time.
//
// Returns { approved: true, memberName } — or { approved: false } when the
// account isn't (or is no longer) pending, e.g. another officer just acted.
// Callers refresh the officers' pending-approval notification themselves
// (syncMemberApprovalNotifications), once per batch.
async function approvePendingUser(userId, { actorId = null, via = 'MANUAL' } = {}) {
  // Only flips a still-pending account, so two approvals can't both run.
  const { count } = await prisma.user.updateMany({
    where: { id: userId, status: 'PENDING_OFFICER_APPROVAL' },
    data: { status: 'APPROVED' },
  })
  if (count === 0) return { approved: false }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, member: { select: { firstName: true, lastName: true } } },
  })
  const memberName = user?.member ? `${user.member.firstName} ${user.member.lastName}` : null

  await writeAuditLog({
    actorId,
    targetUserId: userId,
    action: AUDIT_ACTIONS.USER_APPROVED,
    details: via === 'ROSTER' ? { memberName, via } : { memberName },
  })

  await notifyRegistrationApproved(userId, memberName)
  // Best-effort: a failed email must never block the approval itself.
  if (user?.email) {
    await sendRegistrationStatusEmail(user.email, memberName, true)
      .catch((err) => logError('Approval email failed', err))
  }

  return { approved: true, memberName }
}

module.exports = { approvePendingUser }
