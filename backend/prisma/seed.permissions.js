const prisma = require('../src/lib/prisma')
const { toRows } = require('../src/utils/permissionModules')
require('dotenv').config()

// Mirrors the final permission list exactly (see utils/permissionModules.js).
// Once seeded, the President/VP can further tweak it via Settings ▸ Manage Roles.
const DEFAULT_PERMISSIONS = toRows()

async function seedPermissions() {
  console.log('Seeding role permissions...')
  for (const p of DEFAULT_PERMISSIONS) {
    await prisma.rolePermission.upsert({
      where: { role_module: { role: p.role, module: p.module } },
      update: process.env.NODE_ENV === 'production' && process.env.SEED_RESET_PERMISSIONS !== 'true'
        ? {}
        : { level: p.level },
      create: p,
    })
  }
  console.log(`Done — ${DEFAULT_PERMISSIONS.length} permissions seeded.`)
}

seedPermissions()
  .catch(console.error)
  .finally(() => prisma.$disconnect())