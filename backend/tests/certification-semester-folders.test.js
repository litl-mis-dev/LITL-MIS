// Certification folders: Academic Year → Semester → Event. Event folders are
// filed under the semester active when the event is created, a semester shows
// once it is activated, new files are stored under the semester, and
// certificates issued before this change still verify. Runs against an
// in-memory fake Prisma — no database, storage or network. Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backend = path.resolve(__dirname, '..')
const stub = (rel, exports) => { require.cache[require.resolve(path.join(backend, rel))] = { exports } }

// ── Fake database ────────────────────────────────────────────────────────────
let db
let nextId
const reset = () => {
  db = { semesters: [], archives: [], folders: [], events: [], certificates: [], auditLogs: [], files: new Map() }
  nextId = 1
}
const byId = (rows, id) => rows.find((r) => r.id === id) ?? null
const withSemester = (folder) => folder && { ...folder, semester: byId(db.semesters, folder.semesterId) }

const fakePrisma = {
  semester: {
    findFirst: async ({ where }) => db.semesters.find((s) => s.isActive === where.isActive) ?? null,
    findMany: async ({ where }) => db.semesters.filter((s) => where.schoolYear.in.includes(s.schoolYear)),
  },
  certificationArchive: {
    findUnique: async ({ where }) => db.archives.find((a) => (where.id ? a.id === where.id : a.schoolYear === where.schoolYear)) ?? null,
    create: async ({ data }) => {
      const archive = { id: nextId++, createdAt: new Date(), ...data }
      db.archives.push(archive)
      return archive
    },
    findMany: async () => [...db.archives]
      .sort((a, b) => b.schoolYear.localeCompare(a.schoolYear))
      .map((archive) => ({
        ...archive,
        eventFolders: db.folders.filter((f) => f.certificationArchiveId === archive.id).map((f) => ({
          ...f,
          event: byId(db.events, f.eventId),
          _count: { certificates: db.certificates.filter((c) => c.eventCertificationFolderId === f.id).length },
        })),
      })),
  },
  eventCertificationFolder: {
    findUnique: async ({ where }) => withSemester(db.folders.find((f) => f.eventId === where.eventId)),
    create: async ({ data }) => {
      const folder = { id: nextId++, createdAt: new Date(), ...data }
      db.folders.push(folder)
      return withSemester(folder)
    },
  },
  event: {
    findUnique: async ({ where }) => byId(db.events, where.id),
  },
  certificate: {
    findUnique: async ({ where }) => db.certificates.find((c) => c.certificateNumber === where.certificateNumber) ?? null,
    create: async ({ data }) => {
      const certificate = { id: nextId++, status: 'ACTIVE', createdAt: new Date(), ...data, issuedBy: null }
      db.certificates.push(certificate)
      return certificate
    },
    findMany: async ({ where }) => db.certificates
      .filter((c) => c.eventCertificationFolderId === where.eventCertificationFolderId)
      .map((c) => ({ ...c, issuedBy: null })),
    findFirst: async ({ where }) => {
      const certificate = db.certificates.find((c) => where.OR.some((o) => Object.entries(o).every(([k, v]) => c[k] === v)))
      return certificate ? { ...certificate, event: byId(db.events, certificate.eventId) } : null
    },
  },
  auditLog: {
    findFirst: async ({ where }) => [...db.auditLogs].reverse()
      .find((l) => l.action === where.action && l.details.includes(where.details.contains)) ?? null,
  },
}

stub('src/lib/prisma.js', fakePrisma)
stub('src/realtime/socket.js', { emitToOfficers: () => {}, emitToHashChain: () => {} })
stub('src/utils/auditLog.js', { writeAuditLog: async (entry) => { db.auditLogs.push({ ...entry, details: JSON.stringify(entry.details) }) } })
stub('src/services/storage.service.js', {
  uploadFile: async (storagePath, buffer) => {
    db.files.set(storagePath, buffer)
    return { path: storagePath, publicUrl: `https://files.test/${storagePath}` }
  },
  downloadFile: async (storagePath) => db.files.get(storagePath),
})
stub('src/services/certificateStamp.service.js', { stampCertificate: async ({ buffer, mimeType }) => ({ buffer, mimeType }) })
stub('src/services/templateValidation.service.js', { validateTemplateDimensions: async () => ({ valid: true }) })

const certification = require(path.join(backend, 'src/controllers/certification.controller'))
const { buildPayload, computeHash, sha256 } = require(path.join(backend, 'src/utils/ledger'))

// ── Helpers ──────────────────────────────────────────────────────────────────
const addSemester = (schoolYear, semester, { isActive = false, hasBeenActivated = isActive } = {}) => {
  const row = { id: nextId++, schoolYear, semester, isActive, hasBeenActivated }
  db.semesters.push(row)
  return row
}
const activate = (row) => {
  db.semesters.forEach((s) => { s.isActive = false })
  Object.assign(row, { isActive: true, hasBeenActivated: true })
}
const addEvent = (title) => {
  const event = { id: nextId++, title, date: '2026-09-15', location: 'Room 101', status: 'COMING_SOON', isArchived: false }
  db.events.push(event)
  return event
}
const createEvent = async (title) => {
  const event = addEvent(title)
  await certification.ensureEventCertificationFolder(event, 1)
  return event
}
const call = async (handler, req) => {
  const res = { statusCode: 200 }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (body) => { res.body = body; return res }
  await handler({ user: { id: 1 }, params: {}, body: {}, ...req }, res)
  return res
}
const getTree = async () => (await call(certification.getTree, {})).body.archives

