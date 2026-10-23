// Centralized logger. Use this instead of console.error/console.log directly
// in any place that might be near sensitive data (req.body, OTPs, passwords, tokens).

const SENSITIVE_KEYS = ['password', 'confirmPassword', 'confirmNewPassword', 'otp', 'otpCodeHash', 'token', 'resetToken']

// Strips sensitive fields before logging an object, in case a caller passes req.body by mistake
const sanitize = (data) => {
  if (!data || typeof data !== 'object') return data
  const clone = Array.isArray(data) ? [...data] : { ...data }
  for (const key of Object.keys(clone)) {
    if (SENSITIVE_KEYS.includes(key)) {
      clone[key] = '[REDACTED]'
    }
  }
  return clone
}

const logError = (label, err, context = {}) => {
  console.error(`[ERROR] ${label}:`, err.message || err, sanitize(context))
}

const logInfo = (label, context = {}) => {
  console.log(`[INFO] ${label}`, sanitize(context))
}

module.exports = { logError, logInfo, sanitize }