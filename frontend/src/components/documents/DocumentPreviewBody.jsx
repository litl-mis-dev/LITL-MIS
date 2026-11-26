import { useCallback } from "react";
import FileViewer from "../ui/FileViewer.jsx";
import { fetchDocumentPreview } from "../../services/documents.service.js";
import { FileIcon } from "./DocumentIcons.jsx";

const PREVIEWABLE_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const PREVIEWABLE_FRAME_EXT = new Set(["pdf", "txt", "csv"]);

// The Preview window's body (officer and member Documents): PDFs, images and
// text open inside the system; other types are download-only.
export default function DocumentPreviewBody({ item }) {
    const extension = (item.fileType || "").toLowerCase();
    const load = useCallback(() => fetchDocumentPreview(item.id), [item.id]);

    if (PREVIEWABLE_FRAME_EXT.has(extension) || PREVIEWABLE_IMAGE_EXT.has(extension)) {
        return <FileViewer load={load} kind={PREVIEWABLE_IMAGE_EXT.has(extension) ? "image" : "frame"} title={item.name} />;
    }

    return (
        <>
            <div className="documents-details__icon documents-details__icon--file">
                <FileIcon />
            </div>
            <p className="document-preview__title">{item.fileType} file</p>
            <p className="card__sub">Preview isn't available for this file type — download it to view.</p>
        </>
    );
}
