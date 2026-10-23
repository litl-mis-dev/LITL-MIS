const crypto = require('crypto')
const path   = require('path')
const archiver = require('archiver')

const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { buildPayload, computeHash, sha256 } = require('../utils/ledger')
const storageService = require('../services/storage.service')
const { stampCertificate } = require('../services/certificateStamp.service')
const { validateTemplateDimensions } = require('../services/templateValidation.service')
const { emitToOfficers } = require('../realtime/socket')

const STORAGE_FOLDER = 'certification'
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(value, maxLength = 24) {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
}

// Unique 8-character alphanumeric Certificate ID (uppercase letters + digits,
// ambiguous characters like 0/O and 1/I excluded so it's easy to read/type
// off a printed certificate). This is the ID stamped on the certificate and
// the one officers/verifiers type in manually.
const CERTIFICATE_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateCertificateIdCandidate() {
  let id = ''
  const bytes = crypto.randomBytes(8)
  for (let i = 0; i < 8; i++) {
    id += CERTIFICATE_ID_ALPHABET[bytes[i] % CERTIFICATE_ID_ALPHABET.length]
  }
  return id
}

async function generateUniqueCertificateId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCertificateIdCandidate()
    const existing = await prisma.certificate.findUnique({ where: { certificateNumber: candidate } })
    if (!existing) return candidate
  }
  throw new Error('Failed to generate a unique Certificate ID. Please try again.')
}

// Ensures a CertificationArchive exists for the given academic year. Officers
// never create these directly — they're always a side effect of a semester
// being activated (or, defensively, of an event being created under a school
// year that doesn't have one yet).
async function ensureCertificationArchive(schoolYear, actorId, tx = prisma) {
  const existing = await tx.certificationArchive.findUnique({ where: { schoolYear } })
  if (existing) return { archive: existing, created: false }

  const archive = await tx.certificationArchive.create({ data: { schoolYear } })
  return { archive, created: true }
}

// Ensures an EventCertificationFolder exists for the given event, creating its
// parent CertificationArchive too if needed. Called automatically on event
// creation, and defensively whenever the certification module is opened for
// an event that predates this feature.
async function ensureEventCertificationFolder(event, actorId) {
  const existing = await prisma.eventCertificationFolder.findUnique({ where: { eventId: event.id } })
  if (existing) return existing

  const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
  const schoolYear = activeSemester?.schoolYear ?? String(new Date(event.date).getFullYear())

  const { archive, created } = await ensureCertificationArchive(schoolYear, actorId)
  if (created) {
    await writeAuditLog({
      actorId,
      action: AUDIT_ACTIONS.CERTIFICATION_ARCHIVE_CREATED,
      details: { schoolYear, archiveId: archive.id },
    })
  }

  return prisma.eventCertificationFolder.create({
    data: { eventId: event.id, certificationArchiveId: archive.id },
  })
}

function formatCertificate(cert) {
  return {
    id: cert.id,
    certificateNumber: cert.certificateNumber,
    publicId: cert.publicId,
    status: cert.status,
    originalFileName: cert.originalFileName,
    mimeType: cert.mimeType,
    fileSize: cert.fileSize,
    url: cert.publicUrl,
    verificationUrl: `${FRONTEND_URL}/verify/${cert.certificateNumber}`,
    certificateHash: cert.certificateHash,
    issuedAt: cert.createdAt,
    issuedBy: cert.issuedBy
      ? [cert.issuedBy.member?.firstName, cert.issuedBy.member?.lastName].filter(Boolean).join(' ') || cert.issuedBy.email
      : null,
    revokedAt: cert.revokedAt,
    revokeReason: cert.revokeReason,
    eventId: cert.eventId,
  }
}

