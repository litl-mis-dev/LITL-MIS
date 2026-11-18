import { useState } from "react";

// Every table shows 10 rows per page, numbered on from the previous page:
// page 1 is 1–10, page 2 is 11–20, and so on.
export const TABLE_PAGE_SIZE = 10;

// Splits `rows` into pages. `resetKey` is anything that changes what the
// table shows (a search, a filter, a selected semester): when it changes, the
// table goes back to page 1. The page also never points past the last page
// when rows are removed.
export function usePagination(rows, { resetKey = "", pageSize = TABLE_PAGE_SIZE } = {}) {
    const [state, setState] = useState({ key: resetKey, page: 1 });
    const total = rows?.length ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const requested = state.key === resetKey ? state.page : 1;
    const page = Math.min(Math.max(requested, 1), pageCount);
    const start = (page - 1) * pageSize;

    return {
        page,
        pageCount,
        pageSize,
        total,
        pageRows: (rows ?? []).slice(start, start + pageSize),
        // The number shown for the row at `index` on this page.
        rowNumber: (index) => start + index + 1,
        setPage: (next) => setState({ key: resetKey, page: next }),
    };
}
