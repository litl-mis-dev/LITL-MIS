import { useCallback, useEffect, useMemo, useState } from "react";
import {
    fetchDocuments,
    getDocumentDownloadUrl,
    getDocumentPreviewUrl,
} from "../../services/documents.service.js";
import { getSocket } from "../../services/socket.js";

const PREVIEWABLE_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg"]);

export default function Documents() {
    const [items,          setItems]          = useState([]);
    const [isLoading,      setIsLoading]      = useState(true);
    const [loadError,      setLoadError]      = useState("");
    const [currentFolderId, setCurrentFolderId] = useState(null);
    const [selectedItemId,  setSelectedItemId]  = useState(null);
    const [searchTerm,      setSearchTerm]      = useState("");
    const [previewItem,     setPreviewItem]     = useState(null);

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        setLoadError("");
        try {
            const data = await fetchDocuments();
            setItems(data.items ?? []);
        } catch (err) {
            setLoadError(err.response?.data?.message || "Could not load documents. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    // Real-time: uploads, renames, sharing/access changes, and deletions
    // show up live, respecting whatever access this fetch already enforces.
    useEffect(() => {
        const socket = getSocket();
        const handler = () => loadAll();
        socket.on('document:changed', handler);
        return () => socket.off('document:changed', handler);
    }, [loadAll]);

    const selectedItem  = items.find(item => item.id === selectedItemId) ?? null;
    const currentFolder = items.find(item => item.id === currentFolderId) ?? null;

    const visibleItems = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        return items
            .filter(item => item.parentId === currentFolderId)
            .filter(item => !item.trashedAt)
            .filter(item => !query || item.name.toLowerCase().includes(query))
            .sort((a, b) => {
                if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    }, [currentFolderId, items, searchTerm]);

    const breadcrumbs = useMemo(() => {
        const trail = [];
        let folder = currentFolder;
        while (folder) {
            trail.unshift(folder);
            folder = items.find(item => item.id === folder.parentId);
        }
        return trail;
    }, [currentFolder, items]);

    function openFolder(folderId) {
        setCurrentFolderId(folderId);
        setSelectedItemId(null);
        setSearchTerm("");
    }

    function openItem(item) {
        if (item.type === "folder") {
            openFolder(item.id);
            return;
        }
        setPreviewItem(item);
    }

    function handleDownload(item) {
        if (item.type === "folder") return;
        window.location.href = getDocumentDownloadUrl(item.id);
    }

    return (
        <>
            <div className="dash__header">
                <div>
                    <p className="dash__eyebrow">Files</p>
                    <h1 className="dash__title">Documents</h1>
                    <p className="dash__subtitle">View and download shared documents.</p>
                </div>
            </div>

            {isLoading ? (
                <section className="card documents-main">
                    <p className="card__sub">Loading documents…</p>
                </section>
            ) : loadError ? (
                <section className="card documents-main">
                    <p className="card__sub">{loadError}</p>
                    <button type="button" className="btn btn--outline" onClick={loadAll}>
                        Try again
                    </button>
                </section>
            ) : (
                <div className={`documents-workspace ${selectedItem ? "" : "documents-workspace--full"}`}>

                    {/* ── Main grid ─────────────────────────────────────────── */}
                    <section className="card documents-main">
                        <div className="documents-toolbar">
                            <div className="documents-breadcrumbs" aria-label="Folder path">
                                <button type="button" onClick={() => openFolder(null)}>
                                    My Drive
                                </button>
                                {breadcrumbs.map(folder => (
                                    <button
                                        key={folder.id}
                                        type="button"
                                        onClick={() => openFolder(folder.id)}
                                    >
                                        {folder.name}
                                    </button>
                                ))}
                            </div>

                            <label className="member-search documents-search">
                                <span className="sr-only">Search documents</span>
                                <input
                                    type="search"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    placeholder="Search in this folder"
                                />
                            </label>
                        </div>

                        <div className="documents-grid">
                            {visibleItems.map(item => (
                                <article
                                    key={item.id}
                                    className={`document-tile ${selectedItemId === item.id ? "document-tile--active" : ""}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setSelectedItemId(item.id)}
                                    onDoubleClick={() => openItem(item)}
                                    onKeyDown={e => { if (e.key === "Enter") setSelectedItemId(item.id); }}
                                >
                                    <span className={`document-tile__icon document-tile__icon--${item.type}`}>
                                        {item.type === "folder" ? <FolderIcon /> : <FileIcon />}
                                    </span>
                                    <span className="document-tile__name">{item.name}</span>
                                    <span className="document-tile__meta">
                                        {item.type === "folder" ? "Folder" : item.fileType} | {item.updatedAt}
                                    </span>
                                </article>
                            ))}

                            {visibleItems.length === 0 && (
                                <div className="documents-empty">
                                    <span className="documents-empty__icon"><FolderIcon /></span>
                                    <h2 className="card__title">No documents found</h2>
                                    <p className="card__sub">
                                        {searchTerm
                                            ? `No results for "${searchTerm}".`
                                            : "There are no shared documents in this folder yet."}
                                    </p>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* ── Details panel ─────────────────────────────────────── */}
                    {selectedItem && (
                        <aside className="card documents-details">
                            <div className={`documents-details__icon documents-details__icon--${selectedItem.type}`}>
                                {selectedItem.type === "folder" ? <FolderIcon /> : <FileIcon />}
                            </div>

                            <h2 className="card__title">{selectedItem.name}</h2>
                            <p className="card__sub">
                                {selectedItem.type === "folder"
                                    ? "Folder"
                                    : `${selectedItem.fileType} document`}
                            </p>

                            <dl className="documents-meta-list">
                                <div>
                                    <dt>Owner</dt>
                                    <dd>{selectedItem.owner}</dd>
                                </div>
                                <div>
                                    <dt>Updated</dt>
                                    <dd>{selectedItem.updatedAt}</dd>
                                </div>
                                {selectedItem.type === "file" && (
                                    <div>
                                        <dt>Size</dt>
                                        <dd>{selectedItem.size}</dd>
                                    </div>
                                )}
                            </dl>

                            <div className="documents-details__actions">
                                {selectedItem.type === "file" && (
                                    <>
                                        <button
                                            type="button"
                                            className="btn btn--primary"
                                            onClick={() => setPreviewItem(selectedItem)}
                                        >
                                            View
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn--outline"
                                            onClick={() => handleDownload(selectedItem)}
                                        >
                                            Download
                                        </button>
                                    </>
                                )}
                                {selectedItem.type === "folder" && (
                                    <button
                                        type="button"
                                        className="btn btn--primary"
                                        onClick={() => openFolder(selectedItem.id)}
                                    >
                                        Open
                                    </button>
                                )}
                            </div>
                        </aside>
                    )}
                </div>
            )}

            {/* ── Preview modal ──────────────────────────────────────────────── */}
            {previewItem && (
                <div className="member-modal" role="presentation">
                    <div
                        className="member-modal__panel member-modal__panel--filter"
                        role="dialog"
                        aria-modal="true"
                    >
                        <div className="member-modal__header">
                            <div>
                                <p className="member-modal__eyebrow">Preview</p>
                                <h2 className="member-modal__title">{previewItem.name}</h2>
                            </div>
                            <button
                                type="button"
                                className="icon-btn icon-btn--plain"
                                onClick={() => setPreviewItem(null)}
                                aria-label="Close preview"
                            >
                                <CloseIcon />
                            </button>
                        </div>

                        <div className="document-preview">
                            {renderPreviewBody(previewItem)}
                        </div>

                        <div className="member-modal__footer">
                            <button
                                type="button"
                                className="btn btn--outline"
                                onClick={() => handleDownload(previewItem)}
                            >
                                Download
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ── Preview renderer (identical to officer version) ───────────────────────────

function renderPreviewBody(item) {
    const extension = (item.fileType || "").toLowerCase();
    const url = getDocumentPreviewUrl(item.id);

    if (extension === "pdf") {
        return <iframe className="document-preview__frame" src={url} title={item.name} />;
    }
    if (PREVIEWABLE_IMAGE_EXT.has(extension)) {
        return <img className="document-preview__image" src={url} alt={item.name} />;
    }
    return (
        <>
            <div className="documents-details__icon documents-details__icon--file">
                <FileIcon />
            </div>
            <p className="document-preview__title">{item.fileType} file</p>
            <p className="card__sub">
                Preview isn't available for this file type — download it to view.
            </p>
        </>
    );
}

// ── Icons (identical to officer version) ─────────────────────────────────────

function FolderIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 19V5c0-.6.2-1 .6-1.4C4 3.2 4.4 3 5 3h5l2 2h7c.6 0 1 .2 1.4.6.4.4.6.8.6 1.4v12c0 .6-.2 1-.6 1.4-.4.4-.8.6-1.4.6H5c-.6 0-1-.2-1.4-.6C3.2 20 3 19.6 3 19Z" />
        </svg>
    );
}

function FileIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 22c-.6 0-1-.2-1.4-.6C4.2 21 4 20.6 4 20V4c0-.6.2-1 .6-1.4C5 2.2 5.4 2 6 2h8l6 6v12c0 .6-.2 1-.6 1.4-.4.4-.8.6-1.4.6H6Zm7-13h5l-5-5v5Zm-5 8h8v-2H8v2Zm0-4h8v-2H8v2Z" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
        </svg>
    );
}