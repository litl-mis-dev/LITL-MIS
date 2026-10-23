// Mirrors backend/src/utils/permissionModules.js MODULES exactly. The
// default matrix itself lives server-side only (single source of truth) —
// the frontend always reads live levels from /role-permissions/mine or
// /role-permissions.

// DASHBOARD, HASH_CHAIN, and DOCUMENTS are intentionally NOT part of this
// list — they have no RBAC. Every officer gets Dashboard + Hash Chain view
// access, every officer gets Documents edit access, and the Adviser is
// special-cased directly in code (view-only on Documents, no access to Hash
// Chain) rather than through the configurable permission matrix.
export const MODULES = [
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

export const MODULE_LABELS = {
  MEMBER_LIST:       'Member List',
  MEMBERS_APPROVAL:  'Members Approval',
  AUDIT:             'Audit',
  EVENT:             'Event',
  CERTIFICATION:     'Certification',
  FINANCIAL:         'Financial',
  ACTIVITY_LOGS:     'Activity Logs',
  SETTINGS_ROLES:    'Settings (Manage Role)',
  SETTINGS_DESIGN:   'Settings (Design)',
}

export const LEVEL_RANK = { NONE: 0, VIEW: 1, EDIT: 2 }

// True if `level` (from a permissions map) satisfies `required` ('VIEW' by default).
export function levelSatisfies(level, required = 'VIEW') {
  return (LEVEL_RANK[level] ?? 0) >= (LEVEL_RANK[required] ?? 1)
}