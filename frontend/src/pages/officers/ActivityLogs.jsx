import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardHeader from "../../components/officers/DashboardHeader.jsx";
import { listAuditLogs } from "../../services/auditLog.service.js";

const MODULES = ['Authentication', 'Registration', 'Members', 'Financial']
const ROLE_BADGE_STYLE = {
    marginLeft: 8, fontSize: 11, fontWeight: 600,
    padding: "2px 8px", borderRadius: 9999,
    background: "#eef2ff", color: "#4338ca",
};

export default function ActivityLogs() {
    // ── Data state ────────────────────────────────────────────────────────────
    const [logs,    setLogs]    = useState([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });

    // ── Filter & search state ─────────────────────────────────────────────────
    const [searchTerm,     setSearchTerm]     = useState("");
    const [isFilterOpen,   setIsFilterOpen]   = useState(false);
    const [filters,        setFilters]        = useState({
        modules: [],
        dateFrom: "",
        dateTo: ""
    });

    const activeFilterCount =
        filters.modules.length +
        (filters.dateFrom ? 1 : 0) +
        (filters.dateTo   ? 1 : 0);

    // ── Debounce search so we don't fire on every keystroke ───────────────────
    const searchTimeout = useRef(null)
    const [debouncedSearch, setDebouncedSearch] = useState("")
    useEffect(() => {
        clearTimeout(searchTimeout.current)
        searchTimeout.current = setTimeout(() => setDebouncedSearch(searchTerm), 400)
        return () => clearTimeout(searchTimeout.current)
    }, [searchTerm])

    // ── Fetch from API ────────────────────────────────────────────────────────
    const fetchLogs = useCallback(async (overridePage = 1) => {
        setLoading(true);
        setError('');
        try {
            const data = await listAuditLogs({
                q:        debouncedSearch,
                module:   filters.modules.length === 1 ? filters.modules[0] : '',
                dateFrom: filters.dateFrom,
                dateTo:   filters.dateTo,
                page:     overridePage,
                limit:    pagination.limit,
            });
            setLogs(data.logs ?? []);
            setPagination(data.pagination ?? { page: 1, limit: 50, total: 0, totalPages: 1 });
        } catch {
            setError('Failed to load activity logs. Please refresh.');
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, filters, pagination.limit]);

    // Re-fetch whenever search or filters change (reset to page 1)
    useEffect(() => { fetchLogs(1); }, [fetchLogs]);

    // ── Client-side multi-module filter — API sends one module at a time,
    //    multiple selections filter in-memory so the UI stays snappy ──────────
    const filteredLogs = useMemo(() => {
        if (filters.modules.length <= 1) return logs;
        return logs.filter(log => filters.modules.includes(log.module));
    }, [logs, filters.modules]);

    // ── Filter handlers ───────────────────────────────────────────────────────

    function handleFilterToggle(group, value) {
        setFilters(f => {
            const current = f[group];
            const next = current.includes(value)
                ? current.filter(v => v !== value)
                : [...current, value];
            return { ...f, [group]: next };
        });
    }

    function clearFilters() {
        setFilters({ modules: [], dateFrom: "", dateTo: "" });
    }

    function handleDateFilterChange(field, value) {
        setFilters(f => ({ ...f, [field]: value }));
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <>
            <DashboardHeader page="activity-logs" />

            <div className="card">
                <div className="card__header">
                    <div>
                        <h2 className="card__title">All System Activities</h2>
                        <p className="card__sub">
                            {loading
                                ? "Loading..."
                                : error
                                    ? error
                                    : `${pagination.total.toLocaleString()} recorded action${pagination.total !== 1 ? "s" : ""}`
                            }
                        </p>
                    </div>
                    <div className="member-list-actions activity-logs__actions">
                        <label className="member-search activity-logs__search">
                            <span className="sr-only">Search activity logs</span>
                            <input
                                type="search"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                placeholder="Search logs"
                                aria-label="Search activity logs"
                            />
                        </label>
                        <div className="advanced-filter-actions">
                            <button
                                type="button"
                                className="btn btn--outline btn--filter"
                                onClick={() => setIsFilterOpen(true)}
                            >
                                Advanced Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                            </button>
                            {activeFilterCount > 0 && (
                                <button
                                    type="button"
                                    className="icon-btn icon-btn--plain advanced-filter-actions__clear"
                                    onClick={clearFilters}
                                    aria-label="Clear active filters"
                                    title="Clear active filters"
                                >
                                    <CloseIcon />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="table-wrapper activity-logs-table-wrapper">
                    <table className="data-table activity-logs-table">
                        <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Time</th>
                                    <th>Account</th>
                                    <th>Description</th>
                                    <th>Module</th>
                                    <th>Fund Amount</th>
                                </tr>
                                </thead>
                                <tbody>
                                {!loading && filteredLogs.map(log => (
                                    <tr key={log.id}>
                                    <td>{log.date}</td>
                                    <td>{log.time}</td>
                                    <td>
                                        <div className="activity-logs-table__account">
                                        <span className="font-medium">{log.account}</span>
                                        <span style={ROLE_BADGE_STYLE}>{log.role}</span>
                                        {log.targetUser && (
                                            <span className="mt-0.5 block text-xs text-gray-500">
                                            → {log.targetUser}
                                            </span>
                                        )}
                                        </div>
                                    </td>
                                    <td className="activity-logs-table__action">{log.description ?? log.action}</td>
                                    <td>
                                        <span className="activity-logs-table__module">{log.module}</span>
                                    </td>
                                    
                                    <td>
                                        {log.fundAmount ? (
                                            <span className={`activity-logs-table__amount activity-logs-table__amount--${log.fundChange}`}>
                                                <span className="activity-logs-table__amount-sign">
                                                    {getAmountSign(log.fundChange)}
                                                </span>
                                                <span className="activity-logs-table__currency-icon" aria-label="Philippine peso">₱</span>
                                                <span>{log.fundAmount}</span>
                                            </span>
                                        ) : (
                                            <span className="activity-logs-table__empty-amount">N/A</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {loading && (
                                <tr>
                                    <td colSpan="6" className="data-table__empty">
                                        Loading activity logs...
                                    </td>
                                </tr>
                            )}
                            {!loading && filteredLogs.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="data-table__empty">
                                        {error || "No activity logs match your search or filter."}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {!loading && pagination.totalPages > 1 && (
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', borderTop: '1px solid var(--color-border, #e5e7eb)',
                        fontSize: 13, color: 'var(--color-text-secondary, #6b7280)'
                    }}>
                        <span>
                            Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
                        </span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                type="button"
                                className="btn btn--outline btn--sm"
                                disabled={pagination.page <= 1}
                                onClick={() => fetchLogs(pagination.page - 1)}
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                className="btn btn--outline btn--sm"
                                disabled={pagination.page >= pagination.totalPages}
                                onClick={() => fetchLogs(pagination.page + 1)}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Filter Modal ─────────────────────────────────────────────────── */}
            {isFilterOpen && (
                <div className="member-modal" role="presentation">
                    <div
                        className="member-modal__panel member-modal__panel--filter"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="activity-log-filter-title"
                    >
                        <div className="member-modal__header">
                            <div>
                                <p className="member-modal__eyebrow">Filters</p>
                                <h2 id="activity-log-filter-title" className="member-modal__title">
                                    Filter Activity Logs
                                </h2>
                            </div>
                            <button
                                type="button"
                                className="icon-btn icon-btn--plain"
                                onClick={() => setIsFilterOpen(false)}
                                aria-label="Close activity log filter modal"
                            >
                                <CloseIcon />
                            </button>
                        </div>

                        <div className="filter-modal__body">
                            <FilterChecklist
                                title="Module"
                                options={MODULES}
                                selectedValues={filters.modules}
                                onToggle={value => handleFilterToggle("modules", value)}
                            />
                            <fieldset className="filter-checklist activity-logs-calendar-filter">
                                <legend>Date Range</legend>
                                <div className="activity-logs-calendar-filter__grid">
                                    <label className="dash-form__field">
                                        From
                                        <input
                                            type="date"
                                            value={filters.dateFrom}
                                            onChange={e => handleDateFilterChange("dateFrom", e.target.value)}
                                        />
                                    </label>
                                    <label className="dash-form__field">
                                        To
                                        <input
                                            type="date"
                                            value={filters.dateTo}
                                            onChange={e => handleDateFilterChange("dateTo", e.target.value)}
                                        />
                                    </label>
                                </div>
                            </fieldset>
                        </div>

                        <div className="member-modal__footer">
                            <button type="button" className="btn btn--outline" onClick={clearFilters}>
                                Clear Filters
                            </button>
                            <button type="button" className="btn btn--primary" onClick={() => setIsFilterOpen(false)}>
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ─── Helpers (preserved from original file) ───────────────────────────────────

function FilterChecklist({ title, options, selectedValues, onToggle }) {
    return (
        <fieldset className="filter-checklist">
            <legend>{title}</legend>
            <div className="filter-checklist__grid">
                {options.map(option => (
                    <label key={option} className="feature-checklist__item">
                        <input
                            type="checkbox"
                            checked={selectedValues.includes(option)}
                            onChange={() => onToggle(option)}
                        />
                        <span>{option}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}

function getAmountSign(change) {
    return change === "deduct" ? "−" : "+";
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
        </svg>
    );
}