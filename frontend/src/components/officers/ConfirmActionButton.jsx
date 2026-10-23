import { useState } from "react";
import ConfirmationDialog from "./ConfirmationDialog";

export default function ConfirmActionButton({
    children,
    className,
    disabled = false,
    isOpen,
    title,
    message,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    onOpenChange,
    beforeOpen,
    buttonType = "button",
}) {
    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const isConfirmOpen = isOpen ?? internalIsOpen;

    function setConfirmOpen(nextIsOpen) {
        onOpenChange?.(nextIsOpen);

        if (isOpen === undefined) {
            setInternalIsOpen(nextIsOpen);
        }
    }

    function handleOpen(event) {
        if (beforeOpen?.(event) === false) {
            return;
        }

        setConfirmOpen(true);
    }

    function handleConfirm() {
        setConfirmOpen(false);
        onConfirm?.();
    }

    function handleCancel() {
        onCancel?.();
        setConfirmOpen(false);
    }

    return (
        <>
            <button type={buttonType} className={className} disabled={disabled} onClick={handleOpen}>
                {children}
            </button>

            <ConfirmationDialog
                isOpen={isConfirmOpen}
                title={title}
                message={message}
                confirmLabel={confirmLabel}
                cancelLabel={cancelLabel}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </>
    );
}
