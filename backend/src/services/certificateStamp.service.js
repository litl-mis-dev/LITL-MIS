// Takes an officer-uploaded, already-finished certificate (image or PDF) and
// returns a new copy with the Certificate ID and a scannable QR code stamped
// into the lower-right corner, inside a safe margin, without touching the
// original design otherwise. This module never designs a certificate — it
// only overlays verification information onto one that already exists.

const sharp = require('sharp')
const QRCode = require('qrcode')
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib')

// pdf-lib's Standard-14 fonts (Helvetica-Bold) carry built-in AFM width
// tables that don't require an embedded font subset to measure — we reuse
// this ONE font instance to measure certificate-number text width for BOTH
// the PDF and the PNG paths. This guarantees the two formats agree on
// exactly how wide the label text is, instead of each relying on its own
// renderer's font metrics (pdf-lib's Helvetica-Bold vs. the system/Arial
// font sharp's SVG rasterizer would use), which can differ enough to make
// text overflow the card in one format but not the other.
let sharedMeasurementFontPromise = null
function getSharedMeasurementFont() {
  if (!sharedMeasurementFontPromise) {
    sharedMeasurementFontPromise = PDFDocument.create().then((doc) => doc.embedFont(StandardFonts.HelveticaBold))
  }
  return sharedMeasurementFontPromise
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const SUPPORTED_PDF_MIME_TYPE = 'application/pdf'

// ── Shared physical stamp geometry ──────────────────────────────────────────
// Original bug: the PDF path measured everything in points (a real, fixed
// physical unit — 72pt = 1in), while the PNG path measured everything in
// pixels derived from unreliable embedded DPI metadata. Every single visual
// property below (QR size, margin, padding, label proportions, corner
// radius, border thickness) is now defined ONCE as a physical ratio/inch
// value and consumed identically by both paths — only the final unit
// conversion (pixels vs points) differs.
const QR_PHYSICAL_SIZE_INCHES = 0.7 // physical QR size, both formats (0.7in x 0.7in)
const MARGIN_PHYSICAL_INCHES = 0.175 // minimum distance from page edge to the stamp card (50% of previous 0.35in)
const MARGIN_SHORT_SIDE_RATIO = 0.0225 // margin also scales with page size, same ratio both formats (50% of previous 0.045)
const CARD_PADDING_RATIO = 0.09 // card padding around the QR, relative to qrSize
const LABEL_FONT_SIZE_RATIO = 0.15 // certificate-number font size, relative to qrSize
const LABEL_GAP_RATIO = 0.09 // gap between QR and label text, relative to qrSize
const CORNER_RADIUS_RATIO = 0 // no rounded corners — square card, both formats
const BORDER_WIDTH_INCHES = 0.015 // card border thickness, both formats
const POINTS_PER_INCH = 72

const A4_WIDTH_IN = 8.27
const A4_HEIGHT_IN = 11.69

// Single source of truth for margin, used identically by both paths (each
// converts the same "inches" result into its own unit).
function resolveMarginInches(shortSideInches) {
  return Math.max(MARGIN_PHYSICAL_INCHES, shortSideInches * MARGIN_SHORT_SIDE_RATIO)
}

// Given the actual pixel dimensions of an image, determine the true
// pixels-per-inch to use for physical sizing.
//
// Deliberately IGNORES embedded DPI metadata (`metadata.density`). That
// metadata is what caused the original PNG/PDF mismatch — it's frequently
// missing, defaulted (e.g. sharp's fallback of 96), or simply inaccurate for
// exported/scanned certificates. The PDF path never depends on file metadata
// (points are always physically correct), so for the two formats to produce
// a truly identical, guaranteed-consistent stamp, the PNG path must be
// equally metadata-independent — derived only from the certificate's known,
// fixed A4 page geometry.
function resolvePixelsPerInch(widthPx, heightPx) {
  const isLandscape = widthPx >= heightPx
  const physicalWidthIn = isLandscape ? A4_HEIGHT_IN : A4_WIDTH_IN
  const physicalHeightIn = isLandscape ? A4_WIDTH_IN : A4_HEIGHT_IN

  const ppiFromWidth = widthPx / physicalWidthIn
  const ppiFromHeight = heightPx / physicalHeightIn
  return (ppiFromWidth + ppiFromHeight) / 2
}

// Given a QR size (in whatever unit the caller is working in — px or pt),
// derive every other stamp dimension using the SAME ratios for both formats.
// This is the one place all the "same padding / same label proportions /
// same corner radius / same border width" geometry is computed, so PNG and
// PDF can never drift apart again.
function computeStampLayout(qrSize, unitsPerInch, textWidth) {
  const cardPadding = qrSize * CARD_PADDING_RATIO
  const fontSize = qrSize * LABEL_FONT_SIZE_RATIO
  const labelGap = qrSize * LABEL_GAP_RATIO
  const labelHeight = fontSize + labelGap // vertical space reserved below the QR for the certificate number
  const cornerRadius = cardPadding * CORNER_RADIUS_RATIO
  const borderWidth = BORDER_WIDTH_INCHES * unitsPerInch
  // Card width is the QR block's width UNLESS the certificate-number text
  // (measured with the shared font metrics) is wider — in which case the
  // card grows to fit it, identically in both formats, rather than letting
  // long certificate numbers overflow the rounded card in one format only.
  const innerWidth = Math.max(qrSize, textWidth)
  const cardWidth = innerWidth + cardPadding * 2
  const cardHeight = qrSize + cardPadding * 2 + labelHeight

  return { cardPadding, fontSize, labelGap, labelHeight, cornerRadius, borderWidth, cardWidth, cardHeight, innerWidth }
}

function isSupportedCertificateMime(mimeType) {
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) || mimeType === SUPPORTED_PDF_MIME_TYPE
}

