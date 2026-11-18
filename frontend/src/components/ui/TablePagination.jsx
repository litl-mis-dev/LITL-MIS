// The bar under every table: which rows are shown, and Previous / Next.
// Shown only when there is more than one page. Pair it with usePagination
// (utils/usePagination.js), or pass the same numbers from a server page.
export default function TablePagination({ page, pageCount, pageSize, total, onPageChange, label = "rows" }) {
    if (pageCount <= 1) return null;

    const first = (page - 1) * pageSize + 1;
    const last = Math.min(page * pageSize, total);

    return (
        <nav className="table-pagination" aria-label={`${label} pages`}>
            <span className="table-pagination__summary" aria-live="polite">
                Showing {first}–{last} of {total.toLocaleString()}
            </span>
            <div className="table-pagination__controls">
                <button type="button" className="btn btn--outline btn--sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                    Previous
                </button>
                <span className="table-pagination__page">Page {page} of {pageCount}</span>
                <button type="button" className="btn btn--outline btn--sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
                    Next
                </button>
            </div>
        </nav>
    );
}
