import cvsuLogoUrl from "../assets/images/CvSU_Logo.png";
import litlLogoUrl  from "../assets/images/LITL_Logo.png";

export const A4_WIDTH_POINTS  = 595.28;
export const A4_HEIGHT_POINTS = 841.89;
export const CANVAS_WIDTH     = 1240;
export const CANVAS_HEIGHT    = 1754;

const WHITE    = "#ffffff";
const TEXT     = "#111827";
const FORM_FONT = "24px Arial";

const A4_WIDTH_INCHES        = A4_WIDTH_POINTS / 72;
const CANVAS_PIXELS_PER_INCH = CANVAS_WIDTH / A4_WIDTH_INCHES;
const CANVAS_PIXELS_PER_CM   = CANVAS_PIXELS_PER_INCH / 2.54;
const HEADER_WIDTH           = 8.07 * CANVAS_PIXELS_PER_INCH;
const DEFAULT_HEADER_START_Y = 2.5  * CANVAS_PIXELS_PER_CM;

const DEFAULT_PAGE_MARGINS = { top: 150, right: 150, bottom: 150, left: 150 };
const DEFAULT_FRAME_MARGINS = { top: 0, right: 0, bottom: 0, left: 0 };

// ── Layout ────────────────────────────────────────────────────────────────────

function createLayout(margins = {}, frameMargins = {}) {
    const pageMargins          = { ...DEFAULT_PAGE_MARGINS,  ...margins };
    const documentFrameMargins = { ...DEFAULT_FRAME_MARGINS, ...frameMargins };
    const contentLeft  = pageMargins.left;
    const contentRight = CANVAS_WIDTH - pageMargins.right;
    const frameLeft    = documentFrameMargins.left;
    const frameRight   = CANVAS_WIDTH - documentFrameMargins.right;

    return {
        pageMargins,
        documentFrameMargins,
        contentLeft,
        contentRight,
        contentWidth: contentRight - contentLeft,
        frameLeft,
        frameRight,
        frameWidth: frameRight - frameLeft,
    };
}

function getLayout(context) {
    return context.__certificateLayout ?? createLayout();
}

export function getCertificateContentLayout(context) {
    const { contentLeft, contentRight, contentWidth } = getLayout(context);
    return { contentLeft, contentRight, contentWidth };
}

// ── Drawing primitives ────────────────────────────────────────────────────────

export function getValue(value, fallback = "") {
    return value?.toString().trim() || fallback;
}

function formatSignatureName(name) {
    const normalizedName = getValue(name, "");
    const parts = normalizedName.split(/\s+/).filter(Boolean);
    if (parts.length < 3) return normalizedName.toUpperCase();
    return parts.map((part, index) => {
        const isMiddleName = index > 0 && index < parts.length - 1;
        return isMiddleName ? `${part.charAt(0).toUpperCase()}.` : part;
    }).join(" ").toUpperCase();
}

function drawText(context, text, x, y, options = {}) {
    const { font = "22px Arial", align = "left", color = TEXT, underline = false, bold = false } = options;
    context.font         = bold ? `700 ${font}` : font;
    context.fillStyle    = color;
    context.textAlign    = align;
    context.textBaseline = "alphabetic";
    context.fillText(text, x, y);

    if (underline) {
        const width = context.measureText(text).width;
        let startX  = x;
        if (align === "center") startX = x - width / 2;
        if (align === "right")  startX = x - width;
        context.beginPath();
        context.moveTo(startX, y + 5);
        context.lineTo(startX + width, y + 5);
        context.lineWidth   = 2;
        context.strokeStyle = color;
        context.stroke();
    }
}

function drawLine(context, x1, y1, x2, y2, width = 2, color = TEXT) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.lineWidth   = width;
    context.strokeStyle = color;
    context.stroke();
}

