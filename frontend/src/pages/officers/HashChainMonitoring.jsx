import { useCallback, useEffect, useState } from "react";
import DashboardHeader from "../../components/officers/DashboardHeader.jsx";
import { verifyLedger } from "../../services/ledger.service.js";
import { getSocket } from "../../services/socket.js";

const MIN_VISIBLE_VERIFYING_MS = 900;

function Spinner() {
    return <span className="hash-chain-spinner" aria-hidden="true" />;
}

function formatHash(hash) {
    if (!hash) return "—";
    if (hash === "GENESIS") return "GENESIS";
    return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

function formatDateTime(iso) {
    return new Date(iso).toLocaleString("en-PH", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
}

export default function HashChainMonitoring() {
    const [result,      setResult]      = useState(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error,       setError]       = useState("");
    const [hasVerified, setHasVerified] = useState(false);
    const [hasNewActivity, setHasNewActivity] = useState(false);

    const runVerification = useCallback(async () => {
        setIsVerifying(true);
        setError("");
        const startedAt = Date.now();
        try {
            const data = await verifyLedger();
            setResult(data);
            setHasVerified(true);
            setHasNewActivity(false);
        } catch {
            setError("Failed to run ledger verification. Please try again.");
        } finally {
            // Keep the loading state on screen for a minimum stretch of time so
            // the verification is visibly happening rather than appearing to
            // resolve instantly, even when the actual check is very fast.
            const elapsed = Date.now() - startedAt;
            const remaining = MIN_VISIBLE_VERIFYING_MS - elapsed;
            if (remaining > 0) {
                await new Promise((resolve) => setTimeout(resolve, remaining));
            }
            setIsVerifying(false);
        }
    }, []);

    useEffect(() => { runVerification(); }, [runVerification]);

    // Real-time: a lightweight signal that the chain has grown — never
    // triggers verification automatically, that stays a manual action.
    useEffect(() => {
        const socket = getSocket();
        const handler = () => setHasNewActivity(true);
        socket.on('ledger:new', handler);
        return () => socket.off('ledger:new', handler);
    }, []);

    const alertVariant =
        !hasVerified || isVerifying ? "pending"
        : result?.status === "INTACT" ? "verified"
        : "changed";

    const alertLabel =
        !hasVerified ? "Not yet verified"
        : isVerifying ? "Verifying..."
        : result?.status === "INTACT"
            ? `All ${result.totalLinks} link${result.totalLinks !== 1 ? "s" : ""} verified`
            : `Tampering detected — ${result.tamperedLinks.length} link${result.tamperedLinks.length !== 1 ? "s" : ""} affected`;

    return (
        <>
            <DashboardHeader page="hash-chain" />

            {/* ── Summary card ────────────────────────────────────────────── */}
            <section className="card hash-chain-flow-card">
                <div className="card__header hash-chain-flow-card__header">
                    <div>
                        <h2 className="card__title">Financial Ledger Integrity</h2>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        {hasNewActivity && (
                            <span className="hash-chain-alert hash-chain-alert--pending">
                                New activity added to the chain
                            </span>
                        )}
                        <span className={`hash-chain-alert hash-chain-alert--${alertVariant}`}>
                            {isVerifying && <Spinner />}
                            {alertLabel}
                        </span>
                        <button
                            type="button"
                            className="btn btn--outline"
                            onClick={runVerification}
                            disabled={isVerifying}
                        >
                            {isVerifying ? (<><Spinner /> Verifying...</>) : "Re-run verification"}
                        </button>
                    </div>
                </div>

                {error && (
                    <p style={{ padding: "16px 20px", color: "var(--color-danger,#dc2626)", fontSize: 13 }}>
                        {error}
                    </p>
                )}

                {isVerifying && (
                    <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--color-text-secondary,#6b7280)", display: "flex", alignItems: "center", gap: 8 }}>
                        <Spinner />
                        Re-deriving and comparing every hash in the chain — this may take a moment for large ledgers...
                    </p>
                )}

                {!isVerifying && hasVerified && result?.totalLinks === 0 && (
                    <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--color-text-secondary,#6b7280)" }}>
                        No financial ledger records found yet. Records will appear here once financial transactions are recorded.
                    </p>
                )}

                {/* ── Chain links ──────────────────────────────────────────── */}
                {result && result.links.length > 0 && (
                    <div className="hash-chain-flow" aria-label="Financial ledger hash chain">
                        {[...result.links].reverse().map((link, index) => (
                            <article
                                key={link.id}
                                className={`hash-chain-link hash-chain-link--${link.status.toLowerCase()}`}
                            >
                                <div className="hash-chain-link__index">
                                    {String(result.links.length - index).padStart(2, "0")}
                                </div>
                                <div className="hash-chain-link__body">
                                    <div className="hash-chain-link__top">
                                        <div>
                                            <h3>Log #{link.id} — {link.action}</h3>
                                            <p style={{ fontSize: 12, marginTop: 2 }}>
                                                {link.actorName && <><span style={{ color: "var(--color-text-secondary,#6b7280)" }}>By </span>{link.actorName} · </>}
                                                {formatDateTime(link.createdAt)}
                                            </p>
                                        </div>
                                        <span className={`hash-chain-status hash-chain-status--${link.status.toLowerCase()}`}>
                                            {link.status === "VERIFIED" ? "Verified" : "Tampered"}
                                        </span>
                                    </div>

                                    <div className="hash-chain-link__hashes">
                                        <HashValue label="Previous" value={formatHash(link.storedPrevHash)} />
                                        <HashValue label="Current"  value={formatHash(link.storedHash)}    />
                                        <HashValue label="Derived"  value={formatHash(link.derivedHash)}   />
                                    </div>

                                    {/* Specific tamper reasons */}
                                    {link.status === "TAMPERED" && link.reasons.length > 0 && (
                                        <ul className="hash-chain-link__warning-list" style={{
                                            marginTop: 10, paddingLeft: 0, listStyle: "none",
                                            display: "flex", flexDirection: "column", gap: 4
                                        }}>
                                            {link.reasons.map((reason, i) => (
                                                <li key={i} className="hash-chain-link__warning">
                                                    ⚠ {reason}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </section>

            {/* ── Tampered records table ───────────────────────────────────── */}
            {hasVerified && result && result.tamperedLinks.length > 0 && (
                <section className="card" style={{ marginTop: 16 }}>
                    <div className="card__header">
                        <div>
                            <h2 className="card__title" style={{ color: "var(--color-danger,#dc2626)" }}>
                                Affected Records — {result.tamperedLinks.length} Issue{result.tamperedLinks.length !== 1 ? "s" : ""} Found
                            </h2>
                            <p className="card__sub">
                                These financial audit log entries failed integrity verification. Each issue is described in detail.
                            </p>
                        </div>
                    </div>
                    <div className="table-wrapper">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Log ID</th>
                                    <th>Action</th>
                                    <th>Performed By</th>
                                    <th>Timestamp</th>
                                    <th>What Was Detected</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.tamperedLinks.map(link => (
                                    <tr key={link.id}>
                                        <td>#{link.id}</td>
                                        <td>{link.action}</td>
                                        <td>{link.actorName ?? "—"}</td>
                                        <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(link.createdAt)}</td>
                                        <td>
                                            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                                                {link.reasons.map((r, i) => (
                                                    <li key={i} style={{ fontSize: 12, color: "var(--color-danger,#dc2626)" }}>
                                                        {r}
                                                    </li>
                                                ))}
                                            </ul>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </>
    );
}

function HashValue({ label, value }) {
    return (
        <div className="hash-chain-value">
            <span>{label}</span>
            <code>{value}</code>
        </div>
    );
}