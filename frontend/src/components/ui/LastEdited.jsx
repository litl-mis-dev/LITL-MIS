// The latest change to a record, shown the same way everywhere:
//   Amount spent: ₱150.00 → ₱120.00      ← a short summary (full text on hover)
//   Maria Santos (Nov 25, 2026)
// `edit` is the record's `lastEdit` from the server ({ name, at, summary,
// summaryFull }), or null when there's nothing recorded for it yet.
function formatEditDate(value) {
    return new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export default function LastEdited({ edit, empty = "—" }) {
    if (!edit) return empty ? <span className="last-edited last-edited--none">{empty}</span> : null;
    return (
        <span className="last-edited">
            {edit.summary && <small className="last-edited__summary" title={edit.summaryFull ?? edit.summary}>{edit.summary}</small>}
            <small className="last-edited__by">{edit.name} ({formatEditDate(edit.at)})</small>
        </span>
    );
}
