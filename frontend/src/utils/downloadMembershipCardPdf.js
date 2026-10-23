import QRCode from "qrcode";
import litlLogoUrl from "../assets/images/LITL_Logo.png";
import { getDocumentAssets } from "../services/documentAsset.service.js";

const MM_TO_PT = 72 / 25.4;
const PX_PER_MM = 10;
const A4 = { width: 210, height: 297 };
const CARD = { width: 85.6, height: 53.98 };
const PAGE_MARGIN = 12;
const CARD_GAP = 0;
const ROW_GAP = 8;

const FALLBACK_ORG = {
    contact: "cvsu13.litl@gmail.com",
    website: "facebook.com/LITLcvsu13",
    terms: "If found, please return it to the organization office.",
};
const PROFILE_STORAGE_PREFIX = "litl-officer-profile:";

const imageCache = new Map();

function mm(value) {
    return value * PX_PER_MM;
}

function sanitizeFilename(value) {
    return String(value ?? "")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 120);
}

function getMemberName(member) {
    return member?.name || member?.fullName || [member?.firstName, member?.middleName, member?.lastName, member?.suffix].filter(Boolean).join(" ") || "Member";
}

function getMemberNameFields(member) {
    const givenName = member?.firstName || member?.member?.firstName || "";
    const middleName = member?.middleName || member?.member?.middleName || "";
    const lastName = member?.lastName || member?.member?.lastName || "";

    if (givenName || middleName || lastName) {
        return { givenName, middleName, lastName };
    }

    const parts = getMemberName(member).trim().split(/\s+/).filter(Boolean);
    const derivedGivenName = parts.shift() || "Member";
    const derivedLastName = parts.length ? parts.pop() : "";

    return {
        givenName: derivedGivenName,
        middleName: parts.join(" "),
        lastName: derivedLastName,
    };
}

function getStudentNumber(member) {
    return member?.studentNumber || member?.memberId || member?.id || "N/A";
}

function getProgram(member) {
    return member?.program || member?.course || member?.degreeProgram || "BS Information Technology";
}

function getAvatar(member) {
    return (
        member?.avatar ||
        member?.profilePicture ||
        member?.member?.avatar ||
        readStoredProfileAvatar(member?.id) ||
        readStoredProfileAvatar(member?.userId) ||
        ""
    );
}

function readStoredProfileAvatar(userId) {
    if (!userId) return "";

    try {
        const profile = JSON.parse(localStorage.getItem(`${PROFILE_STORAGE_PREFIX}${userId}`) || "{}");
        return profile.avatar || "";
    } catch {
        return "";
    }
}

function getQrText(member) {
    return member?.qrCodePayload || `${getMemberName(member)}\n${getStudentNumber(member)}`;
}

function getIssueDate(member) {
    const value = member?.issueDate || member?.issuedAt || member?.createdAt;
    const date = value ? new Date(value) : new Date();

    return Number.isNaN(date.getTime())
        ? new Date().toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" })
        : date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

// The combined front+back template is cached per-download-batch so
// "Download All" only fetches the active Supabase template once instead of
// once per member.
let combinedTemplateRequest = null;

function loadImage(src, crossOrigin = false) {
    if (!src) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);

    const promise = new Promise((resolve) => {
        const image = new Image();
        if (crossOrigin) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });

    imageCache.set(src, promise);
    return promise;
}

// Fetches the officer-uploaded Membership Card template from Supabase (via
// the same /document-assets backend used by Disbursement, Return Fund, and
// Membership Certificate). Returns null when no custom template has been
// uploaded, so callers fall back to the built-in default design.
async function loadCombinedCardTemplate() {
    try {
        const data = await getDocumentAssets();
        const url = data?.assets?.membershipCard?.url;
        if (!url) return null;
        return await loadImage(url, true);
    } catch {
        return null;
    }
}

