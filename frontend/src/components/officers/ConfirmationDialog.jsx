import ModalPortal from "../ui/ModalPortal.jsx";

// Rendered into <body> at the dialog layer, so it always sits above the page,
// the sidebar and any modal it was opened from.
export default function ConfirmationDialog({
    isOpen,
    title = "Confirm action",
    message = "Are you sure you want to continue?",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    // While the confirmed action runs: spinner on Confirm, both buttons locked
    // so it can't be submitted twice or cancelled halfway.
    busy = false,
}) {
    if (!isOpen) {
        return null;
    }

    return (
        <ModalPortal>
            <div className="fixed inset-0 z-(--z-dialog) flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4">
                <div
                    className="max-h-[calc(100vh-24px)] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-5 shadow-2xl sm:p-6"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="confirmation-dialog-title"
                >
                    <h2 id="confirmation-dialog-title" className="text-lg font-semibold text-gray-900">
                        {title}
                    </h2>
                    <p className="mt-2 text-sm text-gray-600">{message}</p>

                    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={busy}
                            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={busy}
                            aria-busy={busy}
                            className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover) disabled:opacity-70"
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
}
