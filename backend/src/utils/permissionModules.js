// Single source of truth for the RBAC module list. Each role's level per
// module lives in the RolePermission table and is edited in Settings ▸ Manage
// Roles.
//
// Levels: 'NONE' (hidden — no nav item, no page, no API access),
//         'VIEW' (read-only), 'EDIT' (full manage access).

// DASHBOARD, HASH_CHAIN, and DOCUMENTS are intentionally NOT part of this
// list — they have no RBAC. Every officer gets Dashboard + Hash Chain view
// access, every officer gets Documents edit access, and the Adviser is
// special-cased directly in code (view-only on Documents, no access to Hash
// Chain) rather than through the configurable permission matrix.
const MODULES = [
  'MEMBER_LIST',
  'MEMBERS_APPROVAL',
  'AUDIT',
  'EVENT',
  'CERTIFICATION',
  'FINANCIAL',
  'ACTIVITY_LOGS',
  'SETTINGS_ROLES',
  'SETTINGS_DESIGN',
]

module.exports = { MODULES }
