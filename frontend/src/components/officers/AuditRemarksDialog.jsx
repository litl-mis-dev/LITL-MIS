import { useEffect, useRef, useState } from "react";

export default function AuditRemarksDialog({ item, busy, error, onCancel, onSave }) {
  const dialogRef = useRef(null);
  const [remarks, setRemarks] = useState(item.remarks || "");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="audit-remarks-dialog" aria-labelledby="audit-remarks-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && remarks.trim()) onSave(remarks.trim()); }}>
        <h2 id="audit-remarks-title" className="card__title">Request clarification</h2>
        <p className="card__sub">{item.displayId}</p>
        {error && <p className="settings-message settings-message--error" role="alert">{error}</p>}
        <label className="audit-remarks-field">
          <span>Remarks</span>
          <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)}
            placeholder="What needs to be clarified?" rows={4} required disabled={busy} autoFocus />
        </label>
        <div className="audit-remarks-actions">
          <button type="button" className="btn btn--outline" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy || !remarks.trim()}>{busy ? "Saving..." : "Save Review"}</button>
        </div>
      </form>
    </dialog>
  );
}
