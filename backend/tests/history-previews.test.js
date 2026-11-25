// Document previews served by the system, the audited record behind its
// certificate, and one edit history for the whole set of fund categories.
// Runs against a small fake database — no MySQL, storage or network.
// Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

let documents, stored, logs, auditLogRows
const reset = () => {
  documents = {
    1: { id: 1, type: 'FILE', name: 'Minutes.pdf', fileType: 'PDF', mimeType: 'application/pdf', storagePath: 'docs/1' },
    2: { id: 2, type: 'FILE', name: 'Budget.xlsx', fileType: 'XLSX', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', storagePath: 'docs/2' },
    // Renamed to .pdf after upload: still the spreadsheet it was uploaded as.
    3: { id: 3, type: 'FILE', name: 'Renamed.pdf', fileType: 'PDF', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', storagePath: 'docs/3' },
    4: { id: 4, type: 'FILE', name: 'Notes.csv', fileType: 'CSV', mimeType: 'text/csv; charset=utf-8', storagePath: 'docs/4' },
  }
  stored = { 'docs/1': Buffer.from('%PDF-1.4 test'), 'docs/2': Buffer.from('PK'), 'docs/3': Buffer.from('PK'), 'docs/4': Buffer.from('a,b\n1,2') }
  logs = []
  auditLogRows = []
}
reset()

stub('src/lib/prisma.js', {
  documentItem: { findUnique: async ({ where }) => documents[where.id] ?? null },
  audit: {
    findUnique: async ({ where }) => ({ 7: { disbursementId: 5, returnFundId: null }, 8: { disbursementId: null, returnFundId: 6 } })[where.id] ?? null,
  },
  disbursement: {
    findUnique: async () => ({ id: 5, reference: 'DIS-005', name: 'Carlo Reyes', amount: '200.00', fundCategory: { id: 1, name: 'General Fund' }, returnFunds: [] }),
    count: async () => 0,
  },
  returnFund: {
    findUnique: async () => ({ id: 6, reference: 'RET-006', amount: '80.00', disbursementId: 5, disbursement: { id: 5, reference: 'DIS-005' } }),
  },
  semester: { findFirst: async () => ({ id: 3, schoolYear: '2026-2027', semester: 'SECOND' }) },
  fundCategory: {
    findFirst: async () => ({ semesterId: 2 }),
    findUnique: async () => ({ id: 11, name: 'Events', semesterId: 2, isArchived: false }),
    update: async () => ({}),
  },
  auditLog: {
    findMany: async ({ where }) => auditLogRows.filter((r) => r.entityType === where.entityType && where.entityId.in.includes(r.entityId)),
  },
})
stub('src/services/storage.service.js', { downloadFile: async (key) => stored[key], getSignedUrl: async () => 'https://storage.example/signed' })
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { logs.push(entry) } })
stub('src/realtime/socket.js', { emitToOfficers: () => {}, emitToAll: () => {}, emitToUser: () => {}, emitToHashChain: () => {} })
stub('src/utils/documentAccess.js', {
  canView: () => true, canEdit: () => true, formatDocument: (d) => d, formatMemberName: () => 'Owner',
  GROUP_TO_LABEL: {}, LABEL_TO_GROUP: {}, isTopAdmin: () => false,
})
stub('src/services/calculations.service.js', {
  getFundReport: async () => ({ categories: [{ id: 11, name: 'Events', isTurnoverFund: false }, { id: 12, name: 'Turnover', isTurnoverFund: true }] }),
  RETURNS_SUMMARY_INCLUDE: {}, summarizeReturns: () => ({ amountSpent: '120.00' }),
  getTotalCategoryPercentage: async () => 0, parseAmount: (v) => v,
})

const { summarize } = require(path.join(backend, 'src/utils/historySummary'))
const documentCtrl = require(path.join(backend, 'src/controllers/document.controller'))
const auditCtrl = require(path.join(backend, 'src/controllers/audit.controller'))
const categoryCtrl = require(path.join(backend, 'src/controllers/fundCategory.controller'))

function call(handler, { params = {}, body = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      status(code) { this.statusCode = code; return this },
      set(h) { Object.assign(this.headers, h); return this },
      json(payload) { resolve({ status: this.statusCode, body: payload, res: this }); return this },
      send(payload) { resolve({ status: this.statusCode, sent: payload, res: this }); return this },
      redirect(url) { resolve({ status: 302, redirect: url, res: this }) },
    }
    handler({ params, body, user: { id: 1, role: 'PRESIDENT_ADMIN' } }, res)
  })
}

// ── Document preview ─────────────────────────────────────────────────────────
test('preview: a PDF is sent by the system to show inline — never a storage redirect', async () => {
  reset()
  const { status, sent, redirect, res } = await call(documentCtrl.previewItem, { params: { id: '1' } })
  assert.equal(status, 200)
  assert.equal(redirect, undefined)
  assert.equal(sent.toString(), '%PDF-1.4 test')
  assert.equal(res.headers['Content-Type'], 'application/pdf')
  assert.match(res.headers['Content-Disposition'], /^inline;/)
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
})

test('preview: CSV shows as plain text', async () => {
  reset()
  const { res } = await call(documentCtrl.previewItem, { params: { id: '4' } })
  assert.equal(res.headers['Content-Type'], 'text/plain; charset=utf-8')
})

