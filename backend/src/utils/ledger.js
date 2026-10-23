const crypto  = require('crypto')
const prisma  = require('../lib/prisma')
const { logError } = require('./logger')
const { emitToHashChain } = require('../realtime/socket')

// ─── Which actions participate in the hash-chain ledger ───────────────────────
const FINANCIAL_LEDGER_ACTIONS = new Set([
  'PAYMENT_RECORDED',
  'PAYMENT_ARCHIVED',
  'CATEGORY_CREATED',
  'CATEGORY_ARCHIVED',
  'DISBURSEMENT_CREATED',
  'DISBURSEMENT_ARCHIVED',
  'RETURN_FUND_CREATED',
  'RETURN_FUND_ARCHIVED',
  'NEXT_SEMESTER_ACTIVATED',
  'SCHOOL_YEAR_ADVANCED',
  'CERTIFICATE_ISSUED',
  'CERTIFICATE_REVOKED',
  'MEMBERSHIP_CERTIFICATE_ISSUED',
])

const GENESIS = 'GENESIS'

// ─── Hashing ──────────────────────────────────────────────────────────────────

// Only immutable, DB-sourced fields go here — no display-name fields that
// could change when a member is renamed. This makes the payload deterministic.
function buildPayload(log) {
  return JSON.stringify({
    id:          log.id,
    action:      log.action,
    actorId:     log.actorId     ?? null,
    targetUserId:log.targetUserId ?? null,
    details:     log.details     ?? null,
    createdAt:   log.createdAt instanceof Date
                   ? log.createdAt.toISOString()
                   : log.createdAt,
  })
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function computeHash(previousHash, payload) {
  return sha256(`${previousHash}|${payload}`)
}

function safeParseDetails(raw) {
  if (!raw) return null
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
}

function peso(value) {
  const n = parseFloat(value)
  return isFinite(n) ? `₱${n.toFixed(2)}` : `₱${value}`
}

// ─── Stamp ────────────────────────────────────────────────────────────────────

// Called from writeAuditLog immediately after the row is created.
// Non-financial actions return instantly.
async function stampLedgerHash(auditLogId, action, auditLogRow) {
  if (!FINANCIAL_LEDGER_ACTIONS.has(action)) return

  try {
    const last = await prisma.auditLog.findFirst({
      where: {
        action:      { in: [...FINANCIAL_LEDGER_ACTIONS] },
        id:          { lt: auditLogId },
        hash:        { not: null },
      },
      orderBy: { id: 'desc' },
      select:  { hash: true },
    })

    const previousHash = last?.hash ?? GENESIS
    const payload      = buildPayload(auditLogRow)
    const hash         = computeHash(previousHash, payload)

    await prisma.auditLog.update({
      where: { id: auditLogId },
      data:  { hash, previousHash },
    })

    // Lightweight signal only — tells authorized officers the chain has
    // grown, so a manual re-verification may be worth running. The actual
    // verification stays a manual, on-demand action (verifyLedger below).
    emitToHashChain('ledger:new', { action, auditLogId })
  } catch (err) {
    logError('Stamp ledger hash failed', err)
  }
}

// ─── Cross-reference checks ───────────────────────────────────────────────────
// Each function receives the parsed `details` object from the AuditLog row and
// returns { ok: true } when the underlying record matches the snapshot, or
// { ok: false, reasons: string[] } describing every specific field mismatch.

const CHECKS = {

  async PAYMENT_RECORDED(details) {
    const snap = details?.snapshot
    if (!snap?.id) return { ok: true, skipped: true }

    const record = await prisma.payment.findUnique({
      where:   { id: snap.id },
      include: {
        member: {
          select: { firstName: true, middleName: true, lastName: true, suffix: true }
        }
      }
    })

    const memberName = details.memberName ?? 'Unknown member'
    const semLabel   = details.semesterLabel ?? '—'

    if (!record) {
      return {
        ok: false,
        reasons: [`Payment record for ${memberName} (${semLabel}) was deleted directly from the database.`]
      }
    }

    const reasons = []

    const loggedAmount  = parseFloat(snap.amount)
    const currentAmount = parseFloat(record.amount.toString())
    if (Math.abs(loggedAmount - currentAmount) > 0.001) {
      reasons.push(`Payment amount for ${memberName} was changed from ${peso(snap.amount)} to ${peso(record.amount)} directly in the database.`)
    }

    if (snap.memberId !== record.memberId) {
      reasons.push(`Payment was re-assigned from member ID ${snap.memberId} to member ID ${record.memberId} directly in the database.`)
    }

    if (snap.semesterId !== record.semesterId) {
      reasons.push(`Payment's receiving semester was changed (ID ${snap.semesterId} → ${record.semesterId}) directly in the database.`)
    }

    if ((snap.obligationSemesterId ?? null) !== (record.obligationSemesterId ?? null)) {
      reasons.push(`Payment's obligation semester was changed (ID ${snap.obligationSemesterId} → ${record.obligationSemesterId}) directly in the database.`)
    }

    // A PAYMENT_RECORDED log should correspond to a non-archived payment.
    // If it's now archived AND there's no matching PAYMENT_ARCHIVED audit log,
    // it was silently soft-deleted in the database.
    if (record.isArchived && !snap.isArchived) {
      const hasArchiveLog = await prisma.auditLog.findFirst({
        where: {
          action:  'PAYMENT_ARCHIVED',
          details: { contains: `"paymentId":${snap.id}` },
        }
      })
      if (!hasArchiveLog) {
        reasons.push(`Payment for ${memberName} (${semLabel}) was archived directly in the database without a corresponding audit log entry.`)
      }
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },

  async PAYMENT_ARCHIVED(details) {
    const snap = details?.snapshot
    if (!snap?.id) return { ok: true, skipped: true }

    const record = await prisma.payment.findUnique({ where: { id: snap.id } })
    const name   = details.memberName ?? `Payment #${snap.id}`
    const sem    = details.semesterLabel ?? '—'

    if (!record) {
      // Hard-deleted — this is worse than archived; it means the row is gone entirely
      return {
        ok: false,
        reasons: [`Payment for ${name} (${sem}) was permanently deleted from the database. Financial records must not be hard-deleted.`]
      }
    }

    const reasons = []
    if (!record.isArchived) {
      reasons.push(`Payment for ${name} (${sem}) was re-activated in the database (isArchived was reset to false) without a corresponding audit log entry.`)
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },

  async DISBURSEMENT_CREATED(details) {
    const snap = details?.snapshot
    if (!snap?.reference) return { ok: true, skipped: true }

    const record = await prisma.disbursement.findUnique({
      where:   { reference: snap.reference },
      include: { fundCategory: { select: { name: true } } }
    })

    if (!record) {
      return {
        ok: false,
        reasons: [`Disbursement ${snap.reference} (${peso(snap.amount)} for "${snap.titleOfActivities ?? snap.purposeOfFund}") was deleted directly from the database.`]
      }
    }

    const reasons = []

    const loggedAmt  = parseFloat(snap.amount)
    const currentAmt = parseFloat(record.amount.toString())
    if (Math.abs(loggedAmt - currentAmt) > 0.001) {
      reasons.push(`Disbursement ${snap.reference} amount was changed from ${peso(snap.amount)} to ${peso(record.amount)} directly in the database.`)
    }

    if (snap.name && snap.name !== record.name) {
      reasons.push(`Disbursement ${snap.reference} recipient was changed from "${snap.name}" to "${record.name}" directly in the database.`)
    }

    if (snap.purposeOfFund && snap.purposeOfFund !== record.purposeOfFund) {
      reasons.push(`Disbursement ${snap.reference} purpose was changed from "${snap.purposeOfFund}" to "${record.purposeOfFund}" directly in the database.`)
    }

    if (snap.titleOfActivities && snap.titleOfActivities !== record.titleOfActivities) {
      reasons.push(`Disbursement ${snap.reference} title was changed from "${snap.titleOfActivities}" to "${record.titleOfActivities}" directly in the database.`)
    }

    if (snap.fundCategoryId && snap.fundCategoryId !== record.fundCategoryId) {
      reasons.push(`Disbursement ${snap.reference} fund category was changed (ID ${snap.fundCategoryId} → ${record.fundCategoryId}) directly in the database.`)
    }

    if (snap.disbursedBy && snap.disbursedBy !== record.disbursedBy) {
      reasons.push(`Disbursement ${snap.reference} "Disbursed By" signatory was changed from "${snap.disbursedBy}" to "${record.disbursedBy}" directly in the database.`)
    }

    if (snap.approvedBy && snap.approvedBy !== record.approvedBy) {
      reasons.push(`Disbursement ${snap.reference} "Approved By" signatory was changed from "${snap.approvedBy}" to "${record.approvedBy}" directly in the database.`)
    }

    if (snap.receivedBy && snap.receivedBy !== record.receivedBy) {
      reasons.push(`Disbursement ${snap.reference} "Received By" signatory was changed from "${snap.receivedBy}" to "${record.receivedBy}" directly in the database.`)
    }

    // Disbursement is archived but no DISBURSEMENT_ARCHIVED log exists
    if (record.isArchived && !snap.isArchived) {
      const hasArchiveLog = await prisma.auditLog.findFirst({
        where: {
          action:  'DISBURSEMENT_ARCHIVED',
          details: { contains: `"reference":"${snap.reference}"` },
        }
      })
      if (!hasArchiveLog) {
        reasons.push(`Disbursement ${snap.reference} was archived directly in the database without a corresponding audit log entry.`)
      }
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },

  async DISBURSEMENT_ARCHIVED(details) {
    const snap = details?.snapshot
    if (!snap?.reference) return { ok: true, skipped: true }

    const record = await prisma.disbursement.findUnique({ where: { reference: snap.reference } })

    if (!record) {
      return {
        ok: false,
        reasons: [`Disbursement ${snap.reference} was permanently deleted from the database. Financial records must not be hard-deleted.`]
      }
    }

    const reasons = []
    if (!record.isArchived) {
      reasons.push(`Disbursement ${snap.reference} was re-activated (isArchived reset to false) in the database without a corresponding audit log entry.`)
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },

  async RETURN_FUND_CREATED(details) {
    const snap = details?.snapshot
    if (!snap?.reference) return { ok: true, skipped: true }

    const record = await prisma.returnFund.findUnique({ where: { reference: snap.reference } })

    if (!record) {
      return {
        ok: false,
        reasons: [`Return Fund ${snap.reference} (${peso(snap.amount)} from "${snap.receivedFrom ?? '—'}") was deleted directly from the database.`]
      }
    }

    const reasons = []

    const loggedAmt  = parseFloat(snap.amount)
    const currentAmt = parseFloat(record.amount.toString())
    if (Math.abs(loggedAmt - currentAmt) > 0.001) {
      reasons.push(`Return Fund ${snap.reference} amount was changed from ${peso(snap.amount)} to ${peso(record.amount)} directly in the database.`)
    }

    if (snap.receivedFrom && snap.receivedFrom !== record.receivedFrom) {
      reasons.push(`Return Fund ${snap.reference} "Received From" was changed from "${snap.receivedFrom}" to "${record.receivedFrom}" directly in the database.`)
    }

    if (snap.disbursementId && snap.disbursementId !== record.disbursementId) {
      reasons.push(`Return Fund ${snap.reference} was re-linked to a different disbursement (ID ${snap.disbursementId} → ${record.disbursementId}) directly in the database.`)
    }

    if (record.isArchived && !snap.isArchived) {
      const hasArchiveLog = await prisma.auditLog.findFirst({
        where: {
          action:  'RETURN_FUND_ARCHIVED',
          details: { contains: `"reference":"${snap.reference}"` },
        }
      })
      if (!hasArchiveLog) {
        reasons.push(`Return Fund ${snap.reference} was archived directly in the database without a corresponding audit log entry.`)
      }
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },

  async RETURN_FUND_ARCHIVED(details) {
    const snap = details?.snapshot
    if (!snap?.reference) return { ok: true, skipped: true }

    const record = await prisma.returnFund.findUnique({ where: { reference: snap.reference } })

    if (!record) {
      return {
        ok: false,
        reasons: [`Return Fund ${snap.reference} was permanently deleted from the database. Financial records must not be hard-deleted.`]
      }
    }

    const reasons = []
    if (!record.isArchived) {
      reasons.push(`Return Fund ${snap.reference} was re-activated (isArchived reset to false) in the database without a corresponding audit log entry.`)
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },

  async CATEGORY_CREATED(details) {
    if (!details?.names?.length) return { ok: true, skipped: true }

    const found = await prisma.fundCategory.count({
      where: {
        name:       { in: details.names },
        semesterId: details.semesterId ?? undefined,
      }
    })

    if (found < details.names.length) {
      const missing = details.names.length - found
      return {
        ok: false,
        reasons: [`${missing} fund categor${missing === 1 ? 'y' : 'ies'} (${details.names.join(', ')}) ${missing === 1 ? 'was' : 'were'} deleted directly from the database.`]
      }
    }
    return { ok: true }
  },

  async CATEGORY_ARCHIVED(details) {
    if (!details?.categoryId) return { ok: true, skipped: true }

    const record = await prisma.fundCategory.findUnique({ where: { id: details.categoryId } })
    if (!record) {
      return {
        ok: false,
        reasons: [`Fund category "${details.name ?? `#${details.categoryId}`}" was permanently deleted from the database.`]
      }
    }

    if (!record.isArchived) {
      return {
        ok: false,
        reasons: [`Fund category "${record.name}" was re-activated (isArchived reset to false) in the database without a corresponding audit log entry.`]
      }
    }

    return { ok: true }
  },

  async CERTIFICATE_ISSUED(details) {
    const snap = details?.snapshot
    if (!snap?.publicId) return { ok: true, skipped: true }

    const record = await prisma.certificate.findUnique({ where: { publicId: snap.publicId } })
    const label = snap.certificateNumber ?? snap.publicId

    if (!record) {
      return {
        ok: false,
        reasons: [`Certificate ${label} was deleted directly from the database.`]
      }
    }

    const reasons = []

    if (snap.certificateHash && snap.certificateHash !== record.certificateHash) {
      reasons.push(`Certificate ${label}'s stored hash was changed directly in the database — the file on record no longer matches what was issued.`)
    }

    if (snap.storagePath && snap.storagePath !== record.storagePath) {
      reasons.push(`Certificate ${label} was re-pointed to a different stored file (${snap.storagePath} → ${record.storagePath}) directly in the database.`)
    }

    if (snap.eventId !== record.eventId) {
      reasons.push(`Certificate ${label} was re-assigned from event ID ${snap.eventId} to event ID ${record.eventId} directly in the database.`)
    }

    if (record.status === 'REVOKED') {
      const hasRevokeLog = await prisma.auditLog.findFirst({
        where: {
          action:  'CERTIFICATE_REVOKED',
          details: { contains: `"publicId":"${snap.publicId}"` },
        }
      })
      if (!hasRevokeLog) {
        reasons.push(`Certificate ${label} was marked REVOKED directly in the database without a corresponding audit log entry.`)
      }
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },

  async CERTIFICATE_REVOKED(details) {
    const snap = details?.snapshot
    if (!snap?.publicId) return { ok: true, skipped: true }

    const record = await prisma.certificate.findUnique({ where: { publicId: snap.publicId } })
    const label = snap.certificateNumber ?? snap.publicId

    if (!record) {
      return {
        ok: false,
        reasons: [`Certificate ${label} was permanently deleted from the database. Certificates must not be hard-deleted.`]
      }
    }

    const reasons = []
    if (record.status !== 'REVOKED') {
      reasons.push(`Certificate ${label} was reinstated (status reset to ACTIVE) in the database without a corresponding audit log entry.`)
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },

    async MEMBERSHIP_CERTIFICATE_ISSUED(details) {
    const snap = details?.snapshot
    if (!snap?.certificateNumber) return { ok: true, skipped: true }

    const record = await prisma.membershipCertificate.findUnique({ where: { certificateNumber: snap.certificateNumber } })
    const label = snap.certificateNumber

    if (!record) {
      return {
        ok: false,
        reasons: [`Membership certificate ${label} was deleted directly from the database.`]
      }
    }

    const reasons = []

    if (snap.certificateHash && snap.certificateHash !== record.certificateHash) {
      reasons.push(`Membership certificate ${label}'s stored hash was changed directly in the database.`)
    }
    if (snap.paymentId !== record.paymentId) {
      reasons.push(`Membership certificate ${label} was re-linked to a different payment directly in the database.`)
    }
    if (snap.memberId !== record.memberId) {
      reasons.push(`Membership certificate ${label} was re-assigned to a different member directly in the database.`)
    }
    if (snap.semesterId !== record.semesterId) {
      reasons.push(`Membership certificate ${label} was re-assigned to a different semester directly in the database.`)
    }

    return reasons.length ? { ok: false, reasons } : { ok: true }
  },
}

// ─── Main verify function ─────────────────────────────────────────────────────

async function verifyLedger() {
  const financialLogs = await prisma.auditLog.findMany({
    where: {
      action: { in: [...FINANCIAL_LEDGER_ACTIONS] },
      hash:   { not: null },
    },
    orderBy: { id: 'asc' },
    include: {
      actor: {
        select: {
          role:   true,
          member: { select: { firstName: true, middleName: true, lastName: true } }
        }
      }
    }
  })

  if (financialLogs.length === 0) {
    return { status: 'INTACT', totalLinks: 0, tamperedLinks: [], links: [] }
  }

  let expectedPreviousHash = GENESIS
  const links   = []
  let hasTampered = false

  for (const log of financialLogs) {
    const payload           = buildPayload(log)
    const derivedHash       = computeHash(expectedPreviousHash, payload)
    const hashMatch         = derivedHash === log.hash
    const prevHashMatch     = log.previousHash === expectedPreviousHash

    // ── Cross-reference / snapshot check ─────────────────────────────────
    const details       = safeParseDetails(log.details)
    const checkFn       = CHECKS[log.action]
    let crossRefResult  = { ok: true, skipped: false }
    if (checkFn) {
      try { crossRefResult = await checkFn(details) } catch (e) {
        logError(`Cross-ref check failed for ${log.action} #${log.id}`, e)
      }
    }

    const intact = hashMatch && prevHashMatch && (crossRefResult.ok || crossRefResult.skipped)
    if (!intact) hasTampered = true

    // Build the list of human-readable reasons for display
    const reasons = []
    if (!hashMatch) {
      reasons.push('The audit log entry itself was altered directly in the database (hash mismatch).')
    }
    if (!prevHashMatch) {
      reasons.push('The chain link is broken — a preceding financial record was deleted or modified.')
    }
    if (!crossRefResult.ok && !crossRefResult.skipped && crossRefResult.reasons?.length) {
      reasons.push(...crossRefResult.reasons)
    }

    const actorMember = log.actor?.member
    const actorName = actorMember
      ? [actorMember.firstName, actorMember.middleName, actorMember.lastName].filter(Boolean).join(' ')
      : 'System'

    links.push({
      id:             log.id,
      action:         log.action,
      actorName,
      actorRole:      log.actor?.role ?? null,
      createdAt:      log.createdAt,
      storedHash:     log.hash,
      storedPrevHash: log.previousHash,
      derivedHash,
      status:         intact ? 'VERIFIED' : 'TAMPERED',
      hashMatch,
      prevHashMatch,
      crossRefOk:     crossRefResult.ok || crossRefResult.skipped,
      reasons,        // always present — empty array when VERIFIED
    })

    // Always advance with the DERIVED hash so a broken link doesn't
    // cascade false positives to every subsequent record
    expectedPreviousHash = derivedHash
  }

  return {
    status:        hasTampered ? 'TAMPERED' : 'INTACT',
    totalLinks:    links.length,
    tamperedLinks: links.filter(l => l.status === 'TAMPERED'),
    links,
  }
}

module.exports = {
  stampLedgerHash,
  verifyLedger,
  FINANCIAL_LEDGER_ACTIONS,
  GENESIS,
  buildPayload,
  computeHash,
  sha256,
}