// Call once at the start of a download / download-all run to make sure every
// generated card in the batch uses the same, freshly-resolved template
// (never a stale cached URL from a previous session).
export function resetMembershipCardTemplateCache() {
    combinedTemplateRequest = null;
    imageCache.clear();
}

function getActiveCombinedTemplate() {
    if (!combinedTemplateRequest) {
        combinedTemplateRequest = loadCombinedCardTemplate();
    }
    return combinedTemplateRequest;
}

function drawImageCover(context, image, x, y, width, height) {
    if (!image) return false;

    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;

    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    context.restore();
    return true;
}

function drawImageContain(context, image, x, y, width, height) {
    if (!image) return false;

    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;

    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    return true;
}

function fitFont(context, text, maxWidth, startPx, minPx, weight = 700) {
    let size = startPx;

    while (size > minPx) {
        context.font = `${weight} ${size}px Arial`;
        if (context.measureText(String(text ?? "")).width <= maxWidth) break;
        size -= 2;
    }

    return size;
}

function wrapLines(context, text, maxWidth, maxLines = 3) {
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";

    words.forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (context.measureText(next).width > maxWidth && line) {
            lines.push(line);
            line = word;
            return;
        }
        line = next;
    });

    if (line) lines.push(line);

    if (lines.length > maxLines) {
        const trimmed = lines.slice(0, maxLines);
        let last = trimmed.at(-1);
        while (last.length > 3 && context.measureText(`${last}...`).width > maxWidth) {
            last = last.slice(0, -1);
        }
        trimmed[trimmed.length - 1] = `${last}...`;
        return trimmed;
    }

    return lines;
}

function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);

    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}

function drawDefaultFront(context, x, y, w, h, logo) {
    context.fillStyle = "#ffffff";
    context.fillRect(x, y, w, h);

    const headerH = mm(8.5);
    context.fillStyle = "#161616";
    context.fillRect(x, y, w, headerH);
    context.fillStyle = "#e5e7eb";
    context.fillRect(x, y + headerH, w, mm(0.8));

    const logoSize = mm(6.2);
    const logoX = x + mm(4);
    const logoY = y + mm(1.1);

    if (logo) {
        drawImageContain(context, logo, logoX, logoY, logoSize, logoSize);
    }

    const textX = logo ? logoX + logoSize + mm(2) : x + mm(4);
    context.fillStyle = "#ffffff";
    context.font = `700 ${mm(2)}px Arial`;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillText("LEAGUE OF INFORMATION TECHNOLOGY LEADERS", textX, y + mm(3.9));

    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.font = `500 ${mm(1.45)}px Arial`;
    context.fillText("CAVITE STATE UNIVERSITY - TRECE MARTIRES CITY CAMPUS", textX, y + mm(6.4));
}

function drawDefaultBack(context, x, y, w, h) {
    context.fillStyle = "#ffffff";
    context.fillRect(x, y, w, h);

    const headerH = mm(8.5);
    context.fillStyle = "#161616";
    context.fillRect(x, y, w, headerH);
    context.fillStyle = "#e5e7eb";
    context.fillRect(x, y + headerH, w, mm(0.8));

    context.fillStyle = "#ffffff";
    context.font = `700 ${mm(2.4)}px Arial`;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillText("LITL MEMBER VERIFICATION", x + mm(5), y + mm(5.5));

    context.fillStyle = "rgba(255, 255, 255, 0.8)";
    context.font = `500 ${mm(1.45)}px Arial`;
    context.textAlign = "right";
    context.fillText("OFFICIAL CREDENTIAL", x + w - mm(5), y + mm(5.5));
    context.textAlign = "left";
}

function drawProfile(context, image, x, y, size, name) {
    const radius = mm(1.2);
    context.save();
    roundRect(context, x, y, size, size, radius);
    context.clip();

    if (!drawImageCover(context, image, x, y, size, size)) {
        context.fillStyle = "#e2e8f0";
        context.fillRect(x, y, size, size);

        context.fillStyle = "#475569";
        context.font = `700 ${mm(7)}px Arial`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(getInitials(name), x + size / 2, y + size / 2);
    }

    context.restore();

    context.strokeStyle = "#161616";
    context.lineWidth = mm(0.45);
    roundRect(context, x, y, size, size, radius);
    context.stroke();
}

