// Validates the size and orientation of officer-uploaded templates BEFORE they
// are stored. This module only measures and reports — it never resizes, crops,
// stretches, or otherwise modifies the uploaded file.
//
// Physical size:
//  - PDF   : read from the page box (points → mm). This is a real physical size.
//  - Image : PNG/JPEG/WEBP have no reliable physical size (embedded DPI is often
//            missing or defaulted — the certificate stamp service ignores it for
//            the same reason). So an image is judged by its pixel proportions,
//            scaled to the required size (same approach as resolvePixelsPerInch
//            in certificateStamp.service.js), and each axis must land inside the
//            tolerance.

const sharp = require('sharp')
const { PDFDocument } = require('pdf-lib')

const MM_PER_POINT = 25.4 / 72
const EPSILON = 0.01 // absorbs floating-point noise only

// Keys match the documentAsset assetType values (+ eventCertificate).
const TEMPLATE_SPECS = {
  disbursementTemplate: { name: 'Disbursement & Return Fund template', label: 'A4 Portrait', width: 210,   height: 297,   tolerance: 5 },
  memberCertificate:    { name: 'Membership Certificate template',      label: 'A4 Landscape', width: 297, height: 210,   tolerance: 5 },
  eventCertificate:     { name: 'Event Certification template',         label: 'A4 Landscape', width: 297, height: 210,   tolerance: 5 },
  membershipCard:       { name: 'Membership Card template',             label: 'front + back side-by-side', width: 171.2, height: 53.98, tolerance: 2 },
}

const fmt = (n) => Number(n.toFixed(1)).toString()
const orientationOf = (w, h) => (w >= h ? 'Landscape' : 'Portrait')

async function readDimensions(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const pages = pdf.getPages()
    if (pages.length === 0) throw new Error('empty pdf')
    const sizes = pages.map((page) => {
      const box = page.getCropBox()
      const swap = Math.abs(page.getRotation().angle) % 180 === 90
      const w = (swap ? box.height : box.width) * MM_PER_POINT
      const h = (swap ? box.width : box.height) * MM_PER_POINT
      return { widthMm: w, heightMm: h }
    })
    return { kind: 'pdf', sizes }
  }

  const meta = await sharp(buffer).metadata()
  if (!meta.width || !meta.height) throw new Error('no dimensions')
  // EXIF orientations 5–8 are displayed rotated 90°.
  const rotated = meta.orientation >= 5 && meta.orientation <= 8
  return {
    kind: 'image',
    widthPx: rotated ? meta.height : meta.width,
    heightPx: rotated ? meta.width : meta.height,
  }
}

function buildMessage(spec, detectedText, problem) {
  return (
    `${spec.name} rejected: ${problem} ` +
    `Required size: ${spec.label} (${spec.width} × ${spec.height} mm). ` +
    `Detected size: ${detectedText}. ` +
    `Allowed tolerance: ±${spec.tolerance} mm for width and height.`
  )
}

// Returns { valid: true } or { valid: false, message }.
async function validateTemplateDimensions({ buffer, mimeType, templateType }) {
  const spec = TEMPLATE_SPECS[templateType]
  if (!spec) return { valid: true } // not a size-restricted template

  let dims
  try {
    dims = await readDimensions(buffer, mimeType)
  } catch {
    return {
      valid: false,
      message: `${spec.name} rejected: the file could not be read to check its size. Please upload a valid file.`,
    }
  }

  const requiredOrientation = orientationOf(spec.width, spec.height)

  const check = (widthMm, heightMm, detectedText) => {
    if (orientationOf(widthMm, heightMm) !== requiredOrientation) {
      return buildMessage(
        spec,
        detectedText,
        `wrong orientation (${orientationOf(widthMm, heightMm)} detected, ${requiredOrientation} required).`
      )
    }
    const widthOk = Math.abs(widthMm - spec.width) <= spec.tolerance + EPSILON
    const heightOk = Math.abs(heightMm - spec.height) <= spec.tolerance + EPSILON
    if (!widthOk || !heightOk) {
      return buildMessage(spec, detectedText, 'the size is outside the allowed tolerance.')
    }
    return null
  }

  if (dims.kind === 'pdf') {
    for (let i = 0; i < dims.sizes.length; i++) {
      const { widthMm, heightMm } = dims.sizes[i]
      const pageText = `${fmt(widthMm)} × ${fmt(heightMm)} mm${dims.sizes.length > 1 ? ` (page ${i + 1})` : ''}`
      const message = check(widthMm, heightMm, pageText)
      if (message) return { valid: false, message }
    }
    return { valid: true }
  }

  // Image: scale pixels to mm using the average of both axes' scale factors.
  const pxPerMm = (dims.widthPx / spec.width + dims.heightPx / spec.height) / 2
  const widthMm = dims.widthPx / pxPerMm
  const heightMm = dims.heightPx / pxPerMm
  const detectedText = `${dims.widthPx} × ${dims.heightPx} px (≈ ${fmt(widthMm)} × ${fmt(heightMm)} mm when scaled to the required size)`
  const message = check(widthMm, heightMm, detectedText)
  return message ? { valid: false, message } : { valid: true }
}

module.exports = { validateTemplateDimensions, TEMPLATE_SPECS }