function drawImageMaxFit(context, image, x, y, width, height) {
    const scale     = Math.min(width / image.width, height / image.height);
    const drawWidth  = image.width  * scale;
    const drawHeight = image.height * scale;
    const drawX     = x + (width  - drawWidth)  / 2;
    const drawY     = y + (height - drawHeight) / 2;
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

// ── Header / Footer ───────────────────────────────────────────────────────────

function drawDefaultHeaderText(context, x, y, width, assets = {}) {
    const centerX  = x + width / 2;
    const startY   = y + DEFAULT_HEADER_START_Y;
    const logoSize = 128;
    const logoY    = startY - 24;

    if (assets.defaultCvsuLogo) {
        drawImageMaxFit(context, assets.defaultCvsuLogo, x + 24, logoY, logoSize, logoSize);
    }
    if (assets.defaultLitlLogo) {
        drawImageMaxFit(context, assets.defaultLitlLogo, x + width - logoSize - 24, logoY, logoSize, logoSize);
    }

    drawText(context, "REPUBLIC OF THE PHILIPPINES", centerX, startY, { font: "20px Arial", align: "center" });
    drawText(context, "CAVITE STATE UNIVERSITY", centerX, startY + 27, { font: "20px Arial", align: "center" });
    drawText(context, "LEAGUE OF INFORMATION TECHNOLOGY LEADERS", centerX, startY + 66, { font: "32px Arial", align: "center", bold: true });
    drawText(context, "Trece Martires City Campus - Brgy Gregorio, Trece Martires City, Cavite", centerX, startY + 100, { font: "20px Arial", align: "center" });
    drawLine(context, x, startY + 130, x + width, startY + 130, 1.5, TEXT);
}

function drawHeader(context, assets = {}) {
    const { documentFrameMargins, frameLeft, frameWidth } = getLayout(context)
    const headerWidth = Math.min(HEADER_WIDTH, frameWidth)
    const headerX     = frameLeft + (frameWidth - headerWidth) / 2

    context.fillStyle = WHITE
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    // disbursementTemplate is the full-page A4 background — draw it and skip
    // the default header/footer since the template already contains them
    if (assets.disbursementTemplate) {
        context.drawImage(assets.disbursementTemplate, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
        return
    }

    // No custom template — draw the default programmatic header
    drawDefaultHeaderText(context, headerX, documentFrameMargins.top, headerWidth, assets)
}

// ── Document content ──────────────────────────────────────────────────────────

function drawJustifiedText(context, text, x, y, maxWidth, lineHeight) {
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line    = [];

    words.forEach((word) => {
        const testLine = [...line, word].join(" ");
        if (context.measureText(testLine).width > maxWidth && line.length) {
            lines.push(line);
            line = [word];
            return;
        }
        line.push(word);
    });
    if (line.length) lines.push(line);

    lines.forEach((lineWords, lineIndex) => {
        const lineY      = y + lineIndex * lineHeight;
        const isLastLine = lineIndex === lines.length - 1;

        if (isLastLine || lineWords.length === 1) {
            context.fillText(lineWords.join(" "), x, lineY);
            return;
        }

        const wordsWidth = lineWords.reduce((total, word) => total + context.measureText(word).width, 0);
        const spaceWidth = (maxWidth - wordsWidth) / (lineWords.length - 1);
        let cursorX      = x;

        lineWords.forEach((word) => {
            context.fillText(word, cursorX, lineY);
            cursorX += context.measureText(word).width + spaceWidth;
        });
    });

    return y + lines.length * lineHeight;
}

export function drawCenteredText(context, text, x, y, width) {
    const previousAlign  = context.textAlign;
    context.textAlign    = "center";
    context.fillText(text, x + width / 2, y);
    context.textAlign    = previousAlign;
}

export function drawDocumentMeta(context, record = {}) {
    const { contentLeft, contentRight } = getLayout(context);
    context.save();

    function drawMetaField(label, value, x, y, valueX, lineEndX) {
        drawText(context, label, x, y, { font: FORM_FONT, color: TEXT, bold: true });
        drawText(context, getValue(value, ""), valueX, y, { font: FORM_FONT, color: TEXT });
        drawLine(context, valueX - 8, y + 5, lineEndX, y + 5, 2, TEXT);
    }

    drawMetaField("Date Issued:", record.date ?? record.dateIssued, contentLeft, 455, contentLeft + 150, contentLeft + 360);
    drawMetaField("Issue No.:",   record.id ?? record.issueNo, contentRight - 330, 455, contentRight - 178, contentRight);
    context.restore();
}

// Same look as drawDocumentMeta (bold label, regular value, underline) but the
// label/value positions follow the text width, so longer labels and values fit.
export function drawDocumentMetaFields(context, { leftLabel, leftValue, rightLabel, rightValue, y = 455, left, right } = {}) {
    const layout = getLayout(context);
    // Custom edges are only used when a caller passes left/right (Attendance report).
    // Disbursement / Return Fund don't pass them, so they keep the default margins.
    const contentLeft  = left  ?? layout.contentLeft;
    const contentRight = right ?? layout.contentRight;
    const labelGap = 22;
    context.save();

    function measure(text, bold) {
        context.font = bold ? `700 ${FORM_FONT}` : FORM_FONT;
        return context.measureText(text).width;
    }

    // Left field (styled like "Date Issued:")
    const leftValueText  = getValue(leftValue, "");
    const leftValueX     = contentLeft + measure(leftLabel, true) + labelGap;
    const leftLineEnd    = leftValueX + Math.max(measure(leftValueText, false) + 8, 210);
    drawText(context, leftLabel, contentLeft, y, { font: FORM_FONT, color: TEXT, bold: true });
    drawText(context, leftValueText, leftValueX, y, { font: FORM_FONT, color: TEXT });
    drawLine(context, leftValueX - 8, y + 5, leftLineEnd, y + 5, 2, TEXT);

    // Right field (styled like "Issue No.:"), right-aligned to the content edge
    const rightValueText = getValue(rightValue, "");
    const rightLineWidth = Math.max(measure(rightValueText, false) + 16, 120);
    const rightValueX    = contentRight - rightLineWidth + 8;
    const rightLabelX    = rightValueX - labelGap - measure(rightLabel, true);
    drawText(context, rightLabel, rightLabelX, y, { font: FORM_FONT, color: TEXT, bold: true });
    drawText(context, rightValueText, rightValueX, y, { font: FORM_FONT, color: TEXT });
    drawLine(context, rightValueX - 8, y + 5, contentRight, y + 5, 2, TEXT);

    context.restore();
}

export function drawSignatureBlock(context, label, name, position, x, y, width) {
    context.save();
    context.textAlign    = "left";
    context.textBaseline = "alphabetic";

    context.font      = `700 ${FORM_FONT}`;
    context.fillStyle = TEXT;
    context.fillText(label, x, y);

    const nameY = y + 80;
    context.font = `700 ${FORM_FONT}`;
    context.fillText(formatSignatureName(name), x, nameY);

    const lineY = nameY + 12;
    drawLine(context, x, lineY, x + width, lineY, 2, TEXT);

    context.font = FORM_FONT;
    context.fillText(getValue(position, ""), x, lineY + 35);
    context.restore();
}

export function drawCertificateBody(context, bodyText, y = 548) {
    const { contentLeft, contentWidth } = getLayout(context);
    context.save();
    context.fillStyle = TEXT;
    context.textAlign = "left";
    context.font      = FORM_FONT;
    const nextY = drawJustifiedText(context, bodyText, contentLeft, y, contentWidth, 44);
    context.restore();
    return Math.max(nextY, y + 132);
}

// ── Canvas factory ────────────────────────────────────────────────────────────

export function createCertificateCanvas(assets = {}, options = {}) {
        const { margins, frameMargins, title = 'COMMITTEE ON FINANCE' } = options
    const canvas  = document.createElement('canvas')
    const context = canvas.getContext('2d')

    canvas.width  = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
    context.__certificateLayout = createLayout(margins, frameMargins)

    // drawHeader handles the disbursementTemplate full-page background
    // For member certificates, a separate certificateBackground is used
    if (assets.certificateBackground && !assets.disbursementTemplate) {
        context.fillStyle = WHITE
        context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
        context.drawImage(assets.certificateBackground, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    } else {
        drawHeader(context, assets)
       // drawFooter(context, assets)
    }

    context.fillStyle = TEXT
    context.font = `700 ${FORM_FONT}`
    if (title) drawCenteredText(context, title, 0, 350, CANVAS_WIDTH)

    return { canvas, context }
}

// ── Asset loading ─────────────────────────────────────────────────────────────

function loadImage(dataUrl) {
    return new Promise((resolve) => {
        if (!dataUrl) { resolve(null); return; }
        const image  = new Image();
        image.onload  = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src     = dataUrl;
    });
}

export async function loadActiveDocumentAssets() {
    try {
        const { getDocumentAssets } = await import('../services/documentAsset.service.js')
        const data = await getDocumentAssets()
        const serverAssets = data.assets ?? {}

        const [defaultCvsuLogo, defaultLitlLogo, disbursementTemplate] = await Promise.all([
            loadImage(cvsuLogoUrl),
            loadImage(litlLogoUrl),
            serverAssets.disbursementTemplate?.url
                ? loadImageCrossOrigin(serverAssets.disbursementTemplate.url)
                : Promise.resolve(null),
        ])

        return {
            ...(defaultCvsuLogo     ? { defaultCvsuLogo }     : {}),
            ...(defaultLitlLogo     ? { defaultLitlLogo }     : {}),
            ...(disbursementTemplate ? { disbursementTemplate } : {}),
        }
    } catch {
        const [defaultCvsuLogo, defaultLitlLogo] = await Promise.all([
            loadImage(cvsuLogoUrl),
            loadImage(litlLogoUrl),
        ])
        return {
            ...(defaultCvsuLogo ? { defaultCvsuLogo } : {}),
            ...(defaultLitlLogo ? { defaultLitlLogo } : {}),
        }
    }
}

function loadImageCrossOrigin(url) {
    return new Promise((resolve) => {
        if (!url) { resolve(null); return }
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.onload  = () => resolve(image)
        image.onerror = () => resolve(null)
        image.src = url
    })
}

// ── PDF generation ────────────────────────────────────────────────────────────

function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function createPdfFromJpeg(jpegBytes, options = {}) {
    const isLandscape  = options.orientation === "landscape";
    const pageWidth    = isLandscape ? A4_HEIGHT_POINTS : A4_WIDTH_POINTS;
    const pageHeight   = isLandscape ? A4_WIDTH_POINTS  : A4_HEIGHT_POINTS;
    const imageWidth   = options.imageWidth  ?? CANVAS_WIDTH;
    const imageHeight  = options.imageHeight ?? CANVAS_HEIGHT;
    const encoder      = new TextEncoder();
    const chunks       = [];
    const offsets      = [];
    let position       = 0;

    function appendString(value) {
        const bytes = encoder.encode(value);
        chunks.push(bytes);
        position += bytes.length;
    }
    function appendBytes(bytes) {
        chunks.push(bytes);
        position += bytes.length;
    }
    function beginObject(objectNumber) {
        offsets[objectNumber] = position;
        appendString(`${objectNumber} 0 obj\n`);
    }

    appendString("%PDF-1.4\n");

    beginObject(1);
    appendString("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    beginObject(2);
    appendString("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

    beginObject(3);
    appendString(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
    );

    beginObject(4);
    appendString(
        `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    appendBytes(jpegBytes);
    appendString("\nendstream\nendobj\n");

    const pageContent = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
    beginObject(5);
    appendString(`<< /Length ${encoder.encode(pageContent).length} >>\nstream\n${pageContent}endstream\nendobj\n`);

    const xrefPosition = position;
    appendString("xref\n0 6\n0000000000 65535 f \n");
    for (let objectNumber = 1; objectNumber <= 5; objectNumber += 1) {
        appendString(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`);
    }
    appendString(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF`);

    return new Blob(chunks, { type: "application/pdf" });
}

function downloadBlob(blob, filename) {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href     = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export function downloadCanvasAsPdf(canvas, filename = "committee-finance-receipt.pdf", options = {}) {
    const jpegBytes = dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.95));
    const pdfBlob   = createPdfFromJpeg(jpegBytes, {
        ...options,
        imageWidth:  canvas.width,
        imageHeight: canvas.height,
    });
    downloadBlob(pdfBlob, filename);
}