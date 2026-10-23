export function DownloadIcon({ className, ...props }) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            {...props}
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5" />
            <path d="M12 15V3" />
        </svg>
    );
}

export function EditIcon({ className, ...props }) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            {...props}
        >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    );
}

export function FileDownloadIcon({ className, ...props }) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            {...props}
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
            <path d="M12 12v6" />
            <path d="m9 15 3 3 3-3" />
        </svg>
    );
}

export function DeleteIcon({ className, ...props }) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            {...props}
        >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
        </svg>
    );
}

export function CloseIcon({ className, ...props }) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            {...props}
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    );
}
