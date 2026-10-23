// Remembers an in-progress email verification (PendingRegistration) in an
// httpOnly cookie so the user can resume the OTP page after a refresh,
// Back button, or closing and reopening the browser.
//
// The cookie only holds the random PendingRegistration token. The database
// row (and its otpExpiresAt) is always the source of truth.

const PENDING_REG_COOKIE = 'LITL-MIS_pending_reg'

const baseOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/api/auth'
  }
}

// Cookie lives exactly as long as the OTP does — never longer, never shorter.
const setPendingRegCookie = (res, token, expiresAt) => {
  const maxAge = new Date(expiresAt).getTime() - Date.now()
  if (maxAge <= 0) return
  res.cookie(PENDING_REG_COOKIE, token, { ...baseOptions(), maxAge })
}

const clearPendingRegCookie = (res) => {
  res.clearCookie(PENDING_REG_COOKIE, baseOptions())
}

// Cookie first; falls back to the request body so registration still works
// in browsers that block cross-site cookies. Always returns a string or null
// (never an object), so it is safe to pass straight into a Prisma `where`.
const getPendingRegToken = (req) => {
  const fromCookie = req.cookies?.[PENDING_REG_COOKIE]
  if (typeof fromCookie === 'string' && fromCookie) return fromCookie

  const fromBody = req.body?.verificationToken
  if (typeof fromBody === 'string' && fromBody) return fromBody

  return null
}

// "juan.delacruz@gmail.com" -> "ju***********@gmail.com"
const maskEmail = (email) => {
  const [local, domain] = String(email).split('@')
  if (!domain) return '***'
  const visible = local.slice(0, Math.min(2, local.length))
  const hidden = '*'.repeat(Math.max(local.length - visible.length, 3))
  return `${visible}${hidden}@${domain}`
}

module.exports = {
  PENDING_REG_COOKIE,
  setPendingRegCookie,
  clearPendingRegCookie,
  getPendingRegToken,
  maskEmail
}