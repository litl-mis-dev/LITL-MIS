const path = require('path')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const { OFFICER_ROLES, ROLE_POSITION_LABELS } = require('../utils/roles')
const crypto = require('crypto')
const storageService = require('../services/storage.service')
const {
  canView,
  canEdit,
  canManage,
  getEffectivePermission,
  parseAccessPayload,
  formatMemberName,
  formatDocument,
} = require('../utils/documentAccess')
const { emitToAll } = require('../realtime/socket')


const MAX_NAME_LENGTH = 50

// ── Shared include/select shape ─────────────────────────────────────────────────

const DOCUMENT_INCLUDE = {
  owner: {
    select: {
      id: true, role: true, email: true,
      member: { select: { firstName: true, middleName: true, lastName: true, suffix: true } },
    },
  },
  groupAccess: true,
  officerAccess: true,
}

// ── Small helpers ────────────────────────────────────────────────────────────────

async function getCurrentOfficerIds() {
  const officers = await prisma.user.findMany({
    where: { role: { in: OFFICER_ROLES }, status: 'APPROVED' },
    select: { id: true },
  })
  return officers.map((o) => o.id)
}

function getExtensionLabel(fileName) {
  const ext = fileName.split('.').pop()
  return ext && ext.toLowerCase() !== fileName.toLowerCase() ? ext.toUpperCase() : 'FILE'
}

