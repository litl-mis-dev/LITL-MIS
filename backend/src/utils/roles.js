const ALL_ROLES = [
  'PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SECRETARY',
  'SEN_INTERNAL_AFFAIRS', 'SEN_EXTERNAL_AFFAIRS', 'SEN_FINANCE', 'SEN_AUDIT',
  'SEN_BUSINESS_AFFAIRS', 'SEN_LOGISTICS_PROPERTIES', 'SEN_PUBLICITY_INFORMATION',
  'SEN_ACADEMIC_AFFAIRS', 'SEN_RULES_CONSTITUTIONAL_AMENDMENTS',
  'SEN_SPORTS_ARTS_CULTURE', 'SEN_STUDENT_RIGHTS_WELFARE',
  'YEAR_REP_1', 'YEAR_REP_2', 'YEAR_REP_3', 'YEAR_REP_4',
  'ADVISER_DEPT_CHAIR', 'MEMBER',
]

// Every role except plain MEMBER — i.e. anyone who belongs in the officer
// workspace at all. Fine-grained per-module access is handled separately by
// the RBAC permission matrix (see services/permissions.service.js); this list
// only answers "is this an officer" for things like auth/view-as switching.
const OFFICER_ROLES = ALL_ROLES.filter((role) => role !== 'MEMBER')

// Officers with access to Hash Chain — every officer except the Adviser /
// Dept. Chair, who has no access to that module at all (not even view).
const HASH_CHAIN_ROLES = OFFICER_ROLES.filter((role) => role !== 'ADVISER_DEPT_CHAIR')

// The Adviser / Dept. Chair is a faculty seat, NOT a member of the org. It
// never pays membership fees, has no membership status, is never counted as
// a member, and has no Member-side dashboard or Member/Officer switch.
const NON_MEMBER_ROLES = ['ADVISER_DEPT_CHAIR']
const isNonMemberRole = (role) => NON_MEMBER_ROLES.includes(role)

// Prisma `where` fragment for a User: real members only, never an Adviser.
const MEMBERSHIP_USER_FILTER = { role: { notIn: NON_MEMBER_ROLES } }

// Officer roles that also have a Member-side dashboard.
const MEMBER_SIDE_ROLES = OFFICER_ROLES.filter((role) => !NON_MEMBER_ROLES.includes(role))

// Roles assignable to a member through Manage Roles.
const ASSIGNABLE_OFFICER_ROLES = OFFICER_ROLES.filter((role) => !NON_MEMBER_ROLES.includes(role))

const REGISTRATION_APPROVERS = [
  'PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN',
  'YEAR_REP_1', 'YEAR_REP_2', 'YEAR_REP_3', 'YEAR_REP_4',
]

// Assigning/removing an officer's role, and changing a member's lifecycle
const OFFICER_MANAGERS = ['PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN']

const YEAR_REP_TO_YEAR_LEVEL = {
  YEAR_REP_1: '1st Year',
  YEAR_REP_2: '2nd Year',
  YEAR_REP_3: '3rd Year',
  YEAR_REP_4: '4th Year',
}

const ANNOUNCEMENT_MANAGERS = ['PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SEN_PUBLICITY_INFORMATION']

const ROLE_HOME = {
  PRESIDENT_ADMIN:                      '/officers/dashboard',
  VICE_PRESIDENT_ADMIN:                 '/officers/dashboard',
  SECRETARY:                            '/officers/dashboard',
  SEN_INTERNAL_AFFAIRS:                 '/officers/dashboard',
  SEN_EXTERNAL_AFFAIRS:                 '/officers/dashboard',
  SEN_FINANCE:                          '/officers/dashboard',
  SEN_AUDIT:                            '/officers/dashboard',
  SEN_BUSINESS_AFFAIRS:                 '/officers/dashboard',
  SEN_LOGISTICS_PROPERTIES:             '/officers/dashboard',
  SEN_PUBLICITY_INFORMATION:            '/officers/dashboard',
  SEN_ACADEMIC_AFFAIRS:                 '/officers/dashboard',
  SEN_RULES_CONSTITUTIONAL_AMENDMENTS:  '/officers/dashboard',
  SEN_SPORTS_ARTS_CULTURE:              '/officers/dashboard',
  SEN_STUDENT_RIGHTS_WELFARE:           '/officers/dashboard',
  YEAR_REP_1:                           '/officers/dashboard',
  YEAR_REP_2:                           '/officers/dashboard',
  YEAR_REP_3:                           '/officers/dashboard',
  YEAR_REP_4:                           '/officers/dashboard',
  ADVISER_DEPT_CHAIR:                   '/officers/dashboard',
  MEMBER:                               '/members',
}

// ── Human-readable position labels for each role ──────────────────────────────
const ROLE_POSITION_LABELS = {
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
}

// ── Roles that serve as auto-filled signatories on financial documents ─────────
const SIGNATORY_ROLES = {
  president:  'PRESIDENT_ADMIN',
  senFinance: 'SEN_FINANCE',
  senAudit:   'SEN_AUDIT',
}

// ── Roles shown in the landing page's "Current Leadership" section ────────────
// Fixed display/sort order: President down to Senator for Student Rights and
// Welfare. Year Reps, the Adviser/Dept. Chair, and plain Members are excluded.
const LEADERSHIP_ROLES = [
  'PRESIDENT_ADMIN', 'VICE_PRESIDENT_ADMIN', 'SECRETARY',
  'SEN_INTERNAL_AFFAIRS', 'SEN_EXTERNAL_AFFAIRS', 'SEN_FINANCE', 'SEN_AUDIT',
  'SEN_BUSINESS_AFFAIRS', 'SEN_LOGISTICS_PROPERTIES', 'SEN_PUBLICITY_INFORMATION',
  'SEN_ACADEMIC_AFFAIRS', 'SEN_RULES_CONSTITUTIONAL_AMENDMENTS',
  'SEN_SPORTS_ARTS_CULTURE', 'SEN_STUDENT_RIGHTS_WELFARE',
]

module.exports = {
  ALL_ROLES, OFFICER_ROLES, HASH_CHAIN_ROLES, REGISTRATION_APPROVERS,
  NON_MEMBER_ROLES, isNonMemberRole, MEMBERSHIP_USER_FILTER, MEMBER_SIDE_ROLES, ASSIGNABLE_OFFICER_ROLES,
  ROLE_HOME, ROLE_POSITION_LABELS, SIGNATORY_ROLES, OFFICER_MANAGERS,
  ANNOUNCEMENT_MANAGERS, YEAR_REP_TO_YEAR_LEVEL, LEADERSHIP_ROLES,
}