// ── Archive tree (officer view) ─────────────────────────────────────────────
// GET /api/certification/tree
// Returns every academic year archive, with its event folders and per-folder
// certificate counts, in one shot — the whole left-hand tree the officer sees.
const getTree = async (req, res) => {
  try {
    const archives = await prisma.certificationArchive.findMany({
      orderBy: { schoolYear: 'desc' },
      include: {
        eventFolders: {
          include: {
            event: { select: { id: true, title: true, date: true, location: true, status: true } },
            _count: { select: { certificates: true } },
          },
        },
      },
    })

    return res.json({
      archives: archives.map((archive) => ({
        id: archive.id,
        schoolYear: archive.schoolYear,
        createdAt: archive.createdAt,
        eventFolders: archive.eventFolders
          .filter((folder) => folder.event) // guard against orphaned rows
          .map((folder) => ({
            id: folder.id,
            eventId: folder.eventId,
            title: folder.event.title,
            date: folder.event.date,
            location: folder.event.location,
            status: folder.event.status,
            certificateCount: folder._count.certificates,
          })),
      })),
    })
  } catch (err) {
    logError('Get certification tree', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Single event folder (officer view) ──────────────────────────────────────
// GET /api/certification/events/:eventId
const getEventFolder = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId)
    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event || event.isArchived) {
      return res.status(404).json({ message: 'Event not found.' })
    }

    const folder = await ensureEventCertificationFolder(event, req.user.id)

    const certificates = await prisma.certificate.findMany({
      where: { eventCertificationFolderId: folder.id },
      orderBy: { createdAt: 'desc' },
      include: { issuedBy: { select: { email: true, member: { select: { firstName: true, lastName: true } } } } },
    })

    return res.json({
      folder: { id: folder.id, eventId: folder.eventId, certificationArchiveId: folder.certificationArchiveId },
      event: { id: event.id, title: event.title, date: event.date, location: event.location, status: event.status },
      certificates: certificates.map(formatCertificate),
    })
  } catch (err) {
    logError('Get event certification folder', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Issue a certificate ──────────────────────────────────────────────────────
// POST /api/certification/events/:eventId/certificates  (multipart: certificate)
const issueCertificate = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId)
    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event || event.isArchived) {
      return res.status(404).json({ message: 'Event not found.' })
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No certificate file was uploaded.' })
    }

    const folder = await ensureEventCertificationFolder(event, req.user.id)
    const archive = await prisma.certificationArchive.findUnique({ where: { id: folder.certificationArchiveId } })

    const issued = []
    const failed = []

    // Each file is stamped, hashed, stored, and anchored independently so one
    // bad file in a batch doesn't block the rest of the upload.
    for (const file of req.files) {
      try {
        // Reject wrong size/orientation before a certificate ID is generated or anything is stored.
        const sizeCheck = await validateTemplateDimensions({
          buffer: file.buffer,
          mimeType: file.mimetype,
          templateType: 'eventCertificate',
        })
        if (!sizeCheck.valid) {
          failed.push({ fileName: file.originalname, message: sizeCheck.message, sizeRejected: true })
          continue
        }

        // Human-readable, printed Certificate ID — unique 8-character alphanumeric code.
        const certificateNumber = await generateUniqueCertificateId()
        const publicId = crypto.randomUUID()
        const verificationUrl = `${FRONTEND_URL}/verify/${certificateNumber}`

        // 1. Stamp Certificate ID + QR onto the officer's finished certificate.
        const { buffer: stampedBuffer, mimeType: stampedMimeType } = await stampCertificate({
          buffer: file.buffer,
          mimeType: file.mimetype,
          certificateNumber,
          verificationUrl,
        })

        // 2. Hash the FINAL (stamped) file — this is what gets anchored in the ledger.
        const certificateHash = sha256(stampedBuffer)

        // 3. Store the final file in Supabase, organized by academic year → event.
        const ext = stampedMimeType === 'application/pdf' ? '.pdf' : path.extname(file.originalname) || '.png'
        const storagePath = `${STORAGE_FOLDER}/${archive.schoolYear}/${slugify(event.title, 40)}-${event.id}/${publicId}${ext}`
        const { path: uploadedPath, publicUrl } = await storageService.uploadFile(storagePath, stampedBuffer, stampedMimeType)

        // 4. Persist the certificate record.
        const certificate = await prisma.certificate.create({
          data: {
            certificateNumber,
            publicId,
            eventCertificationFolderId: folder.id,
            eventId: event.id,
            originalFileName: file.originalname,
            mimeType: stampedMimeType,
            fileSize: stampedBuffer.length,
            storagePath: uploadedPath,
            publicUrl,
            certificateHash,
            issuedById: req.user.id,
          },
          include: { issuedBy: { select: { email: true, member: { select: { firstName: true, lastName: true } } } } },
        })

        // 5. Anchor the finalized certificate's hash into the centralized hash-linked ledger.
        await writeAuditLog({
          actorId: req.user.id,
          action: AUDIT_ACTIONS.CERTIFICATE_ISSUED,
          details: {
            certificateId: certificate.id,
            certificateNumber,
            eventId: event.id,
            eventTitle: event.title,
            snapshot: {
              publicId,
              certificateNumber,
              eventId: event.id,
              storagePath: uploadedPath,
              certificateHash,
            },
          },
        })

        issued.push(formatCertificate(certificate))
      } catch (err) {
        logError(`Issue certificate — ${file.originalname}`, err)
        failed.push({
          fileName: file.originalname,
          message: err.message?.includes('Unsupported') ? err.message : 'Failed to issue this certificate.',
        })
      }
    }

    if (issued.length === 0) {
      const allSizeRejected = failed.every((f) => f.sizeRejected)
      return res.status(allSizeRejected ? 400 : 500).json({
        message: allSizeRejected
          ? `${failed[0].fileName}: ${failed[0].message}${failed.length > 1 ? ` (${failed.length - 1} more file(s) were also rejected.)` : ''}`
          : 'None of the certificates could be issued.',
        failed,
      })
    }

    emitToOfficers('certificate:changed', { eventId: event.id, action: 'issued' })

    return res.status(201).json({
      message: failed.length > 0
        ? `Issued ${issued.length} of ${req.files.length} certificates.`
        : `Issued ${issued.length} certificate${issued.length === 1 ? '' : 's'}.`,
      certificates: issued,
      // Kept for backwards compatibility with callers expecting a single certificate.
      certificate: issued[0],
      failed,
    })
  } catch (err) {
    logError('Issue certificate', err)
    return res.status(500).json({ message: 'Something went wrong while issuing the certificates.' })
  }
}

