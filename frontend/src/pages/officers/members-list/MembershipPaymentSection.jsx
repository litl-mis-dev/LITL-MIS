import { useState } from "react";
import { createPortal } from "react-dom";
import { previewPayment, recordPayment } from "../../../services/financial.service.js";

const PAYMENT_UNIT = 100;
const SEMESTER_LABELS = { FIRST: "1st Semester", SECOND: "2nd Semester" };

const STATUS_COLOR = {
    PAID: { bg: "#dcfce7", color: "#15803d", label: "Paid" },
    SETTLED: { bg: "#fef9c3", color: "#a16207", label: "Settled" },
    UNPAID: { bg: "#fee2e2", color: "#b91c1c", label: "Unpaid" },
};

function peso(amount) {
    return `₱${Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

function Row({ label, value, highlight }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
            <span style={{ color: "#6b7280" }}>{label}</span>
            <span style={{ fontWeight: 600, color: highlight ?? "#111827" }}>{value}</span>
        </div>
    );
}

function PaymentHistoryList({ history, loading, error }) {
    return (
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, marginTop: 8, gridColumn: "1 / -1" }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 8 }}>
                Membership Payment History
            </h3>
            {loading && <p style={{ fontSize: 13, color: "#6b7280" }}>Loading history...</p>}
            {error && <p style={{ fontSize: 13, color: "#dc2626" }}>{error}</p>}

            {!loading && !error && history.length === 0 && (
                <p style={{ fontSize: 13, color: "#6b7280" }}>No semester records found.</p>
            )}

            {!loading && history.map((row) => {
                const badge = STATUS_COLOR[row.status] ?? STATUS_COLOR.UNPAID;
                const semLabel = `${row.schoolYear} ${SEMESTER_LABELS[row.semester]}`;
                return (
                    <div key={row.semesterId} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 0", borderBottom: "1px solid #f3f4f6"
                    }}>
                        <div>
                            <p style={{ fontSize: 13, fontWeight: 500, color: "#111827", margin: 0 }}>
                                {semLabel}
                                {row.isActive && (
                                    <span style={{ marginLeft: 6, fontSize: 11, color: "#059669", fontWeight: 600 }}>
                                        (Active)
                                    </span>
                                )}
                            </p>
                            {row.payment && (
                                <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
                                    {new Date(row.payment.paidAt).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" })}
                                    {" · "}₱{parseFloat(row.payment.amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                                </p>
                            )}
                        </div>
                        <span style={{
                            fontSize: 11, fontWeight: 600, padding: "2px 10px",
                            borderRadius: 9999, background: badge.bg, color: badge.color
                        }}>{badge.label}</span>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Shared membership payment UI + flow. Used by BOTH the Edit Member modal and
 * the Scan Payment (QR) modal so history, amount controls, verification,
 * confirmation and validation are identical.
 *
 * Props:
 *  - member            { memberId, name }
 *  - paymentHistory    rows from getMemberPaymentHistory (oldest → newest)
 *  - historyLoading    boolean
 *  - historyError      string (optional)
 *  - canManage         boolean (FINANCIAL edit permission)
 *  - onRecorded()      async callback after a payment is saved
 */
export default function MembershipPaymentSection({ member, paymentHistory, historyLoading, historyError = "", canManage, onRecorded }) {
    const unpaid = (paymentHistory ?? []).filter((row) => row.status === "UNPAID");
    const maxUnits = unpaid.length;

    const [rawUnits, setUnits] = useState(1);
    const [plan, setPlan] = useState(null);       // server-verified allocation
    const [isVerifying, setIsVerifying] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState("");
    const [dialogError, setDialogError] = useState("");

    // Keep the amount within what the member actually owes.
    const units = Math.max(1, Math.min(rawUnits, Math.max(maxUnits, 1)));

    const amount = units * PAYMENT_UNIT;
    const coveredIds = new Set(unpaid.slice(0, units).map((r) => r.semesterId));

    async function handleRecordClick() {
        setError("");
        setIsVerifying(true);
        try {
            // Server verifies the amount and returns the exact semesters it will pay.
            const result = await previewPayment(member.memberId, amount);
            setPlan(result);
            setDialogError("");
        } catch (err) {
            setError(err.response?.data?.message ?? "Failed to verify payment.");
        } finally {
            setIsVerifying(false);
        }
    }

    async function handleConfirm() {
        if (!plan || isRecording) return;
        setIsRecording(true);
        setDialogError("");
        try {
            await recordPayment(member.memberId, plan.amount, plan.allocation.map((a) => a.semesterId));
            setPlan(null);
            setUnits(1);
            await onRecorded?.();
        } catch (err) {
            setDialogError(err.response?.data?.message ?? "Failed to record payment.");
        } finally {
            setIsRecording(false);
        }
    }

    const stepBtn = {
        width: 32, height: 32, borderRadius: 8, border: "1px solid #d1d5db",
        background: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer",
    };

    return (
        <>
        <PaymentHistoryList history={paymentHistory ?? []} loading={historyLoading} error={historyError} />
        {canManage && (
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, marginTop: 8, gridColumn: "1 / -1" }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 8 }}>
                Record Membership Payment
            </h3>

            {historyLoading ? (
                <p style={{ fontSize: 13, color: "#6b7280" }}>Loading unpaid semesters...</p>
            ) : maxUnits === 0 ? (
                <p style={{ fontSize: 13, color: "#6b7280" }}>This member has no unpaid semesters.</p>
            ) : (
                <>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 10px" }}>
                        Payments are applied to the oldest unpaid semester first.
                    </p>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                        <button type="button" style={{ ...stepBtn, opacity: units <= 1 ? 0.5 : 1 }}
                            disabled={units <= 1 || isVerifying}
                            onClick={() => setUnits((u) => Math.max(1, u - 1))}
                            aria-label="Decrease payment by ₱100">−</button>
                        <strong style={{ fontSize: 16, minWidth: 96, textAlign: "center" }}>{peso(amount)}</strong>
                        <button type="button" className="btn btn--outline btn--sm"
                            style={{ fontSize: 12, padding: "5px 12px", opacity: units >= maxUnits ? 0.5 : 1 }}
                            disabled={units >= maxUnits || isVerifying}
                            onClick={() => setUnits((u) => Math.min(maxUnits, u + 1))}
                            aria-label="Add ₱100 to payment">+ Add ₱100</button>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>
                            {units} of {maxUnits} unpaid semester{maxUnits === 1 ? "" : "s"}
                        </span>
                    </div>

                    {unpaid.map((row) => {
                        const included = coveredIds.has(row.semesterId);
                        return (
                            <div key={row.semesterId} style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13,
                                color: included ? "#111827" : "#9ca3af",
                            }}>
                                <span>{row.schoolYear} {SEMESTER_LABELS[row.semester]}{row.isActive ? " (Active)" : ""}</span>
                                <span style={{ fontWeight: 600, color: included ? "#15803d" : "#9ca3af" }}>
                                    {included ? `Included · ${peso(PAYMENT_UNIT)}` : "Unpaid"}
                                </span>
                            </div>
                        );
                    })}

                    {error && <p style={{ fontSize: 13, color: "#dc2626", margin: "8px 0 0" }}>{error}</p>}

                    <div style={{ marginTop: 12 }}>
                        <button type="button" className="btn btn--primary btn--sm"
                            disabled={isVerifying || isRecording}
                            onClick={handleRecordClick}>
                            {isVerifying ? "Verifying..." : "Record Payment"}
                        </button>
                    </div>
                </>
            )}

            {plan && createPortal(
                <div style={{
                    position: "fixed", inset: 0, zIndex: 200000, display: "flex",
                    alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)", padding: 16
                }}>
                    <div style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
                        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                            Record Membership Payment
                        </h3>
                        <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 16 }}>
                            Please review the details before confirming.
                        </p>
                        <div style={{ background: "#f9fafb", borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
                            <Row label="Member" value={member?.name} />
                            <Row label="Total Amount" value={peso(plan.amount)} />
                            <Row label="Semesters Paid" value={`${plan.units}`} />
                        </div>
                        <div style={{ background: "#f9fafb", borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
                            {plan.allocation.map((a) => (
                                <Row key={a.semesterId}
                                    label={`${a.schoolYear} ${SEMESTER_LABELS[a.semester]}`}
                                    value={`${peso(a.amount)} · ${a.status === "SETTLED" ? "SETTLED" : "PAID"}`}
                                    highlight={a.status === "SETTLED" ? "#a16207" : "#15803d"} />
                            ))}
                        </div>
                        {plan.allocation.some((a) => a.status === "SETTLED") && (
                            <div style={{
                                background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8,
                                padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#92400e"
                            }}>
                                ⚠️ Previous semesters will be recorded as <strong>Settled</strong> because they are no longer active.
                                The amount will be counted in the currently active semester's financial report.
                            </div>
                        )}
                        {dialogError && <p style={{ fontSize: 13, color: "#dc2626", marginBottom: 12 }}>{dialogError}</p>}
                        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                            <button type="button"
                                style={{
                                    padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db",
                                    background: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 500
                                }}
                                onClick={() => { setPlan(null); setDialogError(""); }}
                                disabled={isRecording}>
                                Cancel
                            </button>
                            <button type="button"
                                style={{
                                    padding: "8px 16px", borderRadius: 8, border: "none",
                                    background: "var(--primary,#ef8315)", color: "#fff", fontSize: 13,
                                    cursor: isRecording ? "not-allowed" : "pointer", fontWeight: 600, opacity: isRecording ? 0.7 : 1
                                }}
                                onClick={handleConfirm}
                                disabled={isRecording}>
                                {isRecording ? "Recording..." : "Confirm Payment"}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
        )}
        </>
    );
}