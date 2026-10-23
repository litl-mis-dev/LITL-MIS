import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import DashboardHeader from "../../components/officers/DashboardHeader.jsx";
import ConfirmationDialog from "../../components/officers/ConfirmationDialog.jsx";
import AuditRemarksDialog from "../../components/officers/AuditRemarksDialog.jsx";
import { listAudits, reviewAudit } from "../../services/financial.service.js";
import { useRole } from "../../utils/useRole.js";

const STATUS_OPTIONS = ["PENDING", "REVIEW", "FOR_CLARIFICATION", "CLEARED"];
const FILTERS = ["All", ...STATUS_OPTIONS];

const STATUS_LABELS = {
  PENDING: "Pending",
  REVIEW: "Review",
  FOR_CLARIFICATION: "For Clarification",
  CLEARED: "Cleared",
};

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "N/A";

  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusClass(status) {
  return STATUS_LABELS[status].toLowerCase().replace(/\s+/g, "-");
}

function mapAuditRecord(audit) {
  const isDisbursement = Boolean(audit.disbursement);
  const source = isDisbursement ? audit.disbursement : audit.returnFund;
  const activity = isDisbursement
    ? source?.titleOfActivities || source?.purposeOfFund || "Disbursement record"
    : source?.disbursement?.titleOfActivities || source?.disbursement?.purposeOfFund || "Returned fund record";
  const preparedBy = isDisbursement
    ? source?.disbursedBy || "Finance"
    : source?.refundedBy || source?.receivedFrom || "Finance";

  return {
    id: audit.id,
    displayId: isDisbursement ? `AUD-DIS-${source?.id}` : `AUD-RET-${source?.id}`,
    date: source?.createdAt,
    reference: source?.reference,
    item: activity,
    category: isDisbursement ? "Disbursement" : "Return Fund",
    sourceType: isDisbursement ? "DISBURSEMENT" : "RETURN_FUND",
    amount: Number(source?.amount || 0),
    preparedBy,
    status: audit.status,
    remarks: audit.remarks,
    reviewedBy: audit.reviewedBy,
    reviewedAt: audit.reviewedAt,
  };
}

