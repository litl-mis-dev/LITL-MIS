const crypto = require('crypto')
const bcrypt = require('bcrypt')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { sendAdviserInviteEmail } = require('../utils/email')
const { disconnectUser } = require('../realtime/socket')
const { ADVISER_ROLE, ADVISER_TITLE_LABELS, ADVISER_SEAT_LIMITS } = require('../utils/roles')
const { isValidEmail, isCvsuEmail, isValidName, isValidPassword, isValidSex } = require('../utils/validators')

// Advisers and the Department Chair join by invitation from the President —
// never through the public student registration form. Seats are limited per
// title (ADVISER_SEAT_LIMITS): active advisers plus pending invites count, and
// every step that takes or changes a seat runs under one database lock so two
// requests can never both take the last seat.

const INVITE_TTL_MS = 48 * 60 * 60 * 1000
const SEAT_LOCK = 'litl_mis_adviser_seats'
const SUFFIX_REGEX = /^[A-Za-z.]{1,10}$/

const httpError = (status, message) => Object.assign(new Error(message), { status })
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const newToken = () => crypto.randomBytes(32).toString('base64url')
const inviteLink = (token) => `${(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/adviser-invite#token=${token}`
const titleLabel = (title) => ADVISER_TITLE_LABELS[title] ?? title
const fullName = (p) => [p.firstName, p.lastName, p.suffix].filter(Boolean).join(' ')
const isPending = (invite, now = new Date()) => !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > now

