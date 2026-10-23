// Generates the "Event Attendance Report" PDF for a single event, client-side.
//
// The page header, report title and meta row reuse the same drawing code as the
// Disbursement document (utils/certificatePdf.js), so the logos, fonts, spacing
// and horizontal line are identical. Every Year + Section group starts on its
// own A4 page; the official header and report details appear only on the first
// page of each group, continuation pages only carry the table.

import {
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    createCertificateCanvas,
    drawDocumentMetaFields,
    getCertificateContentLayout,
    loadActiveDocumentAssets,
} from "./certificatePdf";

const MM_TO_PT = 72 / 25.4;
const A4 = { width: 210, height: 297 };
const PX_PER_MM = CANVAS_WIDTH / A4.width; // same canvas as the Disbursement document
const TEXT = "#111827";
const PAGE_MARGIN = 150;                   // px — top/bottom page margin
const SIDE_MARGIN = 14 * PX_PER_MM;        // px — left/right margin of the original attendance layout (14 mm)
const FIRST_PAGE_TABLE_Y = 560;            // px — below the report details
const ROW_HEIGHT = 9 * PX_PER_MM;
const HEADER_ROW_HEIGHT = 10 * PX_PER_MM;

// Same column widths (mm) as the original attendance layout — 182 mm in total.
const COLUMNS = [
    { key: "no", label: "No.", weight: 12 },
    { key: "name", label: "Name", weight: 62 },
    { key: "studentNumber", label: "Student No.", weight: 32 },
    { key: "yearLevel", label: "Year", weight: 22 },
    { key: "section", label: "Section", weight: 20 },
    { key: "checkedInAt", label: "Time Checked-in", weight: 34 },
];

function mm(value) {
    return value * PX_PER_MM;
}

function sanitizeFilename(value) {
    return String(value || "attendance")
        .trim()
        .replace(/[^a-z0-9\-_ ]/gi, "")
        .replace(/\s+/g, "_")
        .slice(0, 80);
}

const collator = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, { numeric: true });

// ── Sorting: Year, then Section, then alphabetically by Name ──────────────────
// Unresolved scans (no matching member record) are always sorted last so the
// ordered, identifiable attendees are never pushed down by raw QR codes.
export function sortAttendanceRecords(records) {
    return [...records].sort((a, b) => {
        const memberA = a.member;
        const memberB = b.member;

        if (!memberA && !memberB) return 0;
        if (!memberA) return 1;
        if (!memberB) return -1;

        const yearCompare = collator(memberA.yearLevel, memberB.yearLevel);
        if (yearCompare !== 0) return yearCompare;

        const sectionCompare = collator(memberA.section, memberB.section);
        if (sectionCompare !== 0) return sectionCompare;

        return String(memberA.name || "").localeCompare(String(memberB.name || ""));
    });
}

// Splits already-sorted records into Year + Section groups (in sorted order).
function groupByYearAndSection(sortedRecords) {
    const groups = [];
    const byKey = new Map();

    sortedRecords.forEach((record) => {
        const member = record.member;
        const key = member ? `${member.yearLevel ?? ""}||${member.section ?? ""}` : "__unmatched__";
        let group = byKey.get(key);

        if (!group) {
            group = {
                key,
                yearLevel: member ? member.yearLevel ?? "" : "",
                section: member ? member.section ?? "" : "",
                isUnmatched: !member,
                records: [],
            };
            byKey.set(key, group);
            groups.push(group);
        }
        group.records.push(record);
    });

    return groups;
}

// "October 15, 2026, 2:35 PM" — always the real current date/time.
function formatGeneratedAt(date = new Date()) {
    const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
    const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
    return `${day}, ${time}`;
}

