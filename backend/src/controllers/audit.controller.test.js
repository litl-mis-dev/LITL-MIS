const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function setup({ status = 'REVIEW', failNotification = false, activeYear = '2025-2026' } = {}) {
  let audit = { id: 1, status, remarks: 'Existing remarks', disbursementId: 5, updatedAt: new Date('2026-01-01') }
  const updates = []
  const logs = []
  const queries = []
  const dependencies = {
    '../lib/prisma': {
      semester: { findFirst: async () => activeYear ? { schoolYear: activeYear } : null },
      audit: {
        findUnique: async () => ({ ...audit }),
        findMany: async (args) => { queries.push(args); return [] },
        update: async ({ where, data }) => {
          if (where.status !== audit.status || where.updatedAt !== audit.updatedAt) {
            throw Object.assign(new Error('Record changed'), { code: 'P2025' })
          }
          updates.push(data)
          audit = { ...audit, ...data, updatedAt: new Date() }
          return { ...audit, disbursement: { reference: 'DIS-5', name: 'Event' } }
        },
      },
    },
    '../utils/logger': { logError() {} },
    '../utils/auditLog': { writeAuditLog: async (log) => logs.push(log) },
    '../utils/auditActions': { AUDIT_ACTIONS: { AUDIT_CLEARED: 'CLEARED', AUDIT_STATUS_UPDATED: 'UPDATED' } },
    '../services/notification.service': { notifyAuditStatusChanged: async () => {
      if (failNotification) throw new Error('Notification unavailable')
    } },
  }
  const context = { module: { exports: {} }, require: (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
    return dependencies[name]
  } }
  vm.runInNewContext(readFileSync(path.join(__dirname, 'audit.controller.js'), 'utf8'), context)
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  })
  const request = (newStatus, remarks) => ({ params: { id: '1' }, user: { id: 9 }, body: { status: newStatus, ...(remarks !== undefined ? { remarks } : {}) } })
  return { ...context.module.exports, response, request, updates, logs, queries, getAudit: () => audit }
}

test('a concurrent status update cannot overwrite clearance', async () => {
  const state = setup()
  const cleared = state.response()
  const pending = state.response()
  await Promise.all([
    state.reviewAudit(state.request('CLEARED'), cleared),
    state.reviewAudit(state.request('PENDING'), pending),
  ])
  assert.equal(cleared.statusCode, 200)
  assert.equal(pending.statusCode, 409)
  assert.equal(state.getAudit().status, 'CLEARED')
  assert.equal(state.updates.length, 1)
  assert.equal(state.logs.length, 1)
})

test('already cleared records remain locked', async () => {
  const state = setup({ status: 'CLEARED' })
  const res = state.response()
  await state.reviewAudit(state.request('REVIEW'), res)
  assert.equal(res.statusCode, 400)
  assert.equal(state.updates.length, 0)
})

test('notification failure does not turn a successful save into an error', async () => {
  const state = setup({ failNotification: true })
  const res = state.response()
  await state.reviewAudit(state.request('CLEARED'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.audit.status, 'CLEARED')
  assert.equal(res.body.audit.remarks, 'Existing remarks')
})

test('clarification validates, saves and logs remarks and review time', async () => {
  const state = setup()
  const invalid = state.response()
  await state.reviewAudit(state.request('FOR_CLARIFICATION', ' '), invalid)
  assert.equal(invalid.statusCode, 400)
  assert.equal(state.updates.length, 0)
  const res = state.response()
  await state.reviewAudit(state.request('FOR_CLARIFICATION', ' Missing receipt '), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.audit.remarks, 'Missing receipt')
  assert.ok(res.body.audit.reviewedAt)
  assert.equal(res.body.audit.reviewedById, 9)
  assert.equal(state.logs[0].details.remarks, 'Missing receipt')
})

test('invalid statuses and malformed remarks do not write records', async () => {
  const state = setup()
  for (const req of [state.request('INVALID'), state.request('REVIEW', {})]) {
    const res = state.response()
    await state.reviewAudit(req, res)
    assert.equal(res.statusCode, 400)
  }
  assert.equal(state.updates.length, 0)
})

test('audit list restricts both source types to the active academic year', async () => {
  const state = setup()
  const res = state.response()
  await state.listAudits({}, res)
  assert.equal(res.body.schoolYear, '2025-2026')
  const sources = state.queries[0].where.OR
  assert.equal(sources[0].disbursement.semester.schoolYear, '2025-2026')
  assert.equal(sources[1].returnFund.semester.schoolYear, '2025-2026')
  assert.equal(sources[0].disbursement.isArchived, false)
  assert.equal(sources[1].returnFund.isArchived, false)
})

test('no active semester returns an empty audit list', async () => {
  const state = setup({ activeYear: null })
  const res = state.response()
  await state.listAudits({}, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.audits.length, 0)
  assert.equal(res.body.schoolYear, null)
  assert.equal(state.queries.length, 0)
})
