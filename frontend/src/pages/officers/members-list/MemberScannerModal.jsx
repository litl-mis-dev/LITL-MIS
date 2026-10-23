import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import MembershipPaymentSection from "./MembershipPaymentSection.jsx";

const scannerElementId = "officers-member-qr-reader";

export default function MemberLookupModal({ members, onClose, onPaymentRecorded, onLoadPaymentHistory }) {
    const [scannerSessionKey, setScannerSessionKey] = useState(0);
    const [scannerError, setScannerError] = useState("");
    const [scannerStatus, setScannerStatus] = useState("Starting camera...");
    const [scanResult, setScanResult] = useState("");
    const [scannedMember, setScannedMember] = useState(null);
    const [paymentHistory, setPaymentHistory] = useState([]);
    const [paymentHistoryLoading, setPaymentHistoryLoading] = useState(false);
    const scannerRef = useRef(null);
    const scannerRestartTimeoutRef = useRef(null);

    // Payment amount controls, verification and confirmation are handled by the
    // shared MembershipPaymentSection (same as the Edit Member modal).
    async function loadScannedMemberHistory(memberId) {
        const data = await onLoadPaymentHistory?.(memberId);
        setPaymentHistory(data?.history ?? []);
    }

    async function handlePaymentRecorded() {
        await onPaymentRecorded?.();
        restartScanner();
    }

    async function handleQrScan(decodedText) {
        const matchedMember = findMemberFromQr(decodedText, members);

        setScanResult(decodedText);
        setScannedMember(matchedMember);
        setScannerError(matchedMember ? "" : "No approved member matched this QR code.");
        setPaymentHistory([]);
        if (!matchedMember) {
            scheduleScannerRestart(1800);
            return;
        }

        setPaymentHistoryLoading(true);
        try {
            await loadScannedMemberHistory(matchedMember.memberId);
        } catch {
            setScannerError("Member found, but payment history could not be loaded.");
        } finally {
            setPaymentHistoryLoading(false);
        }
    }

    function closeModal() {
        clearScannerRestart();
        stopScanner();
        setScannerStatus("");
        onClose();
    }

    function restartScanner(delayMs = 0) {
        clearScannerRestart();
        stopScanner();
        scannerRestartTimeoutRef.current = window.setTimeout(() => {
            setScanResult("");
            setScannedMember(null);
            setScannerError("");
            setPaymentHistory([]);
            setPaymentHistoryLoading(false);
            setScannerStatus("Starting camera...");
            setScannerSessionKey((currentKey) => currentKey + 1);
        }, delayMs);
    }

    function scheduleScannerRestart(delayMs = 0) {
        restartScanner(delayMs);
    }

    function clearScannerRestart() {
        if (!scannerRestartTimeoutRef.current) return;

        window.clearTimeout(scannerRestartTimeoutRef.current);
        scannerRestartTimeoutRef.current = null;
    }

    function stopScanner() {
        const scanner = scannerRef.current;
        if (!scanner) return;

        scannerRef.current = null;
        stopScannerInstance(scanner);
    }

    function stopScannerInstance(scanner) {
        const clearScanner = () => {
            try {
                const clearResult = scanner.clear();
                if (clearResult?.catch) {
                    clearResult.catch(() => {});
                }
            } catch {
                // Scanner cleanup can throw if the camera element has already been removed.
            }
        };

        if (scanner.isScanning) {
            Promise.resolve(scanner.stop()).then(clearScanner).catch(clearScanner);
            return;
        }

        clearScanner();
    }

    function handleBackdropClick(event) {
        if (event.target === event.currentTarget) {
            closeModal();
        }
    }

    useEffect(() => () => clearScannerRestart(), []);

    useEffect(() => {
        let isCancelled = false;
        const scanner = new Html5Qrcode(scannerElementId);
        const startDelay = window.setTimeout(() => {
            startScanner();
        }, 120);

        async function startScanner() {
            try {
                scannerRef.current = scanner;
                const cameras = await Html5Qrcode.getCameras();

                if (isCancelled) return;
                if (!cameras.length) {
                    setScannerStatus("");
                    setScannerError("No camera was found on this device.");
                    return;
                }

                const backCamera = cameras.find((camera) => /back|rear|environment/i.test(camera.label));
                const cameraId = backCamera?.id ?? cameras[0].id;

                await scanner.start(
                    cameraId,
                    { fps: 12 },
                    (decodedText) => {
                        if (isCancelled) return;
                        handleQrScan(decodedText);
                        stopScanner();
                    },
                    () => {}
                );

                if (!isCancelled) {
                    setScannerStatus("Point the camera at a member QR code anywhere in the frame.");
                }
            } catch {
                if (isCancelled) return;
                setScannerStatus("");
                setScannerError("Camera could not be opened. Allow camera permission and use localhost or HTTPS.");
            }
        }

        return () => {
            isCancelled = true;
            window.clearTimeout(startDelay);
            stopScannerInstance(scanner);
        };
        // Recreate the scanner only when the scan session changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scannerSessionKey]);

    return (
        <div className="member-modal event-modal" role="presentation" onClick={handleBackdropClick}>
            <div className="member-modal__panel member-modal__panel--lookup" role="dialog" aria-modal="true">
                <ModalHeader eyebrow="Member lookup" title="Scan Member QR" onClose={closeModal} />
                <div className="filter-modal__body member-lookup">
                    <div className="member-lookup__grid">
                        <section className="member-lookup__camera" aria-label="QR scanner">
                            <div className="member-lookup__section-head">
                                <h3>Camera</h3>
                                <span>{scannerStatus && !scanResult ? "Scanning" : scanResult ? "Paused" : "Ready"}</span>
                            </div>
                            <div className="qr-scanner">
                                <div key={scannerSessionKey} id={scannerElementId} className="qr-scanner__reader" />
                                {scannerStatus && !scanResult && (
                                    <p className="qr-scanner__status">{scannerStatus}</p>
                                )}
                            </div>
                        </section>

                        <aside className="member-lookup__side">
                            <section className="member-lookup-card qr-attendance-list">
                                <div className="member-lookup__section-head">
                                    <h3>Member Details</h3>
                                    {scannedMember && (
                                        <span className={`member-lookup__pill member-lookup__pill--${scannedMember.isPaid ? "paid" : "unpaid"}`}>
                                            {scannedMember.isPaid ? "Paid" : "Unpaid"}
                                        </span>
                                    )}
                                </div>
                                {scannedMember ? (
                                    <>
                                        <div className="attendance-list__item">
                                            <span>Name</span>
                                            <strong>{scannedMember.name}</strong>
                                        </div>
                                        <div className="attendance-list__item">
                                            <span>Student No.</span>
                                            <strong>{scannedMember.studentNumber}</strong>
                                        </div>
                                        <div className="attendance-list__item">
                                            <span>Year &amp; Section</span>
                                            <strong>{scannedMember.yearLevel}-{scannedMember.section}</strong>
                                        </div>
                                        <div className="attendance-list__item">
                                            <span>Active Semester</span>
                                            <strong>{scannedMember.isPaid ? "Paid" : "Unpaid"}</strong>
                                        </div>
                                    </>
                                ) : (
                                    <p className="attendance-list__empty">Scan a QR code to check an approved member.</p>
                                )}
                            </section>

                            {scanResult && (
                                <div className={`qr-scan-result ${scannerError ? "qr-scan-result--warning" : ""}`}>
                                    <span>{scannerError ? "QR not found" : "Member found"}</span>
                                    <strong>{scannerError ? formatQrPreview(scanResult) : scannedMember?.studentNumber}</strong>
                                </div>
                            )}
                        </aside>
                    </div>

                    {scannedMember && (
                        <MembershipPaymentSection
                            member={scannedMember}
                            paymentHistory={paymentHistory}
                            historyLoading={paymentHistoryLoading}
                            canManage
                            onRecorded={handlePaymentRecorded}
                        />
                    )}
                    {scannerError && <p className="event-form__error">{scannerError}</p>}
                </div>
                <div className="member-modal__footer">
                    <button type="button" className="btn btn--outline" onClick={() => restartScanner()}>
                        Scan Again
                    </button>
                </div>
            </div>
        </div>
    );
}

function ModalHeader({ eyebrow, title, onClose }) {
    return (
        <div className="member-modal__header">
            <div>
                <p className="member-modal__eyebrow">{eyebrow}</p>
                <h2 className="member-modal__title">{title}</h2>
            </div>
            <button type="button" className="icon-btn icon-btn--plain" onClick={onClose} aria-label="Close modal">
                <CloseIcon />
            </button>
        </div>
    );
}

function formatQrPreview(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findMemberFromQr(decodedText, members) {
    const values = getQrCandidateValues(decodedText);

    return members.find((member) => {
        const memberValues = [
            member.id,
            member.memberId,
            member.userId,
            member.studentNumber,
            member.email,
        ].filter(Boolean).map((value) => String(value).trim().toLowerCase());

        return values.some((value) => memberValues.includes(value));
    }) ?? null;
}

function getQrCandidateValues(decodedText) {
    const rawValue = String(decodedText ?? "").trim();
    const values = new Set([rawValue.toLowerCase()]);
    rawValue
        .split(/[\r\n,|;]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .forEach((value) => values.add(value));

    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === "object") {
            ["id", "memberId", "userId", "studentNumber", "studentNo", "email"].forEach((key) => {
                if (parsed[key]) values.add(String(parsed[key]).trim().toLowerCase());
            });
        }
    } catch {
        try {
            const parsedUrl = new URL(rawValue);
            values.add(parsedUrl.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "");
            ["id", "memberId", "userId", "studentNumber", "studentNo", "email"].forEach((key) => {
                const value = parsedUrl.searchParams.get(key);
                if (value) values.add(value.trim().toLowerCase());
            });
        } catch {
            // Plain QR payloads are matched as-is.
        }
    }

    return [...values].filter(Boolean);
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
        </svg>
    );
}