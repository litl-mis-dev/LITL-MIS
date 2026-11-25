import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "../../../services/socket.js";
import {
    getMembersList, previewMembersList, saveMembersList, removeMembersListEntry,
} from "../../../services/officer.service.js";
import { readMembersListFile } from "../../../utils/readMembersListFile.js";
import { formatPersonName } from "../../../utils/formInputs.js";
import ModalPortal from "../../../components/ui/ModalPortal.jsx";
import RequiredMark from "../../../components/ui/RequiredMark.jsx";
import CharCount from "../../../components/ui/CharCount.jsx";
import { LIMITS } from "../../../utils/fieldLimits.js";
import ConfirmActionButton from "../../../components/officers/ConfirmActionButton.jsx";
import LoadingState from "../../../components/ui/LoadingState.jsx";

const ACCOUNT_STATUS_LABELS = {
    APPROVED: "Approved",
    PENDING_OFFICER_APPROVAL: "Pending approval",
    PENDING_EMAIL_VERIFICATION: "Verifying email",
    REJECTED: "Rejected",
    DEACTIVATED: "Deactivated",
};

// Member Approval ▸ Members List. Officers upload the list of students who
// may join (Student Number + Last Name). Pending registrations that match are
// approved automatically, and so is anyone on the list who registers later.
// Non-matches stay pending for manual review; nobody is rejected automatically.
export default function MembersListPanel({ onApprovalsChanged }) {
    const [entries, setEntries] = useState(null);
    const [loadError, setLoadError] = useState("");
    const [message, setMessage] = useState("");
    const [fileError, setFileError] = useState("");
    const [isReading, setIsReading] = useState(false);
    const [pendingRows, setPendingRows] = useState(null); // rows awaiting preview/confirm
    const [pendingSource, setPendingSource] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isListOpen, setIsListOpen] = useState(false);
    const fileInputRef = useRef(null);

    const loadMembersList = useCallback(async () => {
        try {
            const data = await getMembersList();
            setEntries(data.entries ?? []);
            setLoadError("");
        } catch {
            setLoadError("Couldn't load the Members List.");
        }
    }, []);

    useEffect(() => {
        let active = true;
        getMembersList()
            .then((data) => { if (active) setEntries(data.entries ?? []); })
            .catch(() => { if (active) setLoadError("Couldn't load the Members List."); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        const socket = getSocket();
        socket.on("membersList:changed", loadMembersList);
        return () => socket.off("membersList:changed", loadMembersList);
    }, [loadMembersList]);

    async function handleFileChosen(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setFileError("");
        setMessage("");
        setIsReading(true);
        try {
            const rows = await readMembersListFile(file);
            if (rows.length === 0) throw new Error("The file has no student rows under the headings.");
            setPendingSource(file.name);
            setPendingRows(rows);
        } catch (err) {
            setFileError(err.message || "Couldn't read that file.");
        } finally {
            setIsReading(false);
        }
    }

    function handleSaved(result) {
        setPendingRows(null);
        setIsAddOpen(false);
        setMessage(result.message);
        loadMembersList();
        if (result.approvedCount > 0) onApprovalsChanged?.();
    }

    return (
        <div className="card members-list-card">
            <div className="card__header">
                <div>
                    <h2 className="card__title">Members List</h2>
                    <p className="card__sub">
                        {loadError || (entries === null
                            ? "Loading Members List…"
                            : `${entries.length} student${entries.length === 1 ? "" : "s"} on the Members List.`)}
                    </p>
                </div>
                <div className="member-list-actions members-list-card__actions">
                    <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="sr-only" onChange={handleFileChosen} />
                    <button type="button" className="btn btn--primary" onClick={() => fileInputRef.current?.click()}
                        disabled={isReading} aria-busy={isReading}>
                        {isReading ? "Reading file…" : "Upload Members List"}
                    </button>
                    <button type="button" className="btn btn--outline" onClick={() => { setMessage(""); setIsAddOpen(true); }}>
                        Add Student
                    </button>
                    <button type="button" className="btn btn--outline" onClick={() => setIsListOpen(true)} disabled={!entries?.length}>
                        View Members List
                    </button>
                </div>
            </div>

            {/* Below the header, full width, so the buttons keep one line. */}
            <p className="members-list-card__note">
                Registrations with a CvSU email that match a student number and last name are approved automatically.
                Upload an .xlsx or .csv file with <strong>Student Number</strong> and <strong>Last Name</strong> columns.
            </p>

            {(message || fileError) && (
                <p className={`members-download-status ${fileError ? "members-download-status--error" : ""}`} role="status">
                    {fileError || message}
                </p>
            )}

            {pendingRows && (
                <MembersListPreviewModal
                    rows={pendingRows}
                    source={pendingSource}
                    allowReplace={pendingRows.length > 1}
                    onSaved={handleSaved}
                    onClose={() => setPendingRows(null)}
                />
            )}

            {isAddOpen && (
                <AddStudentModal
                    onNext={(row) => { setIsAddOpen(false); setPendingSource("Added by hand"); setPendingRows([row]); }}
                    onClose={() => setIsAddOpen(false)}
                />
            )}

            {isListOpen && (
                <MembersListModal
                    entries={entries ?? []}
                    onRemoved={(studentNumber) => {
                        setEntries((list) => (list ?? []).filter((e) => e.studentNumber !== studentNumber));
                        setMessage(`${studentNumber} was removed from the Members List. Members already approved stay approved.`);
                    }}
                    onClose={() => setIsListOpen(false)}
                />
            )}
        </div>
    );
}

// ── Preview: what saving will do, then save ──────────────────────────────────
function MembersListPreviewModal({ rows, source, allowReplace, onSaved, onClose }) {
    const [mode, setMode] = useState("add");
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    function changeMode(nextMode) {
        setMode(nextMode);
        setPreview(null);
        setError("");
    }

    useEffect(() => {
        let active = true;
        previewMembersList(rows, mode)
            .then((data) => { if (active) setPreview(data); })
            .catch((err) => {
                if (!active) return;
                setError(err.response?.data?.message ?? "Couldn't check the list. Please try again.");
                setPreview(err.response?.data?.invalid ? { invalid: err.response.data.invalid, invalidCount: err.response.data.invalid.length } : null);
            });
        return () => { active = false; };
    }, [rows, mode]);

    async function handleSave() {
        if (isSaving) return;
        setIsSaving(true);
        setError("");
        try {
            onSaved(await saveMembersList(rows, mode));
        } catch (err) {
            setError(err.response?.data?.message ?? "Couldn't save the Members List. Please try again.");
            setIsSaving(false);
        }
    }

    const canSave = Boolean(preview?.validRows) && !isSaving;

    return (
        <ModalPortal>
            <div className="member-modal" role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onClose(); }}>
                <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true" aria-labelledby="members-list-preview-title">
                    <div className="member-modal__header">
                        <div>
                            <p className="member-modal__eyebrow">Members List</p>
                            <h2 id="members-list-preview-title" className="member-modal__title">Review before saving</h2>
                        </div>
                        <button type="button" className="icon-btn icon-btn--plain" onClick={onClose} disabled={isSaving} aria-label="Close">×</button>
                    </div>

                    <div className="filter-modal__body">
                        <p className="card__sub">{source} · {rows.length} row{rows.length === 1 ? "" : "s"} read</p>

                        {allowReplace && (
                            <fieldset className="filter-checklist">
                                <legend>How to save this list</legend>
                                <label className="feature-checklist__item">
                                    <input type="radio" name="members-list-mode" checked={mode === "add"} onChange={() => changeMode("add")} disabled={isSaving} />
                                    <span>Add to the list: new students are added, changed last names are updated</span>
                                </label>
                                <label className="feature-checklist__item">
                                    <input type="radio" name="members-list-mode" checked={mode === "replace"} onChange={() => changeMode("replace")} disabled={isSaving} />
                                    <span>Replace the list: the Members List becomes exactly this file</span>
                                </label>
                            </fieldset>
                        )}

                        {!preview && !error && <LoadingState inline label="Checking the list…" />}
                        {error && <p className="members-download-status members-download-status--error" role="alert">{error}</p>}

                        {preview?.validRows > 0 && (
                            <>
                                <dl className="members-list-summary">
                                    <div><dt>Will be approved now</dt><dd>{preview.willApprove.length}</dd></div>
                                    <div><dt>New on the list</dt><dd>{preview.added}</dd></div>
                                    <div><dt>Last name updated</dt><dd>{preview.updated}</dd></div>
                                    {mode === "replace" && <div><dt>Removed from the list</dt><dd>{preview.removed}</dd></div>}
                                    <div><dt>Not registered yet</dt><dd>{preview.notRegisteredYet}</dd></div>
                                    <div><dt>Pending, not on the list</dt><dd>{preview.pendingNotListed}</dd></div>
                                    <div><dt>List size after saving</dt><dd>{preview.listSizeAfter}</dd></div>
                                </dl>
                                <p className="card__sub">
                                    Students who register later are approved automatically if they&apos;re on the Members List.
                                    {mode === "replace" && preview.removed > 0 && " Removing someone from the list doesn't undo an approval already given."}
                                </p>
                                <MembersListGroup title="Will be approved now" items={preview.willApprove}
                                    render={(u) => <><strong>{u.name}</strong><span>{u.studentNumber}</span></>} />
                                <MembersListGroup title="Name doesn't match — stays pending for manual review" items={preview.nameMismatch}
                                    render={(u) => <><strong>{u.name}</strong><span>{u.studentNumber} · list says &quot;{u.listLastName}&quot;</span></>} />
                                <MembersListGroup title="Registered with a personal email — stays pending for manual review" items={preview.personalEmail}
                                    render={(u) => <><strong>{u.name}</strong><span>{u.studentNumber} · confirm it&apos;s really this student before approving</span></>} />
                            </>
                        )}
                        {preview?.invalidCount > 0 && (
                            <MembersListGroup
                                title={`Rows skipped (${preview.invalidCount})`}
                                items={preview.invalid}
                                render={(r) => <><strong>Row {r.row}: {r.studentNumber || "(no student number)"} {r.lastName}</strong><span>{r.reason}</span></>}
                            />
                        )}
                    </div>

                    <div className="member-modal__footer">
                        <button type="button" className="btn btn--outline" onClick={onClose} disabled={isSaving}>Cancel</button>
                        {mode === "replace" ? (
                            <ConfirmActionButton
                                className="btn btn--primary"
                                disabled={!canSave}
                                busy={isSaving}
                                title="Replace the Members List?"
                                message={`The Members List will become exactly this list of ${preview?.validRows ?? 0} student${preview?.validRows === 1 ? "" : "s"}${preview?.removed ? `, and ${preview.removed} student${preview.removed === 1 ? "" : "s"} not on it will be removed` : ""}.`}
                                confirmLabel="Replace"
                                cancelLabel="Cancel"
                                onConfirm={handleSave}
                            >
                                {isSaving ? "Saving…" : "Replace List"}
                            </ConfirmActionButton>
                        ) : (
                            <button type="button" className="btn btn--primary" onClick={handleSave} disabled={!canSave} aria-busy={isSaving}>
                                {isSaving ? "Saving…" : "Save to List"}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
}

function MembersListGroup({ title, items, render }) {
    if (!items?.length) return null;
    return (
        <section className="members-list-entries">
            <h3>{title}</h3>
            <ul className="card-picker__list">
                {items.map((item, i) => (
                    <li key={item.userId ?? `${item.row}-${i}`} className="members-list-entries__item">{render(item)}</li>
                ))}
            </ul>
        </section>
    );
}

// ── Add one student ──────────────────────────────────────────────────────────
function AddStudentModal({ onNext, onClose }) {
    const [studentNumber, setStudentNumber] = useState("");
    const [lastName, setLastName] = useState("");

    function handleSubmit(event) {
        event.preventDefault();
        onNext({ row: 1, studentNumber: studentNumber.trim(), lastName: lastName.trim() });
    }

    return (
        <ModalPortal>
            <div className="member-modal" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
                <div className="member-modal__panel member-modal__panel--approval" role="dialog" aria-modal="true" aria-labelledby="members-list-add-title">
                    <div className="member-modal__header">
                        <div>
                            <p className="member-modal__eyebrow">Members List</p>
                            <h2 id="members-list-add-title" className="member-modal__title">Add Student</h2>
                        </div>
                        <button type="button" className="icon-btn icon-btn--plain" onClick={onClose} aria-label="Close">×</button>
                    </div>
                    <form className="member-modal__form member-modal__form--single" onSubmit={handleSubmit}>
                        <label className="dash-form__field">
                            <span>Student Number<RequiredMark /></span>
                            <input value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)}
                                placeholder="e.g. 2023-100-123" maxLength={20} required autoFocus />
                        </label>
                        <label className="dash-form__field">
                            <span>Last Name<RequiredMark /></span>
                            <input value={lastName} onChange={(e) => setLastName(formatPersonName(e.target.value))}
                                placeholder="e.g. Dela Cruz" maxLength={LIMITS.membersListLastName} required />
                            <CharCount value={lastName} max={LIMITS.membersListLastName} />
                        </label>
                        <p className="card__sub">If the student number is already on the list, its last name is updated.</p>
                        <div className="member-modal__actions">
                            <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
                            <button type="submit" className="btn btn--primary">Review</button>
                        </div>
                    </form>
                </div>
            </div>
        </ModalPortal>
    );
}

