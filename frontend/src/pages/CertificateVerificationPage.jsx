import { useCallback, useEffect, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useNavigate, useParams } from "react-router-dom";
import logo from "../assets/images/LogoAndText.png";
import "../assets/styles/LandingPage.css";
import { verifyCertificate } from "../services/certification.service.js";
import { renderVerifiedMembershipCertificateImage } from "../utils/downloadMembershipCertificate.js";

export default function CertificateVerificationPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [certificateId, setCertificateId] = useState(() => decodeURIComponent(token));
  const [result, setResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("");
  const [membershipPreviewUrl, setMembershipPreviewUrl] = useState(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);

  const runVerification = useCallback(async (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setResult({ tone: "error", title: "Certificate ID required", message: "Enter an ID or scan the QR code to continue." });
      return;
    }

    setIsVerifying(true);
    try {
      const data = await verifyCertificate(trimmed);
      setResult(buildDisplayResult(data));
    } catch {
      setResult({ tone: "error", title: "Verification failed", message: "Something went wrong while contacting the verification service. Please try again." });
    } finally {
      setIsVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (token) runVerification(decodeURIComponent(token));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setMembershipPreviewUrl(null);

    if (result?.tone === "ready" && result.record?.certificateType === "MEMBERSHIP") {
      setIsRenderingPreview(true);
      renderVerifiedMembershipCertificateImage(result.record)
        .then((dataUrl) => { if (!cancelled) setMembershipPreviewUrl(dataUrl); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setIsRenderingPreview(false); });
    }

    return () => { cancelled = true; };
  }, [result]);

  useEffect(() => {
    if (!scannerOpen) return undefined;
    let cancelled = false;
    const scanner = new Html5Qrcode("certificate-verification-reader");

    scanner.start(
      { facingMode: "environment" },
      { fps: 10, aspectRatio: 1.333333 },
      (decodedText) => {
        if (cancelled) return;
        const decodedId = getCertificateIdFromQr(decodedText);
        setCertificateId(decodedId);
        runVerification(decodedId);
        setScannerOpen(false);
      },
      () => {}
    ).then(() => {
      if (!cancelled) setScannerMessage("Place the QR code anywhere inside the camera view.");
    }).catch(() => {
      if (!cancelled) setScannerMessage("Camera access was unavailable. Allow camera permission or enter the certificate ID instead.");
    });

    return () => {
      cancelled = true;
      if (scanner.isScanning) scanner.stop().catch(() => {}).finally(() => scanner.clear());
      else scanner.clear();
    };
  }, [scannerOpen, runVerification]);

  function handleSubmit(event) {
    event.preventDefault();
    runVerification(certificateId);
  }

  return (
    <div className="landing-page verification-page">
      <header className="verification-page__header">
        <button type="button" className="landing-brand" onClick={() => navigate("/")} aria-label="Return to landing page">
          <img src={logo} alt="League of Information Technology Leaders" />
        </button>
        <button type="button" className="verification-page__back" onClick={() => navigate("/")}>← Back to home</button>
      </header>

      <main className="verification-page__main">
        <div className="verification-page__intro">
          <p className="landing-kicker">Public certificate service</p>
          <h1>Verify an LITL certificate</h1>
          <p>Scan the QR code or enter the certificate ID printed on the document. No account is required.</p>
        </div>

        <div className="landing-verification-card verification-page__card">
          <div className="landing-verification-card__header">
            <span className="landing-verification-icon" aria-hidden="true">✓</span>
            <div><strong>Certificate verification</strong><p>Use either option below to begin.</p></div>
          </div>

          {scannerOpen ? (
            <div className="landing-scanner">
              <div id="certificate-verification-reader" className="landing-scanner__reader" />
              <p>{scannerMessage || "Starting camera..."}</p>
              <button type="button" className="landing-secondary-action" onClick={() => setScannerOpen(false)}>Cancel scan</button>
            </div>
          ) : (
            <>
              <button type="button" className="landing-scan-button" onClick={() => { setScannerMessage(""); setResult(null); setScannerOpen(true); }}>
                <span className="landing-scan-button__icon" aria-hidden="true">▦</span>
                <span><strong>Scan certificate QR</strong><small>Use this device's camera</small></span>
              </button>
              <div className="landing-verification-divider"><span>or enter manually</span></div>
              <form className="landing-verification-form" onSubmit={handleSubmit}>
                <label htmlFor="certificate-id">Certificate ID</label>
                <div>
                  <input id="certificate-id" value={certificateId} onChange={(event) => { setCertificateId(event.target.value); setResult(null); }} placeholder="e.g. a1b2c3d4-..." autoComplete="off" autoFocus />
                  <button type="submit" className="landing-primary-action" disabled={isVerifying}>{isVerifying ? "Verifying…" : "Verify"}</button>
                </div>
              </form>
            </>
          )}

          {result && (
            <div className={`landing-verification-result landing-verification-result--${result.tone}`} role="status">
              <strong>{result.title}</strong>
              <p>{result.message}</p>
              {result.record && (
                <div className="verification-digital-copy">
                  <dl>
                    <div><dt>Certificate ID</dt><dd>{result.record.certificateNumber}</dd></div>
                    {result.record.certificateType === "MEMBERSHIP" ? (
                      <>
                        <div><dt>Member</dt><dd>{result.record.memberName}</dd></div>
                        <div><dt>Semester</dt><dd>{result.record.semesterLabel}</dd></div>
                      </>
                    ) : (
                      <>
                        <div><dt>Activity</dt><dd>{result.record.eventTitle}</dd></div>
                        {result.record.eventDate && <div><dt>Event date</dt><dd>{result.record.eventDate}</dd></div>}
                      </>
                    )}
                    <div><dt>Issued</dt><dd>{formatDate(result.record.issuedAt)}</dd></div>
                    {result.record.revokedAt && <div><dt>Revoked</dt><dd>{formatDate(result.record.revokedAt)}</dd></div>}
                    {result.record.revokeReason && <div><dt>Reason</dt><dd>{result.record.revokeReason}</dd></div>}
                  </dl>
                  {result.record.certificateType === "MEMBERSHIP" ? (
                    <>
                      {isRenderingPreview && <p className="verification-preview-loading">Loading certificate preview…</p>}
                      {membershipPreviewUrl && (
                        <img src={membershipPreviewUrl} alt={`Membership certificate for ${result.record.memberName}`} />
                      )}
                    </>
                  ) : (
                    result.record.fileUrl && (
                      result.record.mimeType?.startsWith("image/") ? (
                        <img src={result.record.fileUrl} alt={`Digital copy of ${result.record.certificateNumber}`} />
                      ) : (
                        <a className="landing-primary-action" href={result.record.fileUrl} target="_blank" rel="noreferrer">View certificate</a>
                      )
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="verification-page__privacy">Only official certificate details will be displayed. Personal contact information remains private.</p>
      </main>
    </div>
  );
}

function buildDisplayResult(data) {
  if (data.status === "VALID") {
    const isMembership = data.certificate.certificateType === "MEMBERSHIP";
    return {
      tone: "ready",
      title: "Certificate verified",
      message: isMembership
        ? `${data.certificate.certificateNumber} is an authentic membership certificate and has not been altered.`
        : `${data.certificate.certificateNumber} is authentic and has not been altered or revoked.`,
      record: data.certificate,
    };
  }

  if (data.status === "REVOKED") {
    return {
      tone: "revoked",
      title: "Certificate revoked",
      message: `${data.certificate.certificateNumber} was issued but has since been revoked and is no longer valid.`,
      record: data.certificate,
    };
  }

  return {
    tone: "error",
    title: "Certificate not valid",
    message: data.reason || "This certificate could not be verified.",
  };
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(value));
}

function getCertificateIdFromQr(value) {
  const rawValue = String(value || "").trim();
  try {
    const url = new URL(rawValue);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || rawValue);
  } catch {
    return rawValue;
  }
}