// Builds an SVG path string for a rounded rectangle of the given size,
// anchored at (0,0) in its own local coordinate space. Used by BOTH the
// raster SVG card and the PDF SVG path so the two corner radii are drawn
// from the literal same geometry, not two different approximations.
function roundedRectPath(width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  return [
    `M ${r} 0`,
    `H ${width - r}`,
    `Q ${width} 0 ${width} ${r}`,
    `V ${height - r}`,
    `Q ${width} ${height} ${width - r} ${height}`,
    `H ${r}`,
    `Q 0 ${height} 0 ${height - r}`,
    `V ${r}`,
    `Q 0 0 ${r} 0`,
    'Z',
  ].join(' ')
}

// ── QR generation ─────────────────────────────────────────────────────────────

async function generateQrPngBuffer(verificationUrl, pixelSize) {
  return QRCode.toBuffer(verificationUrl, {
    type: 'png',
    errorCorrectionLevel: 'H', // high correction — certificate print quality varies
    margin: 1,
    width: pixelSize,
    color: { dark: '#0f172a', light: '#ffffffff' },
  })
}

// ── Raster (PNG/JPEG/WEBP) stamping ─────────────────────────────────────────
// QR + a white backing card are composited into the lower-right corner.
// Every geometric property (size, margin, padding, label proportions,
// corner radius, border thickness) comes from computeStampLayout(), the same
// function the PDF path uses — only the px-per-inch conversion differs.

async function stampRasterCertificate({ buffer, certificateNumber, verificationUrl }) {
  const image = sharp(buffer)
  const metadata = await image.metadata()
  const width = metadata.width
  const height = metadata.height

  if (!width || !height) {
    throw new Error('Unable to read certificate image dimensions.')
  }

  const shortSide = Math.min(width, height)
  const pixelsPerInch = resolvePixelsPerInch(width, height)

  const qrSize = Math.min(
    Math.round(QR_PHYSICAL_SIZE_INCHES * pixelsPerInch),
    Math.round(shortSide * 0.7) // guard against degenerate/tiny uploads
  )
  const marginInches = resolveMarginInches(shortSide / pixelsPerInch)
  const margin = Math.round(marginInches * pixelsPerInch)

  // Measure the label text with the SAME font metrics the PDF path uses, so
  // both formats agree on how wide the certificate number is and size their
  // card identically (see getSharedMeasurementFont).
  const measurementFont = await getSharedMeasurementFont()
  const provisionalFontSizePt = (qrSize / pixelsPerInch) * LABEL_FONT_SIZE_RATIO * POINTS_PER_INCH
  const textWidthPt = measurementFont.widthOfTextAtSize(certificateNumber, provisionalFontSizePt)
  const textWidth = (textWidthPt / POINTS_PER_INCH) * pixelsPerInch

  const layout = computeStampLayout(qrSize, pixelsPerInch, textWidth)
  const cardPadding = Math.round(layout.cardPadding)
  const fontSize = Math.round(layout.fontSize)
  const labelGap = Math.round(layout.labelGap)
  const labelHeight = fontSize + labelGap
  const cornerRadius = Math.round(layout.cornerRadius)
  const borderWidth = Math.max(1, Math.round(layout.borderWidth))
  const innerWidth = Math.round(layout.innerWidth)

  const cardWidth = innerWidth + cardPadding * 2
  const cardHeight = qrSize + cardPadding * 2 + labelHeight
  const qrOffsetX = cardPadding + Math.round((innerWidth - qrSize) / 2) // center the QR if the card widened for text

  const cardX = Math.max(margin, width - margin - cardWidth)
  const cardY = Math.max(margin, height - margin - cardHeight)

  const qrPngBuffer = await generateQrPngBuffer(verificationUrl, qrSize)

  // Text baseline sits `labelGap` below the QR, matching the PDF path's
  // `qrY - cardPadding - fontSize * 0.7` placement logic exactly (both put
  // the baseline roughly 0.7 * fontSize above the bottom of the label zone).
  const labelSvg = `
    <svg width="${cardWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="${cardWidth / 2}" y="${labelHeight - labelGap * 0.3}" text-anchor="middle"
            font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}"
            font-weight="700" fill="#334155">${escapeXml(certificateNumber)}</text>
    </svg>
  `

  const cardPath = roundedRectPath(cardWidth, cardHeight, cornerRadius)
  const cardSvg = `
    <svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">
      <path d="${cardPath}" fill="#ffffff" stroke="#e2e8f0" stroke-width="${borderWidth}" />
    </svg>
  `

  const stamped = await sharp(buffer)
    .composite([
      { input: Buffer.from(cardSvg), left: cardX, top: cardY },
      { input: qrPngBuffer, left: cardX + qrOffsetX, top: cardY + cardPadding },
      { input: Buffer.from(labelSvg), left: cardX, top: cardY + cardPadding + qrSize },
    ])
    .toFormat(metadata.format === 'jpeg' ? 'jpeg' : 'png')
    .toBuffer()

  return { buffer: stamped, mimeType: metadata.format === 'jpeg' ? 'image/jpeg' : 'image/png' }
}

