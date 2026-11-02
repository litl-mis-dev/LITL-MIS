// prisma/seed-permissions.sql is the manual fallback for seed.permissions.js.
// This keeps the two identical: if the default permission table in
// src/utils/permissionModules.js changes, regenerate the SQL file.
// Run with: npm test
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { toRows } = require('../src/utils/permissionModules')

test('seed-permissions.sql inserts exactly the default permission rows', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'seed-permissions.sql'), 'utf8')
  assert.match(sql, /INSERT IGNORE INTO RolePermission/, 'must never overwrite existing rows')

  const fromSql = [...sql.matchAll(/\('([A-Z_0-9]+)', '([A-Z_]+)', '(NONE|VIEW|EDIT)', NOW\(3\)\)/g)]
    .map(([, role, module, level]) => `${role}.${module}=${level}`)
    .sort()
  const fromCode = toRows().map((r) => `${r.role}.${r.module}=${r.level}`).sort()

  assert.equal(fromSql.length, fromCode.length)
  assert.deepEqual(fromSql, fromCode)
})
