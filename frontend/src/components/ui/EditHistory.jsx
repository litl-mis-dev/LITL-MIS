import { useEffect, useState } from "react";
import ModalPortal from "./ModalPortal.jsx";
import Spinner from "./Spinner.jsx";
import { getEditHistory } from "../../services/history.service.js";
import LastEdited from "./LastEdited.jsx";

// Who changed a record, when, and what — without opening the Activity Log.
// variant "inline" (record details): a summary of the latest change, the name
// and date, then a "View history" link. variant "link" (table cells, under the name and date
// the table already shows): just the link. The link opens the full history.
// `refreshKey`: change it after saving the record to reload the history.

const dateTime = (iso) => new Date(iso).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

const MONEY_FIELD = /amount|budget/i;
function formatValue(field, value) {
    if (value === null || value === undefined || value === "") return "(empty)";
    if (MONEY_FIELD.test(field) && !Number.isNaN(Number(value))) {
        return `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return String(value);
}

function ChangeList({ entry }) {
    if (!entry.changes?.length) return <p className="edit-history__description">{entry.description}</p>;
    return (
        <ul className="edit-history__changes">
            {entry.changes.map((change) => (
                <li key={change.field}>
                    <span className="edit-history__field">{change.label}:</span>{" "}
                    <span className="edit-history__from">{formatValue(change.field, change.from)}</span>
                    {" → "}
                    <span className="edit-history__to">{formatValue(change.field, change.to)}</span>
                </li>
            ))}
        </ul>
    );
}

export default function EditHistory({ type, id, refreshKey = 0, variant = "inline", title = "Edit history" }) {
    const [state, setState] = useState({ key: "", entries: null, lastEdit: null, error: "" });
    const [isOpen, setIsOpen] = useState(false);
    const key = `${type}|${id}|${refreshKey}`;
    const shouldLoad = Boolean(id) && (variant === "inline" || isOpen);

    useEffect(() => {
        if (!shouldLoad || state.key === key) return undefined;
        let cancelled = false;
        getEditHistory(type, id)
            .then((data) => { if (!cancelled) setState({ key, entries: data.entries ?? [], lastEdit: data.lastEdit ?? null, error: "" }); })
            .catch(() => { if (!cancelled) setState({ key, entries: [], lastEdit: null, error: "Couldn't load the edit history." }); });
        return () => { cancelled = true; };
    }, [shouldLoad, key, type, id, state.key]);

    if (!id) return null;
    const loading = shouldLoad && state.key !== key;
    const entries = state.key === key ? state.entries ?? [] : [];
    // The latest entry (creating the record counts), as shown in lists.
    const lastEdit = state.key === key ? state.lastEdit : null;

    const modal = isOpen && (
        <ModalPortal>
            <div className="member-modal edit-history-modal" role="presentation"
                onClick={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
                <div className="member-modal__panel" role="dialog" aria-modal="true" aria-labelledby="edit-history-title">
                    <div className="member-modal__header">
                        <div>
                            <p className="member-modal__eyebrow">History</p>
                            <h2 id="edit-history-title" className="member-modal__title">{title}</h2>
                        </div>
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setIsOpen(false)}>Close</button>
                    </div>
                    <div className="filter-modal__body">
                        {loading && <p className="edit-history__muted"><Spinner /> Loading history…</p>}
                        {!loading && state.error && <p className="edit-history__error" role="alert">{state.error}</p>}
                        {!loading && !state.error && entries.length === 0 && <p className="edit-history__muted">No changes recorded yet.</p>}
                        {!loading && entries.length > 0 && (
                            <ol className="edit-history__list">
                                {entries.map((entry) => (
                                    <li key={entry.id}>
                                        <p className="edit-history__meta">
                                            <strong>{entry.actorName}</strong> · {dateTime(entry.createdAt)} · {entry.actionLabel}
                                        </p>
                                        <ChangeList entry={entry} />
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );

    const viewLink = (
        <button type="button" className="edit-history__more" onClick={() => setIsOpen(true)}>View history</button>
    );

    if (variant === "link") {
        return <>{viewLink}{modal}</>;
    }

    return (
        <section className="edit-history" aria-label={title}>
            {loading && <p className="edit-history__muted"><Spinner /> Loading edit history…</p>}
            {!loading && !lastEdit && <p className="edit-history__muted">{state.error || "No edits yet."}</p>}
            {!loading && lastEdit && (
                <>
                    <LastEdited edit={lastEdit} />
                    {viewLink}
                </>
            )}
            {modal}
        </section>
    );
}
