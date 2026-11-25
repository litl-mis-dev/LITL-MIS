const jwt = require('jsonwebtoken')

// A session lasts until logout, and ends on its own only after 30 days
// without any use: every request renews the cookie once it is a day old
// (auth.middleware.js). Logout, a password change or deactivation bumps
// tokenVersion, which ends every copy of the token at once.
const SESSION_IDLE_DAYS = 30
const SESSION_MAX_AGE_MS = SESSION_IDLE_DAYS * 24 * 60 * 60 * 1000
const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60
const AUTH_COOKIE_NAME = 'LITL-MIS'

// The website (litltrece.me) and the API (api.litltrece.me) are the same
// site, so Lax still sends the cookie with the app's own requests while
// keeping it off requests started by other sites.
const authCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
})

// Sets (or renews) the session cookie for this user.
const setAuthCookie = (res, user) => {
  res.cookie(AUTH_COOKIE_NAME, signAuthToken(user), { ...authCookieOptions(), maxAge: SESSION_MAX_AGE_MS })
}

// Login session token, with tokenVersion so it can be revoked.
const signAuthToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion
    },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_IDLE_DAYS}d`, algorithm: 'HS256' }
  )
}

const verifyAuthToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
}

const signResetToken = (userId, tokenVersion = 0) => {
  return jwt.sign(
    { id: userId, purpose: 'PASSWORD_RESET', tokenVersion },
    process.env.RESET_TOKEN_SECRET,
    { expiresIn: '10m', algorithm: 'HS256' }
  )
}

const verifyResetToken = (token) => {
  const decoded = jwt.verify(token, process.env.RESET_TOKEN_SECRET, { algorithms: ['HS256'] })
  if (decoded.purpose !== 'PASSWORD_RESET') throw new Error('Wrong token purpose')
  return decoded
}

module.exports = {
  AUTH_COOKIE_NAME, SESSION_MAX_AGE_MS, SESSION_RENEW_AFTER_SECONDS,
  authCookieOptions, setAuthCookie,
  signAuthToken, verifyAuthToken, signResetToken, verifyResetToken,
}