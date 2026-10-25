const bcrypt = require('bcrypt')
const { generateOtp, hashOtp, compareOtp } = require('../utils/otp')
const { generateVerificationToken } = require('../utils/token')
const { sendOtpEmail } = require('../utils/email')
const { signAuthToken, verifyAuthToken, signResetToken, verifyResetToken } = require('../utils/jwt')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')  
const { generateMemberQrCode } = require('../utils/memberQr')
const { isNonMemberRole, DEVELOPER_ROLE } = require('../utils/roles')
const storageService = require('../services/storage.service')
const {
  PENDING_REG_COOKIE,
  setPendingRegCookie,
  clearPendingRegCookie,
  getPendingRegToken,
  maskEmail
} = require('../utils/pendingRegistrationCookie')
const { syncMemberApprovalNotifications } = require('../services/notification.service')

const {
  isValidStudentNumber,
  isValidEmail,
  isCvsuEmail,
  isValidPassword,
  isValidSex,
  isValidName,
  isValidSection,
  isValidYearLevel
} = require('../utils/validators')

const prisma = require('../lib/prisma')

const OTP_EXPIRY_MINUTES = 10
const MAX_OTP_ATTEMPTS = 5
const OTP_RESEND_COOLDOWN_SECONDS = 60
const LOGIN_LOCKOUT_MINUTES = 15

// Password-reset codes are capped per ACCOUNT, not just per IP (the route
// limiters). Without this, requests spread over many IPs could flood a
// victim's inbox and get 5 fresh guesses with every new code.
const RESET_OTP_WINDOW_MS = 60 * 60 * 1000
const RESET_OTP_MAX_PER_WINDOW = 5
const RESET_OTP_MAX_FAILED_PER_WINDOW = 10

// Failed logins pause sign-in for one (account, IP) pair after
// LOGIN_PAIR_LOCK_THRESHOLD attempts, so a stranger guessing at someone's
// account cannot lock the real owner out from their own device. The whole
// account is only locked after LOGIN_ACCOUNT_LOCK_THRESHOLD failures in a row
// (from any IP), which still stops distributed password guessing.
const LOGIN_PAIR_LOCK_THRESHOLD = 5
const LOGIN_ACCOUNT_LOCK_THRESHOLD = 20
const INVALID_LOGIN_MESSAGE = `Invalid credentials. After ${LOGIN_PAIR_LOCK_THRESHOLD} failed attempts, sign-in is paused for ${LOGIN_LOCKOUT_MINUTES} minutes.`

// In-memory, like the route rate limiters: resets on restart and is per
// process. The account-wide lock in the database is the durable backstop.
const failedLoginsByPair = new Map() // `${userId}:${ip}` -> { count, firstAt, lockedUntil }
const MAX_TRACKED_LOGIN_PAIRS = 5000

function getLoginPair(key, now) {
  const entry = failedLoginsByPair.get(key)
  if (!entry) return null
  const windowOver = now - entry.firstAt > LOGIN_LOCKOUT_MINUTES * 60 * 1000
  if (windowOver && entry.lockedUntil <= now) {
    failedLoginsByPair.delete(key)
    return null
  }
  return entry
}

function recordFailedLoginPair(key, now) {
  if (failedLoginsByPair.size >= MAX_TRACKED_LOGIN_PAIRS) {
    for (const k of failedLoginsByPair.keys()) getLoginPair(k, now) // drops expired entries
  }
  const entry = getLoginPair(key, now) ?? { count: 0, firstAt: now, lockedUntil: 0 }
  entry.count += 1
  if (entry.count >= LOGIN_PAIR_LOCK_THRESHOLD) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MINUTES * 60 * 1000
  }
  failedLoginsByPair.set(key, entry)
  return entry
}

async function getResetOtpUsage(userId) {
  const recent = await prisma.otp.findMany({
    where: {
      userId,
      purpose: 'PASSWORD_RESET',
      createdAt: { gte: new Date(Date.now() - RESET_OTP_WINDOW_MS) }
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, attempts: true }
  })
  return {
    sentInWindow: recent.length,
    failedInWindow: recent.reduce((sum, otp) => sum + otp.attempts, 0),
    secondsSinceLastSend: recent[0]
      ? (Date.now() - recent[0].createdAt.getTime()) / 1000
      : Infinity
  }
}

// Issues and emails a new password-reset code unless this account is in its
// cooldown or over its hourly caps. Returns false (and sends nothing) when
// refused — callers answer with the same generic message either way.
async function issueResetOtp(user) {
  const usage = await getResetOtpUsage(user.id)
  if (
    usage.secondsSinceLastSend < OTP_RESEND_COOLDOWN_SECONDS ||
    usage.sentInWindow >= RESET_OTP_MAX_PER_WINDOW ||
    usage.failedInWindow >= RESET_OTP_MAX_FAILED_PER_WINDOW
  ) {
    return false
  }

  // Only the newest code may ever be used.
  await prisma.otp.updateMany({
    where: { userId: user.id, purpose: 'PASSWORD_RESET', used: false },
    data: { used: true }
  })

  const otp = generateOtp()
  await prisma.otp.create({
    data: {
      userId: user.id,
      codeHash: await hashOtp(otp),
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
    }
  })

  await sendOtpEmail(user.email, otp, 'PASSWORD_RESET')
  return true
}

