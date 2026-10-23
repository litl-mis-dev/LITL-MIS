import { useEffect, useState } from "react";
import "../../assets/styles/members/MemberDashboard.css";
import { useAuth } from "../../context/AuthContext";
import { downloadMembershipCertificate } from "../../utils/downloadMembershipCertificate";
import { getMyPaymentHistory } from "../../services/financial.service";
import { getSocket } from "../../services/socket";

const SEMESTER_LABELS = { FIRST: "First", SECOND: "Second" }

function formatDate(iso) {
  if (!iso) return null
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "2-digit", year: "numeric"
  }).format(new Date(iso))
}

export default function Membership() {
  const { user } = useAuth();
  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState("");

  useEffect(() => {
    loadHistory();
  }, [user]);

  function loadHistory() {
    getMyPaymentHistory()
      .then(data => {
        // Map API response to the shape this page and the download util expect
        const mapped = (data.history ?? [])
          .slice()
          .reverse()   // show most recent semester first
          .map((item, idx) => ({
            id:            idx + 1,
            semesterId:    item.semesterId,
            academicYear:  item.schoolYear,
            semester:      SEMESTER_LABELS[item.semester] ?? item.semester,
            section:       item.section ?? user?.member?.section ?? "",
            paymentStatus: item.status.charAt(0) + item.status.slice(1).toLowerCase(), // "Paid" / "Settled" / "Unpaid"
            paidAt:        item.payment?.paidAt ?? null,
            amount:        item.payment?.amount ?? "100.00",
            certificate:   item.payment?.certificate ?? null, // { certificateNumber, verificationUrl } once paid
            isActive:      item.isActive,
            rawStatus:     item.status,   // "PAID" | "SETTLED" | "UNPAID"
          }))
        setRecords(mapped)
      })
      .catch(() => setError("Failed to load membership history. Please refresh."))
      .finally(() => setLoading(false))
  }

  // Real-time: this member's own paid/unpaid status can change as soon as
  // an officer records or archives a payment for them.
  useEffect(() => {
    const socket = getSocket();
    const handler = () => loadHistory();
    socket.on('payment:self-changed', handler);
    return () => socket.off('payment:self-changed', handler);
  }, [user]);

  //const canDownload        = r => r.rawStatus !== "UNPAID"
  const canDownload        = r => r.rawStatus !== "UNPAID" && Boolean(r.certificate)
  const latestDownloadable = records.find(canDownload)
  const downloadableCount  = records.filter(canDownload).length
  const unpaidCount        = records.filter(r => r.rawStatus === "UNPAID").length

  function handleDownload(record) {
    if (!canDownload(record)) return
    downloadMembershipCertificate(record, user)
  }

  return (
    <>
      <div className="dash__header">
        <div>
          <p className="dash__eyebrow">Member Account</p>
          <h1 className="dash__title">Membership</h1>
          <p className="dash__subtitle">View your membership history and download certificate copies.</p>
        </div>
      </div>

      {/* ── Overview card ──────────────────────────────────────────────────── */}
      <section className="member-membership-overview" aria-label="Membership summary">
        <div className="member-membership-overview__main">
          <div>
            <p className="member-membership-overview__eyebrow">Current Certificate</p>
            <h2 className="member-membership-overview__title">
              {loading
                ? "Loading..."
                : latestDownloadable
                  ? `${latestDownloadable.semester} Semester, A.Y. ${latestDownloadable.academicYear}`
                  : "No certificate available"}
            </h2>
            <p className="member-membership-overview__sub">
              {loading
                ? ""
                : latestDownloadable
                  ? `${latestDownloadable.section} membership certificate is ready for download.`
                  : "A certificate will become available after a paid membership record is posted."}
            </p>
          </div>

          <button
            type="button"
            className="member-membership-overview__button"
            disabled={!latestDownloadable || loading}
            onClick={() => latestDownloadable && handleDownload(latestDownloadable)}
          >
            <DownloadIcon />
            <span>Download PDF</span>
          </button>
        </div>

        <div className="member-membership-overview__stats" aria-label="Membership record counts">
          <SummaryMetric label="Records"      value={loading ? "—" : records.length} />
          <SummaryMetric label="Downloadable" value={loading ? "—" : downloadableCount} tone="success" />
          <SummaryMetric
            label="Pending"
            value={loading ? "—" : unpaidCount}
            tone={unpaidCount > 0 ? "warning" : "muted"}
          />
        </div>
      </section>

      {/* ── History table ───────────────────────────────────────────────────── */}
      <section className="member-card member-membership-card">
        <div className="member-membership-card__header">
          <div>
            <p className="member-card__eyebrow">History</p>
            <h2 className="member-card__title">Membership Records</h2>
          </div>
        </div>

        {error && (
          <p style={{ padding: "16px 20px", color: "var(--color-danger, #dc2626)", fontSize: 13 }}>
            {error}
          </p>
        )}

        <div className="member-membership-table-wrap">
          <table className="member-membership-table">
            <colgroup>
              <col className="member-membership-table__col-number" />
              <col className="member-membership-table__col-year" />
              <col className="member-membership-table__col-semester" />
              <col className="member-membership-table__col-section" />
              <col className="member-membership-table__col-date" />
              <col className="member-membership-table__col-status" />
              <col className="member-membership-table__col-action" />
            </colgroup>
            <thead>
              <tr>
                <TableHeader label="#" />
                <TableHeader label="Academic Year" />
                <TableHeader label="Semester" />
                <TableHeader label="Section" />
                <TableHeader label="Date Paid" />
                <TableHeader label="Payment Status" />
                <TableHeader label="Action" isAction />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: "32px 16px", color: "var(--color-text-secondary, #6b7280)", fontSize: 13 }}>
                    Loading membership history...
                  </td>
                </tr>
              )}
              {!loading && records.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: "32px 16px", color: "var(--color-text-secondary, #6b7280)", fontSize: 13 }}>
                    No membership records found.
                  </td>
                </tr>
              )}
              {!loading && records.map((record) => (
                <tr key={record.semesterId}>
                  <td>
                    <span className="member-membership-table__index">{record.id}</span>
                  </td>
                  <td className="member-membership-table__strong">{record.academicYear}</td>
                  <td className="member-membership-table__strong">{record.semester}</td>
                  <td>{record.section}</td>
                  <td className="member-membership-table__date">
                    {record.paidAt ? formatDate(record.paidAt) : "—"}
                  </td>
                  <td>
                    <span
                      className={`member-membership-table__status member-membership-table__status--${record.rawStatus.toLowerCase()}`}
                    >
                      {record.paymentStatus}
                      {record.rawStatus === "SETTLED" && (
                        <span
                          title="Payment was recorded after this semester ended"
                          style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}
                        >
                          ⓘ
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="member-membership-table__download"
                      aria-label={`Download ${record.academicYear} ${record.semester} membership certificate`}
                      title={
                        !canDownload(record)
                          ? "Certificate is available after payment"
                          : "Download certificate"
                      }
                      disabled={!canDownload(record)}
                      onClick={() => handleDownload(record)}
                    >
                      <DownloadIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryMetric({ label, value, tone = "default" }) {
  return (
    <div className={`member-membership-metric member-membership-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TableHeader({ label, isAction = false }) {
  return (
    <th>
      <span className={`member-membership-table__heading ${isAction ? "member-membership-table__heading--action" : ""}`}>
        {label}
      </span>
    </th>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  );
}