// ── Revoke a certificate ─────────────────────────────────────────────────────
// POST /api/certification/certificates/:id/revoke
const revokeCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { reason } = req.body

    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) return res.status(404).json({ message: 'Certificate not found.' })
    if (certificate.status === 'REVOKED') {
      return res.status(400).json({ message: 'This certificate has already been revoked.' })
    }

    const updated = await prisma.certificate.update({
      where: { id },
      data: {
        status: 'REVOKED',
        revokedById: req.user.id,
        revokedAt: new Date(),
        revokeReason: reason?.trim() || null,
      },
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.CERTIFICATE_REVOKED,
      details: {
        certificateId: id,
        certificateNumber: certificate.certificateNumber,
        reason: reason?.trim() || null,
        snapshot: {
          publicId: certificate.publicId,
          certificateNumber: certificate.certificateNumber,
        },
      },
    })

    emitToOfficers('certificate:changed', { certificateId: id, eventId: certificate.eventId, action: 'revoked' })

    return res.json({ message: 'Certificate revoked.', certificate: formatCertificate(updated) })
  } catch (err) {
    logError('Revoke certificate', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Individual download ──────────────────────────────────────────────────────
// GET /api/certification/certificates/:id/download
const downloadCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const certificate = await prisma.certificate.findUnique({ where: { id } })
    if (!certificate) return res.status(404).json({ message: 'Certificate not found.' })

    const buffer = await storageService.downloadFile(certificate.storagePath)
    res.setHeader('Content-Type', certificate.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${certificate.certificateNumber}${path.extname(certificate.storagePath)}"`)
    return res.send(buffer)
  } catch (err) {
    logError('Download certificate', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Bulk download (whole event folder, zipped) ──────────────────────────────
// GET /api/certification/events/:eventId/certificates/download
// ── Bulk download (whole event folder, zipped) ──────────────────────────────
// GET /api/certification/events/:eventId/certificates/download
//
// The zip is built fully in memory before anything is sent to the client.
// Streaming straight to the response (archive.pipe(res)) meant that any
// hiccup mid-stream — a slow Supabase download, a network blip — left the
// connection cut with no valid Content-Length, which browsers report as an
// invalid/unreachable response. Buffering first means we either send one
// complete, correctly-sized zip, or a clean JSON error — never a broken one.
const downloadEventCertificatesZip = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId)
    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event) return res.status(404).json({ message: 'Event not found.' })

    const folder = await prisma.eventCertificationFolder.findUnique({ where: { eventId } })
    const certificates = folder
      ? await prisma.certificate.findMany({ where: { eventCertificationFolderId: folder.id }, orderBy: { createdAt: 'asc' } })
      : []

    if (certificates.length === 0) {
      return res.status(404).json({ message: 'No certificates have been issued for this event yet.' })
    }

    const zipBuffer = await buildCertificatesZipBuffer(certificates)

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${slugify(event.title, 40)}-certificates.zip"`)
    res.setHeader('Content-Length', zipBuffer.length)
    return res.send(zipBuffer)
  } catch (err) {
    logError('Bulk download certificates', err)
    if (!res.headersSent) return res.status(500).json({ message: 'Something went wrong while preparing the download.' })
    res.end()
  }
}

