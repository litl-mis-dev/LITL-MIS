const prisma = require('../lib/prisma')

// In-process cache so every API request doesn't hit the DB.
// Invalidated whenever the President changes a permission.
let cache = null
let cacheAt = 0
const TTL_MS = 30_000 // 30 seconds

const LEVEL_RANK = { NONE: 0, VIEW: 1, EDIT: 2 }

async function loadPermissions() {
  const now = Date.now()
  if (cache && now - cacheAt < TTL_MS) return cache

  const rows = await prisma.rolePermission.findMany()
  const map  = {} // role -> { module -> level }
  for (const row of rows) {
    if (!map[row.role]) map[row.role] = {}
    map[row.role][row.module] = row.level
  }
  cache  = map
  cacheAt = now
  return map
}

function invalidateCache() {
  cache  = null
  cacheAt = 0
}

// Returns 'NONE' | 'VIEW' | 'EDIT' for a given role + module.
async function getLevel(role, module) {
  const map = await loadPermissions()
  return map[role]?.[module] ?? 'NONE'
}

// True if `role` has at least `requiredLevel` access to `module`.
// requiredLevel defaults to 'VIEW' (EDIT also satisfies a VIEW check).
async function hasAccess(role, module, requiredLevel = 'VIEW') {
  const level = await getLevel(role, module)
  return LEVEL_RANK[level] >= LEVEL_RANK[requiredLevel]
}

module.exports = { loadPermissions, invalidateCache, getLevel, hasAccess, LEVEL_RANK }