// Identifies the caller from the auth cookie without failing — used where
// authMiddleware can't run (logout must clear even a stale cookie).
async function getUserFromAuthCookie(req) {
  const token = req.cookies?.['LITL-MIS']
  if (!token) return null
  try {
    const decoded = verifyAuthToken(token)
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, role: true, tokenVersion: true }
    })
    return user && user.tokenVersion === decoded.tokenVersion ? user : null
  } catch {
    return null
  }
}

const AUTH_USER_PROFILE_SELECT = {
  id: true,
  studentNumber: true,
  email: true,
  emailType: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
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
      avatar: true,
      status: true,
      qrCode: true
    }
  }
}

const AUTH_USER_LOGIN_SELECT = {
  ...AUTH_USER_PROFILE_SELECT,
  password: true,
  failedLoginAttempts: true,
  lockedUntil: true,
  tokenVersion: true
}

function buildAuthUser(user) {
  if (!user) return null

  const {
    password,
    failedLoginAttempts,
    lockedUntil,
    tokenVersion,
    developerName,
    ...publicUser
  } = user

  // An Adviser is not a member: the Member row only holds profile details,
  // so membership-only fields (status, QR code) are never exposed for them.
  const isAdviser = isNonMemberRole(user.role)
  const { status: _memberStatus, qrCode: _memberQrCode, ...adviserSafeMember } = user.member ?? {}
  const m = user.member && (isAdviser ? adviserSafeMember : user.member)
  const name = m
    ? [m.firstName, m.middleName, m.lastName, m.suffix].filter(Boolean).join(' ')
    : developerName ?? null

  return {
    ...publicUser,
    member: m
      ? {
          ...m,
          studentNumber: user.studentNumber,
          email: user.email,
          emailType: user.emailType
        }
      : null,
    memberId: m?.id ?? null,
    name,
    firstName: m?.firstName ?? null,
    middleName: m?.middleName ?? null,
    lastName: m?.lastName ?? null,
    suffix: m?.suffix ?? null,
    sex: m?.sex ?? null,
    yearLevel: m?.yearLevel ?? null,
    section: m?.section ?? null,
    avatar: m?.avatar ?? null,
    memberStatus: isAdviser ? null : (m?.status ?? null),
    qrCode: isAdviser ? null : (m?.qrCode ?? null)
  }
}

async function ensureAuthUserQrCode(user) {
  if (!user?.member) return user
  // Advisers are not members — they get no member QR code.
  if (isNonMemberRole(user.role)) return user

  const qrCode = await generateMemberQrCode({
    ...user.member,
    studentNumber: user.studentNumber
  })

  if (user.member.qrCode !== qrCode) {
    await prisma.member.update({
      where: { id: user.member.id },
      data: { qrCode }
    })
  }

  user.member.qrCode = qrCode
  return user
}