// Active advisers with this title + unexpired, unanswered invites for it.
async function seatsUsed(db, title) {
  const [active, pending] = await Promise.all([
    db.user.count({ where: { role: ADVISER_ROLE, status: 'APPROVED', adviserTitle: title } }),
    db.adviserInvite.count({ where: { title, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ])
  return active + pending
}

async function assertSeatFree(db, title) {
  const used = await seatsUsed(db, title)
  if (used >= ADVISER_SEAT_LIMITS[title]) {
    throw httpError(409, `All ${titleLabel(title)} seats are taken (${used}/${ADVISER_SEAT_LIMITS[title]}). Revoke an invite or deactivate someone first.`)
  }
}

// Runs fn(tx) holding a MySQL named lock, so seat checks and the writes that
// depend on them can't interleave between requests.
function withSeatLock(fn) {
  return prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw`SELECT GET_LOCK(${SEAT_LOCK}, 10) AS got`
    if (Number(lock?.got) !== 1) throw httpError(503, 'The system is busy. Please try again.')
    try {
      return await fn(tx)
    } finally {
      await tx.$queryRaw`SELECT RELEASE_LOCK(${SEAT_LOCK})`
    }
  }, { maxWait: 15000, timeout: 20000 })
}

const sendError = (res, err, label) => {
  if (err.status) return res.status(err.status).json({ message: err.message })
  logError(label, err)
  return res.status(500).json({ message: 'Something went wrong. Please try again.' })
}

function parseTitle(value) {
  if (!Object.hasOwn(ADVISER_SEAT_LIMITS, value)) throw httpError(400, 'Choose Adviser or Department Chair.')
  return value
}

function parseNames(body) {
  const { firstName, lastName, suffix } = body ?? {}
  if (!isValidName(firstName)) throw httpError(400, 'Enter a valid first name.')
  if (!isValidName(lastName)) throw httpError(400, 'Enter a valid last name.')
  if (suffix !== undefined && suffix !== null && suffix !== '' && !(typeof suffix === 'string' && SUFFIX_REGEX.test(suffix.trim()))) {
    throw httpError(400, 'Enter a valid suffix (e.g. Jr., III).')
  }
  return {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    suffix: typeof suffix === 'string' && suffix.trim() ? suffix.trim() : null,
  }
}

const formatInvite = (invite, now = new Date()) => ({
  id: invite.id,
  email: invite.email,
  name: fullName(invite),
  title: invite.title,
  titleLabel: titleLabel(invite.title),
  expiresAt: invite.expiresAt,
  isExpired: invite.expiresAt <= now,
  createdAt: invite.createdAt,
})

const formatAdviser = (user) => ({
  userId: user.id,
  email: user.email,
  name: user.member ? fullName(user.member) : user.email,
  title: user.adviserTitle,
  titleLabel: titleLabel(user.adviserTitle),
  status: user.status,
  updatedAt: user.updatedAt,
})

// ── President: overview ───────────────────────────────────────────────────────

// GET /api/advisers
const listAdvisers = async (req, res) => {
  try {
    const now = new Date()
    const select = {
      id: true, email: true, status: true, adviserTitle: true, updatedAt: true,
      member: { select: { firstName: true, lastName: true, suffix: true } },
    }
    const [active, past, openInvites] = await Promise.all([
      prisma.user.findMany({ where: { role: ADVISER_ROLE, status: 'APPROVED' }, select, orderBy: { createdAt: 'asc' } }),
      prisma.user.findMany({ where: { role: ADVISER_ROLE, status: 'DEACTIVATED' }, select, orderBy: { updatedAt: 'desc' } }),
      prisma.adviserInvite.findMany({ where: { acceptedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' } }),
    ])

    const seats = {}
    for (const title of Object.keys(ADVISER_SEAT_LIMITS)) {
      seats[title] = {
        label: titleLabel(title),
        limit: ADVISER_SEAT_LIMITS[title],
        used: active.filter((u) => u.adviserTitle === title).length +
          openInvites.filter((i) => i.title === title && isPending(i, now)).length,
      }
    }

    return res.json({
      seats,
      active: active.map(formatAdviser),
      invites: openInvites.map((i) => formatInvite(i, now)),
      past: past.map(formatAdviser),
    })
  } catch (err) {
    return sendError(res, err, 'List advisers')
  }
}

// ── President: invitations ────────────────────────────────────────────────────

async function emailInvite(invite, token) {
  await sendAdviserInviteEmail({
    toEmail: invite.email,
    firstName: invite.firstName,
    titleLabel: titleLabel(invite.title),
    link: inviteLink(token),
    expiresAt: invite.expiresAt,
  })
}

// POST /api/advisers/invites  { firstName, lastName, suffix, email, title }
const createInvite = async (req, res) => {
  try {
    const names = parseNames(req.body)
    const title = parseTitle(req.body?.title)
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address.')

    const token = newToken()
    const invite = await withSeatLock(async (tx) => {
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
        throw httpError(409, 'This email already has an account.')
      }
      const existing = await tx.adviserInvite.findFirst({
        where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      })
      if (existing) throw httpError(409, 'This email already has a pending invitation. Resend or revoke it instead.')
      await assertSeatFree(tx, title)

      return tx.adviserInvite.create({
        data: {
          ...names, email, title,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedById: req.user.id,
        },
      })
    })

    try {
      await emailInvite(invite, token)
    } catch (mailErr) {
      // Without the email nobody can use the invite — release its seat.
      await prisma.adviserInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } }).catch(() => {})
      logError('Send adviser invite email', mailErr)
      return res.status(502).json({ message: 'The invitation email could not be sent. Please try again.' })
    }

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ADVISER_INVITED,
      details: { inviteId: invite.id, email, name: fullName(invite), title: titleLabel(title) },
    })

    return res.status(201).json({ message: `Invitation sent to ${email}.`, invite: formatInvite(invite) })
  } catch (err) {
    return sendError(res, err, 'Create adviser invite')
  }
}

// POST /api/advisers/invites/:id/resend — new link, the old one stops working.
const resendInvite = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const token = newToken()
    const invite = await withSeatLock(async (tx) => {
      const current = await tx.adviserInvite.findUnique({ where: { id } })
      if (!current || current.acceptedAt || current.revokedAt) throw httpError(404, 'Invitation not found.')
      // An expired invite no longer holds a seat, so it needs a free one again.
      if (current.expiresAt <= new Date()) await assertSeatFree(tx, current.title)
      if (await tx.user.findUnique({ where: { email: current.email }, select: { id: true } })) {
        throw httpError(409, 'This email already has an account.')
      }
      return tx.adviserInvite.update({
        where: { id },
        data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      })
    })

    try {
      await emailInvite(invite, token)
    } catch (mailErr) {
      logError('Resend adviser invite email', mailErr)
      return res.status(502).json({ message: 'The invitation email could not be sent. Please try again.' })
    }

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ADVISER_INVITE_RESENT,
      details: { inviteId: id, email: invite.email, title: titleLabel(invite.title) },
    })
    return res.json({ message: `A new invitation was sent to ${invite.email}.`, invite: formatInvite(invite) })
  } catch (err) {
    return sendError(res, err, 'Resend adviser invite')
  }
}