// Builds the zip entirely in memory and resolves with the finished Buffer.
async function buildCertificatesZipBuffer(certificates) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const chunks = []

    archive.on('data', (chunk) => chunks.push(chunk))
    archive.on('warning', (err) => logError('Zip certificates warning', err))
    archive.on('error', reject)
    archive.on('end', () => resolve(Buffer.concat(chunks)))

    ;(async () => {
      try {
        for (const cert of certificates) {
          const buffer = await storageService.downloadFile(cert.storagePath)
          const ext = path.extname(cert.storagePath) || '.pdf'
          archive.append(buffer, { name: `${cert.certificateNumber}${ext}` })
        }
        await archive.finalize()
      } catch (err) {
        reject(err)
      }
    })()
  })
}

// ── Public verification ─────────────────────────────────────────────────────
// GET /api/certification/verify/:publicId  — no auth required.
//
// Checks, in order:
//   1. Does a certificate with this publicId exist at all?
//   2. Has it been revoked?
//   3. Does its DB row still match the snapshot anchored in the ledger at
//      issuance time, and does the audit log entry's own hash still check out?
//   4. Do the actual stored file's bytes still hash to what was anchored?
const verifyCertificate = async (req, res) => {
  try {
    const rawInput = String(req.params.publicId || '').trim()
    if (!rawInput) {
      return res.json({ status: 'INVALID', reason: 'No certificate matches this ID or QR code.' })
    }

    // Accepts any of: the printed 8-character Certificate ID, the opaque QR
    // publicId, or the certificate's SHA-256 hash — whichever the scanner or
    // the person typing it in has on hand.
    const certificate = await prisma.certificate.findFirst({
      where: {
        OR: [
          { certificateNumber: rawInput },
          { publicId: rawInput },
          { certificateHash: rawInput },
        ],
      },
      include: { event: { select: { title: true, date: true } } },
    })

    if (!certificate) {
      return await verifyMembershipCertificate(rawInput, res)
    }

    if (certificate.status === 'REVOKED') {
      return res.json({
        status: 'REVOKED',
        certificate: {
          certificateNumber: certificate.certificateNumber,
          eventTitle: certificate.event.title,
          eventDate: certificate.event.date,
          issuedAt: certificate.createdAt,
          revokedAt: certificate.revokedAt,
          revokeReason: certificate.revokeReason,
        },
      })
    }

    // Locate the CERTIFICATE_ISSUED ledger entry for this certificate.
    const issuedLog = await prisma.auditLog.findFirst({
      where: { action: 'CERTIFICATE_ISSUED', details: { contains: `"publicId":"${certificate.publicId}"` } },
      orderBy: { id: 'desc' },
    })

    if (!issuedLog) {
      return res.json({ status: 'INVALID', reason: 'No ledger record exists for this certificate.' })
    }

    // Re-derive the ledger entry's own hash from its stored fields — catches
    // direct tampering with the AuditLog row itself.
    const derivedHash = computeHash(issuedLog.previousHash ?? 'GENESIS', buildPayload(issuedLog))
    const ledgerEntryIntact = derivedHash === issuedLog.hash

    let snapshot = null
    try { snapshot = JSON.parse(issuedLog.details)?.snapshot ?? null } catch { /* leave null */ }

    const snapshotMatchesRecord = Boolean(
      snapshot &&
      snapshot.certificateHash === certificate.certificateHash &&
      snapshot.storagePath === certificate.storagePath
    )

    // Re-hash the actual stored file to confirm it wasn't swapped after issuance.
    let fileHashMatches = false
    try {
      const fileBuffer = await storageService.downloadFile(certificate.storagePath)
      fileHashMatches = sha256(fileBuffer) === certificate.certificateHash
    } catch (err) {
      logError('Verify certificate — file re-hash failed', err)
    }

    const isValid = ledgerEntryIntact && snapshotMatchesRecord && fileHashMatches

    if (!isValid) {
      return res.json({
        status: 'INVALID',
        reason: 'This certificate exists but its integrity does not match the centralized hash-linked ledger.',
      })
    }

    return res.json({
      status: 'VALID',
      certificate: {
        certificateNumber: certificate.certificateNumber,
        eventTitle: certificate.event.title,
        eventDate: certificate.event.date,
        issuedAt: certificate.createdAt,
        fileUrl: certificate.publicUrl,
        mimeType: certificate.mimeType,
        certificateHash: certificate.certificateHash,
      },
    })
  } catch (err) {
    logError('Verify certificate', err)
    return res.status(500).json({ status: 'INVALID', reason: 'Verification could not be completed. Please try again.' })
  }
}

