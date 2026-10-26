// Every non-member seat in the org — mirrors backend/src/utils/roles.js
// exactly. This is the canonical role list the whole frontend keys off.
export const ALL_ROLES = [
  'PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SECRETARY',
  'SEN_INTERNAL_AFFAIRS', 'SEN_EXTERNAL_AFFAIRS', 'SEN_FINANCE', 'SEN_AUDIT',
  'SEN_BUSINESS_AFFAIRS', 'SEN_LOGISTICS_PROPERTIES', 'SEN_PUBLICITY_INFORMATION',
  'SEN_ACADEMIC_AFFAIRS', 'SEN_RULES_CONSTITUTIONAL_AMENDMENTS',
  'SEN_SPORTS_ARTS_CULTURE', 'SEN_STUDENT_RIGHTS_WELFARE',
  'YEAR_REP_1', 'YEAR_REP_2', 'YEAR_REP_3', 'YEAR_REP_4',
  'ADVISER_DEPT_CHAIR', 'MEMBER',
]

// Every role except plain MEMBER — anyone who belongs in the officer
// workspace at all. Fine-grained per-module access comes from the RBAC
// permission matrix (see utils/permissions.js), not this list.
export const OFFICER_ROLES = ALL_ROLES.filter((role) => role !== 'MEMBER')

// Officers with access to Hash Chain — every officer except the Adviser /
// Dept. Chair, who has no access to that module at all (not even view).
export const HASH_CHAIN_ROLES = OFFICER_ROLES.filter((role) => role !== 'ADVISER_DEPT_CHAIR')

// The Adviser / Dept. Chair is NOT a member: no membership payments, no member
// status, no Member dashboard, no Member/Officer switch. Mirrors backend.
export const NON_MEMBER_ROLES = ['ADVISER_DEPT_CHAIR']
export const isNonMemberRole = (role) => NON_MEMBER_ROLES.includes(role)

// Officer roles that also have a Member-side dashboard.
export const MEMBER_SIDE_ROLES = OFFICER_ROLES.filter((role) => !NON_MEMBER_ROLES.includes(role))

// Roles assignable to a member via Manage Roles.
export const ASSIGNABLE_OFFICER_ROLES = OFFICER_ROLES.filter((role) => !NON_MEMBER_ROLES.includes(role))

// Assigning/removing an officer's role, or changing a member's lifecycle
export const OFFICER_MANAGERS = ['PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN']

export const ANNOUNCEMENT_MANAGERS = ['PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SEN_PUBLICITY_INFORMATION']

// The first account on an empty system. Not a member or officer (so not in
// ALL_ROLES): it only approves registrations and assigns the first President.
export const DEVELOPER_ROLE = 'DEVELOPER'

export const ROLE_HOME = {
  ...Object.fromEntries(
    ALL_ROLES.map((role) => [role, role === 'MEMBER' ? '/members' : '/officers/dashboard'])
  ),
  [DEVELOPER_ROLE]: '/developer',
}

export const ROLE_LABELS = {
  PRESIDENT_ADMIN:                     'President',
  VICE_PRESIDENT_ADMIN:                'Vice President',
  SECRETARY:                           'Secretary',
  SEN_INTERNAL_AFFAIRS:                'Senator for Internal Affairs',
  SEN_EXTERNAL_AFFAIRS:                'Senator for External Affairs',
  SEN_FINANCE:                         'Senator for Finance',
  SEN_AUDIT:                           'Senator for Audit',
  SEN_BUSINESS_AFFAIRS:                'Senator for Business Affairs',
  SEN_LOGISTICS_PROPERTIES:            'Senator for Logistics and Properties',
  SEN_PUBLICITY_INFORMATION:           'Senator for Publicity and Information',
  SEN_ACADEMIC_AFFAIRS:                'Senator for Academic Affairs',
  SEN_RULES_CONSTITUTIONAL_AMENDMENTS: 'Senator for Rules and Constitutional Amendments',
  SEN_SPORTS_ARTS_CULTURE:             'Senator for Sports, Arts, and Culture',
  SEN_STUDENT_RIGHTS_WELFARE:          'Senator for Student Rights and Welfare',
  YEAR_REP_1:                          '1st Year Representative',
  YEAR_REP_2:                          '2nd Year Representative',
  YEAR_REP_3:                          '3rd Year Representative',
  YEAR_REP_4:                          '4th Year Representative',
  ADVISER_DEPT_CHAIR:                  'Adviser / Dept. Chair',
  MEMBER:                              'Member',
  DEVELOPER:                           'Developer',
}