// ---------------------------------------------
// REGISTER
// Data is NOT saved to User/Member yet.
// It is held in PendingRegistration until the OTP is verified.
// Returns a random `verificationToken` to the frontend — never the DB id.
// ---------------------------------------------
const register = async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      suffix,
      sex,
      studentNumber,
      yearLevel,
      section,
      hasCvsuEmail,
      email,
      password,
      confirmPassword
    } = req.body

    // --- Validation ---
    // middleName and suffix are intentionally excluded — not every student has one
    if (!firstName || !lastName || !sex || !studentNumber || !yearLevel || !section || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: 'All fields are required' })
    }

    if (!isValidName(firstName)) {
      return res.status(400).json({ message: 'Invalid first name' })
    }

    if (!isValidName(lastName)) {
      return res.status(400).json({ message: 'Invalid last name' })
    }

    if (middleName && !isValidName(middleName)) {
      return res.status(400).json({ message: 'Invalid middle name' })
    }

    if (!isValidSex(sex)) {
      return res.status(400).json({ message: 'Invalid sex value' })
    }

    if (!isValidYearLevel(yearLevel)) {
      return res.status(400).json({ message: 'Invalid year level' })
    }

    if (!isValidSection(section)) {
      return res.status(400).json({ message: 'Invalid section' })
    }


    if (!isValidStudentNumber(studentNumber.trim())) {
      return res.status(400).json({ message: 'Invalid student number format. Expected format: YYYY-NNN-N' })
    }

    if (hasCvsuEmail) {
      if (!isCvsuEmail(email.trim().toLowerCase())) {
        return res.status(400).json({ message: 'Email must end with @cvsu.edu.ph' })
      }
    } else {
      if (!isValidEmail(email.trim().toLowerCase())) {
        return res.status(400).json({ message: 'Please enter a valid email address' })
      }
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and contain an uppercase letter, lowercase letter, number, and special character' })
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedStudentNumber = studentNumber.trim()

    // --- Duplicate checks against REAL users ---
    // A REJECTED account does not block a new application: the student may re-apply,
    // and the old rejected record is reused once they verify their email.
    const existingUserEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existingUserEmail && existingUserEmail.status !== 'REJECTED') {
      return res.status(400).json({ message: 'Email is already registered' })
    }

    const existingUserStudentNumber = await prisma.user.findUnique({ where: { studentNumber: normalizedStudentNumber } })
    if (existingUserStudentNumber && existingUserStudentNumber.status !== 'REJECTED') {
      return res.status(400).json({ message: 'Student number is already registered' })
    }

    // The email and student number must not point to two DIFFERENT rejected accounts.
    if (existingUserEmail && existingUserStudentNumber && existingUserEmail.id !== existingUserStudentNumber.id) {
      return res.status(400).json({ message: 'This email and student number belong to different previous applications. Please contact an officer.' })
    }

    // --- Duplicate checks against PENDING registrations ---
    // Lazy cleanup: if a pending row exists but its OTP has already expired,
    // treat it as abandoned and remove it instead of blocking the new attempt.
    const existingPendingEmail = await prisma.pendingRegistration.findUnique({ where: { email: normalizedEmail } })
    if (existingPendingEmail) {
      const isExpired = existingPendingEmail.otpExpiresAt < new Date()
      if (isExpired) {
        await prisma.pendingRegistration.delete({ where: { id: existingPendingEmail.id } })
      } else {
        return res.status(400).json({ message: 'A verification is already in progress for this email. Please check your inbox or wait for it to expire.' })
      }
    }

    const existingPendingStudentNumber = await prisma.pendingRegistration.findUnique({ where: { studentNumber: normalizedStudentNumber } })
    if (existingPendingStudentNumber) {
      const isExpired = existingPendingStudentNumber.otpExpiresAt < new Date()
      if (isExpired) {
        await prisma.pendingRegistration.delete({ where: { id: existingPendingStudentNumber.id } })
      } else {
        return res.status(400).json({ message: 'A verification is already in progress for this student number.' })
      }
    }

    // --- Hash password and OTP, generate random token, store everything ---
    const hashedPassword = await bcrypt.hash(password, 12)
    const otp = generateOtp()
    const otpHash = await hashOtp(otp)
    const verificationToken = generateVerificationToken()

    const createdPending = await prisma.pendingRegistration.create({
      data: {
        token: verificationToken,
        firstName: firstName.trim(),
        middleName: middleName ? middleName.trim() : null,
        lastName: lastName.trim(),
        suffix: suffix ? suffix.trim() : null,
        sex,
        studentNumber: normalizedStudentNumber,
        yearLevel,
        section: section.trim(),
        email: normalizedEmail,
        emailType: hasCvsuEmail ? 'CVSU' : 'PERSONAL',
        password: hashedPassword,
        otpCodeHash: otpHash,
        otpExpiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        lastOtpSentAt: new Date()
      }
    })

    // If the code can't be sent, remove the pending row so the same email and
    // student number aren't blocked as "already in progress" until it expires.
    try {
      await sendOtpEmail(normalizedEmail, otp, 'EMAIL_VERIFICATION')
    } catch (mailErr) {
      await prisma.pendingRegistration.delete({ where: { id: createdPending.id } }).catch(() => {})
      throw mailErr
    }

    // Remember this verification so the user can resume it after a refresh / reopen.
    setPendingRegCookie(res, verificationToken, createdPending.otpExpiresAt)

    await writeAuditLog({
      action: AUDIT_ACTIONS.USER_REGISTERED,
      details: { email: normalizedEmail, studentNumber: normalizedStudentNumber }
    })

    return res.status(201).json({
      message: 'Verification code sent. Please check your email.',
      verificationToken
    })
  } catch (err) {
    logError('Register failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// The very first account on an empty system becomes the Developer: approved
// straight away (there is no President yet to approve it) and given no Member
// row, so it never shows up in member or officer lists and counts. Returns
// null when this isn't the first account — including when a simultaneous
// registration already claimed the single DeveloperAccount row (id = 1).
async function createDeveloperIfFirstUser(pending) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (await tx.user.count() > 0) return null

      const user = await tx.user.create({
        data: {
          studentNumber: pending.studentNumber,
          email: pending.email,
          emailType: pending.emailType,
          password: pending.password,
          role: DEVELOPER_ROLE,
          status: 'APPROVED'
        }
      })
      const displayName = [pending.firstName, pending.middleName, pending.lastName, pending.suffix]
        .filter(Boolean).join(' ')
      await tx.developerAccount.create({ data: { id: 1, userId: user.id, displayName } })
      await tx.pendingRegistration.delete({ where: { id: pending.id } })
      return user
    })
  } catch (err) {
    if (err.code === 'P2002') return null // lost the race — register as a normal applicant
    throw err
  }
}

// Display name for the Developer, who has no Member row to take it from.
async function attachDeveloperName(user) {
  if (user?.role !== DEVELOPER_ROLE) return user
  const account = await prisma.developerAccount.findUnique({
    where: { userId: user.id },
    select: { displayName: true }
  })
  user.developerName = account?.displayName ?? null
  return user
}