test.beforeEach(reset)

test('a new event goes into the semester that is active when it is created', async () => {
  const first = addSemester('2026-2027', 'FIRST', { isActive: true })
  const itWeek = await createEvent('IT Week 2026')

  const second = addSemester('2026-2027', 'SECOND')
  activate(second)
  const seminar = await createEvent('Cybersecurity Seminar')

  assert.equal(db.folders.find((f) => f.eventId === itWeek.id).semesterId, first.id)
  assert.equal(db.folders.find((f) => f.eventId === seminar.id).semesterId, second.id)
  assert.equal(db.archives.length, 1, 'both semesters share one academic year folder')
})

test('the tree is Academic Year → Semester → Event; the 2nd Semester shows only once activated', async () => {
  const first = addSemester('2026-2027', 'FIRST', { isActive: true })
  const second = addSemester('2026-2027', 'SECOND') // created ahead of time, not activated
  await createEvent('IT Week 2026')
  await createEvent('General Assembly')

  let [year] = await getTree()
  assert.equal(year.schoolYear, '2026-2027')
  assert.deepEqual(year.semesters.map((s) => s.label), ['1st Semester'])
  assert.deepEqual(year.semesters[0].eventFolders.map((f) => f.title), ['IT Week 2026', 'General Assembly'])
  assert.equal(year.semesters[0].isActive, true)
  assert.deepEqual(year.unassignedEventFolders, [])
  assert.equal(year.eventFolders.length, 2, 'flat list kept for the archive count')

  activate(second)
  await createEvent('Cybersecurity Seminar')
  ;[year] = await getTree()
  assert.deepEqual(year.semesters.map((s) => [s.label, s.isActive]), [['1st Semester', false], ['2nd Semester', true]])
  assert.deepEqual(year.semesters[1].eventFolders.map((f) => f.title), ['Cybersecurity Seminar'])
  assert.equal(first.isActive, false)
})

test('a new school year gets its own folder with its 1st Semester; older years stay', async () => {
  addSemester('2026-2027', 'FIRST', { isActive: true })
  await createEvent('IT Week 2026')
  const next = addSemester('2027-2028', 'FIRST')
  activate(next)
  await certification.ensureCertificationArchive('2027-2028', 1) // done by semester activation

  const tree = await getTree()
  assert.deepEqual(tree.map((a) => a.schoolYear), ['2027-2028', '2026-2027'], 'newest year first')
  assert.deepEqual(tree[0].semesters.map((s) => [s.label, s.eventFolders.length]), [['1st Semester', 0]])
  assert.deepEqual(tree[1].semesters[0].eventFolders.map((f) => f.title), ['IT Week 2026'])
})

test('folders made while no semester existed stay reachable from the academic year', async () => {
  const event = await createEvent('Orientation') // no semester at all yet
  const tree = await getTree()
  assert.equal(tree.length, 1)
  assert.deepEqual(tree[0].semesters, [])
  assert.deepEqual(tree[0].unassignedEventFolders.map((f) => f.eventId), [event.id])
})

test('new certificates are stored under the semester; opening the event reports it', async () => {
  addSemester('2026-2027', 'SECOND', { isActive: true })
  const event = await createEvent('IT Week 2026')

  const issued = await call(certification.issueCertificate, {
    params: { eventId: String(event.id) },
    files: [{ originalname: 'juan.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7 juan') }],
  })
  assert.equal(issued.statusCode, 201)
  const [storagePath] = db.files.keys()
  assert.match(storagePath, new RegExp(`^certification/2026-2027/2ND-SEMESTER/IT-WEEK-2026-${event.id}/[0-9a-f-]+\\.pdf$`))

  const opened = await call(certification.getEventFolder, { params: { eventId: String(event.id) } })
  assert.deepEqual(opened.body.folder.semester, { id: db.semesters[0].id, semester: 'SECOND', label: '2nd Semester', isActive: true })
  assert.equal(opened.body.certificates.length, 1)
})

test('a certificate issued before semester folders still verifies as valid', async () => {
  addSemester('2026-2027', 'FIRST', { isActive: true })
  const event = await createEvent('IT Week 2026')
  const folder = db.folders[0]

  // Stored with the old path (no semester segment) and anchored in the ledger.
  const oldPath = `certification/2026-2027/IT-WEEK-2026-${event.id}/old-public-id.pdf`
  const bytes = Buffer.from('%PDF-1.7 issued last month')
  db.files.set(oldPath, bytes)
  const certificateHash = sha256(bytes)
  db.certificates.push({
    id: nextId++, certificateNumber: 'K7MP3QXA', publicId: 'old-public-id', status: 'ACTIVE',
    eventCertificationFolderId: folder.id, eventId: event.id, storagePath: oldPath, certificateHash,
    publicUrl: `https://files.test/${oldPath}`, mimeType: 'application/pdf', createdAt: new Date('2026-10-01T00:00:00Z'),
  })
  const log = {
    id: 1, action: 'CERTIFICATE_ISSUED', actorId: 1, targetUserId: null, previousHash: 'GENESIS',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    details: JSON.stringify({ snapshot: { publicId: 'old-public-id', certificateNumber: 'K7MP3QXA', eventId: event.id, storagePath: oldPath, certificateHash } }),
  }
  log.hash = computeHash('GENESIS', buildPayload(log))
  db.auditLogs.push(log)

  const res = await call(certification.verifyCertificate, { params: { publicId: 'K7MP3QXA' } })
  assert.equal(res.body.status, 'VALID')
})
