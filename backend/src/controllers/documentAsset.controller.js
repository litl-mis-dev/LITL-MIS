const path = require('path')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const storageService = require('../services/storage.service')
const { validateTemplateDimensions } = require('../services/templateValidation.service')

const VALID_TYPES = ['disbursementTemplate', 'memberCertificate', 'membershipCard']
const STORAGE_FOLDER = 'templates'

function toResponse(row) {
  return {
    id: row.id,
    assetType: row.assetType,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    url: row.publicUrl,
    uploadedAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// GET /api/document-assets - officer/member session required
const getAssets = async (req, res) => {
  try {
    const rows = await prisma.documentAsset.findMany()
    const assets = {}
    for (const row of rows) assets[row.assetType] = toResponse(row)
    return res.json({ assets })
  } catch (err) {
    logError('Get document assets', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// GET /api/document-assets/public/member-certificate — no auth required.
// Used by the public certificate verification page so it can render the
// active membership certificate template instead of a hardcoded fallback.
// Only ever exposes this one template's URL — never officer-only assets.
const getPublicMemberCertificateTemplate = async (req, res) => {
  try {
    const asset = await prisma.documentAsset.findUnique({ where: { assetType: 'memberCertificate' } })
    return res.json({ url: asset?.publicUrl ?? null })
  } catch (err) {
    logError('Get public member certificate template', err)
    return res.status(500).json({ url: null })
  }
}

// POST /api/document-assets/:assetType
const uploadAsset = async (req, res) => {
  try {
    const { assetType } = req.params
    if (!VALID_TYPES.includes(assetType)) {
      return res.status(400).json({
        message: `Invalid asset type. Must be one of: ${VALID_TYPES.join(', ')}`,
      })
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided.' })
    }

    
    // Reject wrong size/orientation BEFORE anything is deleted or stored.
    const sizeCheck = await validateTemplateDimensions({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      templateType: assetType,
    })
    if (!sizeCheck.valid) {
      return res.status(400).json({ message: sizeCheck.message })
    }

    const existing = await prisma.documentAsset.findUnique({ where: { assetType } })

    const ext = path.extname(req.file.originalname).toLowerCase()
    const storagePath = `${STORAGE_FOLDER}/${assetType}-${Date.now()}${ext}`

    const { path: uploadedPath, publicUrl } = await storageService.uploadFile(
      storagePath,
      req.file.buffer,
      req.file.mimetype
    )

    const asset = await prisma.documentAsset.upsert({
      where: { assetType },
      update: {
        fileName: req.file.originalname,
        storagePath: uploadedPath,
        publicUrl,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedById: req.user.id,
      },
      create: {
        assetType,
        fileName: req.file.originalname,
        storagePath: uploadedPath,
        publicUrl,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedById: req.user.id,
      },
    })

    if (existing?.storagePath && existing.storagePath !== uploadedPath) {
      await storageService.deleteFile(existing.storagePath).catch(() => { })
    }
    
    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DOCUMENT_ASSET_UPLOADED,
      details: JSON.stringify({ assetType, fileName: req.file.originalname }),
    })

    return res.status(201).json({ message: 'Asset uploaded.', asset: toResponse(asset) })
  } catch (err) {
    logError('Upload document asset', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// DELETE /api/document-assets/:assetType
const deleteAsset = async (req, res) => {
  try {
    const { assetType } = req.params
    if (!VALID_TYPES.includes(assetType)) {
      return res.status(400).json({ message: 'Invalid asset type.' })
    }

    const existing = await prisma.documentAsset.findUnique({ where: { assetType } })
    if (!existing) return res.status(404).json({ message: 'Asset not found.' })

    await storageService.deleteFile(existing.storagePath).catch(() => { })
    await prisma.documentAsset.delete({ where: { assetType } })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.DOCUMENT_ASSET_DELETED,
      details: JSON.stringify({ assetType, fileName: existing.fileName }),
    })

    return res.json({ message: 'Asset removed.' })
  } catch (err) {
    logError('Delete document asset', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { getAssets, uploadAsset, deleteAsset, getPublicMemberCertificateTemplate }