// ── View / remove ────────────────────────────────────────────────────────────
function MembersListModal({ entries, onRemoved, onClose }) {
    const [search, setSearch] = useState("");
    const [removing, setRemoving] = useState(null);
    const [error, setError] = useState("");

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        return query
            ? entries.filter((e) => e.studentNumber.toLowerCase().includes(query) || e.lastName.toLowerCase().includes(query))
            : entries;
    }, [entries, search]);

    async function handleRemove(studentNumber) {
        setRemoving(studentNumber);
        setError("");
        try {
            await removeMembersListEntry(studentNumber);
            onRemoved(studentNumber);
        } catch (err) {
            setError(err.response?.data?.message ?? "Couldn't remove that student.");
        } finally {
            setRemoving(null);
        }
    }

    return (
        <ModalPortal>
            <div className="member-modal" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
                <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true" aria-labelledby="members-list-entries-title">
                    <div className="member-modal__header">
                        <div>
                            <p className="member-modal__eyebrow">Members List</p>
                            <h2 id="members-list-entries-title" className="member-modal__title">{entries.length} student{entries.length === 1 ? "" : "s"} on the Members List</h2>
                        </div>
                        <button type="button" className="icon-btn icon-btn--plain" onClick={onClose} aria-label="Close">×</button>
                    </div>
                    <div className="filter-modal__body">
                        <label className="member-search card-picker__search">
                            <span className="sr-only">Search the Members List</span>
                            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student no. or last name" maxLength={LIMITS.search} />
                        </label>
                        {error && <p className="members-download-status members-download-status--error" role="alert">{error}</p>}
                        <ul className="card-picker__list">
                            {visible.map((e) => (
                                <li key={e.studentNumber} className="members-list-entries__item members-list-entries__item--row">
                                    <span><strong>{e.lastName}</strong> · {e.studentNumber}</span>
                                    <span className="members-list-entries__status">{ACCOUNT_STATUS_LABELS[e.accountStatus] ?? "Not registered"}</span>
                                    <ConfirmActionButton
                                        className="btn btn--outline btn--sm"
                                        busy={removing === e.studentNumber}
                                        disabled={Boolean(removing)}
                                        title="Remove from the Members List?"
                                        message={`${e.studentNumber} (${e.lastName}) won't be approved automatically anymore. If already approved, they stay approved.`}
                                        confirmLabel="Remove"
                                        cancelLabel="Cancel"
                                        onConfirm={() => handleRemove(e.studentNumber)}
                                    >
                                        Remove
                                    </ConfirmActionButton>
                                </li>
                            ))}
                            {visible.length === 0 && <li className="card-picker__empty">No students match your search.</li>}
                        </ul>
                    </div>
                    <div className="member-modal__footer">
                        <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
}