function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let trimmed = text;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}…`;
}

// ── Pages ────────────────────────────────────────────────────────────────────

// First page of a group: official header + report details (same layout as the
// Disbursement document: title y=350, name y=395, meta row y=455).
function createFirstPage(assets, { eventTitle, generatedAt, totalAttendees, group }) {
    const { canvas, context } = createCertificateCanvas(assets, { title: "EVENT ATTENDANCE REPORT" });
    const { contentWidth } = getCertificateContentLayout(context);
    const sideEdges = { left: SIDE_MARGIN, right: CANVAS_WIDTH - SIDE_MARGIN };

    context.fillStyle = TEXT;
    context.textBaseline = "alphabetic";
    context.font = "700 24px Arial";
    context.textAlign = "center";
    context.fillText(
        fitText(context, eventTitle || "Untitled Event", contentWidth),
        CANVAS_WIDTH / 2,
        395
    );

    // Row 1: Date Generated (left) / Total Attendees (right)
    drawDocumentMetaFields(context, {
        ...sideEdges,
        leftLabel: "Date Generated:",
        leftValue: generatedAt,
        rightLabel: "Total Attendees:",
        rightValue: String(totalAttendees),
    });

    // Row 2: Year Level (left, under Date Generated) / Section (right, under Total Attendees)
    if (group) {
        drawDocumentMetaFields(context, {
            ...sideEdges,
            y: 510,
            ...(group.isUnmatched
                ? { leftLabel: "Group:", leftValue: "Unidentified Scans" }
                : {
                      leftLabel: "Year Level:",
                      leftValue: group.yearLevel || "—",
                      rightLabel: "Section:",
                      rightValue: group.section || "—",
                  }),
        });
    }

    return { canvas, context, startY: FIRST_PAGE_TABLE_Y };
}

// Continuation page: plain white A4 — no header, no report details.
function createContinuationPage() {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return { canvas, context, startY: PAGE_MARGIN };
}

function getTableMetrics() {
    const left = SIDE_MARGIN;
    const width = CANVAS_WIDTH - SIDE_MARGIN * 2;
    const totalWeight = COLUMNS.reduce((sum, c) => sum + c.weight, 0);
    return { left, width, columns: COLUMNS.map((c) => ({ ...c, width: (c.weight / totalWeight) * width })) };
}

function drawTableHeaderRow(ctx, y) {
    const { left, width, columns } = getTableMetrics();
    ctx.textAlign = "left";
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(left, y, width, HEADER_ROW_HEIGHT);
    ctx.fillStyle = "#111827";
    ctx.font = `bold ${Math.round(mm(3.6))}px Arial`;
    ctx.textBaseline = "middle";
    let x = left;
    for (const col of columns) {
        ctx.fillText(col.label, x + mm(2), y + HEADER_ROW_HEIGHT / 2);
        x += col.width;
    }
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(left, y, width, HEADER_ROW_HEIGHT);
    return y + HEADER_ROW_HEIGHT;
}

function drawRow(ctx, y, row, isEvenRow) {
    const { left, width, columns } = getTableMetrics();

    if (isEvenRow) {
        ctx.fillStyle = "#fafafa";
        ctx.fillRect(left, y, width, ROW_HEIGHT);
    }

    ctx.fillStyle = "#1f2937";
    ctx.font = `${Math.round(mm(3.3))}px Arial`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    let x = left;
    for (const col of columns) {
        const text = fitText(ctx, String(row[col.key] ?? ""), col.width - mm(4));
        ctx.fillText(text, x + mm(2), y + ROW_HEIGHT / 2);
        x += col.width;
    }

    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(left, y, width, ROW_HEIGHT);
}

// ── Reused verbatim from downloadMembershipCardPdf.js's PDF encoder ──────────

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

// ── Public entry point ────────────────────────────────────────────────────────
//
// event: { title, ... }
// records: attendance records, already filtered by the caller —
//          [{ code, member: { name, studentNumber, yearLevel, section } | null, checkedInAt }]
// filters (optional): { yearLevel, section } — "All"/empty means no filter. Only
//          used to name the file and word the empty-state message.
export async function downloadAttendancePdf(event, records, filters = {}) {
    const yearFilter = filters.yearLevel && filters.yearLevel !== "All" ? filters.yearLevel : "";
    const sectionFilter = filters.section && filters.section !== "All" ? filters.section : "";
    const isFiltered = Boolean(yearFilter || sectionFilter);

    const assets = await loadActiveDocumentAssets(); // same logos / template as the Disbursement document
    const generatedAt = formatGeneratedAt();
    const groups = groupByYearAndSection(sortAttendanceRecords(records));
    const canvases = [];

    if (groups.length === 0) {
        const { canvas, context, startY } = createFirstPage(assets, {
            eventTitle: event.title,
            generatedAt,
            totalAttendees: 0,
        });
        context.fillStyle = "#6b7280";
        context.font = `${Math.round(mm(3.6))}px Arial`;
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.fillText(
            isFiltered ? "No attendees match the selected filters." : "No attendees recorded for this event.",
            SIDE_MARGIN,
            startY + ROW_HEIGHT
        );
        canvases.push(canvas);
    }

    for (const group of groups) {
        const rows = group.records.map((record, index) => ({
            no: index + 1,
            name: record.member?.name ?? record.code,
            studentNumber: record.member?.studentNumber ?? "—",
            yearLevel: record.member?.yearLevel ?? "—",
            section: record.member?.section ?? "—",
            checkedInAt: record.checkedInAt ?? "",
        }));

        let rowIndex = 0;
        let isFirstPage = true;

        // Each group always starts on a fresh A4 page.
        do {
            const page = isFirstPage
                ? createFirstPage(assets, {
                      eventTitle: event.title,
                      generatedAt,
                      totalAttendees: rows.length,
                      group,
                  })
                : createContinuationPage();

            let y = drawTableHeaderRow(page.context, page.startY);
            const bottomLimit = CANVAS_HEIGHT - PAGE_MARGIN;
            let rowsOnThisPage = 0;

            while (rowIndex < rows.length && y + ROW_HEIGHT <= bottomLimit) {
                drawRow(page.context, y, rows[rowIndex], rowsOnThisPage % 2 === 1);
                y += ROW_HEIGHT;
                rowIndex += 1;
                rowsOnThisPage += 1;
            }

            canvases.push(page.canvas);
            isFirstPage = false;
        } while (rowIndex < rows.length);
    }

    const blob = createPdfFromCanvases(canvases);
    const filterSuffix = [
        yearFilter ? sanitizeFilename(yearFilter) : null,
        sectionFilter ? `Section_${sanitizeFilename(sectionFilter)}` : null,
    ].filter(Boolean).join("_");
    downloadBlob(blob, `${sanitizeFilename(event.title)}_attendance${filterSuffix ? `_${filterSuffix}` : ""}.pdf`);
}