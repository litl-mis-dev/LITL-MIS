const prisma = require('../lib/prisma')
const { logError } = require('./logger')
const { stampLedgerHash, FINANCIAL_LEDGER_ACTIONS, GENESIS, buildPayload, computeHash } = require('./ledger')
const { emitToHashChain } = require('../realtime/socket')

const LEDGER_LOCK_NAME = 'litl_mis_ledger_chain'
const LEDGER_LOCK_TIMEOUT_SECONDS = 10

const writeLedgerAuditLog = async (data) => {
  const log = await prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw`SELECT GET_LOCK(${LEDGER_LOCK_NAME}, ${LEDGER_LOCK_TIMEOUT_SECONDS}) AS got`
    if (Number(lock?.got) !== 1) throw new Error('Could not acquire ledger lock')

    try {
      const created = await tx.auditLog.create({ data })

      const last = await tx.auditLog.findFirst({
        where: { action: { in: [...FINANCIAL_LEDGER_ACTIONS] }, id: { lt: created.id }, hash: { not: null } },
        orderBy: { id: 'desc' },
        select: { hash: true },
      })

      const previousHash = last?.hash ?? GENESIS
      const hash = computeHash(previousHash, buildPayload(created))
      await tx.auditLog.update({ where: { id: created.id }, data: { hash, previousHash } })

      return { ...created, hash, previousHash }
    } finally {
      await tx.$queryRaw`SELECT RELEASE_LOCK(${LEDGER_LOCK_NAME})`
    }
  }, { isolationLevel: 'ReadCommitted', maxWait: 15000, timeout: 20000 })

  emitToHashChain('ledger:new', { action: log.action, auditLogId: log.id })
  return log
}

const writeAuditLog = async ({
  actorId = null,
  targetUserId = null,
  action,
  details = null
}) => {
  const data = {
    actorId,
    targetUserId,
    action,
    details: details
      ? (typeof details === 'string' ? details : JSON.stringify(details))
      : null
  }

  if (FINANCIAL_LEDGER_ACTIONS.has(action)) {
    try {
      return await writeLedgerAuditLog(data)
    } catch (err) {
      logError('Atomic ledger write failed, falling back', err)
    }
  }

  try {
    const log = await prisma.auditLog.create({ data })

    // Fire-and-forget — hash stamping must never block the caller
    stampLedgerHash(log.id, action, log)

    return log
  } catch (err) {
    logError('Write audit log failed', err)
  }
}

module.exports = { writeAuditLog }