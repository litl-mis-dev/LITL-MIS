const { AUDIT_ACTION_LABELS } = require('./auditActions')

// What an Activity Log entry changed ([{ field, label, from, to }]) and a
// one-line summary of it for lists: "Amount spent: ₱150.00 → ₱120.00", or
// "Location: Room 1 → Gym (+2 more)" when one save changed several things.

// Entries written before `changes` existed (or by older code paths) still
// show what changed, from the fields those actions always recorded.
function changesOf(action, details) {
  if (Array.isArray(details?.changes)) return details.changes
  switch (action) {
    case 'CATEGORY_UPDATED':
      return [
        { field: 'name', label: 'Category name', from: details.previousName ?? null, to: details.name ?? null },
        { field: 'percentage', label: `${details.name ?? 'Category'} percentage`, from: details.previousPercentage ?? null, to: details.percentage ?? null },
      ].filter((c) => String(c.from) !== String(c.to))
    case 'RETURN_FUND_UPDATED':
      return [{ field: 'amountReturned', label: 'Amount returned', from: details.previousAmount ?? null, to: details.newAmount ?? null }]
    case 'AUDIT_STATUS_UPDATED':
    case 'AUDIT_CLEARED':
      return [{ field: 'status', label: 'Status', from: details.previousStatus ?? null, to: details.newStatus ?? null }]
    case 'EVENT_STATUS_CHANGED':
    case 'DISBURSEMENT_TITLE_UPDATED':
      return [{ field: action === 'EVENT_STATUS_CHANGED' ? 'status' : 'titleOfActivities', label: action === 'EVENT_STATUS_CHANGED' ? 'Status' : 'Title of activity', from: details.from ?? null, to: details.to ?? null }]
    default:
      return []
  }
}

const STATUS_LABELS = {
  COMING_SOON: 'Coming soon', OPEN: 'Open', CLOSED: 'Closed', CANCELLED: 'Cancelled',
  PENDING: 'Pending', REVIEW: 'Review', FOR_CLARIFICATION: 'For Clarification', CLEARED: 'Cleared',
  ACTIVE: 'Active', INACTIVE: 'Inactive', ARCHIVED: 'Archived', GRADUATED: 'Graduated',
  MALE: 'Male', FEMALE: 'Female',
}
const MONEY_FIELD = /amount|budget/i
// Fields whose old and new text is too long for one line: just "… updated".
const LONG_TEXT_FIELDS = new Set(['description', 'remarks'])
const MAX_VALUE_LENGTH = 30

function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (MONEY_FIELD.test(field) && !Number.isNaN(Number(value))) {
    return `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return STATUS_LABELS[value] ?? String(value)
}

const shorten = (text) => (text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1).trimEnd()}…` : text)

function describeChange(change, { short }) {
  if (LONG_TEXT_FIELDS.has(change.field)) return `${change.label} updated`
  const from = formatValue(change.field, change.from)
  const to = formatValue(change.field, change.to)
  return short ? `${change.label}: ${shorten(from)} → ${shorten(to)}` : `${change.label}: ${from} → ${to}`
}

// Entries with nothing changed old → new: a short name for what happened.
function actionSummary(action, details) {
  switch (action) {
    case 'EVENT_CREATED':
    case 'DISBURSEMENT_CREATED': return 'Created'
    case 'USER_APPROVED': return 'Approved'
    case 'DOCUMENT_UPLOADED': return 'Uploaded'
    case 'DOCUMENT_FOLDER_CREATED': return 'Folder created'
    case 'DOCUMENT_TRASHED': return 'Moved to Trash'
    case 'DOCUMENT_RESTORED': return 'Restored'
    case 'DOCUMENT_ACCESS_UPDATED': return 'Sharing updated'
    case 'CATEGORY_CREATED': {
      const count = Array.isArray(details?.names) ? details.names.length : 0
      return count ? `Added ${count} ${count === 1 ? 'category' : 'categories'}` : 'Categories added'
    }
    case 'CATEGORY_ARCHIVED': return details?.name ? `Archived ${details.name}` : 'Category archived'
    default: return AUDIT_ACTION_LABELS[action] ?? action
  }
}

// { summary, summaryFull } for one entry. `prefer` puts that field's change
// first when the entry has it (a Return Fund row shows "Amount returned"
// from an update that also changed its disbursement's amount spent).
function summarize(action, details, { prefer } = {}) {
  const changes = changesOf(action, details)
  if (changes.length === 0) {
    const text = actionSummary(action, details)
    return { summary: text, summaryFull: text }
  }
  const first = changes.find((c) => c.field === prefer) ?? changes[0]
  const more = changes.length > 1 ? ` (+${changes.length - 1} more)` : ''
  return {
    summary: describeChange(first, { short: true }) + more,
    summaryFull: describeChange(first, { short: false }) + more,
  }
}

module.exports = { changesOf, summarize, formatValue }
