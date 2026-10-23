const { verifyAuthToken } = require('../utils/jwt')
//const { PrismaClient } = require('@prisma/client')

//const prisma = new PrismaClient()
const prisma = require('../lib/prisma')
const { MEMBER_SIDE_ROLES } = require('../utils/roles')

const authMiddleware = async (req, res, next) => {
  const token = req.cookies['LITL-MIS']

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

    req.user = { id: user.id, role: user.role }

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