const { hasAccess } = require('../services/permissions.service')

// Usage: requireModule('FINANCIAL')                 // VIEW is enough
//        requireModule('FINANCIAL', 'EDIT')         // must be able to manage it
//
// Looks up the caller's role in the live RolePermission matrix (President-
// editable via Settings ▸ Manage Roles) and blocks the request if the role's
// level for `module` is below `requiredLevel`. Must run after authMiddleware.
const requireModule = (module, requiredLevel = 'VIEW') => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' })
    }

    try {
      const allowed = await hasAccess(req.user.role, module, requiredLevel)
      if (!allowed) {
        return res.status(403).json({ message: 'Access denied' })
      }
      next()
    } catch (err) {
      return res.status(500).json({ message: 'Something went wrong.' })
    }
  }
}

module.exports = requireModule