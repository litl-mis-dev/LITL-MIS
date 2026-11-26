const express = require('express')
const router = express.Router()
const { validateIdParams } = require('../middleware/request.middleware')
validateIdParams(router, ['userId'])

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
  uploadAvatar, getAvatarImage,
} = require('../controllers/auth.controller')

const authMiddleware = require('../middleware/auth.middleware')
const {
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
  changePasswordLimiter,
  emailChangeLimiter,
  verifyEmailChangeLimiter,
} = require('../middleware/rateLimit.middleware')

const { getMyPaymentHistory } = require('../controllers/payment.controller')

// Each limit is per person, with a looser per-network cap first
// (middleware/rateLimit.middleware.js).
router.post('/register', registerIpLimiter, registerLimiter, register)
router.post('/verify-email-otp', verifyOtpIpLimiter, verifyOtpLimiter, verifyEmailOtp)
router.post('/resend-otp', otpResendIpLimiter, otpResendLimiter, resendOtp)

router.get('/pending-registration', getPendingRegistration)

router.post('/login', loginIpLimiter, loginLimiter, login)
router.post('/logout', logout)
router.get('/me', authMiddleware, getMe)
router.put('/avatar', authMiddleware, uploadAvatar)
router.get('/avatar/:userId/image', authMiddleware, getAvatarImage)

router.post('/request-email-change',    authMiddleware, emailChangeLimiter,       requestEmailChange)
router.post('/resend-email-change-otp', authMiddleware, emailChangeLimiter,       resendEmailChangeOtp)
router.post('/verify-email-change',     authMiddleware, verifyEmailChangeLimiter, verifyEmailChange)

router.post('/change-password', authMiddleware, changePasswordLimiter, changePassword)

router.post('/forgot-password', forgotPasswordIpLimiter, forgotPasswordLimiter, forgotPassword)
router.post('/verify-reset-otp', verifyResetOtpIpLimiter, verifyResetOtpLimiter, verifyResetOtp)
router.post('/reset-password', authIpLimiter, authLimiter, resetPassword) // optional fallback

router.get('/my-payment-history', authMiddleware, getMyPaymentHistory)

module.exports = router