// ---------------------------------------------
// VERIFY EMAIL OTP
// Looked up by random `verificationToken`, never by sequential id.
// Account creation + pending deletion happen inside one transaction.
// ---------------------------------------------
const verifyEmailOtp = async (req, res) => {
  try {
    const { otp } = req.body
    const verificationToken = getPendingRegToken(req)

    if (!verificationToken || !otp) {
      return res.status(400).json({ message: 'Verification token and OTP are required' })
    }

    const pending = await prisma.pendingRegistration.findUnique({
      where: { token: verificationToken }
    })

    if (!pending) {
      clearPendingRegCookie(res)
      return res.status(400).json({ message: 'No pending registration found. Please register again.' })
    }

    if (pending.otpExpiresAt < new Date()) {
      await prisma.pendingRegistration.delete({ where: { id: pending.id } }).catch(() => {})
      clearPendingRegCookie(res)
      return res.status(400).json({ message: 'Code has expired. Please register again.' })
    }

    if (pending.otpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(400).json({ message: 'Too many incorrect attempts. Please request a new code.' })
    }

    const isMatch = await compareOtp(otp, pending.otpCodeHash)

    if (!isMatch) {
      await prisma.pendingRegistration.update({
        where: { id: pending.id },
        data: { otpAttempts: pending.otpAttempts + 1 }
      })
      return res.status(400).json({ message: 'Incorrect code. Please try again.' })
    }

    const existingUserEmail = await prisma.user.findUnique({ where: { email: pending.email } })
    const existingUserStudentNumber = await prisma.user.findUnique({ where: { studentNumber: pending.studentNumber } })

    // Only REJECTED accounts may be re-applied over; anything else is a real conflict.
    const conflicts = [existingUserEmail, existingUserStudentNumber].filter(Boolean)
    const hasBlockingUser = conflicts.some((u) => u.status !== 'REJECTED')
    const rejectedIds = [...new Set(conflicts.map((u) => u.id))]

    if (hasBlockingUser || rejectedIds.length > 1) {
      await prisma.pendingRegistration.delete({ where: { id: pending.id } }).catch(() => {})
      clearPendingRegCookie(res)
      return res.status(400).json({ message: 'This email or student number was just registered. Please register again.' })
    }

    // If the student was rejected before, re-use that account instead of creating a new one.
    const rejectedUserId = rejectedIds[0] ?? null

    if (!rejectedUserId) {
      const developer = await createDeveloperIfFirstUser(pending)
      if (developer) {
        clearPendingRegCookie(res)
        await writeAuditLog({
          action: AUDIT_ACTIONS.EMAIL_VERIFIED,
          targetUserId: developer.id,
          details: { developerAccount: true }
        })
        return res.json({
          message: 'Email verified. As the first account, you are the system Developer. Sign in to approve registrations and assign the President.'
        })
      }
    }

    const memberQrCode = await generateMemberQrCode({
      firstName: pending.firstName,
      middleName: pending.middleName,
      lastName: pending.lastName,
      suffix: pending.suffix,
      studentNumber: pending.studentNumber
    })

    const memberData = {
      firstName: pending.firstName,
      middleName: pending.middleName,
      lastName: pending.lastName,
      suffix: pending.suffix,
      sex: pending.sex,
      yearLevel: pending.yearLevel,
      section: pending.section,
      qrCode: memberQrCode
    }

    // --- Atomic: create (or re-open) User+Member AND delete the pending row together ---
    const newUser = await prisma.$transaction(async (tx) => {
      let user

      if (rejectedUserId) {
        // Re-application: refresh the rejected account with the new details and send it
        // back to the officers' approval queue. History (audit logs, etc.) is preserved.
        user = await tx.user.update({
          where: { id: rejectedUserId },
          data: {
            studentNumber: pending.studentNumber,
            email: pending.email,
            emailType: pending.emailType,
            password: pending.password,
            status: 'PENDING_OFFICER_APPROVAL',
            failedLoginAttempts: 0,
            lockedUntil: null,
            tokenVersion: { increment: 1 },
            member: {
              upsert: { create: memberData, update: memberData }
            }
          }
        })
      } else {
        user = await tx.user.create({
          data: {
            studentNumber: pending.studentNumber,
            email: pending.email,
            emailType: pending.emailType,
            password: pending.password,
            role: 'MEMBER',
            status: 'PENDING_OFFICER_APPROVAL',
            member: { create: memberData }
          }
        })
      }

      await tx.pendingRegistration.delete({ where: { id: pending.id } })

      return user
    })

    // Verification finished — the "resume OTP" cookie is no longer needed.
    clearPendingRegCookie(res)

    await writeAuditLog({
      action: AUDIT_ACTIONS.EMAIL_VERIFIED,
      targetUserId: newUser.id,
      details: rejectedUserId ? { reapplied: true } : undefined
    })
    await syncMemberApprovalNotifications()

    return res.json({
      message: 'Email verified. Your account is now awaiting officer approval.'
    })
  } catch (err) {
    logError('Verify OTP failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// RESEND OTP
// ---------------------------------------------
const resendOtp = async (req, res) => {
  try {
    const { purpose } = req.body

    if (!purpose) {
      return res.status(400).json({ message: 'Purpose is required' })
    }

    if (purpose === 'EMAIL_VERIFICATION') {
      const verificationToken = getPendingRegToken(req)

      if (!verificationToken) {
        return res.status(400).json({ message: 'Verification token is required' })
      }

      const pending = await prisma.pendingRegistration.findUnique({
        where: { token: verificationToken }
      })

      if (!pending) {
        clearPendingRegCookie(res)
        return res.status(404).json({ message: 'No pending registration found. Please register again.' })
      }

      const secondsSinceLastSend = (Date.now() - pending.lastOtpSentAt.getTime()) / 1000
      if (secondsSinceLastSend < OTP_RESEND_COOLDOWN_SECONDS) {
        const waitTime = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend)
        return res.status(429).json({ message: `Please wait ${waitTime} seconds before requesting a new code.` })
      }

      const otp = generateOtp()
      const otpHash = await hashOtp(otp)

      const refreshed = await prisma.pendingRegistration.update({
        where: { id: pending.id },
        data: {
          otpCodeHash: otpHash,
          otpAttempts: 0,
          otpExpiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
          lastOtpSentAt: new Date()
        }
      })

      await sendOtpEmail(pending.email, otp, 'EMAIL_VERIFICATION')

      // Resend extends the OTP lifetime, so extend the cookie with it.
      setPendingRegCookie(res, verificationToken, refreshed.otpExpiresAt)

      return res.json({ message: 'A new code has been sent to your email.' })
    }

    if (purpose === 'PASSWORD_RESET') {
      const { email } = req.body

      if (typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ message: 'Email is required' })
      }

      const normalizedEmail = email.trim().toLowerCase()
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

      const genericResponse = { message: 'If an account exists with this email, a new code has been sent.' }

      if (!user) {
        return res.json(genericResponse)
      }

      await issueResetOtp(user)

      return res.json(genericResponse)
    }

    return res.status(400).json({ message: 'Invalid purpose' })
  } catch (err) {
    logError('Resend OTP failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// GET PENDING REGISTRATION
// Lets the OTP page restore itself after a refresh / reopened browser.
// Reads ONLY the httpOnly cookie. Returns a masked email, never the token.
// ---------------------------------------------
const getPendingRegistration = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store')

    const token = req.cookies?.[PENDING_REG_COOKIE]
    if (typeof token !== 'string' || !token) {
      return res.status(404).json({ message: 'No pending registration.' })
    }

    const pending = await prisma.pendingRegistration.findUnique({ where: { token } })

    if (!pending || pending.otpExpiresAt < new Date()) {
      if (pending) {
        await prisma.pendingRegistration.delete({ where: { id: pending.id } }).catch(() => {})
      }
      clearPendingRegCookie(res)
      return res.status(404).json({ message: 'No pending registration.' })
    }

    return res.json({
      email: maskEmail(pending.email),
      otpExpiresAt: pending.otpExpiresAt,
      resendAvailableAt: new Date(pending.lastOtpSentAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000)
    })
  } catch (err) {
    logError('Get pending registration failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// LOGIN
// ---------------------------------------------
const login = async (req, res) => {
  try {
    const { identifier, password } = req.body

    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      return res.status(400).json({ message: 'Please enter your credentials' })
    }

    const trimmedIdentifier = identifier.trim()

    const user = isValidStudentNumber(trimmedIdentifier)
      ? await prisma.user.findUnique({
          where: { studentNumber: trimmedIdentifier },
          select: AUTH_USER_LOGIN_SELECT
        })
      : await prisma.user.findUnique({
          where: { email: trimmedIdentifier.toLowerCase() },
          select: AUTH_USER_LOGIN_SELECT
        })

    // Unknown account, wrong password and paused sign-in all get the same
    // answer, so the response never reveals whether an account exists.
    if (!user) {
      return res.status(401).json({ message: INVALID_LOGIN_MESSAGE })
    }

    const now = Date.now()
    const pairKey = `${user.id}:${req.ip}`
    const accountLocked = user.lockedUntil && user.lockedUntil.getTime() > now
    const pairLocked = (getLoginPair(pairKey, now)?.lockedUntil ?? 0) > now

    if (accountLocked || pairLocked) {
      return res.status(401).json({ message: INVALID_LOGIN_MESSAGE })
    }

    const isMatch = await bcrypt.compare(password, user.password)

    if (!isMatch) {
      const newFailedAttempts = user.failedLoginAttempts + 1
      const shouldLockAccount = newFailedAttempts >= LOGIN_ACCOUNT_LOCK_THRESHOLD
      const pair = recordFailedLoginPair(pairKey, now)

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newFailedAttempts,
          lockedUntil: shouldLockAccount ? new Date(now + LOGIN_LOCKOUT_MINUTES * 60 * 1000) : null
        }
      })

      await writeAuditLog({
        actorId: user.id,
        action: shouldLockAccount
          ? AUDIT_ACTIONS.ACCOUNT_LOCKED
          : AUDIT_ACTIONS.LOGIN_FAILED,
        details: { attempt: newFailedAttempts, signInPaused: pair.lockedUntil > now }
      })

      return res.status(401).json({ message: INVALID_LOGIN_MESSAGE })
    }

    failedLoginsByPair.delete(pairKey)
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null }
    })

    if (user.status === 'PENDING_OFFICER_APPROVAL') {
      return res.status(403).json({ message: 'Your account is awaiting officer approval.' })
    }
    if (user.status === 'REJECTED') {
      return res.status(403).json({ message: 'Your registration was not approved. Please contact an officer.' })
    }

    const token = signAuthToken(user)
    const isProduction = process.env.NODE_ENV === 'production'

    res.cookie('LITL-MIS', token, {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000
    })

    if (user.role !== 'MEMBER') {
      await writeAuditLog({
        actorId: user.id,
        action: AUDIT_ACTIONS.LOGIN_SUCCESS
      })
    }

    await ensureAuthUserQrCode(user)
    await attachDeveloperName(user)

    return res.json({
      message: 'Logged in successfully',
      user: buildAuthUser(user)
    })
  } catch (err) {
    logError('Login failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// LOGOUT
// ---------------------------------------------
const logout = async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production'
  // The route has no authMiddleware (a stale cookie must still be cleared),
  // so identify the caller from the cookie for the audit trail.
  const actor = await getUserFromAuthCookie(req)
  if (actor && actor.role !== 'MEMBER') {
    await writeAuditLog({ actorId: actor.id, action: AUDIT_ACTIONS.LOGOUT })
  }
  res.clearCookie('LITL-MIS', {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction
  })
  return res.json({ message: 'Logged out successfully' })
}

// ---------------------------------------------
// GET CURRENT USER
// ---------------------------------------------
const getMe = async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: AUTH_USER_PROFILE_SELECT
  })

  await ensureAuthUserQrCode(user)
  await attachDeveloperName(user)

  return res.json({ user: buildAuthUser(user) })
}

