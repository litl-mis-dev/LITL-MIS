// What changed in an edit, for the record's edit history: [{ field, label, from, to }].
// `fields` maps each field to its label, and optionally a `format` function
// that turns a stored value into what people read (e.g. a status label).
function diffChanges(before, after, fields) {
  const changes = []
  for (const [field, spec] of Object.entries(fields)) {
    const { label, format = (v) => v } = typeof spec === 'string' ? { label: spec } : spec
    const from = normalize(format(before?.[field]))
    const to = normalize(format(after?.[field]))
    if (from !== to) changes.push({ field, label, from, to })
  }
  return changes
}

function normalize(value) {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

module.exports = { diffChanges }
