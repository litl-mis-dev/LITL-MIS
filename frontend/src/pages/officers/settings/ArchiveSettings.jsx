import { useEffect, useRef, useState } from "react";
import "../../../assets/styles/officers/ArchiveSettings.css";
import FinancialRecordsTable from "../financial/FinancialRecordsTable.jsx";
import {
    mapDisbursementRow, mapReturnFundRow, disbursementColumns, returnFundColumns,
    fundReportColumns, buildFundReportRows,
} from "../../../utils/financialRecordRows.js";
import { downloadDisbursementCertificate } from "../../../utils/downloadDisbursementCertificate.js";
import { downloadReturnFundCertificate } from "../../../utils/downloadReturnFundCertificate.js";
import {
    listSemesters, getArchiveSummary, getArchiveFundReport, listArchiveDisbursements, listArchiveReturnFunds,
} from "../../../services/financial.service";

const RECORD_GROUPS = [
    "Fund Report",
    "Disbursement",
    "Returning",
];

const SEMESTERS = [
    { value: "FIRST", label: "1st Semester" },
    { value: "SECOND", label: "2nd Semester" },
];

const peso = (value) => {
    const n = Number(value) || 0;
    return `${n < 0 ? "-" : ""}\u20B1${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const count = (value) => (value === null || value === undefined ? "--" : value);
// The most recent semester that has been closed; if none has closed yet, the active one.
const pickDefaultSemester = (semesters) => {
    const closed = semesters.filter((s) => s.hasBeenActivated && !s.isActive);
    const pool = closed.length ? closed : semesters.filter((s) => s.isActive);
    const order = (a, b) => a.schoolYear.localeCompare(b.schoolYear) || (a.semester === b.semester ? 0 : a.semester === "FIRST" ? -1 : 1);
    return [...pool].sort(order).pop() || null;
};
const errorMessage = (err) => err?.response?.data?.message || "Unable to load archived records.";

export default function ArchiveSettings() {
    const [academicYear, setAcademicYear] = useState("");
    const [semester, setSemester] = useState("");
    const [recordGroup, setRecordGroup] = useState("");
    const [availableYears, setAvailableYears] = useState([]);
    const [archiveResult, setArchiveResult] = useState({ key: "", data: null, error: "" });
    const [recordsResult, setRecordsResult] = useState({ key: "", fund: null, disbursements: null, returnFunds: null });
    const userTouchedFilters = useRef(false);

    const year = academicYear.trim();
    const match = /^(\d{4})-(\d{4})$/.exec(year);
    const validYear = match && Number(match[2]) === Number(match[1]) + 1;
    const yearError = year && !validYear ? "Enter consecutive years, e.g. 2025-2026." : "";
    const semesterLabel = SEMESTERS.find((item) => item.value === semester)?.label;

    // A request is identified by its filters; a stored result only counts while its key matches the current one.
    const ready = Boolean(validYear && semester);
    const archiveKey = ready ? `${year}|${semester}` : "";
    // With "All financial records" every section is shown; choosing a group shows only that one.
    const showFund = !recordGroup || recordGroup === "Fund Report";
    const showDisbursements = !recordGroup || recordGroup === "Disbursement";
    const showReturns = !recordGroup || recordGroup === "Returning";

    const archiveLoading = Boolean(archiveKey) && archiveResult.key !== archiveKey;
    const data = archiveResult.key === archiveKey ? archiveResult.data : null;
    const loadError = archiveResult.key === archiveKey ? archiveResult.error : "";
    const recordsLoading = Boolean(archiveKey) && recordsResult.key !== archiveKey;
    const records = recordsResult.key === archiveKey ? recordsResult : {};

    useEffect(() => {
        let cancelled = false;
        listSemesters()
            .then(({ semesters = [] }) => {
                if (cancelled) return;
                const years = semesters.filter((s) => s.hasBeenActivated || s.isActive).map((s) => s.schoolYear);
                setAvailableYears([...new Set(years)]);
                // Open on the last completed semester so the archive is never empty by default,
                // unless the user already started choosing something.
                const latest = pickDefaultSemester(semesters);
                if (latest && !userTouchedFilters.current) {
                    setAcademicYear(latest.schoolYear);
                    setSemester(latest.semester);
                }
            })
            .catch(() => {}); // suggestions are optional; the filters still work without them
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!archiveKey) return undefined;
        let cancelled = false;
        getArchiveSummary(year, semester)
            .then((result) => { if (!cancelled) setArchiveResult({ key: archiveKey, data: result, error: "" }); })
            .catch((err) => { if (!cancelled) setArchiveResult({ key: archiveKey, data: null, error: errorMessage(err) }); });
        return () => { cancelled = true; };
    }, [archiveKey, year, semester]);

    useEffect(() => {
        if (!archiveKey) return undefined;
        let cancelled = false;
        Promise.allSettled([
            getArchiveFundReport(year, semester),
            listArchiveDisbursements(year, semester),
            listArchiveReturnFunds(year, semester),
        ]).then(([fund, disbursements, returnFunds]) => {
            if (cancelled) return;
            const part = (outcome, toRows) => (outcome.status === "fulfilled"
                ? { rows: toRows(outcome.value), error: "" }
                : { rows: [], error: errorMessage(outcome.reason) });
            setRecordsResult({
                key: archiveKey,
                fund: part(fund, (result) => buildFundReportRows(result?.categories || [])),
                disbursements: part(disbursements, (result) => (result?.disbursements || []).map(mapDisbursementRow)),
                returnFunds: part(returnFunds, (result) => (result?.returnFunds || []).map(mapReturnFundRow)),
            });
        });
        return () => { cancelled = true; };
    }, [archiveKey, year, semester]);

    const counts = data?.counts;
    const summary = data?.summary;
    const members = data?.members;
    const archivedTotal = counts ? counts.disbursements + counts.returnFunds : null;
    const failedChecks = data ? data.reconciliation.checks.filter((check) => !check.skipped && !check.ok) : [];
    const rosterNote = !members ? "" : members.source === "live" ? "current roster" : members.rosterAvailable ? "at semester close" : "not recorded";
    const figures = data ? [
        ["Beginning Balance", peso(summary.beginningBalance), "carried over"],
        ["Ending Balance", peso(summary.endingBalance), ""],
        ["Total Collections Fund", peso(summary.totalCollectionsFund), "excl. turnover"],
        ["Total Membership Collections", peso(summary.totalMembershipCollections), `${counts.payments} payments`],
        ["Total Disbursements", peso(summary.totalDisbursements), `${counts.disbursements} records`],
        ["Total Returned Funds", peso(summary.totalReturnedFunds), `${counts.returnFunds} records`],
        ["Total Active Members", count(members.totalActive), rosterNote],
        ["Total Paid Members", count(members.totalPaid), "paid this semester's fee"],
        ["Total Unpaid Members", count(members.totalUnpaid), rosterNote],
        ["Total Settled Members", count(members.totalSettled), "paid earlier semesters' fees"],
    ] : [];

    let footer = "Select an academic year and semester to view archived records.";
    if (archiveLoading) footer = "Loading archived records...";
    else if (loadError) footer = loadError;
    else if (data) {
        const label = data.semester.label;
        const noActivity = !counts.payments && !counts.disbursements && !counts.returnFunds;
        footer = noActivity
            ? `No financial activity ${data.semester.isActive ? "has been" : "was"} recorded for ${label}${data.semester.isActive ? " yet" : ""}.`
            : `${label}${data.semester.isActive ? " is the current semester; figures are live." : "."} Archived records are read-only.`;
    }

    // One titled block per record type: heading + count, then its table (or its error).
    const renderSection = (title, result, countLabel, table, countOf = (rows) => rows.length) => (
        <>
            <div className="archive-list-heading">
                <div><h3>{title}</h3><p aria-live="polite">{recordsLoading || !result ? "Loading..." : countLabel(countOf(result.rows))}</p></div>
            </div>
            {result?.error
                ? <p className="archive-footer" role="alert">{result.error}</p>
                : result && !recordsLoading && table(result.rows)}
        </>
    );

    const clearFilters = () => { userTouchedFilters.current = true; setAcademicYear(""); setSemester(""); setRecordGroup(""); };

    return (
        <div className="settings-section-body archive-settings">
            <dl className="archive-summary">
                <div><dt>Academic year</dt><dd>{validYear ? year : "All years"}</dd></div>
                <div><dt>Record groups</dt><dd>{RECORD_GROUPS.length}<span> categories</span></dd></div>
                <div><dt>Archived records</dt><dd>{count(archivedTotal)}<span>{archivedTotal === null ? " Not available" : " records"}</span></dd></div>
            </dl>
            <div className="archive-filters">
                <label className="archive-field">
                    <span>Academic Year</span>
                    <input
                        type="text"
                        list="archive-years"
                        placeholder="e.g. 2025-2026"
                        value={academicYear}
                        onChange={(event) => { userTouchedFilters.current = true; setAcademicYear(event.target.value); }}
                        maxLength={9}
                        aria-invalid={Boolean(yearError)}
                        aria-describedby={yearError ? "archive-year-error" : undefined}
                    />
                    <datalist id="archive-years">
                        {availableYears.map((schoolYear) => <option key={schoolYear} value={schoolYear} />)}
                    </datalist>
                    {yearError && <span id="archive-year-error" className="archive-field-error">{yearError}</span>}
                </label>
                <label className="archive-field">
                    <span>Semester</span>
                    <select value={semester} onChange={(event) => { userTouchedFilters.current = true; setSemester(event.target.value); }}>
                        <option value="">Select semester</option>
                        {SEMESTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                </label>
                <label className="archive-field">
                    <span>Records</span>
                    <select value={recordGroup} onChange={(event) => setRecordGroup(event.target.value)}>
                        <option value="">All financial records</option>
                        {RECORD_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
                    </select>
                </label>
            </div>

            {data && (
                <>
                    <dl className="archive-summary archive-summary-grid" aria-label="Financial summary">
                        {figures.map(([label, value, note]) => (
                            <div key={label}><dt>{label}</dt><dd>{value}{note && <span> {note}</span>}</dd></div>
                        ))}
                    </dl>
                    <div className="archive-reconciliation" role="status">
                        <span className={`archive-status ${failedChecks.length ? "archive-status-warn" : "archive-status-ok"}`}>
                            {failedChecks.length ? "Discrepancy found" : "Balanced"}
                        </span>
                        <span>{failedChecks.length ? "Balances rebuilt from transactions do not match the recorded balances:" : "Balances rebuilt from transactions match the recorded balances."}</span>
                        {failedChecks.length > 0 && (
                            <ul>
                                {failedChecks.map((check) => (
                                    <li key={check.key}>
                                        {check.label}: computed {peso(check.computed)}{check.recorded !== null && `, recorded ${peso(check.recorded)}`}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}

            <div className="archive-list-heading">
                <div><h3>{validYear ? `Academic Year ${year}${semesterLabel ? ` - ${semesterLabel}` : ""}` : "Financial records"}</h3></div>
                {(academicYear || semester || recordGroup) && <button type="button" className="archive-reset" onClick={clearFilters}>Clear filters</button>}
            </div>

            {data && showFund && renderSection("Fund Report", records.fund, (n) => `${n} categories`, (rows) => (
                rows.length > 1 ? (
                    <div className="table-wrapper table-wrapper--scroll">
                        <table className="data-table">
                            <thead>
                                <tr>{fundReportColumns.map((col) => <th key={col.key}>{col.label}</th>)}</tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.rowKey} className={row.isSummary ? "font-semibold" : ""}>
                                        {fundReportColumns.map((col) => (
                                            <td key={col.key}>{col.key === "name" && row.isTurnoverFund ? <>{"\u21BB"} {row.name}</> : row[col.key]}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <p className="archive-footer">No fund categories for this semester.</p>
            ), (rows) => Math.max(rows.length - 1, 0))}
            {data && showDisbursements && renderSection("Disbursement Records", records.disbursements, (n) => `${n} records`, (rows) => (
                <FinancialRecordsTable columns={disbursementColumns} rows={rows} emptyMessage="No disbursement records for this semester." onDownload={downloadDisbursementCertificate} />
            ))}
            {data && showReturns && renderSection("Return Fund Records", records.returnFunds, (n) => `${n} records`, (rows) => (
                <FinancialRecordsTable columns={returnFundColumns} rows={rows} emptyMessage="No return fund records for this semester." onDownload={downloadReturnFundCertificate} />
            ))}
            <p className="archive-footer" role="status">{footer}</p>
        </div>
    );
}