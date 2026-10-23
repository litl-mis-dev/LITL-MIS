import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getEvent, getEventAttendance } from "../../../services/event.service.js";
import { getSocket } from "../../../services/socket.js";
import { downloadAttendancePdf, sortAttendanceRecords } from "../../../utils/downloadAttendancePdf.js";

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

export default function EventAttendance() {
  const { eventId } = useParams();
  const navigate    = useNavigate();

  const [event,      setEvent]      = useState(null);
  const [records,    setRecords]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [yearFilter,    setYearFilter]    = useState("All");
  const [sectionFilter, setSectionFilter] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const loadData = useCallback(() => {
    if (!eventId) return;
    setLoading(true);
    setError("");

    return Promise.all([
      getEvent(eventId),
      getEventAttendance(eventId),
    ])
      .then(([eventData, attendanceData]) => {
        setEvent(eventData.event ?? null);
        setRecords(
          (attendanceData.attendances ?? []).map((a) => ({
            code:       a.qrCode,
            member:     a.member ?? null,
            // Full, unambiguous timestamp used for the PDF export
            checkedInAtIso: a.checkedInAt,
            checkedInAt: new Date(a.checkedInAt).toLocaleTimeString("en", {
              hour: "numeric",
              minute: "2-digit",
            }),
            scannedAt:  new Date(a.checkedInAt).getTime(),
          }))
        );
      })
      .catch(() => setError("Failed to load attendance records. Please refresh."))
      .finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Real-time: other officers scanning attendance for this event, or an
  // edit/archive of the event itself, refresh this page live.
  useEffect(() => {
    if (!eventId) return;
    const socket = getSocket();
    const handleAttendance = (payload) => {
      if (payload?.eventId != null && String(payload.eventId) !== String(eventId)) return;
      loadData();
    };
    const handleEvent = (payload) => {
      if (payload?.eventId != null && String(payload.eventId) !== String(eventId)) return;
      loadData();
    };
    socket.on('attendance:changed', handleAttendance);
    socket.on('event:changed', handleEvent);
    return () => {
      socket.off('attendance:changed', handleAttendance);
      socket.off('event:changed', handleEvent);
    };
  }, [eventId, loadData]);

  // Records matching the selected Year Level / Section. This is the single
  // source of truth for the list, the count, and the PDF export.
  // Scans with no matching member have no year/section, so they only appear
  // when no filter is applied.
  const filteredRecords = useMemo(() => {
    const sectionQuery = sectionFilter.trim();
    if (yearFilter === "All" && !sectionQuery) return records;
    return records.filter((record) => {
      const member = record.member;
      if (!member) return false;
      if (yearFilter !== "All" && member.yearLevel !== yearFilter) return false;
      if (sectionQuery && String(member.section) !== sectionQuery) return false;
      return true;
    });
  }, [records, yearFilter, sectionFilter]);

  const attendance = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    // Sorted by Year, then Section, then alphabetically by Name — matches
    // the same order used in the downloadable PDF.
    return sortAttendanceRecords(filteredRecords)
      .filter((record) => {
        if (!query) return true;
        const name = record.member?.name?.toLowerCase() ?? "";
        const sn   = record.member?.studentNumber?.toLowerCase() ?? "";
        const code = record.code.toLowerCase();
        return name.includes(query) || sn.includes(query) || code.includes(query);
      });
  }, [filteredRecords, searchTerm]);

    // Splits the (already sorted) list into Year + Section groups so the table
  // matches the Download Attendance layout: one table per group, No. restarts at 1.
  const attendanceGroups = useMemo(() => {
    const groups = [];
    const byKey = new Map();
    attendance.forEach((record) => {
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
  }, [attendance]);

  async function handleDownloadPdf() {
    if (!event || isDownloading) return;
    setIsDownloading(true);
    setDownloadError("");
    try {
      // Exports only the records matching the selected Year Level / Section
      // filters (the same set the list and count are built from).
      await downloadAttendancePdf(event, filteredRecords, {
        yearLevel: yearFilter,
        section: sectionFilter.trim(),
      });
    } catch {
      setDownloadError("Failed to generate the attendance PDF. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <>
      <div className="dash__header">
        <div>
          <p className="dash__eyebrow">Attendance</p>
          <h1 className="dash__title">{event?.title ?? "Event Attendance"}</h1>
          <p className="dash__subtitle">
            Review scanned QR attendance records for this event.
          </p>
        </div>
        <div className="dash__header-actions">
          <button
            type="button"
            className="btn btn--outline"
            onClick={handleDownloadPdf}
            disabled={loading || isDownloading || filteredRecords.length === 0}
            title="Download attendance as PDF"
          >
            {isDownloading ? "Generating PDF..." : "Download PDF"}
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => navigate("/officers/events")}
          >
            Back to Events
          </button>
        </div>
      </div>

      <section className="card attendance-page">
        <div className="card__header">
          <div>
            <h2 className="card__title">Scanned Attendees</h2>
            <p className="card__sub">
              {loading
                ? "Loading..."
                : `${attendance.length} record${attendance.length === 1 ? "" : "s"} found. Sorted by Year, Section, then Name.`}
            </p>
          </div>
          <div className="attendance-page__filters">
            <label className="member-role-filter attendance-page__filter">
              <span className="sr-only">Filter by year level</span>
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="All">All Year Levels</option>
                {YEAR_LEVELS.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
            <label className="attendance-page__filter attendance-page__filter-input">
              <span className="sr-only">Filter by section</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={sectionFilter}
                onChange={(e) => {
                  if (/^\d*$/.test(e.target.value)) setSectionFilter(e.target.value);
                }}
                placeholder="Section (All)"
              />
            </label>
            <label className="member-search attendance-page__filter attendance-page__filter-search">
              <span className="sr-only">Search attendees</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, student no., or time"
              />
            </label>
          </div>
        </div>

        {error && (
          <p className="px-4 py-6 text-center text-sm text-red-600">{error}</p>
        )}
        {downloadError && (
          <p className="px-4 py-2 text-center text-sm text-red-600">{downloadError}</p>
        )}

        {!loading && !error && attendance.length > 0 && (
          <div className="att-report">
            {attendanceGroups.map((group) => (
              <div key={group.key} className="att-report__group">
                <p className="att-report__meta">
                  {group.isUnmatched ? (
                    <>
                      <strong>Group:</strong> Unidentified Scans
                    </>
                  ) : (
                    <>
                      <strong>Year Level:</strong> {group.yearLevel || "—"}
                      <span className="att-report__meta-gap" />
                      <strong>Section:</strong> {group.section || "—"}
                    </>
                  )}
                </p>
                <div className="att-report__scroll">
                  <table className="att-report__table">
                    <colgroup>
                      <col style={{ width: "6.59%" }} />
                      <col style={{ width: "34.07%" }} />
                      <col style={{ width: "17.58%" }} />
                      <col style={{ width: "12.09%" }} />
                      <col style={{ width: "10.99%" }} />
                      <col style={{ width: "18.68%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Name</th>
                        <th>Student No.</th>
                        <th>Year</th>
                        <th>Section</th>
                        <th>Time Checked-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.records.map((record, index) => (
                        <tr key={`${record.code}-${record.scannedAt}`}>
                          <td>{index + 1}</td>
                          <td>{record.member?.name ?? record.code}</td>
                          <td>{record.member?.studentNumber ?? "—"}</td>
                          <td>{record.member?.yearLevel ?? "—"}</td>
                          <td>{record.member?.section ?? "—"}</td>
                          <td>{record.checkedInAt ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && attendance.length === 0 && (
          <div className="events-empty events-empty--compact">
            <h2 className="card__title">No attendees found</h2>
            <p className="card__sub">
              Scan a member QR code from a happening event, or adjust your
              search and filters.
            </p>
          </div>
        )}
      </section>
    </>
  );
}