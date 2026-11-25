// Who last edited a record and when — the name, then the date — shown the
// same way as the reviewer in the Audit module's Review Details. `edit` is
// the record's `lastEdit` from the server ({ name, at }), or null when the
// record hasn't been edited since it was created.
function formatEditDate(value) {
    return new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export default function LastEdited({ edit, empty = "—" }) {
    if (!edit) return <span className="last-edited last-edited--none">{empty}</span>;
    return (
        <span className="last-edited">
            <small>{edit.name}</small>
            <small>{formatEditDate(edit.at)}</small>
        </span>
    );
}
