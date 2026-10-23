export default function ConfirmationDialog({
    isOpen,
    title = "Confirm action",
    message = "Are you sure you want to continue?",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
}) {
    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4">
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
                        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover)"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
