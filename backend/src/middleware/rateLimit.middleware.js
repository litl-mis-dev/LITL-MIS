const rateLimit = require('express-rate-limit')

// General auth routes — fallback limiter (optional use)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
})

// REGISTER
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
})

// LOGIN
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
})

// OTP RESEND (email abuse protection)
const otpResendLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: { message: 'Too many resend requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
})

// VERIFY EMAIL OTP
const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many OTP verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
})

// VERIFY RESET OTP
const verifyResetOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many reset OTP attempts. Please request a new code.' },
  standardHeaders: true,
  legacyHeaders: false
})

// FORGOT PASSWORD
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
})

// EMAIL CHANGE — request + resend (strict: sends real emails)
const emailChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { message: 'Too many email change requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// EMAIL CHANGE — OTP verification
const verifyEmailChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: 'Too many password change attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

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

module.exports = {
  publicVerifyLimiter,
  authLimiter,
  registerLimiter,
  loginLimiter,
  otpResendLimiter,
  verifyOtpLimiter,
  verifyResetOtpLimiter,
  forgotPasswordLimiter,
  emailChangeLimiter,
  verifyEmailChangeLimiter,
  changePasswordLimiter,
  documentUploadLimiter,
  contactFormLimiter,
}