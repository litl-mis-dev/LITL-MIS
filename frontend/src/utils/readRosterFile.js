// Reads a member roster file (.xlsx or .csv) in the browser and returns
// [{ row, studentNumber, lastName }]. Only those two columns are sent to the
// server; the file itself never leaves the officer's computer.
//
// .xlsx is a ZIP of XML files. Reading the first worksheet needs nothing but
// the browser's own DecompressionStream and DOMParser, so no spreadsheet
// library (and its dependencies) is added to the app.

export const ROSTER_TEMPLATE_CSV = "Student Number,Last Name\n2023-100-123,Dela Cruz\n";

const STUDENT_NUMBER_HEADER = /^(student\s*(no\.?|number|num|#|id)|stud(ent)?\s*no\.?)$/i;
const LAST_NAME_HEADER = /^(last\s*name|surname|family\s*name)$/i;

export async function readRosterFile(file) {
    const name = file?.name?.toLowerCase() ?? "";
    let table;
    if (name.endsWith(".csv")) {
        table = parseCsv(await file.text());
    } else if (name.endsWith(".xlsx")) {
        table = await readFirstWorksheet(await file.arrayBuffer());
    } else {
        throw new Error("Upload an Excel (.xlsx) or CSV (.csv) file.");
    }
    return rowsFromTable(table);
}

// Finds the header row (within the first 10 rows) and reads the two columns.
function rowsFromTable(table) {
    for (let h = 0; h < Math.min(table.length, 10); h += 1) {
        const header = table[h].map((cell) => String(cell ?? "").trim());
        const numberCol = header.findIndex((cell) => STUDENT_NUMBER_HEADER.test(cell));
        const lastNameCol = header.findIndex((cell) => LAST_NAME_HEADER.test(cell));
        if (numberCol === -1 || lastNameCol === -1) continue;

        return table.slice(h + 1)
            .map((cells, i) => ({
                row: h + i + 2, // as numbered in Excel
                studentNumber: String(cells[numberCol] ?? "").trim(),
                lastName: String(cells[lastNameCol] ?? "").trim(),
            }))
            .filter((r) => r.studentNumber || r.lastName);
    }
    throw new Error('Couldn\'t find the "Student Number" and "Last Name" columns. Use the template\'s headings.');
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    // Excel adds a byte-order mark to "CSV UTF-8" files.
    const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (quoted) {
            if (ch === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === "," || ch === ";") { row.push(cell); cell = ""; }
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && input[i + 1] === "\n") i += 1;
            row.push(cell); rows.push(row); row = []; cell = "";
        } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

// ── XLSX ─────────────────────────────────────────────────────────────────────
async function readFirstWorksheet(buffer) {
    const files = await unzip(buffer);
    const xml = (path) => (files.has(path) ? new DOMParser().parseFromString(files.get(path), "application/xml") : null);

    const sharedStrings = [];
    const shared = xml("xl/sharedStrings.xml");
    if (shared) {
        for (const si of shared.getElementsByTagName("si")) {
            sharedStrings.push([...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
        }
    }

    const sheetPath = firstSheetPath(xml("xl/workbook.xml"), xml("xl/_rels/workbook.xml.rels"));
    const sheet = xml(sheetPath) ?? xml("xl/worksheets/sheet1.xml");
    if (!sheet) throw new Error("This Excel file has no worksheet to read.");

    const table = [];
    for (const rowEl of sheet.getElementsByTagName("row")) {
        const rowIndex = Number(rowEl.getAttribute("r")) - 1;
        const cells = [];
        for (const c of rowEl.getElementsByTagName("c")) {
            const col = columnIndex(c.getAttribute("r"));
            const type = c.getAttribute("t");
            const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
            let value;
            if (type === "s") value = sharedStrings[Number(v)] ?? "";
            else if (type === "inlineStr") value = [...c.getElementsByTagName("t")].map((t) => t.textContent).join("");
            else value = v;
            cells[col >= 0 ? col : cells.length] = value;
        }
        table[rowIndex >= 0 ? rowIndex : table.length] = cells;
    }
    return Array.from(table, (cells) => cells ?? []);
}

function firstSheetPath(workbook, rels) {
    const sheet = workbook?.getElementsByTagName("sheet")[0];
    const relId = sheet?.getAttribute("r:id") ?? sheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = relId && rels ? [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === relId) : null;
    const target = rel?.getAttribute("Target");
    if (!target) return "xl/worksheets/sheet1.xml";
    return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

// "C12" → 2
function columnIndex(ref) {
    const letters = /^[A-Z]+/.exec(ref ?? "")?.[0];
    if (!letters) return -1;
    return [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

// Minimal ZIP reader: returns Map(path → text) for the XML parts we need.
async function unzip(buffer) {
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i -= 1) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error("This file isn't a valid Excel (.xlsx) file.");

    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const wanted = (path) => path === "xl/workbook.xml" || path === "xl/sharedStrings.xml"
        || path === "xl/_rels/workbook.xml.rels" || path.startsWith("xl/worksheets/");
    const files = new Map();

    for (let n = 0; n < entryCount; n += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const path = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
        offset += 46 + nameLength + extraLength + commentLength;
        if (!wanted(path)) continue;

        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const data = new Uint8Array(buffer, dataStart, compressedSize);
        if (method === 0) files.set(path, decoder.decode(data));
        else if (method === 8) files.set(path, decoder.decode(await inflate(data)));
    }
    return files;
}

async function inflate(data) {
    if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser can't read Excel files. Save the list as CSV and upload that instead.");
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