// Membership certificates aren't stored as files (no Supabase upload), so
// there's no "re-hash the stored file" step here — only the ledger snapshot
// cross-check, same principle as Event Certification's non-file checks.
async function verifyMembershipCertificate(rawInput, res) {
  const certificate = await prisma.membershipCertificate.findFirst({
    where: {
      OR: [
        { certificateNumber: rawInput },
        { certificateHash: rawInput },
      ],
    },
    include: {
      member: { select: { firstName: true, middleName: true, lastName: true, suffix: true, section: true } },
      semester: { select: { schoolYear: true, semester: true } },
    },
  })

  if (!certificate) {
    return res.json({ status: 'INVALID', reason: 'No certificate matches this ID or QR code.' })
  }

  const issuedLog = await prisma.auditLog.findFirst({
    where: { action: 'MEMBERSHIP_CERTIFICATE_ISSUED', details: { contains: `"certificateNumber":"${certificate.certificateNumber}"` } },
    orderBy: { id: 'desc' },
  })

  if (!issuedLog) {
    return res.json({ status: 'INVALID', reason: 'No ledger record exists for this certificate.' })
  }

  const derivedHash = computeHash(issuedLog.previousHash ?? 'GENESIS', buildPayload(issuedLog))
  const ledgerEntryIntact = derivedHash === issuedLog.hash

  let snapshot = null
  try { snapshot = JSON.parse(issuedLog.details)?.snapshot ?? null } catch { /* leave null */ }

  const snapshotMatchesRecord = Boolean(
    snapshot &&
    snapshot.certificateHash === certificate.certificateHash &&
    snapshot.paymentId === certificate.paymentId &&
    snapshot.memberId === certificate.memberId &&
    snapshot.semesterId === certificate.semesterId
  )

  if (!ledgerEntryIntact || !snapshotMatchesRecord) {
    return res.json({
      status: 'INVALID',
      reason: 'This certificate exists but its integrity does not match the centralized hash-linked ledger.',
    })
  }

  const memberName = [certificate.member.firstName, certificate.member.middleName, certificate.member.lastName, certificate.member.suffix]
    .filter(Boolean).join(' ')
  const SEMESTER_LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester' }

  return res.json({
    status: 'VALID',
    certificate: {
      certificateNumber: certificate.certificateNumber,
      certificateType: 'MEMBERSHIP',
      memberName,
      schoolYear: certificate.semester.schoolYear,
      semesterCode: certificate.semester.semester,
      semesterLabel: `${certificate.semester.schoolYear} ${SEMESTER_LABELS[certificate.semester.semester]}`,
      section: certificate.member.section ?? null,
      issuedAt: certificate.createdAt,
      certificateHash: certificate.certificateHash,
    },
  })
}

module.exports = {
  getTree,
  getEventFolder,
  issueCertificate,
  revokeCertificate,
  downloadCertificate,
  downloadEventCertificatesZip,
  verifyCertificate,
  ensureCertificationArchive,
  ensureEventCertificationFolder,
}