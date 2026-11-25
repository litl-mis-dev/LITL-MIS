const { verifyAuthToken, setAuthCookie, AUTH_COOKIE_NAME, SESSION_RENEW_AFTER_SECONDS } = require('../utils/jwt')

const prisma = require('../lib/prisma')
const { MEMBER_SIDE_ROLES } = require('../utils/roles')

const authMiddleware = async (req, res, next) => {
  const token = req.cookies[AUTH_COOKIE_NAME]

  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' })
  }

  try {
    const decoded = verifyAuthToken(token)

    // Check tokenVersion matches — if user reset their password, old tokens become invalid
    const user = await prisma.user.findUnique({ where: { id: decoded.id } })

    if (!user) {
      return res.status(401).json({ message: 'Not authenticated' })
    }

    if (user.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({ message: 'Session expired, please log in again' })
    }

    // Only approved accounts may act. Deactivation also bumps tokenVersion,
    // so this is a second line of defence.
    if (user.status !== 'APPROVED') {
      return res.status(401).json({ message: 'Not authenticated' })
    }

    req.user = { id: user.id, role: user.role }

    // Using the site keeps you signed in: once the token is a day old it is
    // replaced with a fresh 30-day one, so only 30 days without use end it.
    if (Math.floor(Date.now() / 1000) - decoded.iat >= SESSION_RENEW_AFTER_SECONDS) {
      setAuthCookie(res, user)
    }

    const viewAs = req.headers['x-view-as']
    if (viewAs === 'MEMBER' && MEMBER_SIDE_ROLES.includes(user.role)) {
      req.user.effectiveRole = 'MEMBER'
    } else {
      req.user.effectiveRole = user.role
    }
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

module.exports = authMiddleware