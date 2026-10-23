const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { invalidateCache, loadPermissions } = require('../services/permissions.service')
const { ALL_ROLES } = require('../utils/roles')
const { MODULES } = require('../utils/permissionModules')

// GET /api/role-permissions/mine
// Returns only the CALLER's own module -> level map. Open to any
// authenticated officer/member — used by the frontend to filter nav items
// and gate pages. (The full cross-role matrix below is admin-only.)
const getMyPermissions = async (req, res) => {
  try {
    const map = await loadPermissions()
    const mine = map[req.user.role] ?? {}
    const permissions = Object.fromEntries(MODULES.map((m) => [m, mine[m] ?? 'NONE']))
    return res.json({ role: req.user.role, permissions })
  } catch (err) {
    logError('Get my permissions', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const VALID_LEVELS = ['NONE', 'VIEW', 'EDIT']

// PRESIDENT_ADMIN is the only role whose permissions cannot be changed —
// lowering the president below EDIT on any module could lock them out
// permanently.
const PROTECTED_ROLE = 'PRESIDENT_ADMIN'

// GET /api/role-permissions
// Returns the full permission matrix — all roles x all modules.
const listRolePermissions = async (req, res) => {
  try {
    const rows = await prisma.rolePermission.findMany({
      orderBy: [{ role: 'asc' }, { module: 'asc' }]
    })
    return res.json({ permissions: rows, modules: MODULES, roles: ALL_ROLES })
  } catch (err) {
    logError('List role permissions', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// PUT /api/role-permissions
// Bulk-update the entire permission matrix. Accepts:
// { permissions: [{ role, module, level }] }
// Validates, saves, invalidates cache, and writes audit log.
const updateRolePermissions = async (req, res) => {
  try {
    const { permissions } = req.body

    if (!Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({ message: 'permissions array is required.' })
    }

    for (const p of permissions) {
      if (!ALL_ROLES.includes(p.role)) {
        return res.status(400).json({ message: `Invalid role: ${p.role}` })
      }
      if (!MODULES.includes(p.module)) {
        return res.status(400).json({ message: `Invalid module: ${p.module}` })
      }
      if (!VALID_LEVELS.includes(p.level)) {
        return res.status(400).json({ message: `Invalid level: ${p.level}` })
      }

      // PRESIDENT_ADMIN must always keep full access — never allow lowering them
      if (p.role === PROTECTED_ROLE && p.level !== 'EDIT') {
        return res.status(400).json({
          message: 'President permissions cannot be lowered below Edit.'
        })
      }
    }

    // Upsert all changes in one transaction
    await prisma.$transaction(
      permissions.map(p =>
        prisma.rolePermission.upsert({
          where:  { role_module: { role: p.role, module: p.module } },
          update: { level: p.level },
          create: { role: p.role, module: p.module, level: p.level }
        })
      )
    )

    // Invalidate in-process cache so next request reads fresh data
    invalidateCache()

    await writeAuditLog({
      actorId: req.user.id,
      action:  AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
      details: { updatedCount: permissions.length }
    })

    return res.json({ message: 'Role permissions updated.' })
  } catch (err) {
    logError('Update role permissions', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { listRolePermissions, updateRolePermissions, getMyPermissions }