function drawFacebookIcon(context, x, baselineY) {
    const radius = mm(0.95);
    const centerY = baselineY - mm(0.85);

    context.save();
    context.fillStyle = "#161616";
    context.beginPath();
    context.arc(x, centerY, radius, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#ffffff";
    context.font = `700 ${mm(1.9)}px Arial`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("f", x, centerY + mm(0.1));
    context.restore();
}

function getInitials(name) {
    return String(name || "M")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "M";
}

function drawFrontContent(context, member, x, y, w, h, profileImage) {
    const photoX = x + mm(4.5);
    const photoY = y + mm(14.5);
    const photoSize = mm(31);
    const infoX = photoX + photoSize + mm(4);
    const infoW = w - (infoX - x) - mm(4.5);
    const name = getMemberName(member);
    const nameFields = getMemberNameFields(member);

    context.fillStyle = "#161616";
    context.font = `700 ${mm(3.2)}px Arial`;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillText(getStudentNumber(member), photoX, y + mm(13.2));

    drawProfile(context, profileImage, photoX, photoY, photoSize, name);

    drawFrontField(context, "LAST NAME", nameFields.lastName, infoX, y + mm(14), infoW);
    drawFrontField(context, "GIVEN NAMES", nameFields.givenName, infoX, y + mm(22), infoW);

    drawFrontField(context, "PROGRAM", getProgram(member), infoX, y + mm(30), infoW, 500);
}

function drawFrontField(context, label, value, x, y, width, weight = 700) {
    context.fillStyle = "rgba(22, 22, 22, 0.72)";
    context.font = `700 ${mm(1.55)}px Arial`;
    context.fillText(label, x, y);

    const text = String(value || "-").toUpperCase();
    const fontSize = fitFont(context, text, width, mm(3), mm(2), weight);
    context.fillStyle = "#161616";
    context.font = `${weight} ${fontSize}px Arial`;
    context.fillText(text, x, y + mm(3.5));

}

function drawBackContent(context, member, x, y, w, h, qrImage) {
    const qrSize = mm(29);
    const qrX = x + mm(4.5);
    const qrY = y + mm(12.5);
    const infoX = qrX + qrSize + mm(4.5);
    const infoW = w - (infoX - x) - mm(4.5);

    context.fillStyle = "#ffffff";
    roundRect(context, qrX - mm(1), qrY - mm(1), qrSize + mm(2), qrSize + mm(2), mm(1));
    context.fill();

    context.strokeStyle = "#161616";
    context.lineWidth = mm(0.4);
    roundRect(context, qrX - mm(1), qrY - mm(1), qrSize + mm(2), qrSize + mm(2), mm(1));
    context.stroke();

    drawImageContain(context, qrImage, qrX, qrY, qrSize, qrSize);

    const idPillX = qrX - mm(1);
    const idPillY = qrY + qrSize + mm(2.8);
    const idPillW = qrSize + mm(2);
    const idPillH = mm(4.2);

    context.fillStyle = "#161616";
    context.font = `700 ${mm(1.8)}px Arial`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(getStudentNumber(member), idPillX + idPillW / 2, idPillY + idPillH / 2);

    // Right Side Info
    context.textAlign = "left";
    context.textBaseline = "alphabetic";

    // Issue Date
    context.fillStyle = "rgba(22, 22, 22, 0.72)";
    context.font = `700 ${mm(1.7)}px Arial`;
    context.fillText("DATE ISSUED", infoX, y + mm(17.5));

    context.fillStyle = "#161616";
    context.font = `700 ${mm(2.8)}px Arial`;
    context.fillText(getIssueDate(member), infoX, y + mm(21.4));

    // Official Channels
    context.fillStyle = "rgba(22, 22, 22, 0.72)";
    context.font = `700 ${mm(1.7)}px Arial`;
    context.fillText("OFFICIAL CHANNELS", infoX, y + mm(26.8));

    context.fillStyle = "#161616";
    context.font = `700 ${mm(2.0)}px Arial`;
    context.fillText(`✉  ${FALLBACK_ORG.contact}`, infoX, y + mm(30.4));

    context.fillStyle = "#161616";
    context.font = `700 ${mm(2.0)}px Arial`;
    drawFacebookIcon(context, infoX + mm(1), y + mm(34.2));
    context.fillText(FALLBACK_ORG.website, infoX + mm(3), y + mm(34.2));

    // Terms / Notice
    context.fillStyle = "rgba(22, 22, 22, 0.82)";
    context.font = `500 ${mm(1.75)}px Arial`;
    wrapLines(context, FALLBACK_ORG.terms, infoW, 3).forEach((line, index) => {
        context.fillText(line, infoX, y + mm(40.2) + index * mm(3.2));
    });
}

function drawCutGuide(context, x, y, w, h) {
    const offset = mm(0.9);

    context.save();
    context.strokeStyle = "#475569";
    context.lineWidth = Math.max(1, mm(0.16));
    context.setLineDash([mm(2.4), mm(1.4)]);
    context.strokeRect(x - offset, y - offset, w + offset * 2, h + offset * 2);
    context.restore();
}

function drawCardPairGuides(context, xMm, yMm) {
    const x = mm(xMm);
    const y = mm(yMm);
    const w = mm(CARD.width * 2 + CARD_GAP);
    const h = mm(CARD.height);

    drawCutGuide(context, x, y, w, h);
}

async function drawCard(context, member, side, xMm, yMm, assets) {
    const x = mm(xMm);
    const y = mm(yMm);
    const w = mm(CARD.width);
    const h = mm(CARD.height);

    context.save();
    context.shadowColor = "rgba(15, 23, 42, 0.10)";
    context.shadowBlur = mm(0.8);
    context.shadowOffsetY = mm(0.5);
    context.fillStyle = "#ffffff";
    context.fillRect(x, y, w, h);
    context.restore();

    // Uploaded template is ONE combined image (front+back side-by-side,
    // 171.2mm x 53.98mm). Draw the matching half as this card's background.
    if (assets.combinedTemplateImage) {
        const image = assets.combinedTemplateImage;
        const halfWidth = image.width / 2;
        const sourceX = side === "back" ? halfWidth : 0;
        context.drawImage(image, sourceX, 0, halfWidth, image.height, x, y, w, h);
    } else if (side === "front") {
        drawDefaultFront(context, x, y, w, h, assets.logo);
    } else {
        drawDefaultBack(context, x, y, w, h);
    }

    if (side === "front") {
        drawFrontContent(context, member, x, y, w, h, assets.profileImage);
    } else {
        drawBackContent(context, member, x, y, w, h, assets.qrImage);
    }

}

function createPageCanvas() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = mm(A4.width);
    canvas.height = mm(A4.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    return { canvas, context };
}

async function getMemberAssets(member) {
    const qrDataUrl = member?.qrCode || await QRCode.toDataURL(getQrText(member), {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320,
    });

    const [combinedTemplateImage, profileImage, qrImage, logo] = await Promise.all([
        getActiveCombinedTemplate(),
        loadImage(getAvatar(member)),
        loadImage(qrDataUrl),
        loadImage(litlLogoUrl),
    ]);

    return { combinedTemplateImage, profileImage, qrImage, logo };
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function createPdfFromCanvases(canvases) {
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let position = 0;
    const pageWidth = A4.width * MM_TO_PT;
    const pageHeight = A4.height * MM_TO_PT;
    const imageBytes = canvases.map((canvas) => dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.95)));
    const pageCount = canvases.length;
    const firstPageObject = 3;
    const firstImageObject = firstPageObject + pageCount;
    const firstContentObject = firstImageObject + pageCount;
    const totalObjects = firstContentObject + pageCount - 1;

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
    appendString(`<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${firstPageObject + index} 0 R`).join(" ")}] /Count ${pageCount} >>\nendobj\n`);

    canvases.forEach((canvas, index) => {
        const pageObject = firstPageObject + index;
        const imageObject = firstImageObject + index;
        const contentObject = firstContentObject + index;

        beginObject(pageObject);
        appendString(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
            `/Resources << /XObject << /Im${index} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`
        );

        beginObject(imageObject);
        appendString(
            `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes[index].length} >>\nstream\n`
        );
        appendBytes(imageBytes[index]);
        appendString("\nendstream\nendobj\n");

        const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im${index} Do\nQ\n`;
        beginObject(contentObject);
        appendString(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    });

    const xrefPosition = position;
    appendString(`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`);

    for (let objectNumber = 1; objectNumber <= totalObjects; objectNumber += 1) {
        appendString(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`);
    }

    appendString(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF`);

    return new Blob(chunks, { type: "application/pdf" });
}

