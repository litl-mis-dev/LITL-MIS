const prisma = require('../lib/prisma')
const { ROLE_POSITION_LABELS, SIGNATORY_ROLES } = require('../utils/roles')

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

async function resolveSignatories() {
  const [president, senFinance, senAudit] = await Promise.all([
    resolveSignatory(SIGNATORY_ROLES.president),
    resolveSignatory(SIGNATORY_ROLES.senFinance),
    resolveSignatory(SIGNATORY_ROLES.senAudit),
  ])
  return { president, senFinance, senAudit }
}

// The officers who sign a Return Fund: received by the Senator for Finance,
// audited by the Senator for Audit, approved by the President — the same
// people the Return Fund form used. A vacant role is left blank.
async function resolveReturnFundSignatories() {
  const { president, senFinance, senAudit } = await resolveSignatories()
  return {
    missing: [
      !senFinance && 'Senator for Finance',
      !senAudit && 'Senator for Audit',
      !president && 'President',
    ].filter(Boolean),
    data: {
      receivedBy:         senFinance?.name ?? '',
      receivedByPosition: senFinance?.position ?? '',
      auditedBy:          senAudit?.name ?? '',
      auditedByPosition:  senAudit?.position ?? '',
      approvedBy:         president?.name ?? '',
      approvedByPosition: president?.position ?? '',
    },
  }
}

module.exports = { resolveSignatory, resolveSignatories, resolveReturnFundSignatories }
