const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_MODULE,
  FINANCIAL_ACTIONS,
  DEDUCT_ACTIONS,
  ADD_ACTIONS
} = require('../utils/auditActions')
const { ROLE_POSITION_LABELS } = require('../utils/roles')

const STATUS_LABELS = {
  PENDING: 'Pending',
  REVIEW: 'Review',
  FOR_CLARIFICATION: 'For Clarification',
  CLEARED: 'Cleared',
}

// GET /api/audit-logs
// Supports: search (q), action, module, dateFrom, dateTo, page, limit
const listAuditLogs = async (req, res) => {
  try {
    // Repeated query params arrive as arrays — treat anything that isn't a
    // plain string as absent instead of letting it reach Prisma.
    const str = (value) => (typeof value === 'string' ? value : '')
    const q            = str(req.query.q).trim()
    const action       = str(req.query.action)
    const moduleFilter = str(req.query.module)
    const dateFrom     = str(req.query.dateFrom)
    const dateTo       = str(req.query.dateTo)

    const pageNum  = Math.max(1, parseInt(str(req.query.page),  10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(str(req.query.limit), 10) || 50))
    const skip     = (pageNum - 1) * pageSize

    // ── Build the Prisma where clause ──────────────────────────────────────
    const where = {}

    if (action) {
      where.action = action
    }

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) {
        const from = new Date(dateFrom)
        if (Number.isNaN(from.getTime())) return res.status(400).json({ message: 'Invalid start date.' })
        from.setHours(0, 0, 0, 0)
        where.createdAt.gte = from
      }
      if (dateTo) {
        const to = new Date(dateTo)
        if (Number.isNaN(to.getTime())) return res.status(400).json({ message: 'Invalid end date.' })
        to.setHours(23, 59, 59, 999)
        where.createdAt.lte = to
      }
    }

    // Text search runs in the database so it covers every page, not just the
    // rows already fetched. Matches the same things the old in-memory filter
    // did: actor name, actor position, action label, module, and details.
    if (q) {
      const query = q.toLowerCase()
      const includesQuery = (text) => String(text).toLowerCase().includes(query)

      const matchingActions = Object.keys(AUDIT_ACTION_LABELS).filter((key) =>
        includesQuery(AUDIT_ACTION_LABELS[key]) || includesQuery(AUDIT_ACTION_MODULE[key] ?? '') || includesQuery(key)
      )
      const matchingRoles = Object.keys(ROLE_POSITION_LABELS).filter((role) =>
        includesQuery(ROLE_POSITION_LABELS[role]) || includesQuery(role)
      )
      // Every word must appear in some part of the actor's name, so
      // "juan cruz" finds "Juan Dela Cruz".
      const nameWords = q.split(/\s+/).filter(Boolean)
      const nameField = (word) => ({
        OR: ['firstName', 'middleName', 'lastName', 'suffix'].map((field) => ({ [field]: { contains: word } }))
      })

      where.OR = [
        { details: { contains: q } },
        { actor: { member: { AND: nameWords.map(nameField) } } },
        ...(matchingActions.length ? [{ action: { in: matchingActions } }] : []),
        ...(matchingRoles.length ? [{ actor: { role: { in: matchingRoles } } }] : []),
      ]
    }

    // Module filter maps to a set of action keys
    if (moduleFilter) {
      const actionsInModule = Object.entries(AUDIT_ACTION_MODULE)
        .filter(([, mod]) => mod === moduleFilter)
        .map(([key]) => key)
      where.action = { in: actionsInModule }
    }

    const [rawLogs, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        include: {
          actor: {
            select: {
              id: true,
              role: true,
              member: { select: { firstName: true, middleName: true, lastName: true, suffix: true } }
            }
          },
          targetUser: {
            select: {
              id: true,
              role: true,
              member: { select: { firstName: true, lastName: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.auditLog.count({ where })
    ])

    // ── Shape each row for the frontend ────────────────────────────────────
    const logs = rawLogs
      .map(log => {
        const actorName  = buildFullName(log.actor?.member) ?? 'System'
        const actorRole  = log.actor?.role ?? null
        const details    = safeParseDetails(log.details)
        const amount = details?.amount ?? details?.snapshot?.amount ?? details?.carriedBalance ?? null

        return {
          id:          log.id,
          date:        formatDate(log.createdAt),
          time:        formatTime(log.createdAt),
          account:     actorName,
          role:        actorRole ? (ROLE_POSITION_LABELS[actorRole] ?? actorRole) : '—',
          action:      AUDIT_ACTION_LABELS[log.action] ?? log.action,
          actionKey:   log.action,
          module:      AUDIT_ACTION_MODULE[log.action] ?? 'System',
          fundAmount:  FINANCIAL_ACTIONS.has(log.action) && amount ? formatAmount(amount) : null,
          fundChange:  DEDUCT_ACTIONS.has(log.action) ? 'deduct' : ADD_ACTIONS.has(log.action) ? 'add' : null,
          details:     details,
          description: buildDescription(log.action, details, log.targetUser ? buildFullName(log.targetUser.member) : null),
          targetUser:  log.targetUser ? buildFullName(log.targetUser.member) ?? 'User' : null,
          createdAt:   log.createdAt,
        }
      })

    return res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      },
      // Available filter options computed from the canonical maps
      availableModules: [...new Set(Object.values(AUDIT_ACTION_MODULE))].sort(),
      availableRoles:   Object.values(ROLE_POSITION_LABELS).filter(r => r !== 'Member')
    })
  } catch (err) {
    logError('List audit logs', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFullName(member) {
  if (!member) return null
  return [member.firstName, member.middleName, member.lastName, member.suffix]
    .filter(Boolean).join(' ')
}

function safeParseDetails(raw) {
  if (!raw) return null
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return { raw } }
}

function formatAmount(value) {
  const n = parseFloat(value)
  if (!isFinite(n)) return null
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: '2-digit', year: 'numeric'
  }).format(new Date(date))
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  }).format(new Date(date))
}

