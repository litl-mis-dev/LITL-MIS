import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardHeader from "../../components/officers/DashboardHeader.jsx";
import { useRole } from "../../utils/useRole.js";
import {
  getCertificationTree,
  getEventCertificationFolder,
  issueCertificate,
  revokeCertificate,
  downloadCertificateFile,
  downloadEventCertificatesZipFile,
} from "../../services/certification.service.js";
import { getSocket } from "../../services/socket.js";

const LEVEL = { ROOT: "root", ARCHIVE: "archive", EVENT: "event" };

export default function Certification() {
  const { can } = useRole();
  const canEdit = can("CERTIFICATION", "EDIT");
  const fileInputRef = useRef(null);

  const [tree, setTree] = useState({ archives: [] });
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState("");

  const [level, setLevel] = useState(LEVEL.ROOT);
  const [activeArchive, setActiveArchive] = useState(null);
  const [activeEventFolder, setActiveEventFolder] = useState(null);
  const [isLoadingFolder, setIsLoadingFolder] = useState(false);
  const [folderError, setFolderError] = useState("");

  const [selectedItem, setSelectedItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");

  const [downloadState, setDownloadState] = useState(null);

  const loadTree = useCallback(async () => {
    setIsLoadingTree(true);
    setTreeError("");
    try {
      const data = await getCertificationTree();
      setTree(data);
    } catch {
      setTreeError("Failed to load the certification archive. Please refresh.");
    } finally {
      setIsLoadingTree(false);
    }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  // Real-time: issuing or revoking a certificate updates the records live
  // for other authorized officers — refresh the tree, and the open event
  // folder if that's the event that changed.
  useEffect(() => {
    const socket = getSocket();
    const handler = (payload) => {
      loadTree();
      if (activeEventFolder && payload?.eventId != null
        && String(payload.eventId) === String(activeEventFolder.event.id)) {
        refreshEventFolder();
      }
    };
    socket.on('certificate:changed', handler);
    return () => socket.off('certificate:changed', handler);
  }, [loadTree, activeEventFolder]);

  async function openEventFolder(eventFolderSummary) {
    setLevel(LEVEL.EVENT);
    setSelectedItem(null);
    setSearchTerm("");
    setIsLoadingFolder(true);
    setFolderError("");
    try {
      const data = await getEventCertificationFolder(eventFolderSummary.eventId);
      setActiveEventFolder(data);
    } catch {
      setFolderError("Failed to load this event's certificates. Please try again.");
    } finally {
      setIsLoadingFolder(false);
    }
  }

  async function refreshEventFolder() {
    if (!activeEventFolder) return;
    try {
      const data = await getEventCertificationFolder(activeEventFolder.event.id);
      setActiveEventFolder(data);
    } catch {
      /* keep showing stale data rather than clearing the view */
    }
  }

  function openArchive(archive) {
    setLevel(LEVEL.ARCHIVE);
    setActiveArchive(archive);
    setActiveEventFolder(null);
    setSelectedItem(null);
    setSearchTerm("");
  }

  function goToRoot() {
    setLevel(LEVEL.ROOT);
    setActiveArchive(null);
    setActiveEventFolder(null);
    setSelectedItem(null);
    setSearchTerm("");
  }

  async function handleUploadCertificate(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0 || !activeEventFolder) return;

    setIsUploading(true);
    setUploadProgress(0);
    setUploadError("");
    try {
      const result = await issueCertificate(activeEventFolder.event.id, files, (progressEvent) => {
        if (progressEvent.total) {
          setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
        }
      });
      if (result?.failed?.length > 0) {
        setUploadError(
          `${result.failed.length} of ${files.length} file(s) could not be issued: ${result.failed.map((f) => (f.message ? `${f.fileName} — ${f.message}` : f.fileName)).join(" | ")}`
        );
      }
      await refreshEventFolder();
      await loadTree();
    } catch (err) {
      setUploadError(err?.response?.data?.message || "Failed to issue the certificate(s). Please try again.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }

  const [revokeTarget, setRevokeTarget] = useState(null); // certificate object
  const [revokeReason, setRevokeReason] = useState("");
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");

  function openRevokeModal(certificate) {
    setRevokeTarget(certificate);
    setRevokeReason("");
    setRevokeError("");
  }

  function closeRevokeModal() {
    if (isRevoking) return;
    setRevokeTarget(null);
    setRevokeReason("");
    setRevokeError("");
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setIsRevoking(true);
    setRevokeError("");
    try {
      await revokeCertificate(revokeTarget.id, revokeReason);
      await refreshEventFolder();
      setSelectedItem((current) =>
        current?.kind === "certificate" && current.data.id === revokeTarget.id
          ? null
          : current
      );
      setRevokeTarget(null);
      setRevokeReason("");
    } catch (err) {
      setRevokeError(err?.response?.data?.message || "Failed to revoke this certificate.");
    } finally {
      setIsRevoking(false);
    }
  }

  async function handleDownloadCertificate(certificate) {
    const key = `certificate-${certificate.id}`;
    setDownloadState({ key, label: `Downloading ${certificate.certificateNumber}…`, progress: 0, error: "" });
    try {
      await downloadCertificateFile(
        certificate.id,
        `${certificate.certificateNumber}${guessExtension(certificate.mimeType)}`,
        (progressEvent) => {
          if (progressEvent.total) {
            setDownloadState((current) =>
              current?.key === key ? { ...current, progress: Math.round((progressEvent.loaded / progressEvent.total) * 100) } : current
            );
          }
        }
      );
      setDownloadState(null);
    } catch (err) {
      setDownloadState({ key, label: `Downloading ${certificate.certificateNumber}…`, progress: 0, error: err?.response?.data?.message || "Failed to download this certificate." });
    }
  }

  async function handleDownloadAllCertificates() {
    if (!activeEventFolder || activeEventFolder.certificates.length === 0) return;
    const key = `event-${activeEventFolder.event.id}`;
    const label = `Downloading all certificates for ${activeEventFolder.event.title}…`;
    setDownloadState({ key, label, progress: 0, error: "" });
    try {
      await downloadEventCertificatesZipFile(
        activeEventFolder.event.id,
        `${activeEventFolder.event.title}-certificates.zip`,
        (progressEvent) => {
          if (progressEvent.total) {
            setDownloadState((current) =>
              current?.key === key ? { ...current, progress: Math.round((progressEvent.loaded / progressEvent.total) * 100) } : current
            );
          }
        }
      );
      setDownloadState(null);
    } catch (err) {
      setDownloadState({ key, label, progress: 0, error: err?.response?.data?.message || "Failed to download the certificates." });
    }
  }

  const visibleArchives = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return tree.archives.filter((archive) => !query || archive.schoolYear.toLowerCase().includes(query));
  }, [tree.archives, searchTerm]);

  const visibleEventFolders = useMemo(() => {
    if (!activeArchive) return [];
    const query = searchTerm.trim().toLowerCase();
    return activeArchive.eventFolders.filter((folder) => !query || folder.title.toLowerCase().includes(query));
  }, [activeArchive, searchTerm]);

  const visibleCertificates = useMemo(() => {
    if (!activeEventFolder) return [];
    const query = searchTerm.trim().toLowerCase();
    return activeEventFolder.certificates.filter((cert) => (
      !query ||
      cert.certificateNumber.toLowerCase().includes(query) ||
      cert.originalFileName.toLowerCase().includes(query)
    ));
  }, [activeEventFolder, searchTerm]);

  return (
    <>
      <DashboardHeader page="certification" />

      <div className={`documents-workspace ${selectedItem ? "" : "documents-workspace--full"}`}>
        <section className="card documents-main certification-main">
          <div className="documents-toolbar">
            <div className="documents-breadcrumbs" aria-label="Certificate folder path">
              <button type="button" onClick={goToRoot}>Certification</button>
              {level !== LEVEL.ROOT && activeArchive && (
                <span className="documents-breadcrumbs__item">
                  <span>/</span>
                  {level === LEVEL.ARCHIVE ? (
                    <strong>Academic Year {activeArchive.schoolYear}</strong>
                  ) : (
                    <button type="button" onClick={() => openArchive(activeArchive)}>Academic Year {activeArchive.schoolYear}</button>
                  )}
                </span>
              )}
              {level === LEVEL.EVENT && activeEventFolder && (
                <span className="documents-breadcrumbs__item">
                  <span>/</span>
                  <strong>{activeEventFolder.event.title}</strong>
                </span>
              )}
            </div>

            <div className="certification-toolbar-actions">
              {level === LEVEL.EVENT && (
                <>
                  {canEdit && (
                    <>
                      <input
                        ref={fileInputRef}
                        className="sr-only"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,application/pdf"
                        multiple
                        onChange={handleUploadCertificate}
                      />
                      <button
                        type="button"
                        className="btn btn--primary btn--icon-only"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        title="Upload finished certificates (you can select multiple)"
                        aria-label="Upload finished certificates"
                      >
                        <UploadIcon />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn--icon-only"
                    onClick={handleDownloadAllCertificates}
                    disabled={!activeEventFolder || activeEventFolder.certificates.length === 0 || Boolean(downloadState)}
                    title="Download all certificates (.zip)"
                    aria-label="Download all certificates as a zip file"
                  >
                    <DownloadIcon />
                  </button>
                </>
              )}

              <label className="certification-search documents-search">
                <span className="sr-only">Search</span>
                <SearchIcon />
                <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search" />
              </label>
            </div>
          </div>

          {isUploading && (
            <div className="certification-upload-progress" role="status">
              <span>Issuing certificate(s)… {uploadProgress}%</span>
              <div className="certification-progress-bar">
                <div className="certification-progress-bar__fill" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}
          {uploadError && <div className="certification-upload-error" role="alert">{uploadError}</div>}

          {downloadState && !downloadState.error && (
            <div className="certification-upload-progress" role="status">
              <span>{downloadState.label} {downloadState.progress}%</span>
              <div className="certification-progress-bar">
                <div className="certification-progress-bar__fill" style={{ width: `${downloadState.progress}%` }} />
              </div>
            </div>
          )}
          {downloadState?.error && (
            <div className="certification-upload-error" role="alert">
              {downloadState.error}
              <button type="button" className="certification-details-btn" onClick={() => setDownloadState(null)}>Dismiss</button>
            </div>
          )}

          <div className="documents-grid">
            {level === LEVEL.ROOT && (
              <>
                {isLoadingTree && (
                  <div className="documents-empty"><h2 className="card__title">Loading certification archive…</h2></div>
                )}
                {treeError && (
                  <div className="documents-empty"><h2 className="card__title">Unable to load archive</h2><p>{treeError}</p></div>
                )}
                {!isLoadingTree && !treeError && visibleArchives.length === 0 && (
                  <div className="documents-empty">
                    <span className="documents-empty__icon"><CertificateIcon /></span>
                    <h2 className="card__title">No certification archive yet</h2>
                    <p>An archive is created automatically the first time a school year is activated.</p>
                  </div>
                )}
                {visibleArchives.map((archive) => (
                  <FolderTile
                    key={archive.id}
                    name={`Academic Year ${archive.schoolYear}`}
                    description="Auto-generated certification archive for this academic year."
                    metaLabel={`${archive.eventFolders.length} activity ${archive.eventFolders.length === 1 ? "folder" : "folders"}`}
                    status="Active"
                    onOpen={() => openArchive(archive)}
                    onSelect={() => setSelectedItem({ kind: "archive", data: archive })}
                    isSelected={selectedItem?.kind === "archive" && selectedItem.data.id === archive.id}
                  />
                ))}
              </>
            )}

            {level === LEVEL.ARCHIVE && (
              <>
                {visibleEventFolders.length === 0 && (
                  <div className="documents-empty">
                    <span className="documents-empty__icon"><CertificateIcon /></span>
                    <h2 className="card__title">No events yet</h2>
                    <p>A folder is created automatically here whenever an officer creates an event.</p>
                  </div>
                )}
                {visibleEventFolders.map((folder) => (
                  <FolderTile
                    key={folder.id}
                    name={folder.title}
                    description={`${formatEventDate(folder.date)} · ${folder.location}`}
                    metaLabel={`${folder.certificateCount} ${folder.certificateCount === 1 ? "certificate" : "certificates"}`}
                    status={folder.status}
                    onOpen={() => openEventFolder(folder)}
                    onSelect={() => setSelectedItem({ kind: "eventFolder", data: folder })}
                    isSelected={selectedItem?.kind === "eventFolder" && selectedItem.data.id === folder.id}
                  />
                ))}
              </>
            )}

            {level === LEVEL.EVENT && (
              <>
                {isLoadingFolder && (
                  <div className="documents-empty"><h2 className="card__title">Loading certificates…</h2></div>
                )}
                {folderError && (
                  <div className="documents-empty"><h2 className="card__title">Unable to load certificates</h2><p>{folderError}</p></div>
                )}
                {!isLoadingFolder && !folderError && visibleCertificates.length === 0 && (
                  <div className="documents-empty">
                    <span className="documents-empty__icon"><CertificateIcon /></span>
                    <h2 className="card__title">No certificates issued yet</h2>
                    <p>Upload a finished certificate to generate its Certificate ID and QR code.</p>
                  </div>
                )}
                {visibleCertificates.map((cert) => (
                  <CertificateTile
                    key={cert.id}
                    certificate={cert}
                    onSelect={() => setSelectedItem({ kind: "certificate", data: cert })}
                    isSelected={selectedItem?.kind === "certificate" && selectedItem.data.id === cert.id}
                  />
                ))}
              </>
            )}
          </div>
        </section>

        {selectedItem && (
          <DetailsPanel
            selectedItem={selectedItem}
            onClose={() => setSelectedItem(null)}
            onOpenFolder={level === LEVEL.ROOT ? () => openArchive(selectedItem.data) : () => openEventFolder(selectedItem.data)}
            onRevoke={canEdit ? openRevokeModal : undefined}
            onDownload={canEdit ? handleDownloadCertificate : undefined}
            isDownloading={Boolean(downloadState)}
          />
        )}
      </div>

      {revokeTarget && (
        <RevokeModal
          certificate={revokeTarget}
          reason={revokeReason}
          onReasonChange={setRevokeReason}
          error={revokeError}
          isSubmitting={isRevoking}
          onCancel={closeRevokeModal}
          onConfirm={confirmRevoke}
        />
      )}
    </>
  );
}

function FolderTile({ name, description, metaLabel, status, onOpen, onSelect, isSelected }) {
  return (
    <article className={`document-tile certification-tile ${isSelected ? "document-tile--active" : ""}`}>
      <button type="button" className="certification-tile__open" onClick={onSelect} onDoubleClick={onOpen}>
        <span className="document-tile__icon document-tile__icon--folder"><FolderIcon /></span>
        <span className="document-tile__content">
          <span className="document-tile__name">{name}</span>
          <span className="certification-tile__description">{description}</span>
        </span>
      </button>
      <span className="certification-tile__footer">
        <span>{metaLabel}</span>
        <span className="certification-tile__footer-actions">
          <span className="certification-status">{status}</span>
          <button type="button" className="certification-details-btn" onClick={onOpen}>Open</button>
        </span>
      </span>
    </article>
  );
}

function CertificateTile({ certificate, onSelect, isSelected }) {
  const isImage = certificate.mimeType?.startsWith("image/");
  return (
    <article className={`document-tile certification-tile ${isSelected ? "document-tile--active" : ""}`}>
      <button type="button" className="certification-tile__open certification-tile__open--static" onClick={onSelect}>
        <span className="document-tile__icon document-tile__icon--file">
          {isImage ? <img src={certificate.url} alt="" /> : <CertificateIcon />}
        </span>
        <span className="document-tile__content">
          <span className="document-tile__name">{certificate.originalFileName}</span>
          <span className="certification-tile__description">{certificate.certificateNumber}</span>
        </span>
      </button>
      <span className="certification-tile__footer">
        <span>{formatFileSize(certificate.fileSize)}</span>
        <span className="certification-tile__footer-actions">
          <span className={`certification-status certification-status--${certificate.status === "REVOKED" ? "revoked" : "active"}`}>
            {certificate.status === "REVOKED" ? "Revoked" : "QR Ready"}
          </span>
          <button type="button" className="certification-details-btn" onClick={onSelect}>Details</button>
        </span>
      </span>
    </article>
  );
}

function DetailsPanel({ selectedItem, onClose, onOpenFolder, onRevoke, onDownload, isDownloading }) {
  const { kind, data } = selectedItem;

  return (
    <aside className="card documents-details">
      <div className={`documents-details__icon documents-details__icon--${kind === "certificate" ? "file" : "folder"}`}>
        {kind === "certificate" ? <CertificateIcon /> : <FolderIcon />}
      </div>

      {kind === "archive" && (
        <>
          <h2>Academic Year {data.schoolYear}</h2>
          <p>Certification archive</p>
          <dl className="documents-meta-list">
            <div><dt>Event folders</dt><dd>{data.eventFolders.length}</dd></div>
            <div><dt>Created</dt><dd>{formatEventDate(data.createdAt)}</dd></div>
          </dl>
          <div className="documents-details__actions">
            <button type="button" className="btn btn--primary" onClick={onOpenFolder}>Open archive</button>
            <button type="button" className="btn" onClick={onClose}>Close details</button>
          </div>
        </>
      )}

      {kind === "eventFolder" && (
        <>
          <h2>{data.title}</h2>
          <p>Event certification folder</p>
          <dl className="documents-meta-list">
            <div><dt>Date</dt><dd>{formatEventDate(data.date)}</dd></div>
            <div><dt>Location</dt><dd>{data.location}</dd></div>
            <div><dt>Certificates</dt><dd>{data.certificateCount}</dd></div>
            <div><dt>Status</dt><dd>{data.status}</dd></div>
          </dl>
          <div className="documents-details__actions">
            <button type="button" className="btn btn--primary" onClick={onOpenFolder}>Open folder</button>
            <button type="button" className="btn" onClick={onClose}>Close details</button>
          </div>
        </>
      )}

      {kind === "certificate" && (
        <>
          <h2>{data.originalFileName}</h2>
          <p>{data.status === "REVOKED" ? "Revoked certificate" : "Issued certificate"}</p>
          {data.mimeType?.startsWith("image/") && (
            <img className="certification-preview" src={data.url} alt={data.originalFileName} />
          )}
          <dl className="documents-meta-list">
            <div><dt>Certificate ID</dt><dd>{data.certificateNumber}</dd></div>
            <div><dt>Verification link</dt><dd className="certification-details-link">{data.verificationUrl}</dd></div>
            <div><dt>File size</dt><dd>{formatFileSize(data.fileSize)}</dd></div>
            <div><dt>Issued</dt><dd>{formatEventDate(data.issuedAt)}</dd></div>
            <div><dt>Issued by</dt><dd>{data.issuedBy ?? "—"}</dd></div>
            <div><dt>Status</dt><dd>{data.status === "REVOKED" ? `Revoked${data.revokeReason ? ` — ${data.revokeReason}` : ""}` : "Active"}</dd></div>
            <div><dt>Ledger hash</dt><dd className="certification-details-hash">{data.certificateHash}</dd></div>
          </dl>
          <div className="documents-details__actions">
            {onDownload && (
              <button type="button" className="btn btn--primary" onClick={() => onDownload(data)} disabled={isDownloading}>Download</button>
            )}
            {data.status !== "REVOKED" && onRevoke && (
              <button type="button" className="btn btn--danger" onClick={() => onRevoke(data)}>Revoke</button>
            )}
            <button type="button" className="btn" onClick={onClose}>Close details</button>
          </div>
        </>
      )}
    </aside>
  );
}

function RevokeModal({ certificate, reason, onReasonChange, error, isSubmitting, onCancel, onConfirm }) {
  return (
    <div className="member-modal" role="presentation">
      <div className="member-modal__panel member-modal__panel--approval" role="dialog" aria-modal="true" aria-labelledby="revoke-modal-title">
        <div className="member-modal__header">
          <div>
            <p className="member-modal__eyebrow">Certificate</p>
            <h2 className="member-modal__title" id="revoke-modal-title">Revoke certificate</h2>
          </div>
          <button type="button" className="icon-btn icon-btn--plain" onClick={onCancel} disabled={isSubmitting} aria-label="Close revoke modal">
            <CloseIcon />
          </button>
        </div>
        <form
          className="member-modal__form"
          onSubmit={(event) => { event.preventDefault(); onConfirm(); }}
        >
          <p>
            Revoke <strong>{certificate.certificateNumber}</strong> ({certificate.originalFileName})? This cannot be undone —
            the certificate will remain on record but will show as revoked whenever it is scanned or verified.
          </p>
          <label className="dash-form__field">
            Reason (optional)
            <textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="e.g. Issued in error, duplicate submission..."
              rows={3}
              maxLength={300}
              autoFocus
              disabled={isSubmitting}
            />
          </label>
          {error && <p className="certification-upload-error" role="alert">{error}</p>}
          <div className="member-modal__actions">
            <button type="button" className="btn btn--outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn--danger" disabled={isSubmitting}>
              {isSubmitting ? "Revoking…" : "Revoke certificate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CloseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
}

function UploadIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 21h14" /></svg>;
}

function DownloadIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
}

function SearchIcon() {
  return <svg className="certification-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg>;
}

function CertificateIcon() {
  return <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v14l-4-2-3 2-3-2-4 2V5a2 2 0 0 1 2-2Z" /><path d="m9 10 2 2 4-4" /></svg>;
}

function FolderIcon() {
  return <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>;
}

function formatEventDate(dateValue) {
  if (!dateValue) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(dateValue));
}

function formatFileSize(size) {
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function guessExtension(mimeType) {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType?.startsWith("image/")) return ".jpg";
  return "";
}