// ── PDF stamping ─────────────────────────────────────────────────────────────
// Every page keeps its own original size/orientation (landscape or portrait
// certificates are both respected). Points are a real physical unit, so
// qrSize is defined directly from QR_PHYSICAL_SIZE_INCHES, and every other
// dimension comes from the SAME computeStampLayout() used by the raster
// path — including a true rounded-corner card, drawn via an SVG path since
// pdf-lib's drawRectangle cannot render rounded corners natively.

async function stampPdfCertificate({ buffer, certificateNumber, verificationUrl }) {
  const pdfDoc = await PDFDocument.load(buffer)
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const pages = pdfDoc.getPages()

  for (const page of pages) {
    const { width, height } = page.getSize()
    const shortSide = Math.min(width, height)

    const qrSize = Math.min(
      QR_PHYSICAL_SIZE_INCHES * POINTS_PER_INCH,
      shortSide * 0.7 // same guard as raster path, in points
    )
    const shortSideInches = shortSide / POINTS_PER_INCH
    const margin = resolveMarginInches(shortSideInches) * POINTS_PER_INCH

    const provisionalFontSizePt = qrSize * LABEL_FONT_SIZE_RATIO
    const textWidth = font.widthOfTextAtSize(certificateNumber, provisionalFontSizePt)

    const layout = computeStampLayout(qrSize, POINTS_PER_INCH, textWidth)
    const { cardPadding, fontSize, labelGap, labelHeight, cornerRadius, borderWidth, cardWidth, cardHeight, innerWidth } = layout
    const qrOffsetX = cardPadding + (innerWidth - qrSize) / 2 // center the QR if the card widened for text

    const qrPngBuffer = await generateQrPngBuffer(verificationUrl, 512)
    const qrImage = await pdfDoc.embedPng(qrPngBuffer)

    const cardRightX = width - margin
    const cardX = cardRightX - cardWidth
    const qrX = cardX + qrOffsetX
    const qrY = margin + labelHeight // leave room for the label below the QR, still inside the margin

    const cardBottomY = qrY - cardPadding - labelHeight // bottom-left corner of the card, in PDF's bottom-up coordinates

    // True rounded-corner card, built from the exact same path geometry as
    // the raster card (roundedRectPath), so the radius is not approximated
    // differently per format. drawSvgPath treats (x, y) as the path's local
    // (0,0) and renders the path with y increasing downward from there, so
    // we anchor at the card's top-left corner.
    const cardPath = roundedRectPath(cardWidth, cardHeight, cornerRadius)
    page.drawSvgPath(cardPath, {
      x: cardX,
      y: cardBottomY + cardHeight,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.89, 0.91, 0.94),
      borderWidth,
      opacity: 0.96,
    })

    page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize })

    page.drawText(certificateNumber, {
      x: cardX + cardPadding + (innerWidth - textWidth) / 2,
      y: qrY - cardPadding - fontSize * 0.7,
      size: fontSize,
      font,
      color: rgb(0.2, 0.25, 0.33),
    })
  }

  const stampedBytes = await pdfDoc.save()
  return { buffer: Buffer.from(stampedBytes), mimeType: SUPPORTED_PDF_MIME_TYPE }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function stampCertificate({ buffer, mimeType, certificateNumber, verificationUrl }) {
  if (mimeType === SUPPORTED_PDF_MIME_TYPE) {
    return stampPdfCertificate({ buffer, certificateNumber, verificationUrl })
  }
  if (SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    return stampRasterCertificate({ buffer, certificateNumber, verificationUrl })
  }
  throw new Error('Unsupported certificate file type.')
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

module.exports = {
  stampCertificate,
  isSupportedCertificateMime,
  SUPPORTED_IMAGE_MIME_TYPES,
  SUPPORTED_PDF_MIME_TYPE,
}