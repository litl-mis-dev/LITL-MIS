const fs = require('fs')
const path = require('path')

// Migrations aren't applied on deploy (docs/RUNBOOK.md), so new code can go
// live against a database that's missing a table or column it needs. This
// compares the migrations shipped with the code with the ones the database
// has finished, so /api/health/ready (and the uptime monitor) can say so.

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'prisma', 'migrations')

function shippedMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

// Names of shipped migrations the database hasn't finished applying.
async function pendingMigrations(prisma, dir = MIGRATIONS_DIR) {
  const applied = await prisma.$queryRaw`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  const done = new Set(applied.map((row) => row.migration_name))
  return shippedMigrations(dir).filter((name) => !done.has(name))
}

module.exports = { pendingMigrations, shippedMigrations }
