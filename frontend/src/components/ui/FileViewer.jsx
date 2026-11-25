import { useEffect, useState } from "react";
import Spinner from "./Spinner.jsx";

// Shows a file inside the system, without downloading it. `load()` returns the
// file as a Blob — fetched from the server (Documents) or drawn in the browser
// (certificates). PDFs and text open in the browser's own viewer; images as
// images. Pass a `load` that keeps its identity (useCallback) so the file
// isn't fetched again on every render.
export default function FileViewer({ load, kind = "frame", title }) {
    const [state, setState] = useState({ url: null, error: "" });

    useEffect(() => {
        let url = null;
        let cancelled = false;
        load()
            .then((blob) => {
                if (cancelled) return;
                url = URL.createObjectURL(blob);
                setState({ url, error: "" });
            })
            .catch(() => { if (!cancelled) setState({ url: null, error: "Couldn't open this file. Try again, or download it instead." }); });
        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [load]);

    if (state.error) return <p className="file-viewer__error" role="alert">{state.error}</p>;
    if (!state.url) return <p className="file-viewer__loading"><Spinner /> Opening…</p>;
    if (kind === "image") return <img className="file-viewer__image" src={state.url} alt={title} />;
    return <iframe className="file-viewer__frame" src={state.url} title={title} />;
}
