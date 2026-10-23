import { useEffect } from "react";

export default function SuccessDialog({
    isOpen,
    title = "Success",
    message = "Action completed successfully.",
    buttonLabel = "OK",
    onClose,
    autoCloseMs = 3000,
}) {
    useEffect(() => {
        if (!isOpen || !autoCloseMs) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            onClose?.();
        }, autoCloseMs);

        return () => window.clearTimeout(timeoutId);
    }, [autoCloseMs, isOpen, onClose]);

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-4"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose?.();
                }
            }}
            role="presentation"
        >
            <div
                className="max-h-[calc(100vh-24px)] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-5 text-center shadow-2xl sm:p-6"
                role="dialog"
                aria-modal="true"
                aria-labelledby="success-dialog-title"
            >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                            d="M5 12.5 9.5 17 19 7"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>
                <h2 id="success-dialog-title" className="mt-4 text-lg font-semibold text-gray-900">
                    {title}
                </h2>
                <p className="mt-2 text-sm text-gray-600">{message}</p>

                <button
                    type="button"
                    onClick={onClose}
                    className="mt-6 w-full rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover)"
                >
                    {buttonLabel}
                </button>
            </div>
        </div>
    );
}
