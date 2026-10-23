const { OFFICER_ROLES, OFFICER_MANAGERS } = require('./roles')

// ── Group <-> label mapping (matches Documents.jsx groupAccessOptions exactly) ─

const GROUP_TO_LABEL = {
  MEMBERS: 'Members',
  ADVISER: 'Adviser/Dept. Chair',
}

const LABEL_TO_GROUP = {
  Members: 'MEMBERS',
  'Adviser/Dept. Chair': 'ADVISER',
}

// ── Role helpers ───────────────────────────────────────────────────────────────

// Drive-style super admins — always full access to every document, same idea
// as OFFICER_MANAGERS already being trusted with officer assignment elsewhere.
const isTopAdmin = (role) => OFFICER_MANAGERS.includes(role)
const isOfficerRole = (role) => OFFICER_ROLES.includes(role)

// ── Access lookups on a loaded DocumentItem (must include groupAccess + officerAccess) ─

function getOfficerAccessRow(doc, userId) {
  return doc.officerAccess?.find((row) => row.userId === userId) ?? null
}

function hasGroup(doc, group) {
  return doc.groupAccess?.some((row) => row.group === group) ?? false
}

// Returns 'VIEW' | 'EDIT' | null for the given user on the given document.
// null means "no access at all" — the document should not even be listed.
function getEffectivePermission(doc, user) {
  if (!doc || !user) return null

  // Use effectiveRole if set (X-View-As downgrade), otherwise real role.
  // This means an officer browsing the member section gets MEMBER-level
  // document access, not their officer-level access.
  const role = user.effectiveRole ?? user.role

  if (isTopAdmin(role)) return 'EDIT'

  const officerRow = getOfficerAccessRow(doc, user.id)

  if (role === 'MEMBER') {
    return hasGroup(doc, 'MEMBERS') ? 'VIEW' : null
  }

  if (role === 'ADVISER_DEPT_CHAIR') {
    // Documents has no RBAC, and the Adviser's access is always view-only —
    // even if a document's sharing settings would otherwise grant EDIT.
    if (officerRow) return 'VIEW'
    return hasGroup(doc, 'ADVISER') ? 'VIEW' : null
  }

  if (isOfficerRole(role)) {
    return officerRow ? officerRow.permission : null
  }

  return null
}

const canView = (doc, user) => getEffectivePermission(doc, user) !== null
const canEdit = (doc, user) => getEffectivePermission(doc, user) === 'EDIT'

// Sharing changes and permanent deletion are kept centrally controlled —
// only the document's owner or a top admin may perform them, even if other
// officers have been granted EDIT.
//const canManage = (doc, user) => isTopAdmin(user.role) || doc.ownerId === user.id
const canManage = (doc, user) => {
  const role = user.effectiveRole ?? user.role
  // The Adviser never manages documents (sharing/permanent-delete) — their
  // access is always view-only, regardless of ownership.
  if (role === 'ADVISER_DEPT_CHAIR') return false
  return isTopAdmin(role) || (isOfficerRole(role) && doc.ownerId === user.id)
}

// ── "Officers" derived group (matches frontend's hasAllOfficers logic) ─────────
// True once every currently active officer has an explicit DocumentOfficerAccess
// row on this document — never stored directly, always recomputed on read.
function hasAllOfficersAccess(doc, currentOfficerIds) {
  if (currentOfficerIds.length === 0) return false
  const withAccess = new Set(doc.officerAccess.map((row) => row.userId))
  return currentOfficerIds.every((id) => withAccess.has(id))
}

function computeGroupLabels(doc, currentOfficerIds) {
  const groups = doc.groupAccess.map((row) => GROUP_TO_LABEL[row.group]).filter(Boolean)
  if (hasAllOfficersAccess(doc, currentOfficerIds)) groups.push('Officers')
  return groups
}

// ── Parsing/validating the { groups, officers } payload from the sharing UI ────

const VALID_GROUP_LABELS = new Set(Object.keys(LABEL_TO_GROUP))
const VALID_PERMISSIONS = new Set(['view', 'edit'])

// Returns { groupEnums, officerPermissions } or throws with a user-facing message.
function parseAccessPayload(body, validOfficerIds) {
  const groupsInput = Array.isArray(body?.groups) ? body.groups : []
  const officersInput = body?.officers && typeof body.officers === 'object' ? body.officers : {}

  const groupEnums = []
  for (const label of groupsInput) {
    if (label === 'Officers') continue // derived, never stored directly
    if (!VALID_GROUP_LABELS.has(label)) {
      throw Object.assign(new Error(`Unknown access group: ${label}`), { status: 400 })
    }
    groupEnums.push(LABEL_TO_GROUP[label])
  }

  const validIdSet = new Set(validOfficerIds)
  const officerPermissions = {}
  for (const [rawId, permission] of Object.entries(officersInput)) {
    const userId = Number(rawId)
    if (!Number.isInteger(userId) || !validIdSet.has(userId)) {
      throw Object.assign(new Error('One or more selected officers are no longer valid.'), { status: 400 })
    }
    const normalized = String(permission).toLowerCase()
    if (!VALID_PERMISSIONS.has(normalized)) {
      throw Object.assign(new Error(`Invalid permission: ${permission}`), { status: 400 })
    }
    officerPermissions[userId] = normalized.toUpperCase()
  }

  return { groupEnums: [...new Set(groupEnums)], officerPermissions }
}

// ── Formatting helpers ──────────────────────────────────────────────────────────

function formatMemberName(user) {
  const m = user?.member
  if (m) {
    return [m.firstName, m.middleName, m.lastName, m.suffix].filter(Boolean).join(' ')
  }
  return user?.email ?? 'Unknown'
}

function formatDate(date) {
  if (!date) return null
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date))
}

function formatFileSize(bytes) {
  if (bytes == null) return undefined
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Shapes a DocumentItem (with owner + groupAccess + officerAccess included)
// into exactly the object Documents.jsx already expects as an `item`.
function formatDocument(doc, { currentOfficerIds, viewerUser }) {
  const permission = getEffectivePermission(doc, viewerUser)

  return {
    id: String(doc.id),
    type: doc.type.toLowerCase(),
    name: doc.name,
    parentId: doc.parentId != null ? String(doc.parentId) : null,
    ...(doc.previousParentId != null ? { previousParentId: String(doc.previousParentId) } : {}),
    owner: formatMemberName(doc.owner),
    ownerId: doc.ownerId,
    updatedAt: formatDate(doc.updatedAt),
    ...(doc.type === 'FILE' ? { size: formatFileSize(doc.size), fileType: doc.fileType } : {}),
    ...(doc.isTrashed ? { trashedAt: formatDate(doc.trashedAt) } : {}),
    access: {
      groups: computeGroupLabels(doc, currentOfficerIds),
      officers: Object.fromEntries(
        doc.officerAccess.map((row) => [String(row.userId), row.permission.toLowerCase()])
      ),
    },
    // Lets the frontend gate action buttons without re-deriving permission logic.
    myPermission: permission ? permission.toLowerCase() : null,
    canManage: canManage(doc, viewerUser),
  }
}

module.exports = {
  GROUP_TO_LABEL,
  LABEL_TO_GROUP,
  isTopAdmin,
  isOfficerRole,
  getEffectivePermission,
  canView,
  canEdit,
  canManage,
  hasAllOfficersAccess,
  computeGroupLabels,
  parseAccessPayload,
  formatMemberName,
  formatDate,
  formatFileSize,
  formatDocument,
}