// POST /api/advisers/invites/:id/revoke
const revokeInvite = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const invite = await prisma.adviserInvite.findUnique({ where: { id } })
    if (!invite || invite.acceptedAt || invite.revokedAt) throw httpError(404, 'Invitation not found.')

    await prisma.adviserInvite.update({ where: { id }, data: { revokedAt: new Date() } })
    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.ADVISER_INVITE_REVOKED,
      details: { inviteId: id, email: invite.email, title: titleLabel(invite.title) },
    })
    return res.json({ message: 'Invitation revoked.' })
  } catch (err) {
    return sendError(res, err, 'Revoke adviser invite')
  }
}

// ── Public: the invited person ───────────────────────────────────────────────

const INVALID_LINK = 'This invitation link is invalid or has expired. Ask the President to send a new one.'

async function findUsableInvite(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw httpError(400, INVALID_LINK)
  const invite = await db.adviserInvite.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!invite || !isPending(invite)) throw httpError(410, INVALID_LINK)
  return invite
}

// POST /api/advisers/invites/lookup  { token } — prefills the accept page.
const lookupInvite = async (req, res) => {
  try {
    const invite = await findUsableInvite(prisma, req.body?.token)
    return res.json({
      invite: {
        email: invite.email,
        firstName: invite.firstName,
        lastName: invite.lastName,
        suffix: invite.suffix,
        title: invite.title,
        titleLabel: titleLabel(invite.title),
        expiresAt: invite.expiresAt,
      },
    })
  } catch (err) {
    return sendError(res, err, 'Look up adviser invite')
  }
}

// POST /api/advisers/invites/accept
// { token, firstName, lastName, suffix, sex, password, confirmPassword }
const acceptInvite = async (req, res) => {
  try {
    const { token, sex, password, confirmPassword } = req.body ?? {}
    const names = parseNames(req.body)
    if (!isValidSex(sex)) throw httpError(400, 'Choose your sex.')
    if (!isValidPassword(password)) {
      throw httpError(400, 'Password must be at least 8 characters and contain an uppercase letter, lowercase letter, number, and special character.')
    }
    if (password !== confirmPassword) throw httpError(400, 'Passwords do not match.')

    // Hash before taking the lock — bcrypt is deliberately slow.
    const passwordHash = await bcrypt.hash(password, 12)

    const user = await withSeatLock(async (tx) => {
      const invite = await findUsableInvite(tx, token)
      if (await tx.user.findUnique({ where: { email: invite.email }, select: { id: true } })) {
        throw httpError(409, 'This email already has an account. Ask the President for help.')
      }
      // The invite itself holds a seat; only active advisers can push it over.
      const active = await tx.user.count({ where: { role: ADVISER_ROLE, status: 'APPROVED', adviserTitle: invite.title } })
      if (active >= ADVISER_SEAT_LIMITS[invite.title]) {
        throw httpError(409, `All ${titleLabel(invite.title)} seats are already filled. Ask the President for help.`)
      }

      const created = await tx.user.create({
        data: {
          email: invite.email,
          emailType: isCvsuEmail(invite.email) ? 'CVSU' : 'PERSONAL',
          password: passwordHash,
          role: ADVISER_ROLE,
          status: 'APPROVED',
          adviserTitle: invite.title,
          member: { create: { ...names, sex } },
        },
      })
      await tx.adviserInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedUserId: created.id },
      })
      return { ...created, invite }
    })

    await writeAuditLog({
      actorId: user.id,
      targetUserId: user.id,
      action: AUDIT_ACTIONS.ADVISER_JOINED,
      details: { inviteId: user.invite.id, name: fullName(names), title: titleLabel(user.adviserTitle) },
    })

    return res.status(201).json({ message: 'Your account is ready. Sign in with your email and new password.' })
  } catch (err) {
    return sendError(res, err, 'Accept adviser invite')
  }
}