export default function Audit() {
  const { canAuditFinancials } = useRole();
  const [audits, setAudits] = useState([]);
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState(null);
  const [pendingClear, setPendingClear] = useState(null);
  const [pendingReview, setPendingReview] = useState(null);
  const [schoolYear, setSchoolYear] = useState(null);

  const fetchAuditItems = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await listAudits();
      setAudits(data.audits || []);
      setSchoolYear(data.schoolYear || null);
    } catch {
      setError("Failed to load automated audit records. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listAudits().then((data) => {
      if (cancelled) return;
      setAudits(data.audits || []);
      setSchoolYear(data.schoolYear || null);
    }).catch(() => {
      if (!cancelled) setError("Failed to load automated audit records. Please refresh.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const items = useMemo(() => audits.map(mapAuditRecord), [audits]);

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return items.filter((item) => {
      const matchesFilter = activeFilter === "All" || item.status === activeFilter;
      const matchesSearch =
        !term ||
        [item.displayId, item.reference, item.item, item.category, item.preparedBy]
          .join(" ")
          .toLowerCase()
          .includes(term);

      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, items, searchTerm]);

  const totals = useMemo(() => {
    const pending = items.filter((item) => item.status === "PENDING").length;
    const review = items.filter(
      (item) => item.status === "REVIEW" || item.status === "FOR_CLARIFICATION",
    ).length;
    const cleared = items.filter((item) => item.status === "CLEARED").length;
    const clearedItems = items.filter((item) => item.status === "CLEARED");
    const auditedDisbursedAmount = clearedItems
      .filter((item) => item.sourceType === "DISBURSEMENT")
      .reduce((sum, item) => sum + item.amount, 0);
    const auditedReturnFundAmount = clearedItems
      .filter((item) => item.sourceType === "RETURN_FUND")
      .reduce((sum, item) => sum + item.amount, 0);

    return { pending, review, cleared, auditedDisbursedAmount, auditedReturnFundAmount };
  }, [items]);

  async function handleStatusChange(id, status, remarks) {
    if (!canAuditFinancials || actioningId !== null) return;

    setActioningId(id);
    setError("");
    try {
      const result = await reviewAudit(id, status, remarks);
      setAudits((current) => current.map((audit) => audit.id === id ? result.audit : audit));
      return true;
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update the audit record.");
      return false;
    } finally {
      setActioningId(null);
    }
  }

  function requestStatusChange(item, status) {
    if (!canAuditFinancials || actioningId !== null || pendingClear || pendingReview || item.status === "CLEARED") return;
    if (status === "CLEARED") {
      setPendingClear(item);
      return;
    }
    if (status === "FOR_CLARIFICATION") {
      setError("");
      setPendingReview(item);
      return;
    }
    handleStatusChange(item.id, status);
  }

  return (
    <>
      <DashboardHeader page="audit" />

      <section className="audit-summary" aria-label="Audit summary">
        <div className="card audit-summary__card">
          <div className="audit-summary__top">
            <span className="audit-summary__label">Pending</span>
            <span className="audit-status audit-status--pending">Queue</span>
          </div>
          <strong className="audit-summary__value">{totals.pending}</strong>
          <p>Auto-added records waiting for Auditor review.</p>
        </div>
        <div className="card audit-summary__card">
          <div className="audit-summary__top">
            <span className="audit-summary__label">Under Review</span>
            <span className="audit-status audit-status--review">Active</span>
          </div>
          <strong className="audit-summary__value">{totals.review}</strong>
          <p>Items being verified or clarified.</p>
        </div>
        <div className="card audit-summary__card">
          <div className="audit-summary__top">
            <span className="audit-summary__label">Cleared</span>
            <span className="audit-status audit-status--cleared">Certified</span>
          </div>
          <strong className="audit-summary__value">{totals.cleared}</strong>
          <p>Transactions marked legitimate and correct.</p>
        </div>
        <div className="card audit-summary__card">
          <div className="audit-summary__top">
            <span className="audit-summary__label">Audited Disbursed</span>
            <span className="audit-status audit-status--on-track">Disbursed</span>
          </div>
          <strong className="audit-summary__value">
            {formatCurrency(totals.auditedDisbursedAmount)}
          </strong>
          <p>Total cleared disbursement amount.</p>
        </div>
        <div className="card audit-summary__card">
          <div className="audit-summary__top">
            <span className="audit-summary__label">Audited Return Fund</span>
            <span className="audit-status audit-status--on-track">Returned</span>
          </div>
          <strong className="audit-summary__value">
            {formatCurrency(totals.auditedReturnFundAmount)}
          </strong>
          <p>Total cleared return fund amount.</p>
        </div>
      </section>

      <section className="audit-grid">
        <div className="card audit-review-card">
          <div className="card__header audit-review-card__header">
            <div>
              <h2 className="card__title">Automated Audit Review</h2>
              {schoolYear && <p className="card__sub">Academic Year {schoolYear}</p>}
              <p className="card__sub">
                Disbursement and return fund records are listed here automatically for Auditor
                review.
                {!canAuditFinancials &&
                  " You have view-only access — only the Auditor (Senator for Audit, VP, or President) can change a record's status."}
              </p>
            </div>
            <div className="member-list-actions">
              <button type="button" className="btn btn--outline btn--sm" disabled={loading || actioningId !== null || Boolean(pendingReview)} onClick={fetchAuditItems}>Refresh</button>
              <label className="member-search">
                <span className="sr-only">Search audit records</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search records"
                  aria-label="Search audit records"
                />
              </label>
              <div className="audit-filter" aria-label="Filter audit records by status">
                {FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`audit-filter__button${
                      activeFilter === filter ? " audit-filter__button--active" : ""
                    }`}
                    onClick={() => setActiveFilter(filter)}
                  >
                    {filter === "All" ? "All" : STATUS_LABELS[filter]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="settings-message settings-message--error" role="alert">{error}</p>}
          <div className="table-wrapper">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>Audit ID</th>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Item</th>
                  <th>Source</th>
                  <th>Amount</th>
                  <th>Prepared By</th>
                  <th>Status</th>
                  <th>Review Details</th>
                  {canAuditFinancials && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={canAuditFinancials ? 10 : 9} className="data-table__empty">
                      Loading automated audit records...
                    </td>
                  </tr>
                )}
                {!loading &&
                  filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.displayId}</td>
                      <td>{formatDate(item.date)}</td>
                      <td>{item.reference}</td>
                      <td className="audit-table__item">{item.item}</td>
                      <td>{item.category}</td>
                      <td>{formatCurrency(item.amount)}</td>
                      <td>{item.preparedBy}</td>
                      <td>
                        <span className={`audit-status audit-status--${statusClass(item.status)}`}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      </td>
                      <td className="audit-review-details">
                        <p>{item.remarks || "No remarks"}</p>
                        {item.reviewedBy && <small>{[item.reviewedBy.member?.firstName, item.reviewedBy.member?.lastName].filter(Boolean).join(" ") || `Officer #${item.reviewedBy.id}`}</small>}
                        {item.reviewedAt && <small>{formatDate(item.reviewedAt)}</small>}
                      </td>
                      {canAuditFinancials && (
                        <td>
                          <div className="audit-table__actions">
                            {item.status === "CLEARED" ? (
                              <span className="audit-status" title="Cleared records cannot be changed">Locked</span>
                            ) : (
                            <label className="audit-status-select">
                              <span className="sr-only">Update status for {item.displayId}</span>
                              <select
                                value={item.status}
                                disabled={actioningId !== null || pendingClear !== null || pendingReview !== null}
                                onChange={(event) => requestStatusChange(item, event.target.value)}
                              >
                                {STATUS_OPTIONS.map((status) => (
                                  <option key={status} value={status}>
                                    {STATUS_LABELS[status]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            )}
                            {item.status === "FOR_CLARIFICATION" && <button
                              type="button" className="btn btn--outline btn--sm"
                              disabled={actioningId !== null || pendingReview !== null || pendingClear !== null}
                              onClick={() => { setError(""); setPendingReview(item); }}
                            >Edit Remarks</button>}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                {!loading && filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={canAuditFinancials ? 10 : 9} className="data-table__empty">
                      {error || "No automated audit records match your search or filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      {pendingReview && <AuditRemarksDialog
        item={pendingReview}
        busy={actioningId !== null}
        error={error}
        onCancel={() => setPendingReview(null)}
        onSave={async (remarks) => {
          if (await handleStatusChange(pendingReview.id, "FOR_CLARIFICATION", remarks)) setPendingReview(null);
        }}
      />}
      {pendingClear && createPortal(
        <div className="relative z-[1100]">
          <ConfirmationDialog
            isOpen
            title="Clear audit record?"
            message={`Mark ${pendingClear.displayId} as Cleared? This will lock the record and prevent further changes.`}
            confirmLabel="Confirm Cleared"
            cancelLabel="Cancel"
            onCancel={() => setPendingClear(null)}
            onConfirm={() => {
              const id = pendingClear.id;
              setPendingClear(null);
              handleStatusChange(id, "CLEARED");
            }}
          />
        </div>,
        document.body
      )}
    </>
  );
}