test('preview: types a browser can\'t show are refused, judged by the type at upload (not a rename)', async () => {
  reset()
  for (const id of ['2', '3']) {
    const { status, body } = await call(documentCtrl.previewItem, { params: { id } })
    assert.equal(status, 415, id)
    assert.match(body.message, /download it to view/)
  }
})

// ── Audit: the record behind the certificate ────────────────────────────────
test('audit document: a disbursement comes back shaped like the Disbursement list', async () => {
  reset()
  const { status, body } = await call(auditCtrl.getAuditDocument, { params: { id: '7' } })
  assert.equal(status, 200)
  assert.equal(body.kind, 'disbursement')
  assert.equal(body.record.reference, 'DIS-005')
  assert.equal(body.record.amountSpent, '120.00', 'with its returns summary')
  assert.equal(body.record.returnFunds, undefined)
})

test('audit document: a return fund comes back with its disbursement; unknown records are 404', async () => {
  reset()
  const rf = await call(auditCtrl.getAuditDocument, { params: { id: '8' } })
  assert.equal(rf.body.kind, 'returnFund')
  assert.equal(rf.body.record.disbursement.reference, 'DIS-005')
  assert.equal((await call(auditCtrl.getAuditDocument, { params: { id: '99' } })).status, 404)
})

// ── Fund categories: one history for the set ─────────────────────────────────
test('categories: archiving is logged on the set\'s history, and the list returns that history', async () => {
  reset()
  const archived = await call(categoryCtrl.archiveCategory, { params: { id: '11' } })
  assert.equal(archived.status, 200)
  assert.deepEqual(logs[0].entity, { type: 'fundCategories', id: 2 }, 'kept under the semester the categories belong to')

  auditLogRows = [{ entityType: 'fundCategories', entityId: 2, action: 'CATEGORY_UPDATED', createdAt: new Date('2026-11-25T02:00:00Z'),
    details: JSON.stringify({ previousName: 'Events', name: 'Events Fund', previousPercentage: 20, percentage: 20 }),
    actor: { role: 'SEN_FINANCE', member: { firstName: 'Paolo', lastName: 'Torres' } } }]
  const { body } = await call(categoryCtrl.listCategories)
  assert.deepEqual(body.history, { id: 2, lastEdit: {
    name: 'Paolo Torres', at: auditLogRows[0].createdAt,
    summary: 'Category name: Events → Events Fund', summaryFull: 'Category name: Events → Events Fund',
  } })
})

// ── One-line summaries of the latest change ─────────────────────────────────
test('summary: one change shows old → new, with money and status labels readable', () => {
  assert.equal(summarize('X', { changes: [{ field: 'amountSpent', label: 'Amount spent', from: '150', to: '120.5' }] }).summary,
    'Amount spent: ₱150.00 → ₱120.50')
  assert.equal(summarize('EVENT_STATUS_CHANGED', { from: 'COMING_SOON', to: 'OPEN' }).summary, 'Status: Coming soon → Open')
  assert.equal(summarize('X', { changes: [{ field: 'middleName', label: 'Middle name', from: null, to: 'Reyes' }] }).summary,
    'Middle name: (empty) → Reyes')
})

test('summary: several changes show the first and a count', () => {
  const { summary } = summarize('EVENT_UPDATED', { changes: [
    { field: 'location', label: 'Location', from: 'Room 1', to: 'Gym' },
    { field: 'time', label: 'Time', from: '09:00', to: '10:00' },
    { field: 'budget', label: 'Budget', from: '100', to: '120' },
  ] })
  assert.equal(summary, 'Location: Room 1 → Gym (+2 more)')
})

test('summary: a shared update shows the part each list prefers', () => {
  const details = { changes: [
    { field: 'amountSpent', label: 'Amount spent', from: '150.00', to: '120.00' },
    { field: 'amountReturned', label: 'Amount returned', from: '0.00', to: '30.00' },
  ] }
  assert.equal(summarize('RETURN_FUND_UPDATED', details, { prefer: 'amountSpent' }).summary, 'Amount spent: ₱150.00 → ₱120.00 (+1 more)')
  assert.equal(summarize('RETURN_FUND_UPDATED', details, { prefer: 'amountReturned' }).summary, 'Amount returned: ₱0.00 → ₱30.00 (+1 more)')
})

test('summary: long text says "updated"; long values are shortened with the full text kept', () => {
  assert.equal(summarize('X', { changes: [{ field: 'description', label: 'Description', from: 'a', to: 'b' }] }).summary, 'Description updated')
  const long = 'A very long event title that keeps going'
  const result = summarize('X', { changes: [{ field: 'title', label: 'Title', from: 'Seminar', to: long }] })
  assert.equal(result.summary, 'Title: Seminar → A very long event title that…')
  assert.equal(result.summaryFull, `Title: Seminar → ${long}`)
})

test('summary: entries with nothing changed old → new name what happened', () => {
  assert.equal(summarize('DISBURSEMENT_CREATED', {}).summary, 'Created')
  assert.equal(summarize('USER_APPROVED', {}).summary, 'Approved')
  assert.equal(summarize('CATEGORY_CREATED', { names: ['Events', 'Sports'] }).summary, 'Added 2 categories')
  assert.equal(summarize('CATEGORY_ARCHIVED', { name: 'Events' }).summary, 'Archived Events')
  assert.equal(summarize('DOCUMENT_TRASHED', {}).summary, 'Moved to Trash')
})
