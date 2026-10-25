const multer = require('multer')
const path   = require('path')

// All uploads use memoryStorage — files are kept as Buffers (req.file.buffer)
// and streamed straight to R2. Nothing is written to the local filesystem.

const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'rtf', 'odt', 'ods', 'odp',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'zip', 'rar', '7z',
])

const MAX_DOCUMENT_SIZE_MB    = Number(process.env.DOCUMENTS_MAX_FILE_SIZE_MB) || 25
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const MAX_FILES_PER_UPLOAD    = 10

function getExt(originalName) {
  return path.extname(originalName).toLowerCase().replace(/^\./, '')
}

// ── Documents upload ──────────────────────────────────────────────────────────

const multerDocuments = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(getExt(file.originalname))) {
      return cb(Object.assign(new Error('UNSUPPORTED_FILE_TYPE'), { code: 'UNSUPPORTED_FILE_TYPE' }))
    }
    cb(null, true)
  },
})

const uploadDocuments = (req, res, next) => {
  multerDocuments.array('files', MAX_FILES_PER_UPLOAD)(req, res, (err) => {
    if (!err) return next()
    if (err.code === 'LIMIT_FILE_SIZE')        return res.status(400).json({ message: `Each file must be smaller than ${MAX_DOCUMENT_SIZE_MB}MB.` })
    if (err.code === 'LIMIT_FILE_COUNT')       return res.status(400).json({ message: `You can upload up to ${MAX_FILES_PER_UPLOAD} files at a time.` })
    if (err.code === 'UNSUPPORTED_FILE_TYPE')  return res.status(400).json({ message: 'One or more files have an unsupported file type.' })
    return res.status(400).json({ message: err.message || 'File upload failed.' })
  })
}

// ── Document asset upload (templates, logos, avatars when sent via multipart) ─

const documentAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'))
    }
    cb(null, true)
  },
})

// ── Certificate upload (finished certificates — image or PDF) ─────────────────

const CERTIFICATE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf',
])
const MAX_CERTIFICATE_SIZE_MB    = Number(process.env.CERTIFICATE_MAX_FILE_SIZE_MB) || 20
const MAX_CERTIFICATE_SIZE_BYTES = MAX_CERTIFICATE_SIZE_MB * 1024 * 1024

const MAX_CERTIFICATE_FILES = Number(process.env.CERTIFICATE_MAX_FILES) || 30

const multerCertificate = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CERTIFICATE_SIZE_BYTES, files: MAX_CERTIFICATE_FILES },
  fileFilter: (req, file, cb) => {
    if (!CERTIFICATE_MIME_TYPES.has(file.mimetype)) {
      return cb(Object.assign(new Error('UNSUPPORTED_FILE_TYPE'), { code: 'UNSUPPORTED_FILE_TYPE' }))
    }
    cb(null, true)
  },
})

// Accepts multiple finished certificates in one request (field name
// "certificates") so an officer can select and issue a whole batch at once.
const uploadCertificate = (req, res, next) => {
  multerCertificate.array('certificates', MAX_CERTIFICATE_FILES)(req, res, (err) => {
    if (!err) {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No certificate file was uploaded.' })
      }
      return next()
    }
    if (err.code === 'LIMIT_FILE_SIZE')       return res.status(400).json({ message: `Each certificate file must be smaller than ${MAX_CERTIFICATE_SIZE_MB}MB.` })
    if (err.code === 'LIMIT_FILE_COUNT')      return res.status(400).json({ message: `You can upload up to ${MAX_CERTIFICATE_FILES} certificates at once.` })
    if (err.code === 'UNSUPPORTED_FILE_TYPE') return res.status(400).json({ message: 'Certificates must be finished PNG, JPEG, WEBP, or PDF files.' })
    return res.status(400).json({ message: err.message || 'File upload failed.' })
  })
}

module.exports = {
  uploadDocuments,
  documentAssetUpload,
  uploadCertificate,
  ALLOWED_DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_SIZE_BYTES,
  MAX_DOCUMENT_SIZE_MB,
  CERTIFICATE_MIME_TYPES,
  MAX_CERTIFICATE_SIZE_MB,
  MAX_CERTIFICATE_FILES,
}