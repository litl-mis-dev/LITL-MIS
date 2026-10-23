import { useEffect, useRef } from "react";

// Anything that looks like a modal/dialog. Used to detect "another modal opened".
const MODAL_SELECTOR = '[role="dialog"], [aria-modal="true"], dialog, .member-modal';

// Closes a modal/popup when the user:
//   - presses Escape,
//   - presses the pointer outside of `containerRef`,
//   - or another modal appears in the page.
// Interaction inside `containerRef` (including nested confirmation dialogs
// rendered inside it) never closes it.
export function useAutoCloseModal({ isOpen, onClose, containerRef }) {
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });

    useEffect(() => {
        if (!isOpen) return undefined;

        const isInside = (node) => Boolean(containerRef.current?.contains(node));

        function handleKeyDown(event) {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            // A nested confirmation dialog is on top; leave this modal alone.
            if (containerRef.current?.querySelector('[aria-labelledby="confirmation-dialog-title"]')) return;
            onCloseRef.current?.();
        }

        function handlePointerDown(event) {
            if (isInside(event.target)) return;
            onCloseRef.current?.();
        }

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const container = containerRef.current;
                    if (container && (container.contains(node) || node.contains(container))) continue;
                    if (node.matches?.(MODAL_SELECTOR) || node.querySelector?.(MODAL_SELECTOR)) {
                        onCloseRef.current?.();
                        return;
                    }
                }
            }
        });

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("pointerdown", handlePointerDown);
        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("pointerdown", handlePointerDown);
            observer.disconnect();
        };
    }, [isOpen, containerRef]);
}