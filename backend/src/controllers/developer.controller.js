const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { MEMBERSHIP_USER_FILTER } = require('../utils/roles')
const { isPresidentAssigned } = require('../middleware/developer.middleware')
const { assignOfficerRole } = require('./officer.controller')

// The Developer is the first account on an empty system. It exists only to
// get the organization started: approve registrations and assign the first
// President. Everything here is mounted behind requireDeveloper, and every
// action also behind requireNoPresident (see routes/developer.routes.js).

const memberName = (m) => [m.firstName, m.middleName, m.lastName, m.suffix].filter(Boolean).join(' ')

// GET /api/developer/status
const getStatus = async (req, res) => {
  try {
    const presidentAssigned = await isPresidentAssigned()
    return res.json({ presidentAssigned })
  } catch (err) {
    logError('Developer status', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// GET /api/developer/members — approved, active members who can be made President.
const listPresidentCandidates = async (req, res) => {
  try {
    const members = await prisma.member.findMany({
      where: { status: 'ACTIVE', user: { status: 'APPROVED', ...MEMBERSHIP_USER_FILTER } },
      select: {
        id: true, firstName: true, middleName: true, lastName: true, suffix: true,
        yearLevel: true, section: true,
        user: { select: { studentNumber: true } }
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
    })
    return res.json({
      members: members.map((m) => ({
        id: m.id,
        name: memberName(m),
        studentNumber: m.user.studentNumber,
        yearLevel: m.yearLevel,
        section: m.section
      }))
    })
  } catch (err) {
    logError('Developer list president candidates', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// POST /api/developer/assign-president { memberId }
// The role is fixed here — the Developer can never assign anything else.
const assignPresident = (req, res) => {
  req.body = { memberId: req.body?.memberId, role: 'PRESIDENT_ADMIN' }
  return assignOfficerRole(req, res)
}

module.exports = { getStatus, listPresidentCandidates, assignPresident }
