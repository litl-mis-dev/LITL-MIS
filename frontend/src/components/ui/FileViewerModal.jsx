import ModalPortal from "./ModalPortal.jsx";
import FileViewer from "./FileViewer.jsx";
import { CloseIcon } from "../icons/ActionIcons.jsx";

// A file opened for reading inside the system (e.g. a disbursement's
// certificate). `load` returns the file as a Blob; keep it stable (useCallback).
export default function FileViewerModal({ eyebrow = "View", title, load, onClose }) {
    return (
        <ModalPortal>
            <div className="member-modal file-viewer-modal" role="presentation"
                onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
                <div className="member-modal__panel file-viewer-panel" role="dialog" aria-modal="true" aria-labelledby="file-viewer-title">
                    <div className="member-modal__header">
                        <div>
                            <p className="member-modal__eyebrow">{eyebrow}</p>
                            <h2 id="file-viewer-title" className="member-modal__title">{title}</h2>
                        </div>
                        <button type="button" className="icon-btn icon-btn--plain" onClick={onClose} aria-label="Close">
                            <CloseIcon />
                        </button>
                    </div>
                    <div className="document-preview">
                        <FileViewer load={load} title={title} />
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
}