// Generates a human-readable, audit-friendly description from an action key
// and its stored details. Called at read-time so labels can be improved without
// re-writing existing log rows. Falls back to AUDIT_ACTION_LABELS if no match.
function buildDescription(action, details, targetName) {
  const d = details || {}
  const fmt = (v) => {
    const n = parseFloat(v)
    return isFinite(n)
      ? `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null
  }

  switch (action) {
    case 'PAYMENT_RECORDED':
      return `Recorded ${fmt(d.amount) ?? '₱100.00'} membership payment${d.memberName ? ` for ${d.memberName}` : ''}.`

    case 'PAYMENT_ARCHIVED':
      return `Archived membership payment record${d.memberName ? ` for ${d.memberName}` : ''}.`

    case 'CATEGORY_CREATED': {
      if (Array.isArray(d.names) && d.names.length > 0) {
        const list = d.names.map((n, i) => {
          const pct = d.percentages?.[i]
          return pct !== undefined ? `${n} (${pct}%)` : n
        }).join(', ')
        return `Added fund ${d.names.length > 1 ? 'categories' : 'category'}: ${list}.`
      }
      return 'Added new fund category.'
    }

    case 'CATEGORY_UPDATED': {
      const nameChanged = d.previousName && d.name && d.previousName !== d.name
      const pctChanged = d.previousPercentage !== undefined && d.percentage !== undefined && d.previousPercentage !== d.percentage
      if (nameChanged && pctChanged)
        return `Updated fund category from "${d.previousName}" (${d.previousPercentage}%) to "${d.name}" (${d.percentage}%).`
      if (nameChanged)
        return `Renamed fund category from "${d.previousName}" to "${d.name}".`
      if (pctChanged)
        return `Updated "${d.name || 'category'}" allocation from ${d.previousPercentage}% to ${d.percentage}%.`
      return `Updated fund category "${d.name || ''}".`
    }

    case 'CATEGORY_ARCHIVED':
      return `Archived fund category: ${d.name || 'N/A'}.`

    case 'DISBURSEMENT_CREATED':
      return `Created a disbursement of ${fmt(d.snapshot?.amount) ?? 'N/A'} for ${d.snapshot?.name || 'N/A'}${d.categoryName ? ` — ${d.categoryName}` : ''}.`

    case 'DISBURSEMENT_UPDATED': {
      if (d.previousAmount && d.newAmount && d.previousAmount !== d.newAmount) {
        return `Updated disbursement ${d.reference ?? ''} amount from ${fmt(d.previousAmount)} to ${fmt(d.newAmount)}.`
      }
      return `Updated disbursement record ${d.reference ?? ''}.`
    }

    case 'DISBURSEMENT_ARCHIVED':
      return `Archived disbursement record ${d.reference ?? ''}.`

    case 'RETURN_FUND_CREATED':
      return `Returned ${fmt(d.snapshot?.amount) ?? 'N/A'} to the organization fund${d.disbursementReference ? ` (ref: ${d.disbursementReference})` : ''}.`

    case 'RETURN_FUND_UPDATED': {
      if (d.previousAmount && d.newAmount && d.previousAmount !== d.newAmount) {
        return `Updated return fund ${d.reference ?? ''} amount from ${fmt(d.previousAmount)} to ${fmt(d.newAmount)}.`
      }
      return `Updated return fund record ${d.reference ?? ''}.`
    } 

    case 'RETURN_FUND_ARCHIVED':
      return `Archived return fund record ${d.reference ?? ''}.`
    
    case 'AUDIT_STATUS_UPDATED': {
      const from = STATUS_LABELS[d.previousStatus] ?? d.previousStatus ?? 'Pending'
      const to = STATUS_LABELS[d.newStatus] ?? d.newStatus ?? 'Pending'
      return `Audit status for ${d.displayId ?? d.reference ?? 'record'} updated from ${from} to ${to}.`
    }

    case 'AUDIT_CLEARED': {
      const from = STATUS_LABELS[d.previousStatus] ?? d.previousStatus ?? 'Pending'
      return `Audit status for ${d.displayId ?? d.reference ?? 'record'} updated from ${from} to Cleared. Marked as legitimate and correct.`
    }

    case 'USER_APPROVED':
      return `Approved member registration${d.memberName ? ` for ${d.memberName}` : targetName ? ` for ${targetName}` : ''}.`

    case 'USER_REJECTED':
      return `Rejected member registration${d.memberName ? ` for ${d.memberName}` : targetName ? ` for ${targetName}` : ''}.`

    case 'USER_REGISTERED':
      return 'New member registration submitted.'

    case 'EMAIL_VERIFIED':
      return 'Email address verified.'

    case 'OFFICER_ASSIGNED':
      return `Assigned ${d.roleName ?? d.role ?? 'officer'} role to ${d.memberName ?? targetName ?? 'member'}.`

    case 'OFFICER_REMOVED':
      return `Removed ${d.previousRoleName ?? d.previousRole ?? 'officer'} role from ${d.memberName ?? targetName ?? 'member'}.`

    case 'MEMBER_STATUS_CHANGED': {
      const from = d.previousStatus ?? '?'
      const to = d.newStatus ?? '?'
      const name = d.memberName ?? targetName
      return `Changed member status from ${from} to ${to}${name ? ` for ${name}` : ''}.${d.officerRoleRevoked ? ' Officer role automatically revoked.' : ''}`
    }

    case 'MEMBER_STATUS_AUTO_DEACTIVATED': {
      // Bulk case (semester advancement): details has a count + list of memberIds.
      if (d.count) {
        return `${d.count} member${d.count !== 1 ? 's' : ''} automatically set to Inactive due to unpaid dues for the last 2 semesters${d.triggeredBySemester ? ` (triggered by activating ${d.triggeredBySemester})` : ''}.`
      }
      // Single-member case (triggered by a payment action, if ever applicable).
      const name = d.memberName ?? targetName
      return `Member${name ? ` ${name}` : ''} automatically set to Inactive due to unpaid dues for the last 2 semesters.`
    }

    case 'MEMBER_STATUS_AUTO_REACTIVATED': {
      if (d.count) {
        return `${d.count} member${d.count !== 1 ? 's' : ''} automatically set back to Active after settling unpaid dues${d.triggeredBySemester ? ` (triggered by activating ${d.triggeredBySemester})` : ''}.`
      }
      const name = d.memberName ?? targetName
      return `Member${name ? ` ${name}` : ''} automatically set back to Active after settling unpaid dues${d.triggeredByPaymentId ? ` (payment #${d.triggeredByPaymentId})` : ''}.`
    }

    case 'NEXT_SEMESTER_ACTIVATED': {
      const balance = fmt(d.carriedBalance)
      return `Activated ${d.nextSemester ?? 'next semester'}.${balance && parseFloat(d.carriedBalance) > 0 ? ` Carried over ${balance} as beginning balance.` : ''}`
    }

    case 'SCHOOL_YEAR_ADVANCED': {
      const balance = fmt(d.carriedBalance)
      const parts = [`Activated ${d.nextSemester ?? 'new school year'}.`]
      if (d.membersPromoted) parts.push(`${d.membersPromoted} member${d.membersPromoted !== 1 ? 's' : ''} promoted.`)
      if (d.membersGraduated) parts.push(`${d.membersGraduated} member${d.membersGraduated !== 1 ? 's' : ''} graduated.`)
      if (balance && parseFloat(d.carriedBalance) > 0) parts.push(`Carried over ${balance} as beginning balance.`)
      return parts.join(' ')
    }

    case 'LOGIN_SUCCESS':  return 'Logged in successfully.'
    case 'LOGOUT':         return 'Logged out.'
    case 'LOGIN_FAILED':   return `Failed login attempt${d.attempt ? ` (attempt ${d.attempt})` : ''}.`
    case 'ACCOUNT_LOCKED': return 'Account temporarily locked due to multiple failed login attempts.'
    case 'PASSWORD_RESET': return 'Password reset successfully.'

    default:
      return AUDIT_ACTION_LABELS[action] ?? action
  }
}

module.exports = { listAuditLogs }