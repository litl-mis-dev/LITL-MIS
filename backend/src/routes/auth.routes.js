const express = require('express')
const router = express.Router()

const {
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
} = require('../controllers/auth.controller')

const authMiddleware = require('../middleware/auth.middleware')
const {
  authLimiter,
  registerLimiter,
  loginLimiter,
  otpResendLimiter,
  verifyOtpLimiter,
  verifyResetOtpLimiter,
  forgotPasswordLimiter,
  changePasswordLimiter,
  emailChangeLimiter,
  verifyEmailChangeLimiter,
} = require('../middleware/rateLimit.middleware')

const { getMyPaymentHistory } = require('../controllers/payment.controller')

router.post('/register', registerLimiter, register)
router.post('/verify-email-otp', verifyOtpLimiter, verifyEmailOtp)
router.post('/resend-otp', otpResendLimiter, resendOtp)

router.get('/pending-registration', getPendingRegistration)

router.post('/login', loginLimiter, login)
router.post('/logout', logout)
router.get('/me', authMiddleware, getMe)
router.put('/avatar', authMiddleware, uploadAvatar)

router.post('/request-email-change',    authMiddleware, emailChangeLimiter,       requestEmailChange)
router.post('/resend-email-change-otp', authMiddleware, emailChangeLimiter,       resendEmailChangeOtp)
router.post('/verify-email-change',     authMiddleware, verifyEmailChangeLimiter, verifyEmailChange)

router.post('/change-password', authMiddleware, changePasswordLimiter, changePassword)

router.post('/forgot-password', forgotPasswordLimiter, forgotPassword)
router.post('/verify-reset-otp', verifyResetOtpLimiter, verifyResetOtp)
router.post('/reset-password', authLimiter, resetPassword) // optional fallback

router.get('/my-payment-history', authMiddleware, getMyPaymentHistory)

module.exports = router