function validateName(rawName) {
  const name = String(rawName ?? '').trim()
  if (!name) throw Object.assign(new Error('A name is required.'), { status: 400 })
  if (name.length > MAX_NAME_LENGTH) {
    throw Object.assign(new Error(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`), { status: 400 })
  }
  if (/[/\\]/.test(name)) {
    throw Object.assign(new Error('Name cannot contain / or \\.'), { status: 400 })
  }
  return name
}

async function assertNoDuplicateFolderName({ parentId, name, excludeId = null }) {
  const existing = await prisma.documentItem.findFirst({
    where: {
      parentId,
      isTrashed: false,
      type: 'FOLDER',
      name: { equals: name },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  })
  if (existing) {
    throw Object.assign(new Error(`A folder named "${name}" already exists here.`), { status: 409 })
  }
}

async function loadDocument(id) {
  return prisma.documentItem.findUnique({ where: { id }, include: DOCUMENT_INCLUDE })
}

async function collectLiveDescendantIds(rootId) {
  const result = []
  let frontier = [rootId]
  while (frontier.length > 0) {
    const children = await prisma.documentItem.findMany({
      where: { parentId: { in: frontier }, isTrashed: false },
      select: { id: true },
    })
    const ids = children.map((c) => c.id)
    result.push(...ids)
    frontier = ids
  }
  return result
}

async function collectTrashedDescendantIds(rootId) {
  const result = []
  let frontier = [rootId]
  while (frontier.length > 0) {
    const children = await prisma.documentItem.findMany({
      where: { previousParentId: { in: frontier }, isTrashed: true },
      select: { id: true },
    })
    const ids = children.map((c) => c.id)
    result.push(...ids)
    frontier = ids
  }
  return result
}

async function grantDefaultOfficerAccess(tx, documentId, ownerId, currentOfficerIds) {
  const data = []

  // Owner gets an explicit EDIT row — this is now the ONLY source of their
  // edit access. When their role changes, getEffectivePermission will check
  // their current role and correctly deny access even though this row exists.
  data.push({ documentId, userId: ownerId, permission: 'EDIT' })

  // Every other current officer gets VIEW by default.
  for (const userId of currentOfficerIds) {
    if (userId !== ownerId) {
      data.push({ documentId, userId, permission: 'VIEW' })
    }
  }

  if (data.length === 0) return
  await tx.documentOfficerAccess.createMany({ data })
}

// ── List (also serves as search — pass ?search=) ────────────────────────────────

const listDocuments = async (req, res) => {
  try {
    const search = String(req.query.search ?? '').trim().toLowerCase()

    const [allDocs, currentOfficerIds] = await Promise.all([
      prisma.documentItem.findMany({ include: DOCUMENT_INCLUDE, orderBy: { name: 'asc' } }),
      getCurrentOfficerIds(),
    ])

    const items = allDocs
      .filter((doc) => canView(doc, req.user))
      .filter((doc) => !search || doc.name.toLowerCase().includes(search))
      .map((doc) => formatDocument(doc, { currentOfficerIds, viewerUser: req.user }))

    return res.json({ items })
  } catch (err) {
    logError('List documents', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Officers available for the sharing UI ───────────────────────────────────────

const getOfficersForSharing = async (req, res) => {
  try {
    const officers = await prisma.user.findMany({
      where: { role: { in: OFFICER_ROLES }, status: 'APPROVED' },
      select: {
        id: true, email: true, role: true,
        member: { select: { firstName: true, middleName: true, lastName: true, suffix: true, avatar: true } },
      },
      orderBy: { id: 'asc' },
    })

    const formatted = officers.map((user) => ({
      id: user.id,
      name: formatMemberName(user),
      email: user.email,
      role: ROLE_POSITION_LABELS[user.role] ?? user.role,
      avatar: user.member?.avatar ?? null,
    }))

    return res.json({ officers: formatted })
  } catch (err) {
    logError('List document-sharing officers', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Create folder ────────────────────────────────────────────────────────────────

const createFolder = async (req, res) => {
  try {
    const name = validateName(req.body.name)
    const parentId = req.body.parentId != null ? Number(req.body.parentId) : null

    let parent = null
    if (parentId != null) {
      parent = await loadDocument(parentId)
      if (!parent || parent.type !== 'FOLDER' || parent.isTrashed) {
        return res.status(404).json({ message: 'Destination folder not found.' })
      }
      if (!canEdit(parent, req.user)) {
        return res.status(403).json({ message: 'You do not have permission to add items to this folder.' })
      }
    }

    await assertNoDuplicateFolderName({ parentId, name })

    const currentOfficerIds = await getCurrentOfficerIds()

    const folder = await prisma.$transaction(async (tx) => {
      const created = await tx.documentItem.create({
        data: { type: 'FOLDER', name, parentId, ownerId: req.user.id },
      })
      await grantDefaultOfficerAccess(tx, created.id, req.user.id, currentOfficerIds)
      return created
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DOCUMENT_FOLDER_CREATED,
      details: { documentId: folder.id, name: folder.name, parentId },
    })

    const full = await loadDocument(folder.id)
    emitToAll('document:changed', { documentId: folder.id, action: 'created' })
    return res.status(201).json({
      message: 'Folder created.',
      item: formatDocument(full, { currentOfficerIds, viewerUser: req.user }),
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    logError('Create folder', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Upload files ──────────────────────────────────────────────────────────────────

const uploadFiles = async (req, res) => {
  const files = req.files ?? []
  const uploadedPaths = [] // for cleanup on error

  try {
    if (files.length === 0) return res.status(400).json({ message: 'No files were uploaded.' })

    const parentId = req.body.parentId != null && req.body.parentId !== ''
      ? Number(req.body.parentId)
      : null

    if (parentId != null) {
      const parent = await loadDocument(parentId)
      if (!parent || parent.type !== 'FOLDER' || parent.isTrashed)
        return res.status(404).json({ message: 'Destination folder not found.' })
      if (!canEdit(parent, req.user))
        return res.status(403).json({ message: 'You do not have permission to add items to this folder.' })
    }

    // Upload each file to R2 first
    const uploadResults = []
    for (const file of files) {
      const ext         = path.extname(file.originalname).toLowerCase()
      const storagePath = `documents/${crypto.randomUUID()}${ext}`
      const { path: uploadedPath, publicUrl } = await storageService.uploadFile(
        storagePath, file.buffer, file.mimetype
      )
      uploadedPaths.push(uploadedPath)
      uploadResults.push({ file, storagePath: uploadedPath, publicUrl })
    }

    const currentOfficerIds = await getCurrentOfficerIds()

    const created = await prisma.$transaction(async (tx) => {
      const rows = []
      for (const { file, storagePath, publicUrl } of uploadResults) {
        const row = await tx.documentItem.create({
          data: {
            type:             'FILE',
            name:             file.originalname,
            parentId,
            ownerId:          req.user.id,
            storagePath,
            publicUrl,
            originalFileName: file.originalname,
            mimeType:         file.mimetype,
            size:             file.size,
            fileType:         getExtensionLabel(file.originalname),
          },
        })
        await grantDefaultOfficerAccess(tx, row.id, req.user.id, currentOfficerIds)
        rows.push(row)
      }
      return rows
    })

    await writeAuditLog({
      actorId: req.user.id,
      action:  AUDIT_ACTIONS.DOCUMENT_UPLOADED,
      details: { parentId, files: created.map(f => ({ id: f.id, name: f.name })) },
    })

    const fullDocs = await Promise.all(created.map(f => loadDocument(f.id)))
    emitToAll('document:changed', { parentId, action: 'uploaded' })
    return res.status(201).json({
      message: `${created.length} file${created.length > 1 ? 's' : ''} uploaded.`,
      items: fullDocs.map(doc => formatDocument(doc, { currentOfficerIds, viewerUser: req.user })),
    })
  } catch (err) {
    // Clean up any files already uploaded to R2 before the error
    await storageService.deleteFiles(uploadedPaths)
    if (err.status) return res.status(err.status).json({ message: err.message })
    logError('Upload documents', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Rename ────────────────────────────────────────────────────────────────────────

const renameItem = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const doc = await loadDocument(id)
    if (!doc) return res.status(404).json({ message: 'Document not found.' })
    if (doc.isTrashed) return res.status(400).json({ message: 'Restore this item before renaming it.' })
    if (!canEdit(doc, req.user)) {
      return res.status(403).json({ message: 'You do not have permission to rename this item.' })
    }

    const name = validateName(req.body.name)

    if (doc.type === 'FOLDER') {
      await assertNoDuplicateFolderName({ parentId: doc.parentId, name, excludeId: doc.id })
    }

    const updated = await prisma.documentItem.update({
      where: { id },
      data: {
        name,
        ...(doc.type === 'FILE' ? { fileType: getExtensionLabel(name) } : {}),
      },
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DOCUMENT_RENAMED,
      details: { documentId: id, from: doc.name, to: updated.name },
    })

    const currentOfficerIds = await getCurrentOfficerIds()
    const full = await loadDocument(id)
    emitToAll('document:changed', { documentId: id, action: 'renamed' })
    return res.json({ message: 'Renamed.', item: formatDocument(full, { currentOfficerIds, viewerUser: req.user }) })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    logError('Rename document', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Sharing / access ─────────────────────────────────────────────────────────────

const updateAccess = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const doc = await loadDocument(id)
    if (!doc) return res.status(404).json({ message: 'Document not found.' })
    if (!canManage(doc, req.user)) {
      return res.status(403).json({ message: 'Only the owner or an administrator can manage sharing for this item.' })
    }

    const currentOfficerIds = await getCurrentOfficerIds()
    const { groupEnums, officerPermissions } = parseAccessPayload(req.body, currentOfficerIds)
    officerPermissions[doc.ownerId] = 'EDIT'

    await prisma.$transaction(async (tx) => {
      await tx.documentGroupAccess.deleteMany({ where: { documentId: id } })
      if (groupEnums.length > 0) {
        await tx.documentGroupAccess.createMany({
          data: groupEnums.map((group) => ({ documentId: id, group })),
        })
      }

      await tx.documentOfficerAccess.deleteMany({ where: { documentId: id } })
      const officerEntries = Object.entries(officerPermissions)
      if (officerEntries.length > 0) {
        await tx.documentOfficerAccess.createMany({
          data: officerEntries.map(([userId, permission]) => ({
            documentId: id, userId: Number(userId), permission,
          })),
        })
      }
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DOCUMENT_ACCESS_UPDATED,
      details: { documentId: id, name: doc.name, groups: groupEnums, officerCount: Object.keys(officerPermissions).length },
    })

    const full = await loadDocument(id)
    emitToAll('document:changed', { documentId: id, action: 'accessUpdated' })
    return res.json({ message: 'Sharing updated.', item: formatDocument(full, { currentOfficerIds, viewerUser: req.user }) })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    logError('Update document access', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Trash (soft delete) ──────────────────────────────────────────────────────────

const trashItem = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const doc = await loadDocument(id)
    if (!doc) return res.status(404).json({ message: 'Document not found.' })
    if (doc.isTrashed) return res.status(400).json({ message: 'This item is already in Temporary.' })
    if (!canEdit(doc, req.user)) {
      return res.status(403).json({ message: 'You do not have permission to delete this item.' })
    }

    const descendantIds = await collectLiveDescendantIds(id)
    const allIds = [id, ...descendantIds]

    const rows = await prisma.documentItem.findMany({
      where: { id: { in: allIds } },
      select: { id: true, parentId: true },
    })
    const now = new Date()

    await prisma.$transaction(
      rows.map((row) =>
        prisma.documentItem.update({
          where: { id: row.id },
          data: { previousParentId: row.parentId, parentId: null, isTrashed: true, trashedAt: now },
        })
      )
    )

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DOCUMENT_TRASHED,
      details: { documentId: id, name: doc.name, affectedCount: allIds.length },
    })

    emitToAll('document:changed', { documentId: id, action: 'trashed' })
    return res.json({ message: 'Moved to Temporary.' })
  } catch (err) {
    logError('Trash document', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────────

const restoreItem = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const doc = await loadDocument(id)
    if (!doc) return res.status(404).json({ message: 'Document not found.' })
    if (!doc.isTrashed) return res.status(400).json({ message: 'This item is not in Temporary.' })
    if (!canEdit(doc, req.user)) {
      return res.status(403).json({ message: 'You do not have permission to restore this item.' })
    }

    const descendantIds = await collectTrashedDescendantIds(id)
    const allIds = [id, ...descendantIds]

    const rows = await prisma.documentItem.findMany({
      where: { id: { in: allIds } },
      select: { id: true, previousParentId: true },
    })

    const rootRow = rows.find((r) => r.id === id)
    let rootTargetParentId = rootRow?.previousParentId ?? null
    if (rootTargetParentId != null) {
      const parent = await prisma.documentItem.findUnique({ where: { id: rootTargetParentId } })
      if (!parent || parent.isTrashed) rootTargetParentId = null
    }

    await prisma.$transaction(
      rows.map((row) =>
        prisma.documentItem.update({
          where: { id: row.id },
          data: {
            parentId: row.id === id ? rootTargetParentId : row.previousParentId,
            previousParentId: null,
            isTrashed: false,
            trashedAt: null,
          },
        })
      )
    )

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DOCUMENT_RESTORED,
      details: { documentId: id, name: doc.name, affectedCount: allIds.length },
    })

    emitToAll('document:changed', { documentId: id, action: 'restored' })
    return res.json({ message: 'Restored.' })
  } catch (err) {
    logError('Restore document', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Permanent delete ─────────────────────────────────────────────────────────────

const permanentlyDeleteItem = async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const doc = await loadDocument(id)
    if (!doc) return res.status(404).json({ message: 'Document not found.' })
    if (!doc.isTrashed)
      return res.status(400).json({ message: 'Move this item to Temporary before deleting it permanently.' })
    if (!canManage(doc, req.user))
      return res.status(403).json({ message: 'Only the owner or an administrator can permanently delete this item.' })

    const descendantIds = await collectTrashedDescendantIds(id)
    const allIds = [id, ...descendantIds]

    // Collect R2 paths BEFORE deleting the DB rows
    const filesToRemove = await prisma.documentItem.findMany({
      where:  { id: { in: allIds }, type: 'FILE', storagePath: { not: null } },
      select: { storagePath: true },
    })

    await prisma.documentItem.deleteMany({ where: { id: { in: allIds } } })

    // Best-effort deletion from R2 — DB rows are already gone
    await storageService.deleteFiles(filesToRemove.map(f => f.storagePath))

    await writeAuditLog({
      actorId: req.user.id,
      action:  AUDIT_ACTIONS.DOCUMENT_DELETED,
      details: { documentId: id, name: doc.name, affectedCount: allIds.length },
    })

    emitToAll('document:changed', { documentId: id, action: 'deleted' })
    return res.json({ message: 'Permanently deleted.' })
  } catch (err) {
    logError('Permanently delete document', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Download ──────────────────────────────────────────────────────────────────────

const downloadItem = async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const doc = await loadDocument(id)
    if (!doc) return res.status(404).json({ message: 'Document not found.' })
    if (!canView(doc, req.user))
      return res.status(403).json({ message: 'You do not have permission to download this item.' })
    // The Adviser's access to Documents is strictly view-only — downloading
    // is an action, not a view, so it's blocked even though they can view.
    if ((req.user.effectiveRole ?? req.user.role) === 'ADVISER_DEPT_CHAIR')
      return res.status(403).json({ message: 'You do not have permission to download this item.' })
    if (doc.type !== 'FILE')
      return res.status(400).json({ message: 'Folder download is not supported yet.' })
    if (!doc.storagePath)
      return res.status(404).json({ message: 'File is missing from storage.' })

    const signedUrl = await storageService.getSignedUrl(
      doc.storagePath, 300,
      { download: doc.originalFileName ?? doc.name }
    )

    await writeAuditLog({
      actorId: req.user.id,
      action:  AUDIT_ACTIONS.DOCUMENT_DOWNLOADED,
      details: { documentId: id, name: doc.name },
    })

    return res.redirect(signedUrl)
  } catch (err) {
    logError('Download document', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// ── Preview (inline) ─────────────────────────────────────────────────────────────

const previewItem = async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const doc = await loadDocument(id)
    if (!doc) return res.status(404).json({ message: 'Document not found.' })
    if (!canView(doc, req.user))
      return res.status(403).json({ message: 'You do not have permission to preview this item.' })
    if (doc.type !== 'FILE')
      return res.status(400).json({ message: 'Folders cannot be previewed.' })
    if (!doc.storagePath)
      return res.status(404).json({ message: 'File is missing from storage.' })

    // No download option → browser renders inline
    const signedUrl = await storageService.getSignedUrl(doc.storagePath, 300)
    return res.redirect(signedUrl)
  } catch (err) {
    logError('Preview document', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = {
  listDocuments,
  getOfficersForSharing,
  createFolder,
  uploadFiles,
  renameItem,
  updateAccess,
  trashItem,
  restoreItem,
  permanentlyDeleteItem,
  downloadItem,
  previewItem,
}