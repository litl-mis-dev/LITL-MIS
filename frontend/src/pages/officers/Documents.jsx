import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardHeader from "../../components/officers/DashboardHeader.jsx";
import { useRole } from "../../utils/useRole.js";
import ConfirmActionButton from "../../components/officers/ConfirmActionButton.jsx";
import {
    fetchDocuments,
    fetchShareableOfficers,
    createFolder as createFolderRequest,
    uploadDocuments as uploadDocumentsRequest,
    renameDocument,
    updateDocumentAccess,
    trashDocument,
    restoreDocument,
    permanentlyDeleteDocument,
    getDocumentDownloadUrl,
    getDocumentPreviewUrl,
} from "../../services/documents.service.js";
import { getSocket } from "../../services/socket.js";

const groupAccessOptions = ["Members", "Officers", "Adviser/Dept. Chair"];

const PREVIEWABLE_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg"]);

function createAccess({ groups = [], officerPermissions = {}, officerKeys = [] } = {}) {
    const permissions = { ...officerPermissions };

    if (groups.includes("Officers")) {
        officerKeys.forEach((key) => {
            permissions[key] = permissions[key] ?? "view";
        });
    }

    const hasAllOfficers = officerKeys.length > 0 && officerKeys.every((key) => permissions[key]);

    return {
        groups: hasAllOfficers ? uniqueAccess([...groups, "Officers"]) : groups.filter((group) => group !== "Officers"),
        officers: permissions,
    };
}