// ── President: managing advisers ─────────────────────────────────────────────

async function loadAdviser(db, userId) {
  const user = await db.user.findUnique({
    where: { id: Number(userId) },
    select: {
      id: true, email: true, role: true, status: true, adviserTitle: true,
      member: { select: { firstName: true, lastName: true, suffix: true } },
    },
  })
  if (!user || user.role !== ADVISER_ROLE) throw httpError(404, 'Adviser not found.')
  return user
}

// POST /api/advisers/:userId/deactivate — blocks login, ends every session,
// frees the seat. Their history (logs, documents, approvals) stays.
const deactivateAdviser = async (req, res) => {
  try {
    const user = await loadAdviser(prisma, req.params.userId)
    if (user.status !== 'APPROVED') throw httpError(400, 'This adviser is not active.')

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED', tokenVersion: { increment: 1 } } }),
      prisma.pushSubscription.deleteMany({ where: { userId: user.id } }),
    ])
    disconnectUser(user.id)

    await writeAuditLog({
      actorId: req.user.id,
      targetUserId: user.id,
      action: AUDIT_ACTIONS.ADVISER_DEACTIVATED,
      details: { name: user.member ? fullName(user.member) : user.email, title: titleLabel(user.adviserTitle) },
    })
    return res.json({ message: 'Adviser deactivated. They have been signed out everywhere.' })
  } catch (err) {
    return sendError(res, err, 'Deactivate adviser')
  }
}

// POST /api/advisers/:userId/reactivate — only if a seat for their title is free.
const reactivateAdviser = async (req, res) => {
  try {
    const user = await withSeatLock(async (tx) => {
      const adviser = await loadAdviser(tx, req.params.userId)
      if (adviser.status !== 'DEACTIVATED') throw httpError(400, 'This adviser is not deactivated.')
      await assertSeatFree(tx, adviser.adviserTitle)
      await tx.user.update({ where: { id: adviser.id }, data: { status: 'APPROVED' } })
      return adviser
    })

    await writeAuditLog({
      actorId: req.user.id,
      targetUserId: user.id,
      action: AUDIT_ACTIONS.ADVISER_REACTIVATED,
      details: { name: user.member ? fullName(user.member) : user.email, title: titleLabel(user.adviserTitle) },
    })
    return res.json({ message: 'Adviser reactivated. They can sign in again.' })
  } catch (err) {
    return sendError(res, err, 'Reactivate adviser')
  }
}

// PATCH /api/advisers/:userId/title  { title } — only into a free seat.
const changeAdviserTitle = async (req, res) => {
  try {
    const title = parseTitle(req.body?.title)
    const user = await withSeatLock(async (tx) => {
      const adviser = await loadAdviser(tx, req.params.userId)
      if (adviser.status !== 'APPROVED') throw httpError(400, 'Only active advisers can change title.')
      if (adviser.adviserTitle === title) throw httpError(400, `They are already ${titleLabel(title)}.`)
      await assertSeatFree(tx, title)
      await tx.user.update({ where: { id: adviser.id }, data: { adviserTitle: title } })
      return adviser
    })

    await writeAuditLog({
      actorId: req.user.id,
      targetUserId: user.id,
      action: AUDIT_ACTIONS.ADVISER_TITLE_CHANGED,
      details: {
        name: user.member ? fullName(user.member) : user.email,
        from: titleLabel(user.adviserTitle),
        to: titleLabel(title),
      },
    })
    return res.json({ message: `Title changed to ${titleLabel(title)}.` })
  } catch (err) {
    return sendError(res, err, 'Change adviser title')
  }
}

module.exports = {
  listAdvisers, createInvite, resendInvite, revokeInvite,
  lookupInvite, acceptInvite,
  deactivateAdviser, reactivateAdviser, changeAdviserTitle,
  INVITE_TTL_MS, hashToken,
}
