import QRCode from "qrcode";
import cvsuLogoUrl from "../assets/images/CvSU_Logo.png";
import litlLogoUrl from "../assets/images/LITL_Logo.png";
import {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    downloadCanvasAsPdf,
    getValue,
} from "./certificatePdf";

const LANDSCAPE_CANVAS_WIDTH = CANVAS_HEIGHT;
const LANDSCAPE_CANVAS_HEIGHT = CANVAS_WIDTH;

// Same physical sizing/placement approach as Event Certification: a fixed
// 1in x 1in QR code (same size as a 1x1 picture) in the lower-right corner
const CANVAS_PIXELS_PER_INCH = 150;
const QR_SIZE = Math.round(CANVAS_PIXELS_PER_INCH * 1); // 150px ≈ 1in
const QR_MARGIN = Math.round(CANVAS_PIXELS_PER_INCH * 0.25); // ≈38px ≈ 0.25in
const QR_CARD_PADDING = Math.round(QR_SIZE * 0.09);
const QR_LABEL_HEIGHT = Math.round(QR_SIZE * 0.34);
const QR_CARD_WIDTH = QR_SIZE + QR_CARD_PADDING * 2;
const QR_CARD_HEIGHT = QR_SIZE + QR_CARD_PADDING * 2 + QR_LABEL_HEIGHT;

const SAMPLE_TEMPLATE = {
    id: "sample-membership-template",
    name: "LITL Certificate of Membership",
    background: {
        color: "#fffdf8",
        accent: "#f59e0b",
        border: "#1f2937",
    },
    namePlacement: {
        x: LANDSCAPE_CANVAS_WIDTH / 2,
        y: 640,
        width: 1180,
    },
    qrPlacement: {
        cardX: LANDSCAPE_CANVAS_WIDTH - QR_MARGIN - QR_CARD_WIDTH,
        cardY: LANDSCAPE_CANVAS_HEIGHT - QR_MARGIN - QR_CARD_HEIGHT,
    },
};

