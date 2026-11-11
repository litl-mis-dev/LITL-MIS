import { useMemo, useState } from "react";
import { downloadAllMembershipCardsPdf, downloadMembershipCardPdf } from "../../../utils/downloadMembershipCardPdf.js";

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const digitsOnly = (value) => value.replace(/\D/g, "");

// Year level first, then section, then name.
function compareMembers(a, b) {
    return (parseInt(a.yearLevel, 10) || 99) - (parseInt(b.yearLevel, 10) || 99)
        || (parseInt(a.section, 10) || 0) - (parseInt(b.section, 10) || 0)
        || a.name.localeCompare(b.name);
}

const memberKey = (member) => member.memberId ?? member.id;

// Members List ▸ Download Membership Cards: pick members (search, filter by
// year level and section, select some or all), then download one PDF with
// the cards of the selected members only.
export default function MembershipCardsModal({ members, onClose, onDownloaded }) {
    const [search, setSearch] = useState("");
    const [yearFilter, setYearFilter] = useState("");
    const [sectionFilter, setSectionFilter] = useState("");
    const [selectedKeys, setSelectedKeys] = useState(() => new Set());
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");

    const sortedMembers = useMemo(() => [...members].sort(compareMembers), [members]);

    const visibleMembers = useMemo(() => {
        const query = search.trim().toLowerCase();
        return sortedMembers.filter((m) =>
            (!query || m.name.toLowerCase().includes(query) || m.studentNumber.toLowerCase().includes(query))
            && (!yearFilter || m.yearLevel === yearFilter)
            && (!sectionFilter || String(m.section) === sectionFilter)
        );
    }, [sortedMembers, search, yearFilter, sectionFilter]);

    const selectedMembers = sortedMembers.filter((m) => selectedKeys.has(memberKey(m)));
    const allVisibleSelected = visibleMembers.length > 0 && visibleMembers.every((m) => selectedKeys.has(memberKey(m)));

    function toggleMember(member) {
        setSelectedKeys((current) => {
            const next = new Set(current);
            const key = memberKey(member);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }

    // "Select all" works on the members currently shown by the search and filters.
    function toggleAllVisible() {
        setSelectedKeys((current) => {
            const next = new Set(current);
            visibleMembers.forEach((m) => (allVisibleSelected ? next.delete(memberKey(m)) : next.add(memberKey(m))));
            return next;
        });
    }

    async function handleDownload() {
        if (selectedMembers.length === 0 || isGenerating) return;
        setIsGenerating(true);
        setError("");
        setProgress("Generating membership cards...");
        try {
            if (selectedMembers.length === 1) {
                await downloadMembershipCardPdf(selectedMembers[0]);
            } else {
                await downloadAllMembershipCardsPdf(selectedMembers, (done, total) => {
                    setProgress(`Generating membership cards... ${done}/${total}`);
                });
            }
            onDownloaded(selectedMembers.length);
        } catch (err) {
            setError(err.message || "Failed to generate membership cards.");
            setProgress("");
            setIsGenerating(false);
        }
    }

    function handleClose() {
        if (!isGenerating) onClose();
    }

    return (
        <div className="member-modal" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
            <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true" aria-labelledby="membership-cards-title">
                <div className="member-modal__header">
                    <div>
                        <p className="member-modal__eyebrow">Membership Cards</p>
                        <h2 id="membership-cards-title" className="member-modal__title">Download Membership Cards</h2>
                    </div>
                    <button type="button" className="icon-btn icon-btn--plain" onClick={handleClose} disabled={isGenerating} aria-label="Close">
                        ×
                    </button>
                </div>

                <div className="filter-modal__body">
                    <div className="card-picker__controls">
                        <label className="member-search card-picker__search">
                            <span className="sr-only">Search members</span>
                            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search name or student no." />
                        </label>
                        <label className="dash-form__field">
                            Year Level
                            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                                <option value="">All year levels</option>
                                {YEAR_LEVELS.map((year) => <option key={year} value={year}>{year}</option>)}
                            </select>
                        </label>
                        <label className="dash-form__field">
                            Section
                            <input value={sectionFilter} inputMode="numeric" pattern="[0-9]*" placeholder="All"
                                onChange={(e) => setSectionFilter(digitsOnly(e.target.value))} />
                        </label>
                    </div>

                    <div className="card-picker__toolbar">
                        <label className="feature-checklist__item">
                            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible}
                                disabled={visibleMembers.length === 0 || isGenerating} />
                            <span>Select all{search || yearFilter || sectionFilter ? " shown" : ""} ({visibleMembers.length})</span>
                        </label>
                        <span className="card-picker__count">{selectedMembers.length} selected</span>
                    </div>

                    <ul className="card-picker__list">
                        {visibleMembers.map((m) => (
                            <li key={memberKey(m)}>
                                <label className="card-picker__item">
                                    <input type="checkbox" checked={selectedKeys.has(memberKey(m))}
                                        onChange={() => toggleMember(m)} disabled={isGenerating} />
                                    <span className="card-picker__name">{m.name}</span>
                                    <span className="card-picker__meta">{m.studentNumber} · {m.yearLevel} - {m.section}</span>
                                </label>
                            </li>
                        ))}
                        {visibleMembers.length === 0 && (
                            <li className="card-picker__empty">No members match your search or filters.</li>
                        )}
                    </ul>

                    {(progress || error) && (
                        <p className={`members-download-status ${error ? "members-download-status--error" : ""}`} role="status">
                            {error || progress}
                        </p>
                    )}
                </div>

                <div className="member-modal__footer">
                    <button type="button" className="btn btn--outline" onClick={handleClose} disabled={isGenerating}>Cancel</button>
                    <button type="button" className="btn btn--primary" onClick={handleDownload}
                        disabled={selectedMembers.length === 0 || isGenerating} aria-busy={isGenerating}>
                        {isGenerating
                            ? "Generating..."
                            : selectedMembers.length === sortedMembers.length && sortedMembers.length > 0
                                ? "Download All Membership Cards"
                                : `Download ${selectedMembers.length || ""} Membership Card${selectedMembers.length === 1 ? "" : "s"}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
