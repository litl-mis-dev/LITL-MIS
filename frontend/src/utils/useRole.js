import { useAuth } from '../context/AuthContext'
import { OFFICER_MANAGERS, ANNOUNCEMENT_MANAGERS } from './roles'
import { levelSatisfies } from './permissionModules'

export function useRole() {
  const { user, permissions } = useAuth()
  const role = user?.role ?? null

  // Generic module check: can(module, requiredLevel = 'VIEW')
  function can(module, requiredLevel = 'VIEW') {
    return levelSatisfies(permissions?.[module], requiredLevel)
  }

  return {
    role,
    permissions,
    can,

    // Convenience flags used across existing pages — mapped onto the new
    // module/level matrix (see backend/src/utils/permissionModules.js).
    canViewFinancials:    can('FINANCIAL', 'VIEW'),
    canManageFinancials:  can('FINANCIAL', 'EDIT'),
    canArchiveFinancials: can('FINANCIAL', 'EDIT'),
    canAuditFinancials:   can('AUDIT', 'EDIT'),

    // MEMBER_LIST and MEMBERS_APPROVAL are separate modules and must be
    // checked independently — one's level must never gate the other's UI
    // or data.
    canViewMemberList:      can('MEMBER_LIST', 'VIEW'),
    canManageMemberList:    can('MEMBER_LIST', 'EDIT'),
    canViewMemberApproval:  can('MEMBERS_APPROVAL', 'VIEW'),
    canApproveMembers:      can('MEMBERS_APPROVAL', 'EDIT'),

    // Assigning/removing officer roles is a standing power, not part of the
    // per-module matrix — mirrors backend OFFICER_MANAGERS exactly.
    canManageOfficers: OFFICER_MANAGERS.includes(role),

    // Sending Announcements is likewise a standing power reserved for a
    // fixed set of seats — mirrors backend ANNOUNCEMENT_MANAGERS exactly.
    canManageAnnouncements: ANNOUNCEMENT_MANAGERS.includes(role),
  }
}