function loadImage(src) {
    return new Promise((resolve) => {
        if (!src) {
            resolve(null);
            return;
        }

        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
}

function loadImageCrossOrigin(src) {
    return new Promise((resolve) => {
        if (!src) { resolve(null); return }
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.onload  = () => resolve(image)
        image.onerror = () => resolve(null)
        image.src = src
    })
}

function drawImageMaxFit(context, image, x, y, width, height) {
    if (!image) return;

    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;

    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function drawImageCover(context, image, x, y, width, height) {
    if (!image) return;

    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;

    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function drawCenteredText(context, text, x, y, options = {}) {
    const {
        font = "28px Arial",
        color = "#111827",
        width = LANDSCAPE_CANVAS_WIDTH,
        lineHeight = 40,
    } = options;
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";

    context.save();
    context.font = font;
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";

    words.forEach((word) => {
        const nextLine = line ? `${line} ${word}` : word;

        if (context.measureText(nextLine).width > width && line) {
            lines.push(line);
            line = word;
            return;
        }

        line = nextLine;
    });

    if (line) lines.push(line);

    lines.forEach((lineText, index) => {
        context.fillText(lineText, x, y + index * lineHeight);
    });

    context.restore();
}

function drawSampleTemplate(context, template, assets) {
    const { background } = template;

    context.fillStyle = background.color;
    context.fillRect(0, 0, LANDSCAPE_CANVAS_WIDTH, LANDSCAPE_CANVAS_HEIGHT);

    context.strokeStyle = background.border;
    context.lineWidth = 10;
    context.strokeRect(70, 70, LANDSCAPE_CANVAS_WIDTH - 140, LANDSCAPE_CANVAS_HEIGHT - 140);

    context.strokeStyle = background.accent;
    context.lineWidth = 5;
    context.strokeRect(96, 96, LANDSCAPE_CANVAS_WIDTH - 192, LANDSCAPE_CANVAS_HEIGHT - 192);

    context.fillStyle = "rgba(245, 158, 11, 0.12)";
    context.fillRect(96, 96, LANDSCAPE_CANVAS_WIDTH - 192, 190);
    context.fillRect(96, LANDSCAPE_CANVAS_HEIGHT - 236, LANDSCAPE_CANVAS_WIDTH - 192, 140);

    drawImageMaxFit(context, assets.cvsuLogo, 154, 126, 120, 120);
    drawImageMaxFit(context, assets.litlLogo, LANDSCAPE_CANVAS_WIDTH - 274, 126, 120, 120);

    drawCenteredText(context, "League of Information Technology Leaders", LANDSCAPE_CANVAS_WIDTH / 2, 180, {
        font: "700 34px Arial",
    });
    drawCenteredText(context, "Cavite State University - Trece Martires City Campus", LANDSCAPE_CANVAS_WIDTH / 2, 224, {
        font: "22px Arial",
        color: "#374151",
    });
    drawCenteredText(context, "CERTIFICATE OF MEMBERSHIP", LANDSCAPE_CANVAS_WIDTH / 2, 408, {
        font: "700 58px Arial",
        color: "#0f172a",
    });
    drawCenteredText(context, "This certificate is proudly presented to", LANDSCAPE_CANVAS_WIDTH / 2, 530, {
        font: "27px Arial",
        color: "#475569",
    });
    drawCenteredText(context, "for being an active member of the organization.", LANDSCAPE_CANVAS_WIDTH / 2, 785, {
        font: "27px Arial",
        color: "#475569",
    });
}

function drawRoundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
}

// Draws a real, scannable QR code (same library used by Event Certification)
// inside a white backing card with the Certificate ID printed below it —
// same visual composition as the event certificate stamping, just rendered
// directly onto this canvas since membership certificates aren't stored as
// files server-side.
async function drawRealQrCode(context, verificationUrl, certificateNumber, cardX, cardY) {
    const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: QR_SIZE,
        color: { dark: "#0f172a", light: "#ffffffff" },
    });
    const qrImage = await loadImage(qrDataUrl);

    context.save();
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#e2e8f0";
    context.lineWidth = 2;
    drawRoundedRect(context, cardX, cardY, QR_CARD_WIDTH, QR_CARD_HEIGHT, 10);
    context.fill();
    context.stroke();
    context.restore();

    if (qrImage) {
        context.drawImage(qrImage, cardX + QR_CARD_PADDING, cardY + QR_CARD_PADDING, QR_SIZE, QR_SIZE);
    }

    context.save();
    context.fillStyle = "#334155";
    context.font = `700 ${Math.max(10, Math.round(QR_LABEL_HEIGHT * 0.38))}px Arial`;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(
        certificateNumber,
        cardX + QR_CARD_WIDTH / 2,
        cardY + QR_CARD_PADDING + QR_SIZE + QR_LABEL_HEIGHT * 0.62
    );
    context.restore();
}

function buildVerificationUrl(certificate) {
    if (certificate?.verificationUrl) return certificate.verificationUrl;
    if (certificate?.certificateNumber) {
        return `${window.location.origin}/verify/${certificate.certificateNumber}`;
    }
    return null;
}

function formatMiddleInitial(middleName) {
    const middleParts = getValue(middleName).split(/\s+/).filter(Boolean);

    return middleParts
        .map((part) => `${part.charAt(0).toUpperCase()}.`)
        .join(" ");
}

function formatNameWithMiddleInitial({ firstName, middleName, lastName, suffix }) {
    return [
        getValue(firstName),
        formatMiddleInitial(middleName),
        getValue(lastName),
        getValue(suffix),
    ].filter(Boolean).join(" ");
}

function formatFullNameWithMiddleInitial(fullName) {
    const parts = getValue(fullName).split(/\s+/).filter(Boolean);

    if (parts.length < 3) {
        return parts.join(" ");
    }

    const suffixes = new Set(["JR", "JR.", "SR", "SR.", "II", "III", "IV", "V"]);
    const maybeSuffix = parts.at(-1);
    const hasSuffix = suffixes.has(maybeSuffix.toUpperCase());
    const suffix = hasSuffix ? parts.at(-1) : "";
    const lastName = hasSuffix ? parts.at(-2) : parts.at(-1);
    const middleParts = parts.slice(1, hasSuffix ? -2 : -1);

    return [
        parts[0],
        ...middleParts.map((part) => `${part.charAt(0).toUpperCase()}.`),
        lastName,
        suffix,
    ].filter(Boolean).join(" ");
}

function getMemberName(user) {
    const member = user?.member ?? {};
    const structuredName = formatNameWithMiddleInitial({
        firstName: user?.firstName || member.firstName,
        middleName: user?.middleName || member.middleName,
        lastName: user?.lastName || member.lastName,
        suffix: user?.suffix || member.suffix,
    });
    const fullName = getValue(user?.name || user?.fullName || member.name || member.fullName);

    return structuredName || formatFullNameWithMiddleInitial(fullName) || "Juan D. Cruz";
}

// Shared canvas-drawing core used both when the member downloads their own
// certificate and when the public verification page previews a verified one.
// `nameText` and `subtitleText` are pre-formatted strings so this function
// doesn't need to know whether the caller has a full `user`/`record` object
// (download flow) or just the fields the verification endpoint returned.
async function drawMembershipCertificate({ nameText, subtitleText, certificateNumber, verificationUrl }) {
    // Always use the public endpoint so the active template loads the same
    // way whether a member is downloading their own certificate or the page
    // is being viewed publicly on the verification page (no login there).
    const { default: api } = await import('../services/api.js')
    const templateUrl = await api.get('/document-assets/public/member-certificate')
        .then((r) => r.data?.url ?? null)
        .catch(() => null)

    const [cvsuLogo, litlLogo, templateImage] = await Promise.all([
        loadImage(cvsuLogoUrl),
        loadImage(litlLogoUrl),
        templateUrl ? loadImageCrossOrigin(templateUrl) : Promise.resolve(null),
    ]);

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = LANDSCAPE_CANVAS_WIDTH;
    canvas.height = LANDSCAPE_CANVAS_HEIGHT;

    if (templateImage) {
        drawImageCover(context, templateImage, 0, 0, LANDSCAPE_CANVAS_WIDTH, LANDSCAPE_CANVAS_HEIGHT);
    } else {
        drawSampleTemplate(context, SAMPLE_TEMPLATE, { cvsuLogo, litlLogo });
    }

    context.fillStyle = "#111827";
    context.font = "700 58px Arial";
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(
        nameText.toUpperCase(),
        SAMPLE_TEMPLATE.namePlacement.x,
        SAMPLE_TEMPLATE.namePlacement.y,
        SAMPLE_TEMPLATE.namePlacement.width
    );

    context.strokeStyle = "#111827";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(245, SAMPLE_TEMPLATE.namePlacement.y + 32);
    context.lineTo(LANDSCAPE_CANVAS_WIDTH - 245, SAMPLE_TEMPLATE.namePlacement.y + 32);
    context.stroke();

    drawCenteredText(context, subtitleText, LANDSCAPE_CANVAS_WIDTH / 2, 850, {
        font: "700 24px Arial",
        color: "#1f2937",
    });

    if (verificationUrl && certificateNumber) {
        const { cardX, cardY } = SAMPLE_TEMPLATE.qrPlacement;
        await drawRealQrCode(context, verificationUrl, certificateNumber, cardX, cardY);
    }

    return canvas;
}

async function renderMembershipCertificateCanvas(record, user) {
    // The Certificate ID and QR code are generated server-side the moment the
    // payment is recorded (see payment.controller.js — ensureMembershipCertificate)
    // and anchored into the centralized hash-linked ledger there. This canvas
    // only renders what already exists; it never invents a certificate.
    return drawMembershipCertificate({
        nameText: getMemberName(user),
        subtitleText: `${record.semester} Semester | A.Y. ${record.academicYear} | ${record.section}`,
        certificateNumber: record.certificate?.certificateNumber,
        verificationUrl: buildVerificationUrl(record.certificate),
    });
}

export async function downloadMembershipCertificate(record, user) {
    const canvas = await renderMembershipCertificateCanvas(record, user);
    const filename = `membership-certificate-${record.academicYear}-${record.semester}.pdf`
        .replace(/\s+/g, "-")
        .toLowerCase();

    downloadCanvasAsPdf(canvas, filename, { orientation: "landscape" });
}

// Used by the public certificate verification page ("also show the
// certificate, like in Certification") — renders a read-only preview image
// of a verified membership certificate from the fields the /verify endpoint
// returns. No download, no auth, and nothing is re-generated or invented:
// the Certificate ID and QR both come straight from the verified record.
export async function renderVerifiedMembershipCertificateImage(certificate) {
    const canvas = await drawMembershipCertificate({
        nameText: certificate.memberName || "",
        subtitleText: [certificate.semesterLabel, certificate.section].filter(Boolean).join(" | "),
        certificateNumber: certificate.certificateNumber,
        verificationUrl: buildVerificationUrl(certificate),
    });

    return canvas.toDataURL("image/png");
}