// ---------------------------------------------
// FORGOT PASSWORD — REQUEST OTP
// ---------------------------------------------
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body

    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ message: 'Email is required' })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

    const genericResponse = { message: 'If an account exists with this email, a code has been sent.' }

    if (!user) {
      return res.json(genericResponse)
    }

    await issueResetOtp(user)

    return res.json(genericResponse)
  } catch (err) {
    logError('Forgot password failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// FORGOT PASSWORD — VERIFY OTP, ISSUE RESET TOKEN
// ---------------------------------------------
const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body

    if (typeof email !== 'string' || typeof otp !== 'string' || !email.trim() || !otp) {
      return res.status(400).json({ message: 'Email and code are required' })
    }

    const normalizedEmail = email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

    if (!user) {
      return res.status(400).json({ message: 'Invalid code or email' })
    }

    const usage = await getResetOtpUsage(user.id)
    if (usage.failedInWindow >= RESET_OTP_MAX_FAILED_PER_WINDOW) {
      return res.status(400).json({ message: 'Too many incorrect attempts. Please try again in an hour.' })
    }

    const otpRecord = await prisma.otp.findFirst({
      where: {
        userId: user.id,
        purpose: 'PASSWORD_RESET',
        used: false
      },
      orderBy: { createdAt: 'desc' }
    })

    if (!otpRecord) {
      return res.status(400).json({ message: 'No active code found. Please request a new one.' })
    }

    if (otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Code has expired. Please request a new one.' })
    }

    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(400).json({ message: 'Too many incorrect attempts. Please request a new code.' })
    }

    const isMatch = await compareOtp(otp, otpRecord.codeHash)

    if (!isMatch) {
      await prisma.otp.update({
        where: { id: otpRecord.id },
        data: { attempts: otpRecord.attempts + 1 }
      })
      return res.status(400).json({ message: 'Incorrect code. Please try again.' })
    }

    await prisma.otp.update({
      where: { id: otpRecord.id },
      data: { used: true }
    })

    const resetToken = signResetToken(user.id, user.tokenVersion)

    return res.json({ message: 'Code verified.', resetToken })
  } catch (err) {
    logError('Verify reset OTP failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// FORGOT PASSWORD — SET NEW PASSWORD
// ---------------------------------------------
const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmNewPassword } = req.body

    if (!resetToken || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ message: 'All fields are required' })
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and contain an uppercase letter, lowercase letter, number, and special character' })
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'Passwords do not match' })
    }

    let decoded
    try {
      decoded = verifyResetToken(resetToken)
    } catch (err) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired. Please start again.' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12)

    const updated = await prisma.user.updateMany({
      where: { id: decoded.id, tokenVersion: decoded.tokenVersion ?? 0 },
      data: {
        password: hashedPassword,
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    })
    if (updated.count === 0) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired. Please start again.' })
    }

    await writeAuditLog({ actorId: decoded.id, action: AUDIT_ACTIONS.PASSWORD_RESET })  

    return res.json({ message: 'Password reset successfully. Please log in with your new password.' })
  } catch (err) {
    logError('Reset password failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// REQUEST EMAIL CHANGE

const requestEmailChange = async (req, res) => {
  try {
    const { newEmail } = req.body
    const userId = req.user.id

    if (!newEmail) {
      return res.status(400).json({ message: 'New email address is required.' })
    }

    const normalizedEmail = newEmail.trim().toLowerCase()

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailType: true }
    })
    if (!user) return res.status(404).json({ message: 'User not found.' })

    // Institutional CvSU emails are locked — cannot be changed
    if (user.emailType === 'CVSU') {
      return res.status(403).json({
        message: 'Your account uses a CvSU institutional email and cannot be changed.'
      })
    }

    // Only CvSU emails are accepted as the new address
    if (!isCvsuEmail(normalizedEmail)) {
      return res.status(400).json({
        message: 'Only CvSU institutional emails (@cvsu.edu.ph) are accepted.'
      })
    }

    if (normalizedEmail === user.email) {
      return res.status(400).json({ message: 'This is already your current email address.' })
    }

    // Check the new email is not already taken by another account
    const takenByUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (takenByUser) {
      return res.status(400).json({ message: 'This email address is already in use.' })
    }

    // Check for an existing pending change (one-at-a-time per user)
    const existingPending = await prisma.pendingEmailChange.findUnique({ where: { userId } })
    if (existingPending) {
      const isExpired = existingPending.otpExpiresAt < new Date()
      if (!isExpired) {
        const secondsSinceLastSend = (Date.now() - existingPending.lastOtpSentAt.getTime()) / 1000
        const waitTime = Math.ceil(Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend))
        return res.status(400).json({
          message: waitTime > 0
            ? `A code was already sent to ${existingPending.newEmail}. Please wait ${waitTime} seconds before requesting a new one.`
            : `A code was already sent to ${existingPending.newEmail}. Please check your email or request a new code.`
        })
      }
      // Expired — clean it up and allow a fresh request
      await prisma.pendingEmailChange.delete({ where: { userId } })
    }

    const otp          = generateOtp()
    const otpHash      = await hashOtp(otp)
    const changeToken  = generateVerificationToken()

    await prisma.pendingEmailChange.create({
      data: {
        token:        changeToken,
        userId,
        newEmail:     normalizedEmail,
        otpCodeHash:  otpHash,
        otpExpiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        lastOtpSentAt: new Date(),
      }
    })

    // Same as registration: a failed send must not leave a pending change
    // that blocks the user from trying again for 10 minutes.
    try {
      await sendOtpEmail(normalizedEmail, otp, 'EMAIL_CHANGE')
    } catch (mailErr) {
      await prisma.pendingEmailChange.delete({ where: { token: changeToken } }).catch(() => {})
      throw mailErr
    }

    await writeAuditLog({
      actorId: userId,
      action:  AUDIT_ACTIONS.EMAIL_CHANGE_REQUESTED,
      details: { newEmail: normalizedEmail }
    })

    return res.status(201).json({
      message:     `A verification code has been sent to ${normalizedEmail}.`,
      changeToken,
    })
  } catch (err) {
    logError('Request email change failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// RESEND EMAIL CHANGE OTP
// Resends the OTP to the pending new email.
// Requires auth — the changeToken must belong to the requesting user.
// ---------------------------------------------
const resendEmailChangeOtp = async (req, res) => {
  try {
    const { changeToken } = req.body
    const userId = req.user.id

    if (!changeToken) {
      return res.status(400).json({ message: 'Change token is required.' })
    }

    const pending = await prisma.pendingEmailChange.findUnique({ where: { token: changeToken } })

    if (!pending) {
      return res.status(404).json({ message: 'No pending email change found. Please start again.' })
    }

    // Prevent token theft — the pending row must belong to the authenticated user
    if (pending.userId !== userId) {
      return res.status(403).json({ message: 'Invalid request.' })
    }

    if (pending.otpExpiresAt < new Date()) {
      await prisma.pendingEmailChange.delete({ where: { token: changeToken } }).catch(() => {})
      return res.status(400).json({ message: 'Verification has expired. Please start again.' })
    }

    const secondsSinceLastSend = (Date.now() - pending.lastOtpSentAt.getTime()) / 1000
    if (secondsSinceLastSend < OTP_RESEND_COOLDOWN_SECONDS) {
      const waitTime = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend)
      return res.status(429).json({
        message: `Please wait ${waitTime} seconds before requesting a new code.`
      })
    }

    const otp     = generateOtp()
    const otpHash = await hashOtp(otp)

    await prisma.pendingEmailChange.update({
      where: { token: changeToken },
      data: {
        otpCodeHash:  otpHash,
        otpAttempts:  0,
        otpExpiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        lastOtpSentAt: new Date(),
      }
    })

    await sendOtpEmail(pending.newEmail, otp, 'EMAIL_CHANGE')

    return res.json({ message: `A new code has been sent to ${pending.newEmail}.` })
  } catch (err) {
    logError('Resend email change OTP failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// VERIFY EMAIL CHANGE
// Step 2 of the email-change flow.
// Validates the OTP, then atomically updates the email and deletes
// the pending row in a single transaction.
// ---------------------------------------------
const verifyEmailChange = async (req, res) => {
  try {
    const { changeToken, otp } = req.body
    const userId = req.user.id

    if (!changeToken || !otp) {
      return res.status(400).json({ message: 'Change token and OTP are required.' })
    }

    const pending = await prisma.pendingEmailChange.findUnique({ where: { token: changeToken } })

    if (!pending) {
      return res.status(400).json({ message: 'No pending email change found. Please start again.' })
    }

    // Token must belong to the authenticated user
    if (pending.userId !== userId) {
      return res.status(403).json({ message: 'Invalid request.' })
    }

    if (pending.otpExpiresAt < new Date()) {
      await prisma.pendingEmailChange.delete({ where: { token: changeToken } }).catch(() => {})
      return res.status(400).json({ message: 'Verification code has expired. Please start again.' })
    }

    if (pending.otpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(400).json({
        message: 'Too many incorrect attempts. Please request a new code.'
      })
    }

    const isMatch = await compareOtp(otp, pending.otpCodeHash)

    if (!isMatch) {
      await prisma.pendingEmailChange.update({
        where: { token: changeToken },
        data: { otpAttempts: pending.otpAttempts + 1 }
      })
      const remaining = MAX_OTP_ATTEMPTS - pending.otpAttempts - 1
      return res.status(400).json({
        message: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      })
    }

    // Race-condition guard: another user might have claimed this email
    // between the time the OTP was sent and now
    const takenByUser = await prisma.user.findUnique({ where: { email: pending.newEmail } })
    if (takenByUser && takenByUser.id !== userId) {
      await prisma.pendingEmailChange.delete({ where: { token: changeToken } }).catch(() => {})
      return res.status(400).json({
        message: 'This email address has just been taken. Please start again with a different address.'
      })
    }

    // Atomic: commit the email update and remove the pending row together
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email:     pending.newEmail,
          emailType: 'CVSU',
        }
      })
      await tx.pendingEmailChange.delete({ where: { token: changeToken } })
    })

    await writeAuditLog({
      actorId: userId,
      action:  AUDIT_ACTIONS.EMAIL_CHANGED,
      details: { newEmail: pending.newEmail }
    })

    return res.json({ message: 'Email address updated successfully.' })
  } catch (err) {
    logError('Verify email change failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// ---------------------------------------------
// CHANGE PASSWORD
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body
    const userId = req.user.id

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ message: 'All fields are required.' })
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters and contain an uppercase letter, lowercase letter, number, and special character.'
      })
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ message: 'Passwords do not match.' })
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'New password must be different from your current password.' })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true }
    })
    if (!user) return res.status(404).json({ message: 'User not found.' })

    const isMatch = await bcrypt.compare(currentPassword, user.password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect.' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12)

    await prisma.user.update({
      where: { id: userId },
      data: {
        password:            hashedPassword,
        tokenVersion:        { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil:         null,
      }
    })

    await writeAuditLog({
      actorId: userId,
      action:  AUDIT_ACTIONS.PASSWORD_RESET,
    })

    return res.json({
      message: 'Password changed successfully. You have been logged out of all other sessions.'
    })
  } catch (err) {
    logError('Change password failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

// PUT /api/auth/avatar
const uploadAvatar = async (req, res) => {
  try {
    const { avatar: base64DataUrl } = req.body
    if (!base64DataUrl) return res.status(400).json({ message: 'Avatar image is required.' })
    if (!base64DataUrl.startsWith('data:image/')) {
      return res.status(400).json({ message: 'Invalid image format. Please upload a JPG, PNG, GIF, or WebP.' })
    }

    const dataUrlMatch = /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(base64DataUrl)
    if (!dataUrlMatch) {
      return res.status(400).json({ message: 'Invalid image format. Please upload a JPG, PNG, GIF, or WebP.' })
    }
    const mimeType  = dataUrlMatch[1]
    const buffer    = Buffer.from(dataUrlMatch[2], 'base64')

    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ message: 'Image must be less than 2MB.' })
    }

    try {
      const meta = await require('sharp')(buffer).metadata()
      if (!['jpeg', 'png', 'gif', 'webp'].includes(meta.format)) throw new Error('unsupported')
    } catch {
      return res.status(400).json({ message: 'The uploaded file is not a valid image.' })
    }

    const member = await prisma.member.findUnique({
      where:  { userId: req.user.id },
      select: { id: true, avatarPath: true },
    })
    if (!member) return res.status(404).json({ message: 'Member profile not found.' })

    // Delete old avatar from R2 before replacing
    if (member.avatarPath) {
      await storageService.deleteFile(member.avatarPath).catch(() => {})
    }

    const ext         = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const storagePath = `profiles/${req.user.id}-${Date.now()}.${ext}`
    const { path: uploadedPath, publicUrl } = await storageService.uploadFile(storagePath, buffer, mimeType)

    await prisma.member.update({
      where: { userId: req.user.id },
      data:  { avatar: publicUrl, avatarPath: uploadedPath },
    })

    return res.json({ message: 'Profile picture updated.', avatar: publicUrl })
  } catch (err) {
    logError('Upload avatar failed', err)
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
}

module.exports = {
  register,
  verifyEmailOtp,
  resendOtp,
  getPendingRegistration,
  login,
  logout,
  getMe,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  changePassword, 
  requestEmailChange,
  resendEmailChangeOtp,
  verifyEmailChange,
  uploadAvatar,
}