export default function Documents() {
    const { role } = useRole();
    // Documents has no RBAC — every officer has edit access EXCEPT the
    // Adviser / Dept. Chair, who is restricted to view-only.
    const canEditModule = role !== "ADVISER_DEPT_CHAIR";
    const [items, setItems] = useState([]);
    const [officers, setOfficers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [actionError, setActionError] = useState("");
    const [isUploading, setIsUploading] = useState(false);

    const [currentFolderId, setCurrentFolderId] = useState(null);
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
    const [accessModal, setAccessModal] = useState(null);
    const [previewItem, setPreviewItem] = useState(null);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [renamingItem, setRenamingItem] = useState(null);
    const [renameValue, setRenameValue] = useState("");
    const [newFolderName, setNewFolderName] = useState("");
    const [isTrashOpen, setIsTrashOpen] = useState(false);
    const fileInputRef = useRef(null);

    const officerAccessOptions = officers;
    const officerAccessKeys = useMemo(() => officers.map((officer) => String(officer.id)), [officers]);
    const defaultOfficerPermissions = useMemo(
        () => Object.fromEntries(officerAccessKeys.map((key) => [key, "view"])),
        [officerAccessKeys]
    );

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        setLoadError("");
        try {
            // The officers-sharing list is only needed (and only permitted) for
            // roles with EDIT on Documents — a VIEW-only role should still be
            // able to load and browse documents without hitting that endpoint.
            const [docsData, officersData] = await Promise.all([
                fetchDocuments(),
                canEditModule ? fetchShareableOfficers() : Promise.resolve({ officers: [] }),
            ]);
            setItems(docsData.items ?? []);
            setOfficers(officersData.officers ?? []);
        } catch (err) {
            setLoadError(err.response?.data?.message || "Could not load documents. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, [canEditModule]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    // Real-time: uploads, renames, sharing/access changes, and deletions
    // show up live. The fetch itself still enforces access permissions, so
    // a broadcast signal is safe — it only triggers a scoped refetch.
    useEffect(() => {
        const socket = getSocket();
        const handler = () => loadAll();
        socket.on('document:changed', handler);
        return () => socket.off('document:changed', handler);
    }, [loadAll]);

    const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
    const currentFolder = isTrashOpen ? null : items.find((item) => item.id === currentFolderId) ?? null;

    const visibleItems = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();

        if (isTrashOpen) {
            return items
                .filter((item) => item.trashedAt)
                .filter((item) => !query || item.name.toLowerCase().includes(query))
                .sort((a, b) => {
                    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
        }

        return items
            .filter((item) => item.parentId === currentFolderId)
            .filter((item) => !item.trashedAt)
            .filter((item) => !query || item.name.toLowerCase().includes(query))
            .sort((a, b) => {
                if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    }, [currentFolderId, isTrashOpen, items, searchTerm]);

    const breadcrumbs = useMemo(() => {
        const trail = [];
        let folder = currentFolder;

        while (folder) {
            trail.unshift(folder);
            folder = items.find((item) => item.id === folder.parentId);
        }

        return trail;
    }, [currentFolder, items]);

    function openFolder(folderId) {
        setCurrentFolderId(folderId);
        setIsTrashOpen(false);
        setSelectedItemId(null);
        setSearchTerm("");
    }

    function openTrash() {
        setIsTrashOpen(true);
        setCurrentFolderId(null);
        setSelectedItemId(null);
        setSearchTerm("");
        setOpenMenuId(null);
    }

    function openItem(item) {
        if (isTrashOpen) {
            selectItem(item);
            return;
        }

        if (item.type === "folder") {
            openFolder(item.id);
            return;
        }

        setPreviewItem(item);
    }

    function selectItem(item) {
        setSelectedItemId(item.id);
        setOpenMenuId(null);
    }

    // ── Create folder ────────────────────────────────────────────────────────

    async function handleCreateFolder(event) {
        event.preventDefault();
        const folderName = newFolderName.trim();
        if (!folderName) return;

        setActionError("");
        try {
            const data = await createFolderRequest(folderName, currentFolderId);
            setItems((current) => [...current, data.item]);
            setSelectedItemId(data.item.id);
            setIsTrashOpen(false);
            setNewFolderName("");
            setIsFolderModalOpen(false);
        } catch (err) {
            setActionError(err.response?.data?.message || "Could not create the folder. Please try again.");
        }
    }

    // ── Upload ────────────────────────────────────────────────────────────────

    async function handleUploadFiles(event) {
        const files = Array.from(event.target.files ?? []);
        if (files.length === 0) return;

        setActionError("");
        setIsUploading(true);
        try {
            const data = await uploadDocumentsRequest(files, currentFolderId);
            setItems((current) => [...current, ...data.items]);
            setSelectedItemId(data.items[0]?.id ?? null);
            setIsTrashOpen(false);
        } catch (err) {
            setActionError(err.response?.data?.message || "Upload failed. Please try again.");
        } finally {
            setIsUploading(false);
            event.target.value = "";
        }
    }

    // ── Sharing / access ─────────────────────────────────────────────────────
    // Toggling a checkbox updates the UI immediately, then persists via PUT;
    // on success the server's own (recomputed) access object replaces it —
    // on failure the optimistic change is rolled back.

function openAccessModal(item) {
    setSelectedItemId(item.id);
    setOpenMenuId(null);
    setAccessModal({
        itemId: item.id,
        localAccess: {
            groups:   [...(item.access?.groups   ?? [])],
            officers: { ...(item.access?.officers ?? {}) },
        },
        isSaving: false,
    });
}

function closeAccessModal() {
    setAccessModal(null);
}

function handleGroupAccessToggle(group) {
    setAccessModal((prev) => {
        if (!prev) return prev;
        const { localAccess } = prev;
        const hasGroup = localAccess.groups.includes(group);

        if (group === "Officers") {
            return hasGroup
                ? { ...prev, localAccess: { ...localAccess, groups: localAccess.groups.filter((g) => g !== "Officers"), officers: {} } }
                : { ...prev, localAccess: createAccess({ groups: [...localAccess.groups, "Officers"], officerPermissions: { ...defaultOfficerPermissions }, officerKeys: officerAccessKeys }) };
        }

        return {
            ...prev,
            localAccess: {
                ...localAccess,
                groups: hasGroup
                    ? localAccess.groups.filter((g) => g !== group)
                    : [...localAccess.groups, group],
            },
        };
    });
}

function handleOfficerAccessToggle(officerKey) {
    setAccessModal((prev) => {
        if (!prev) return prev;
        const { localAccess } = prev;
        const officers = { ...localAccess.officers };

        if (officers[officerKey]) {
            delete officers[officerKey];
        } else {
            officers[officerKey] = "view";
        }

        const hasAllOfficers = officerAccessKeys.length > 0 && officerAccessKeys.every((key) => officers[key]);
        return {
            ...prev,
            localAccess: {
                ...localAccess,
                groups: hasAllOfficers
                    ? uniqueAccess([...localAccess.groups, "Officers"])
                    : localAccess.groups.filter((g) => g !== "Officers"),
                officers,
            },
        };
    });
}

function handleOfficerPermissionChange(officerKey, permission) {
    setAccessModal((prev) => {
        if (!prev) return prev;
        const { localAccess } = prev;
        const officers = { ...localAccess.officers, [officerKey]: permission };
        const hasAllOfficers = officerAccessKeys.length > 0 && officerAccessKeys.every((key) => officers[key]);
        return {
            ...prev,
            localAccess: {
                ...localAccess,
                groups: hasAllOfficers
                    ? uniqueAccess([...localAccess.groups, "Officers"])
                    : localAccess.groups.filter((g) => g !== "Officers"),
                officers,
            },
        };
    });
}

async function handleSaveAccess() {
    if (!accessModal) return;
    setAccessModal((prev) => prev ? { ...prev, isSaving: true } : prev);
    setActionError("");

    try {
        const payload = {
            groups:   accessModal.localAccess.groups.filter((g) => g !== "Officers"),
            officers: accessModal.localAccess.officers,
        };
        const data = await updateDocumentAccess(accessModal.itemId, payload);
        setItems((current) => current.map((item) => item.id === data.item.id ? data.item : item));
        closeAccessModal();
    } catch (err) {
        setAccessModal((prev) => prev ? { ...prev, isSaving: false } : prev);
        setActionError(err.response?.data?.message || "Could not update sharing. Please try again.");
    }
}
    // ── Rename ────────────────────────────────────────────────────────────────

    function openRenameModal(item) {
        setRenamingItem(item);
        setRenameValue(item.name);
        setOpenMenuId(null);
    }

    async function handleRenameItem(event) {
        event.preventDefault();
        const nextName = renameValue.trim();
        if (!nextName || !renamingItem) return;

        setActionError("");
        try {
            const data = await renameDocument(renamingItem.id, nextName);
            setItems((current) => current.map((item) => (item.id === data.item.id ? data.item : item)));
            setRenamingItem(null);
            setRenameValue("");
        } catch (err) {
            setActionError(err.response?.data?.message || "Could not rename. Please try again.");
        }
    }

    // ── Download ──────────────────────────────────────────────────────────────

    function handleDownloadItem(item) {
        setOpenMenuId(null);
        if (item.type === "folder") {
            setActionError("Folder download isn't available yet — download files individually.");
            return;
        }
        window.location.href = getDocumentDownloadUrl(item.id);
    }

    // ── Trash / restore / permanent delete ──────────────────────────────────

    async function handleDeleteItem(itemId) {
        setActionError("");
        try {
            await trashDocument(itemId);
            await loadAll();
        } catch (err) {
            setActionError(err.response?.data?.message || "Could not move to Temporary. Please try again.");
        } finally {
            setSelectedItemId(null);
            setOpenMenuId(null);
        }
    }

    async function handleRestoreItem(itemId) {
        setActionError("");
        try {
            await restoreDocument(itemId);
            await loadAll();
        } catch (err) {
            setActionError(err.response?.data?.message || "Could not restore. Please try again.");
        } finally {
            setSelectedItemId(null);
            setOpenMenuId(null);
        }
    }

    async function handlePermanentDelete(itemId) {
        setActionError("");
        try {
            await permanentlyDeleteDocument(itemId);
            await loadAll();
        } catch (err) {
            setActionError(err.response?.data?.message || "Could not permanently delete. Please try again.");
        } finally {
            setSelectedItemId(null);
            setOpenMenuId(null);
        }
    }

    return (
        <>
            <DashboardHeader
                page="documents"
                actions={(
                    <>
                        {canEditModule && (
                            <>
                                <button type="button" className="btn btn--outline" onClick={() => setIsFolderModalOpen(true)}>
                                    New Folder
                                </button>
                                <button type="button" className="btn btn--primary" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                                    {isUploading ? "Uploading…" : "Upload"}
                                </button>
                                <button type="button" className="btn btn--outline btn--danger" onClick={openTrash}>
                                    <TrashIcon />
                                    Trash
                                </button>
                                <input
                                    ref={fileInputRef}
                                    className="sr-only"
                                    type="file"
                                    multiple
                                    onChange={handleUploadFiles}
                                    aria-label="Upload documents"
                                />
                            </>
                        )}
                    </>
                )}
            />

            {actionError && (
                <div className="card documents-alert documents-alert--error" role="alert">
                    {actionError}
                    <button type="button" className="icon-btn icon-btn--plain" onClick={() => setActionError("")} aria-label="Dismiss">
                        <CloseIcon />
                    </button>
                </div>
            )}

            {isLoading ? (
                <section className="card documents-main">
                    <p className="card__sub">Loading documents…</p>
                </section>
            ) : loadError ? (
                <section className="card documents-main">
                    <p className="card__sub">{loadError}</p>
                    <button type="button" className="btn btn--outline" onClick={loadAll}>Try again</button>
                </section>
            ) : (
            <div className={`documents-workspace ${selectedItem ? "" : "documents-workspace--full"}`}>
                <section className="card documents-main">
                    <div className="documents-toolbar">
                        <div className="documents-breadcrumbs" aria-label="Folder path">
                            <button type="button" onClick={() => openFolder(null)}>My Drive</button>
                            {isTrashOpen ? (
                                <button type="button" aria-current="page">Temporary</button>
                            ) : breadcrumbs.map((folder) => (
                                <button key={folder.id} type="button" onClick={() => openFolder(folder.id)}>
                                    {folder.name}
                                </button>
                            ))}
                        </div>
                        <label className="member-search documents-search">
                            <span className="sr-only">Search documents</span>
                            <input
                                type="search"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Search in this folder"
                            />
                        </label>
                    </div>

                    <div className="documents-grid">
                        {visibleItems.map((item) => (
                            <article
                                key={item.id}
                                className={`document-tile ${selectedItemId === item.id ? "document-tile--active" : ""}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => selectItem(item)}
                                onDoubleClick={() => openItem(item)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") selectItem(item);
                                }}
                            >
                                <button
                                    type="button"
                                    className="document-tile__menu-btn"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setOpenMenuId((currentId) => currentId === item.id ? null : item.id);
                                    }}
                                    aria-label={`Open actions for ${item.name}`}
                                >
                                    <DotsIcon />
                                </button>
                                {openMenuId === item.id && (
                                    <div className="document-action-menu" onClick={(event) => event.stopPropagation()}>
                                        <button type="button" onClick={() => selectItem(item)}>Details</button>
                                        {!isTrashOpen && canEditModule && item.myPermission === "edit" && (
                                            <>
                                                {/* Share access — only the document owner (still an officer) or a top admin */}
                                                {item.canManage && (
                                                    <button type="button" onClick={() => openAccessModal(item)}>Share access</button>
                                                )}
                                                <button type="button" onClick={() => openRenameModal(item)}>Rename</button>
                                            </>
                                        )}
                                        {/* View-only access is literally view-only — downloading is an
                                            action, so it's hidden unless this item is edit-permitted. */}
                                        {item.myPermission === "edit" && (
                                            <button type="button" onClick={() => handleDownloadItem(item)}>Download</button>
                                        )}
                                        {isTrashOpen ? (
                                            canEditModule && (
                                                <>
                                                    <button type="button" onClick={() => handleRestoreItem(item.id)}>Restore</button>
                                                    <ConfirmActionButton
                                                        className="document-action-menu__danger"
                                                        onConfirm={() => handlePermanentDelete(item.id)}
                                                        title="Delete forever?"
                                                        message={`"${item.name}" will be permanently deleted and cannot be recovered.`}
                                                        confirmLabel="Delete forever"
                                                        cancelLabel="Cancel"
                                                    >
                                                        Delete forever
                                                    </ConfirmActionButton>
                                                </>
                                            )
                                        ) : canEditModule && item.myPermission === "edit" && (
                                            <ConfirmActionButton
                                                className="document-action-menu__danger"
                                                onConfirm={() => handleDeleteItem(item.id)}
                                                title="Move to Temporary?"
                                                message={`"${item.name}" will be moved to Temporary (Trash). You can restore it from there later.`}
                                                confirmLabel="Move to Temporary"
                                                cancelLabel="Cancel"
                                            >
                                                Move to Temporary
                                            </ConfirmActionButton>
                                        )}
                                    </div>
                                )}
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
                                <span className="documents-empty__icon">{isTrashOpen ? <TrashIcon /> : <FolderIcon />}</span>
                                <h2 className="card__title">{isTrashOpen ? "Temporary is empty" : "No documents found"}</h2>
                                <p className="card__sub">
                                    {isTrashOpen
                                        ? "Deleted documents will stay here temporarily until restored."
                                        : "Create a folder or upload files to start organizing this space."}
                                </p>
                            </div>
                        )}
                    </div>
                </section>

                {selectedItem && (
                    <aside className="card documents-details">
                        <div className={`documents-details__icon documents-details__icon--${selectedItem.type}`}>
                            {selectedItem.type === "folder" ? <FolderIcon /> : <FileIcon />}
                        </div>
                        <h2 className="card__title">{selectedItem.name}</h2>
                        <p className="card__sub">
                            {selectedItem.type === "folder" ? "Folder" : `${selectedItem.fileType} document`}
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
                            {selectedItem.trashedAt && (
                                <div>
                                    <dt>Temporary</dt>
                                    <dd>Moved {selectedItem.trashedAt}</dd>
                                </div>
                            )}
                            {selectedItem.type === "file" && (
                                <div>
                                    <dt>Size</dt>
                                    <dd>{selectedItem.size}</dd>
                                </div>
                            )}
                            <div>
                                <dt>Access</dt>
                                <dd>{formatAccessSummary(selectedItem.access, officerAccessOptions)}</dd>
                            </div>
                        </dl>
                        <div className="documents-details__actions">
                            {isTrashOpen ? (
                                <>
                                    <button type="button" className="btn btn--primary" onClick={() => handleRestoreItem(selectedItem.id)}>
                                        Restore
                                    </button>
                                    <ConfirmActionButton
                                        className="btn btn--outline btn--danger"
                                        onConfirm={() => handlePermanentDelete(selectedItem.id)}
                                        title="Delete forever?"
                                        message={`"${selectedItem.name}" will be permanently deleted and cannot be recovered.`}
                                        confirmLabel="Delete forever"
                                        cancelLabel="Cancel"
                                    >
                                        Delete forever
                                    </ConfirmActionButton>
                                </>
                            ) : selectedItem.myPermission === "edit" && (
                                <ConfirmActionButton
                                    className="btn btn--outline btn--danger"
                                    onConfirm={() => handleDeleteItem(selectedItem.id)}
                                    title="Move to Temporary?"
                                    message={`"${selectedItem.name}" will be moved to Temporary (Trash). You can restore it from there later.`}
                                    confirmLabel="Move to Temporary"
                                    cancelLabel="Cancel"
                                >
                                    Move to Temporary
                                </ConfirmActionButton>
                            )}
                        </div>
                    </aside>
                )}
            </div>
            )}

            {isFolderModalOpen && (
                <div className="member-modal" role="presentation">
                    <div className="member-modal__panel member-modal__panel--approval" role="dialog" aria-modal="true">
                        <div className="member-modal__header">
                            <div>
                                <p className="member-modal__eyebrow">Folder</p>
                                <h2 className="member-modal__title">Create Folder</h2>
                            </div>
                            <button type="button" className="icon-btn icon-btn--plain" onClick={() => setIsFolderModalOpen(false)} aria-label="Close folder modal">
                                <CloseIcon />
                            </button>
                        </div>
                        <form className="member-modal__form document-modal-form" onSubmit={handleCreateFolder}>
                            <label className="dash-form__field">
                                Folder name
                                <input
                                    value={newFolderName}
                                    onChange={(event) => setNewFolderName(event.target.value)}
                                    placeholder="e.g. Assembly Files"
                                    autoFocus
                                    maxLength={50}
                                    required
                                />
                            </label>
                            <div className="member-modal__actions">
                                <button type="button" className="btn btn--outline" onClick={() => setIsFolderModalOpen(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn--primary">
                                    Create
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

{accessModal && (() => {
    const accessItem = items.find((i) => i.id === accessModal.itemId);
    const { localAccess, isSaving } = accessModal;
    return (
        <div className="member-modal" role="presentation">
            <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true">
                <div className="member-modal__header">
                    <div>
                        <p className="member-modal__eyebrow">Sharing</p>
                        <h2 className="member-modal__title">Manage Access</h2>
                    </div>
                    <button type="button" className="icon-btn icon-btn--plain"
                        onClick={closeAccessModal} disabled={isSaving} aria-label="Close access modal">
                        <CloseIcon />
                    </button>
                </div>
                <div className="filter-modal__body">
                    <p className="documents-access-title">{accessItem?.name}</p>
                    <fieldset className="filter-checklist">
                        <legend>Allowed groups</legend>
                        <div className="filter-checklist__grid">
                            {groupAccessOptions.map((group) => (
                                <label key={group} className="feature-checklist__item">
                                    <input
                                        type="checkbox"
                                        checked={localAccess.groups.includes(group)}
                                        onChange={() => handleGroupAccessToggle(group)}
                                        disabled={isSaving}
                                    />
                                    <span>{group}</span>
                                    {group !== "Officers" && (
                                        <small className="documents-access-note">View only</small>
                                    )}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <fieldset className="filter-checklist documents-officer-access">
                        <legend>Officers</legend>
                        <div className="documents-officer-access__list">
                            {officerAccessOptions.map((officer) => {
                                const key = String(officer.id);
                                return (
                                    <div key={key} className="documents-officer-access__item">
                                        <label className="documents-officer-access__person">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(localAccess.officers[key])}
                                                onChange={() => handleOfficerAccessToggle(key)}
                                                disabled={isSaving}
                                            />
                                            {officer.avatar ? (
                                                <img src={officer.avatar} alt={officer.name} className="user-cell__avatar" />
                                            ) : (
                                                <span className="user-cell__avatar user-cell__avatar--placeholder" aria-hidden="true" />
                                            )}
                                            <span>
                                                <strong>{officer.name}</strong>
                                                <small>{officer.role}</small>
                                            </span>
                                        </label>
                                        <div className="documents-permission-toggle" aria-label={`Permission for ${officer.name}`}>
                                            {["view", "edit"].map((permission) => (
                                                <button
                                                    key={permission}
                                                    type="button"
                                                    className={localAccess.officers[key] === permission ? "documents-permission-toggle__active" : ""}
                                                    disabled={!localAccess.officers[key] || isSaving}
                                                    onClick={() => handleOfficerPermissionChange(key, permission)}
                                                >
                                                    {permission === "view" ? "View" : "Edit"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </fieldset>
                </div>
                <div className="member-modal__footer">
                    <button type="button" className="btn btn--outline"
                        onClick={closeAccessModal} disabled={isSaving}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn--primary"
                        onClick={handleSaveAccess} disabled={isSaving}>
                        {isSaving ? "Saving..." : "Save Access"}
                    </button>
                </div>
            </div>
        </div>
    );
})()}

            {renamingItem && (
                <div className="member-modal" role="presentation">
                    <div className="member-modal__panel member-modal__panel--approval" role="dialog" aria-modal="true">
                        <div className="member-modal__header">
                            <div>
                                <p className="member-modal__eyebrow">Rename</p>
                                <h2 className="member-modal__title">{renamingItem.type === "folder" ? "Rename Folder" : "Rename File"}</h2>
                            </div>
                            <button type="button" className="icon-btn icon-btn--plain" onClick={() => setRenamingItem(null)} aria-label="Close rename modal">
                                <CloseIcon />
                            </button>
                        </div>
                        <form className="member-modal__form document-modal-form" onSubmit={handleRenameItem}>
                            <label className="dash-form__field">
                                Name
                                <input
                                    value={renameValue}
                                    onChange={(event) => setRenameValue(event.target.value)}
                                    autoFocus
                                    maxLength={50}
                                    required
                                />
                            </label>
                            <div className="member-modal__actions">
                                <button type="button" className="btn btn--outline" onClick={() => setRenamingItem(null)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn--primary">
                                    Save
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {previewItem && (
                <div className="member-modal" role="presentation">
                    <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true">
                        <div className="member-modal__header">
                            <div>
                                <p className="member-modal__eyebrow">Preview</p>
                                <h2 className="member-modal__title">{previewItem.name}</h2>
                            </div>
                            <button type="button" className="icon-btn icon-btn--plain" onClick={() => setPreviewItem(null)} aria-label="Close preview">
                                <CloseIcon />
                            </button>
                        </div>
                        <div className="document-preview">
                            {renderPreviewBody(previewItem)}
                        </div>
                        {previewItem.myPermission === "edit" && (
                            <div className="member-modal__footer">
                                <button type="button" className="btn btn--outline" onClick={() => handleDownloadItem(previewItem)}>
                                    Download
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

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
            <div className={`documents-details__icon documents-details__icon--${item.type}`}>
                <FileIcon />
            </div>
            <p className="document-preview__title">{item.fileType} file</p>
            <p className="card__sub">Preview isn't available for this file type — download it to view.</p>
        </>
    );
}

function uniqueAccess(accessItems) {
    return [...new Set(accessItems)];
}

function formatAccessSummary(accessItems, officerAccessOptions) {
    const groups = groupAccessOptions
        .filter((group) => accessItems.groups.includes(group))
        .map((group) => group === "Officers" ? "Officers" : `${group} (view only)`);
    const individualOfficers = officerAccessOptions
        .filter((officer) => accessItems.officers[String(officer.id)] && !accessItems.groups.includes("Officers"))
        .map((officer) => `${officer.name} (${accessItems.officers[String(officer.id)]})`);

    return [...groups, ...individualOfficers].join(", ") || "No access";
}

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

function DotsIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 8c-.6 0-1-.2-1.4-.6C10.2 7 10 6.6 10 6s.2-1 .6-1.4C11 4.2 11.4 4 12 4s1 .2 1.4.6c.4.4.6.8.6 1.4s-.2 1-.6 1.4c-.4.4-.8.6-1.4.6Zm0 6c-.6 0-1-.2-1.4-.6-.4-.4-.6-.8-.6-1.4s.2-1 .6-1.4c.4-.4.8-.6 1.4-.6s1 .2 1.4.6c.4.4.6.8.6 1.4s-.2 1-.6 1.4c-.4.4-.8.6-1.4.6Zm0 6c-.6 0-1-.2-1.4-.6-.4-.4-.6-.8-.6-1.4s.2-1 .6-1.4c.4-.4.8-.6 1.4-.6s1 .2 1.4.6c.4.4.6.8.6 1.4s-.2 1-.6 1.4c-.4.4-.8.6-1.4.6Z" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M7 21c-.6 0-1.1-.2-1.5-.6S5 19.6 4.9 19L4 7H3V5h5V3h8v2h5v2h-1l-.9 12c0 .6-.2 1.1-.6 1.5S17.6 21 17 21H7Zm10-14H6l.9 12H17L17 7ZM9 17h2V9H9v8Zm4 0h2V9h-2v8Z" />
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