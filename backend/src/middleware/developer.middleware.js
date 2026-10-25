const prisma = require('../lib/prisma')
const { DEVELOPER_ROLE } = require('../utils/roles')

const isPresidentAssigned = async () => {
  const president = await prisma.user.findFirst({
    where: { role: 'PRESIDENT_ADMIN', status: 'APPROVED' },
    select: { id: true }
  })
  return Boolean(president)
}

// Only the Developer account. Must run after authMiddleware.
const requireDeveloper = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' })
  if (req.user.role !== DEVELOPER_ROLE) return res.status(403).json({ message: 'Access denied' })
  next()
}

// The Developer's powers exist only while the President seat is empty.
// Checked on every request, so they stop the moment a President is assigned.
const requireNoPresident = async (req, res, next) => {
  try {
    if (await isPresidentAssigned()) {
      return res.status(403).json({ message: 'A President has been assigned. The President now handles approvals and role assignments.' })
    }
    next()
  } catch {
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { requireDeveloper, requireNoPresident, isPresidentAssigned }
