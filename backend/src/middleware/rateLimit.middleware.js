const { rateLimit, ipKeyGenerator } = require('express-rate-limit')
const { getPendingRegToken } = require('../utils/pendingRegistrationCookie')

// Sign-in and sign-up limits count per person, not per network: students on
// campus Wi-Fi often share one public IP, and a per-IP limit would let the
// 11th of them to sign in at an event lock out everyone else. Each limit is
// keyed on the IP *and* the account being acted on (email, student number or
// pending-registration token); a much looser per-IP cap stops one machine
// from cycling through accounts. The per-account lockout in
// auth.controller.js still blocks password guessing.
const FIFTEEN_MINUTES = 15 * 60 * 1000

const limiter = ({ windowMs = FIFTEEN_MINUTES, max, message, ...options }) => rateLimit({
  windowMs,
  max,
  message: { message },
  standardHeaders: true,
  legacyHeaders: false,
  ...options,
})

const bodyField = (field) => (req) => req.body?.[field]
// "<ip>|<who>": the IP (IPv6 grouped by network, as the library does) plus
// the account, lower-cased and capped so odd input can't make huge keys.
const ipAnd = (pickWho) => (req) =>
  `${ipKeyGenerator(req.ip)}|${String(pickWho(req) ?? '').trim().toLowerCase().slice(0, 320)}`
const byUser = (req) => `user:${req.user?.id ?? ipKeyGenerator(req.ip)}`

// Password reset with the token from the reset email (one per account).
const authLimiter = limiter({ max: 5, message: 'Too many requests, please try again later', keyGenerator: ipAnd(bodyField('resetToken')) })
const authIpLimiter = limiter({ max: 100, message: 'Too many requests, please try again later' })

// REGISTER — sends a verification email, so every attempt counts.
const registerLimiter = limiter({ max: 5, message: 'Too many registration attempts. Please try again later.', keyGenerator: ipAnd(bodyField('email')) })
const registerIpLimiter = limiter({ max: 100, message: 'Too many registration attempts. Please try again later.' })

// LOGIN — only failed attempts count; signing in successfully costs nothing.
const loginLimiter = limiter({ max: 10, message: 'Too many login attempts. Try again later.', keyGenerator: ipAnd(bodyField('identifier')), skipSuccessfulRequests: true })
const loginIpLimiter = limiter({ max: 100, message: 'Too many login attempts. Try again later.', skipSuccessfulRequests: true })

// OTP RESEND (email abuse protection) — per pending registration or email.
const otpResendLimiter = limiter({
  windowMs: 5 * 60 * 1000, max: 5, message: 'Too many resend requests. Please wait a few minutes.',
  keyGenerator: ipAnd((req) => getPendingRegToken(req) ?? req.body?.email),
})
// Sends an email: a tighter per-network cap, so one machine can't email many accounts.
const otpResendIpLimiter = limiter({ windowMs: 5 * 60 * 1000, max: 20, message: 'Too many resend requests. Please wait a few minutes.' })

// VERIFY EMAIL OTP — per pending registration.
const verifyOtpLimiter = limiter({ max: 5, message: 'Too many OTP verification attempts. Please try again later.', keyGenerator: ipAnd(getPendingRegToken) })
const verifyOtpIpLimiter = limiter({ max: 100, message: 'Too many OTP verification attempts. Please try again later.' })

// VERIFY RESET OTP / FORGOT PASSWORD — per email.
const verifyResetOtpLimiter = limiter({ max: 5, message: 'Too many reset OTP attempts. Please request a new code.', keyGenerator: ipAnd(bodyField('email')) })
const verifyResetOtpIpLimiter = limiter({ max: 100, message: 'Too many reset OTP attempts. Please request a new code.' })
const forgotPasswordLimiter = limiter({ max: 5, message: 'Too many password reset requests. Please try again later.', keyGenerator: ipAnd(bodyField('email')) })
// Sends an email: a tighter per-network cap, as for resending a code.
const forgotPasswordIpLimiter = limiter({ max: 20, message: 'Too many password reset requests. Please try again later.' })

// Signed-in actions count per account (these run after authMiddleware).
// EMAIL CHANGE — request + resend (strict: sends real emails)
const emailChangeLimiter = limiter({ max: 3, message: 'Too many email change requests. Please try again later.', keyGenerator: byUser })
// EMAIL CHANGE — OTP verification
const verifyEmailChangeLimiter = limiter({ max: 5, message: 'Too many verification attempts. Please try again later.', keyGenerator: byUser })
const changePasswordLimiter = limiter({ max: 5, message: 'Too many password change attempts. Please try again later.', keyGenerator: byUser })

// DOCUMENTS — upload (I/O heavy, guard against abuse)
const documentUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { message: 'Too many uploads. Please slow down and try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// CONTACT FORM — public, unauthenticated endpoint that sends real emails.
const contactFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many messages sent. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const publicVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { status: 'INVALID', reason: 'Too many verification requests. Please wait a minute and try again.', message: 'Too many requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// ADVISER INVITES — public link lookup/accept (token guessing), and the
// President sending invite emails.
const adviserInviteLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const adviserInviteSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many invitation emails. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

module.exports = {
  adviserInviteLinkLimiter,
  adviserInviteSendLimiter,
  publicVerifyLimiter,
  authLimiter,
  authIpLimiter,
  registerLimiter,
  registerIpLimiter,
  loginLimiter,
  loginIpLimiter,
  otpResendLimiter,
  otpResendIpLimiter,
  verifyOtpLimiter,
  verifyOtpIpLimiter,
  verifyResetOtpLimiter,
  verifyResetOtpIpLimiter,
  forgotPasswordLimiter,
  forgotPasswordIpLimiter,
  emailChangeLimiter,
  verifyEmailChangeLimiter,
  changePasswordLimiter,
  documentUploadLimiter,
  contactFormLimiter,
}