export async function downloadMembershipCardPdf(member) {
    resetMembershipCardTemplateCache();
    const { canvas, context } = createPageCanvas();
    const assets = await getMemberAssets(member);
    const startX = PAGE_MARGIN + 2;
    const startY = 18;

    await drawCard(context, member, "front", startX, startY, assets);
    await drawCard(context, member, "back", startX + CARD.width + CARD_GAP, startY, assets);
    drawCardPairGuides(context, startX, startY);

    const filename = sanitizeFilename(`Membership_Card_${getStudentNumber(member)}_${getMemberName(member)}.pdf`);
    downloadBlob(createPdfFromCanvases([canvas]), filename || "Membership_Card.pdf");
}

export async function createMembershipCardPreview(member) {
    resetMembershipCardTemplateCache();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const assets = await getMemberAssets(member);
    const startX = 0;
    const startY = 0;

    canvas.width = mm(CARD.width * 2 + CARD_GAP);
    canvas.height = mm(CARD.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await drawCard(context, member, "front", startX, startY, assets);
    await drawCard(context, member, "back", startX + CARD.width + CARD_GAP, startY, assets);

    return canvas.toDataURL("image/png");
}

export async function downloadAllMembershipCardsPdf(members, onProgress) {
    resetMembershipCardTemplateCache();
    const printableMembers = (members ?? []).filter(Boolean);
    if (printableMembers.length === 0) {
        throw new Error("No membership cards available to download.");
    }

    const canvases = [];
    let page = createPageCanvas();
    let cursorY = PAGE_MARGIN + 2;
    const pairHeight = CARD.height;
    const pairWidth = CARD.width * 2 + CARD_GAP;
    const startX = (A4.width - pairWidth) / 2;

    for (let index = 0; index < printableMembers.length; index += 1) {
        if (cursorY + pairHeight > A4.height - PAGE_MARGIN) {
            canvases.push(page.canvas);
            page = createPageCanvas();
            cursorY = PAGE_MARGIN + 2;
        }

        const member = printableMembers[index];
        const assets = await getMemberAssets(member);

        await drawCard(page.context, member, "front", startX, cursorY, assets);
        await drawCard(page.context, member, "back", startX + CARD.width + CARD_GAP, cursorY, assets);
        drawCardPairGuides(page.context, startX, cursorY);
        cursorY += CARD.height + ROW_GAP;
        onProgress?.(index + 1, printableMembers.length);

        if (index % 3 === 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
    }

    canvases.push(page.canvas);

    const filename = `All_Membership_Cards_${new Date().toISOString().slice(0, 10)}.pdf`;
    downloadBlob(createPdfFromCanvases(canvases), filename);
}
