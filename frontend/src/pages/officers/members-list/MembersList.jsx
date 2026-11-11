import { useEffect, useMemo, useState } from "react";
import { getSocket } from "../../../services/socket.js";
import { DownloadIcon, EditIcon } from "../../../components/icons/ActionIcons.jsx";
import DashboardHeader from "../../../components/officers/DashboardHeader.jsx";
import MemberLookupModal from "./MemberScannerModal.jsx";
import MembershipPaymentSection from "./MembershipPaymentSection.jsx";
import { useRole } from '../../../utils/useRole.js'
import { ROLE_LABELS } from '../../../utils/roles.js'
import ConfirmActionButton from "../../../components/officers/ConfirmActionButton.jsx";
import { getApprovedMembers, getPendingUsers, approveUser, rejectUser, updateMemberStatus, } from "../../../services/officer.service.js";
import { getMemberPaymentHistory, sendBulkPaymentReminders, } from "../../../services/financial.service.js";
import MemberSelectionModal from "./MemberSelectionModal.jsx";
import MemberRosterPanel from "./MemberRosterPanel.jsx";
import { downloadAllMembershipCardsPdf, downloadMembershipCardPdf } from "../../../utils/downloadMembershipCardPdf.js";
import { createAnnouncement } from "../../../services/announcement.service.js";
import LoadingState from "../../../components/ui/LoadingState.jsx";
import RequiredMark from "../../../components/ui/RequiredMark.jsx";

// ─── Constants ────────────────────────────────────────────────────────────────

const yearOptions = ["1st Year", "2nd Year", "3rd Year", "4th Year"].map(v => ({ value: v, label: v }))
const memberStatusOpts = ["ACTIVE", "INACTIVE", "GRADUATED", "ARCHIVED"].map(v => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))
const paymentFilterOpts = [{ value: "Paid", label: "Paid" }, { value: "Unpaid", label: "Unpaid" }]
const digitsOnly = v => v.replace(/\D/g, "")


// ─── MembersList ──────────────────────────────────────────────────────────────

export default function MembersList({ compact = false }) {
    const {
        canManageMemberList,
        canViewMemberApproval,
        canApproveMembers,
        canManageOfficers,
        canManageFinancials,
        canManageAnnouncements,
    } = useRole()
    // ── Data state ────────────────────────────────────────────────────────────
    const [members, setMembers] = useState([]);
    const [pendingUsers, setPendingUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // ── UI state ──────────────────────────────────────────────────────────────
    const [activeSection, setActiveSection] = useState("members");
    const [searchTerm, setSearchTerm] = useState("");
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [filters, setFilters] = useState({
        years: [],
        section: "",
        payment: "",
        memberStatus: "",
    });
    const [editingMember, setEditingMember] = useState(null);
    const [editMemberStatus, setEditMemberStatus] = useState("");
    const [editSaving, setEditSaving] = useState(false);
    const [editError, setEditError] = useState('');
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isCardsModalOpen, setIsCardsModalOpen] = useState(false);
    const [cardGenerationMessage, setCardGenerationMessage] = useState("");

    // Email reminder state
    const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
    const [reminderMessage, setReminderMessage] = useState("");

    // Announcement state
    const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);
    const [announcementTitle, setAnnouncementTitle] = useState("");
    const [announcementMessage, setAnnouncementMessage] = useState("");
    const [announcementRecipients, setAnnouncementRecipients] = useState("MEMBERS");
    const [announcementPriority, setAnnouncementPriority] = useState("NORMAL");
    const [isSendingAnnouncement, setIsSendingAnnouncement] = useState(false);
    const [announcementError, setAnnouncementError] = useState("");
    const [announcementSuccess, setAnnouncementSuccess] = useState("");

    // Payment history state (inside edit modal)
    const [paymentHistory, setPaymentHistory] = useState([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyError, setHistoryError] = useState('')

    // Approval state
    const [approvalLoading, setApprovalLoading] = useState(false)
    // Which registration is being approved/rejected, so only its button spins.
    const [approvalAction, setApprovalAction] = useState(null) // { id, type }
    const [approvalError, setApprovalError] = useState('')

    // ── Load data ────────────────────────────────────────────────────────────

    useEffect(() => {
        fetchAll();
    }, []);

    // ── Real-time refresh ───────────────────────────────────────────────────
    // Membership approvals/status and officer role assignments broadcast
    // lightweight signals; the DB remains the source of truth, so we simply
    // refetch on signal rather than trying to merge partial payloads.
    useEffect(() => {
        const socket = getSocket();
        const handleChange = () => fetchAll();
        socket.on('membership:changed', handleChange);
        socket.on('officerRole:changed', handleChange);
        socket.on('payment:changed', handleChange);
        return () => {
            socket.off('membership:changed', handleChange);
            socket.off('officerRole:changed', handleChange);
            socket.off('payment:changed', handleChange);
        };
    }, []);

    async function fetchAll() {
        setLoading(true);
        setError('');
        try {
            // Member List and Member Approval are independent modules/permissions.
            // Fetch pending approvals only when this role can actually view that
            // module, and never let a Member Approval failure (e.g. NONE/VIEW-only
            // access rejecting the pending-users endpoint) block the Member List
            // data from loading — each module's permission controls only its own
            // access.
            const [membersData, pendingData] = await Promise.all([
                getApprovedMembers(),
                canViewMemberApproval ? getPendingUsers().catch(() => null) : Promise.resolve(null),
            ]);
            setMembers((membersData.members ?? []));
            setPendingUsers(pendingData?.users ?? []);
        } catch {
            setError('Failed to load members. Please refresh.');
        } finally {
            setLoading(false);
        }
    }

    // ── Filters ──────────────────────────────────────────────────────────────

    const activeFilterCount =
        filters.years.length +
        (filters.section ? 1 : 0) +
        (filters.payment ? 1 : 0) +
        (filters.memberStatus ? 1 : 0)

    const filteredMembers = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        return members.filter((m) => {
            const matchesSearch =
                !query ||
                m.name.toLowerCase().includes(query) ||
                m.studentNumber.toLowerCase().includes(query);
            const matchesYear =
                filters.years.length === 0 ||
                filters.years.includes(m.yearLevel);
            const matchesSection =
                !filters.section ||
                m.section.toLowerCase().includes(filters.section.toLowerCase());
            const matchesPayment =
                !filters.payment ||
                (filters.payment === "Paid" ? m.isPaid : !m.isPaid);
            const matchesMemberStatus = !filters.memberStatus || m.memberStatus === filters.memberStatus;

            return matchesSearch && matchesYear && matchesSection && matchesPayment && matchesMemberStatus;
        });
    }, [members, searchTerm, filters]);

    function handleFilterToggle(group, value) {
        setFilters(f => ({ ...f, [group]: f[group].includes(value) ? f[group].filter(v => v !== value) : [...f[group], value] }))
    }

    function clearFilters() {
        setFilters({ years: [], section: "", payment: "", memberStatus: "" });
    }

    function openCardsModal() {
        setCardGenerationMessage("")
        setIsCardsModalOpen(true)
    }

    // Only the members ticked in the modal get a card.
    async function handleDownloadCards(selected, setProgress) {
        if (selected.length === 1) {
            await downloadMembershipCardPdf(selected[0])
        } else {
            await downloadAllMembershipCardsPdf(selected, (done, total) => {
                setProgress(`Generating membership cards... ${done}/${total}`)
            })
        }
        setIsCardsModalOpen(false)
        setCardGenerationMessage(`Membership card PDF downloaded for ${selected.length} member${selected.length === 1 ? "" : "s"}.`)
    }

    function openScannerModal() {
        setIsScannerOpen(true);
    }

    async function handleScannerPaymentRecorded() {
        await fetchAll();
    }

    // ── Edit modal ────────────────────────────────────────────────────────────

    async function openEdit(member) {
        setEditingMember(member)
        setEditMemberStatus(member.memberStatus ?? "ACTIVE")
        setEditError('')
        setPaymentHistory([])
        setHistoryLoading(true)
        setHistoryError('')
        try {
            const data = await getMemberPaymentHistory(member.memberId)
            setPaymentHistory(data.history ?? [])
        } catch {
            setHistoryError('Failed to load payment history.')
        } finally {
            setHistoryLoading(false)
        }
    }

    function closeEdit() {
        setEditingMember(null)
        setEditMemberStatus(''); setEditError(''); setEditSaving(false)
        setPaymentHistory([]); setHistoryError('')
    }

    async function handleSaveEdit(e) {
        e.preventDefault()
        if (!editingMember) return
        const statusChanged = canManageOfficers && editMemberStatus !== (editingMember.memberStatus ?? "ACTIVE")
        if (!statusChanged) { closeEdit(); return }

        setEditSaving(true); setEditError('')
        try {
            await updateMemberStatus(editingMember.memberId, editMemberStatus)
            await fetchAll()
            closeEdit()
        } catch (err) {
            setEditError(err.response?.data?.message ?? 'Failed to update member.')
        } finally { setEditSaving(false) }
    }

    // ── Payment recording ─────────────────────────────────────────────────────
    // The amount controls, verification and confirmation live in the shared
    // MembershipPaymentSection (also used by the Scan Payment modal).

    async function handlePaymentRecorded() {
        if (!editingMember) return
        // Refresh payment history
        const data = await getMemberPaymentHistory(editingMember.memberId)
        setPaymentHistory(data.history ?? [])
        // Refresh member list (isPaid / member status may have changed)
        const md = await getApprovedMembers()
        setMembers((md.members ?? []))
    }

    // ── Payment reminders ─────────────────────────────────────────────────────
    // Only unpaid, active members with an email can be reminded; the server
    // checks this again and emails the selected members only.
    const reminderEligibleMembers = useMemo(
        () => members.filter((m) => !m.isPaid && m.email && m.memberStatus === "ACTIVE"),
        [members]
    )

    function openReminderModal() {
        setReminderMessage("")
        setIsReminderModalOpen(true)
    }

    async function handleSendReminders(selected) {
        const data = await sendBulkPaymentReminders(selected.map((m) => m.memberId))
        setIsReminderModalOpen(false)
        setReminderMessage(data.message || "Payment reminders sent.")
    }
    // ── Announcements ─────────────────────────────────────────────────────────

    function openAnnouncementModal() {
        setAnnouncementTitle("");
        setAnnouncementMessage("");
        setAnnouncementRecipients("MEMBERS");
        setAnnouncementPriority("NORMAL");
        setAnnouncementError("");
        setAnnouncementSuccess("");
        setIsAnnouncementOpen(true);
    }

    function closeAnnouncementModal() {
        if (isSendingAnnouncement) return;
        setIsAnnouncementOpen(false);
    }

    async function handleSendAnnouncement(e) {
        e.preventDefault();
        if (isSendingAnnouncement) return;

        if (!announcementTitle.trim() || !announcementMessage.trim()) {
            setAnnouncementError("Title and message are required.");
            return;
        }

        setIsSendingAnnouncement(true);
        setAnnouncementError("");
        try {
            await createAnnouncement({
                title: announcementTitle.trim(),
                message: announcementMessage.trim(),
                recipients: announcementRecipients,
                priority: announcementPriority,
            });
            setAnnouncementSuccess("Announcement sent.");
            setIsAnnouncementOpen(false);
        } catch (err) {
            setAnnouncementError(err.response?.data?.message ?? "Failed to send announcement.");
        } finally {
            setIsSendingAnnouncement(false);
        }
    }

    // ── Member approval ───────────────────────────────────────────────────────

    async function handleApproveMember(userId) {
        setApprovalLoading(true); setApprovalError(''); setApprovalAction({ id: userId, type: 'approve' })
        try {
            await approveUser(userId)
            setPendingUsers(p => p.filter(u => u.id !== userId))
            const md = await getApprovedMembers()
            setMembers((md.members ?? []))
        } catch (err) {
            setApprovalError(err.response?.data?.message ?? 'Failed to approve.')
        } finally { setApprovalLoading(false); setApprovalAction(null) }
    }

    async function handleRejectMember(userId) {
        setApprovalLoading(true); setApprovalError(''); setApprovalAction({ id: userId, type: 'reject' })
        try {
            await rejectUser(userId)
            setPendingUsers(p => p.filter(u => u.id !== userId))
        } catch (err) {
            setApprovalError(err.response?.data?.message ?? 'Failed to reject.')
        } finally { setApprovalLoading(false); setApprovalAction(null) }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <>
            {!compact && (
                <DashboardHeader
                    page="members-list"
                />
            )}

            {/* The Members/Member Approval tab switcher itself is gated on
                whether this role can see the Member Approval module at all
                (VIEW or EDIT) — it is not related to Member List's own
                permission level. */}
            {!compact && canViewMemberApproval && (
                <div className="settings-shell members-list-shell">
                    <nav className="settings-nav" aria-label="Member sections">
                        <button
                            type="button"
                            className={`settings-nav__item ${activeSection === "members" ? "settings-nav__item--active" : ""}`}
                            onClick={() => setActiveSection("members")}
                        >
                            <span className="settings-nav__label">Members</span>
                        </button>
                        <button
                            type="button"
                            className={`settings-nav__item ${activeSection === "approval" ? "settings-nav__item--active" : ""}`}
                            onClick={() => { setApprovalError(''); setActiveSection("approval"); }}
                        >
                            <span className="settings-nav__label">Member Approval</span>
                            <span className="approval-count">{pendingUsers.length}</span>
                        </button>
                    </nav>
                </div>
            )}

            {(!canViewMemberApproval || compact || activeSection === "members") && (
            <div className="card">
                <div className="card__header">
                    <div>
                        <h2 className="card__title">{compact ? "Recent Members" : "All Members"}</h2>
                        <p className="card__sub">
                            {loading ? "Loading..." : error ? error : `${members.length} approved member${members.length !== 1 ? "s" : ""}`}
                        </p>
                    </div>
                    {!compact && (
                        <div className="member-list-actions">
                            {canManageFinancials && (
                                <button
                                    type="button"
                                    className="btn btn--scan"
                                    onClick={openScannerModal}
                                    aria-label="Scan member QR code"
                                    title="Scan member QR code"
                                >
                                    <CameraIcon />
                                    <span>Scan QR</span>
                                </button>
                            )}
                            {canManageMemberList && (
                                <button
                                    type="button"
                                    className="btn btn--outline"
                                    onClick={openCardsModal}
                                    disabled={loading || members.length === 0}
                                >
                                    <DownloadIcon />
                                    <span>Download Membership Cards</span>
                                </button>
                            )}
                            {/* Sending reminder emails is a Financial-module action
                                (the backend authorizes it purely on FINANCIAL EDIT),
                                so it must depend only on that module's permission —
                                not on Member List's. */}
                            {canManageFinancials && (
                                <button
                                    type="button"
                                    className="btn btn--outline"
                                    onClick={openReminderModal}
                                    disabled={loading}
                                >
                                    <EmailIcon />
                                    <span>Send Payment Reminder</span>
                                </button>
                            )}
                            {/* Announcement is a standing power reserved for the President,
                                Vice President, and Senator for Publicity and Information —
                                not part of the per-module permission matrix. The backend
                                enforces this independently (roleGuard on POST /announcements);
                                hiding this button is only a UX convenience. */}
                            {canManageAnnouncements && (
                                <button
                                    type="button"
                                    className="btn btn--outline"
                                    onClick={openAnnouncementModal}
                                    title="Send a custom announcement"
                                >
                                    <MegaphoneIcon />
                                    <span>Announcement</span>
                                </button>
                            )}
                            <label className="member-search">
                                <input type="search" value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    placeholder="Search name or student no." />
                            </label>
                            <div className="advanced-filter-actions">
                                <button type="button" className="btn btn--outline btn--filter"
                                    onClick={() => setIsFilterOpen(true)}>
                                    Advanced Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                                </button>
                                {activeFilterCount > 0 && (
                                    <button type="button" className="icon-btn icon-btn--plain advanced-filter-actions__clear"
                                        onClick={clearFilters}><CloseIcon /></button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {cardGenerationMessage && (
                    <p className="members-download-status">{cardGenerationMessage}</p>
                )}

                {reminderMessage && (
                    <p className="members-download-status" role="status">{reminderMessage}</p>
                )}

                {announcementSuccess && (
                    <p className="members-download-status">{announcementSuccess}</p>
                )}

                <div className="table-wrapper">
                    <table className="data-table member-data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Student Number</th>
                                <th><span className="stacked-table-heading"><span>Year</span><span>Section</span></span></th>
                                <th><span className="stacked-table-heading"><span>Payment</span><span>Status</span></span></th>
                                <th><span className="stacked-table-heading"><span>Active</span><span>Status</span></span></th>
                                {canManageMemberList && <th>Action</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && filteredMembers.map(m => (
                                <tr key={m.id}>
                                    <td>
                                        <div className="user-cell">
                                            <div>
                                                <p className="user-cell__name">
                                                    {m.name}
                                                    {m.role && m.role !== "MEMBER" && (
                                                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 9999, background: "#eef2ff", color: "#4338ca" }}>
                                                            {ROLE_LABELS[m.role] ?? m.role}
                                                        </span>
                                                    )}
                                                </p>
                                                <p className="user-cell__email">{m.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{m.studentNumber}</td>
                                    <td>{m.yearLevel.charAt(0)}-{m.section}</td>
                                    <td className="data-table__payment">
                                        <span className={`status-badge status-badge--${m.isPaid ? "paid" : "unpaid"}`}>
                                            {m.isPaid ? "Paid" : "Unpaid"}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={`status-badge status-badge--${m.memberStatus?.toLowerCase()}`}>
                                            {m.memberStatus}
                                        </span>
                                    </td>
                                    {canManageMemberList && (
                                        <td>
                                            <div className="member-action-buttons">
                                                <button type="button"
                                                    className="icon-btn member-action-buttons__button"
                                                    onClick={() => openEdit(m)} title="Edit member"
                                                    aria-label={`Edit ${m.name}`}>
                                                    <EditIcon />
                                                </button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {!loading && filteredMembers.length === 0 && (
                                <tr><td colSpan="6" className="data-table__empty">
                                    {error || "No members match the current search or filter."}
                                </td></tr>
                            )}
                            {loading && <tr><td colSpan="6" className="data-table__empty"><LoadingState inline label="Loading members…" /></td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

            {/* ── Member Approval Tab ────────────────────────────────────────── */}
            {/* The roster approves accounts, so it needs Member Approval EDIT. */}
            {!compact && canApproveMembers && activeSection === "approval" && (
                <MemberRosterPanel onApprovalsChanged={fetchAll} />
            )}
            {!compact && canViewMemberApproval && activeSection === "approval" && (
                <div className="card approval-card">
                    <div className="card__header">
                        <div>
                            <h2 className="card__title">Member Approval</h2>
                            <p className="card__sub">
                                {pendingUsers.length} pending member{pendingUsers.length !== 1 ? "s" : ""}
                            </p>
                        </div>
                    </div>
                    <div className="approval-list">
                            {approvalError && <p className="text-sm text-red-600 px-2 pb-2">{approvalError}</p>}
                            {pendingUsers.length === 0 ? (
                                <p className="approval-list__empty">No pending member approvals.</p>
                            ) : pendingUsers.map(u => {
                                const m = u.member ?? {}
                                const name = [m.firstName, m.middleName, m.lastName, m.suffix].filter(Boolean).join(' ')
                                return (
                                    <div key={u.id} className="approval-item">
                                        <div className="user-cell">
                                            <div>
                                                <p className="user-cell__name">{name || u.email}</p>
                                                <p className="approval-item__meta">
                                                    {u.studentNumber} · {m.yearLevel?.charAt(0)}-{m.section}
                                                </p>
                                            </div>
                                        </div>
                                        {/* Approve/Reject are actions that modify data — only shown
                                            when this role has EDIT on Member Approval. VIEW-level
                                            roles can see the pending list but not act on it. */}
                                        {canApproveMembers && (
                                            <div className="approval-item__actions">
                                                <ConfirmActionButton
                                                    className="btn btn--outline btn--sm btn--danger"
                                                    disabled={approvalLoading}
                                                    busy={approvalAction?.id === u.id && approvalAction.type === 'reject'}
                                                    onConfirm={() => handleRejectMember(u.id)}
                                                    title="Reject this registration?"
                                                    message={`${name || u.email} will be notified that their registration was not approved and will not be able to sign in.`}
                                                    confirmLabel="Reject"
                                                    cancelLabel="Cancel"
                                                >
                                                    Reject
                                                </ConfirmActionButton>
                                                <ConfirmActionButton
                                                    className="btn btn--primary btn--sm"
                                                    disabled={approvalLoading}
                                                    busy={approvalAction?.id === u.id && approvalAction.type === 'approve'}
                                                    onConfirm={() => handleApproveMember(u.id)}
                                                    title="Approve this registration?"
                                                    message={`${name || u.email} will be notified and can sign in right away.`}
                                                    confirmLabel="Approve"
                                                    cancelLabel="Cancel"
                                                >
                                                    Approve
                                                </ConfirmActionButton>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                    </div>
                </div>
            )}

            {/* ── Edit Member Modal ──────────────────────────────────────────── */}
            {editingMember && (
                <div className="member-modal" role="presentation">
                    <div className="member-modal__panel" role="dialog" aria-modal="true"
                        style={{ maxWidth: 560 }}>
                        <div className="member-modal__header">
                            <div>
                                <p className="member-modal__eyebrow">Edit Member</p>
                                <h2 className="member-modal__title">{editingMember.name}</h2>
                            </div>
                            <button type="button" className="icon-btn icon-btn--plain"
                                onClick={closeEdit}><CloseIcon /></button>
                        </div>

                        <form className="member-modal__form" onSubmit={handleSaveEdit}>
                            {editError && <p className="text-sm text-red-600 mb-2">{editError}</p>}

                            {/* Read-only info */}
                            <div className="dash-form__field">
                                <span className="dash-form__label">Student Number</span>
                                <p className="dash-form__value">{editingMember.studentNumber}</p>
                            </div>
                            <div className="dash-form__field">
                                <span className="dash-form__label">Year &amp; Section</span>
                                <p className="dash-form__value">{editingMember.yearLevel}-{editingMember.section}</p>
                            </div>

                            {/* Officer management fields */}
                            {canManageOfficers && (
                                <>
                                    <label className="dash-form__field">
                                        Member Status
                                        <select value={editMemberStatus}
                                            onChange={e => setEditMemberStatus(e.target.value)}>
                                            {memberStatusOpts.map(o => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    {editingMember.role && editingMember.role !== "MEMBER" && (
                                        <div className="dash-form__field">
                                            <span className="dash-form__label">Officer Role</span>
                                            <p className="dash-form__value">
                                                {ROLE_LABELS[editingMember.role] ?? editingMember.role}
                                            </p>
                                        </div>
                                    )}
                                    {editMemberStatus !== "ACTIVE" && editingMember.role !== "MEMBER" && (
                                        <p className="text-xs text-amber-600 -mt-2 mb-1">
                                            Setting to non-active status will automatically remove their officer role.
                                        </p>
                                    )}
                                </>
                            )}

                            <MembershipPaymentSection
                                member={editingMember}
                                paymentHistory={paymentHistory}
                                historyLoading={historyLoading}
                                historyError={historyError}
                                canManage={canManageFinancials}
                                onRecorded={handlePaymentRecorded}
                            />

                            <div className="member-modal__actions" style={{ marginTop: 16 }}>
                                <button type="button" className="btn btn--outline"
                                    onClick={closeEdit} disabled={editSaving}>Cancel</button>
                                <button aria-busy={editSaving} type="submit" className="btn btn--primary"
                                    disabled={editSaving}>{editSaving ? "Saving..." : "Save Changes"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}



            {/* ── Create Announcement Modal ─────────────────────────────────── */}
            {isAnnouncementOpen && (
                <div className="member-modal" role="presentation">
                    <div className="member-modal__panel" role="dialog" aria-modal="true"
                        style={{ maxWidth: 480 }}>
                        <div className="member-modal__header">
                            <div>
                                <p className="member-modal__eyebrow">Announcement</p>
                                <h2 className="member-modal__title">Create Announcement</h2>
                            </div>
                            <button type="button" className="icon-btn icon-btn--plain"
                                onClick={closeAnnouncementModal}><CloseIcon /></button>
                        </div>

                        <form className="member-modal__form member-modal__form--single" onSubmit={handleSendAnnouncement}>
                            {announcementError && <p className="text-sm text-red-600 mb-2">{announcementError}</p>}

                            <label className="dash-form__field">
                                <span>Title<RequiredMark /></span>
                                <input
                                    type="text"
                                    value={announcementTitle}
                                    onChange={e => setAnnouncementTitle(e.target.value)}
                                    placeholder="e.g. Membership Fee Collection"
                                    maxLength={120}
                                    required
                                />
                            </label>

                            <label className="dash-form__field">
                                <span>Message<RequiredMark /></span>
                                <textarea
                                    value={announcementMessage}
                                    onChange={e => setAnnouncementMessage(e.target.value)}
                                    placeholder="Write the announcement details..."
                                    rows={4}
                                    maxLength={1000}
                                    required
                                />
                            </label>

                            <label className="dash-form__field">
                                Recipients
                                <select value={announcementRecipients}
                                    onChange={e => setAnnouncementRecipients(e.target.value)}>
                                    <option value="MEMBERS">Members</option>
                                    <option value="OFFICERS">Officers</option>
                                    <option value="BOTH">Both</option>
                                </select>
                            </label>

                            <label className="dash-form__field">
                                Priority
                                <select value={announcementPriority}
                                    onChange={e => setAnnouncementPriority(e.target.value)}>
                                    <option value="NORMAL">Normal</option>
                                    <option value="IMPORTANT">Important</option>
                                </select>
                            </label>

                            {announcementPriority === "IMPORTANT" && (
                                <p className="text-sm text-gray-500">
                                    Important announcements stay pinned in the recipients&apos; notifications for 7 days.
                                </p>
                            )}

                            <div className="member-modal__actions" style={{ marginTop: 16 }}>
                                <button type="button" className="btn btn--outline"
                                    onClick={closeAnnouncementModal} disabled={isSendingAnnouncement}>Cancel</button>
                                <button aria-busy={isSendingAnnouncement} type="submit" className="btn btn--primary"
                                    disabled={isSendingAnnouncement}>{isSendingAnnouncement ? "Sending..." : "Send"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Advanced Filter Modal ──────────────────────────────────────── */}
            {isFilterOpen && (
                <div className="member-modal" role="presentation">
                    <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true">
                        <div className="member-modal__header">
                            <div>
                                <p className="member-modal__eyebrow">Filters</p>
                                <h2 className="member-modal__title">Filter Members</h2>
                            </div>
                            <button type="button" className="icon-btn icon-btn--plain"
                                onClick={() => setIsFilterOpen(false)}><CloseIcon /></button>
                        </div>
                        <div className="filter-modal__body">
                            <FilterChecklist title="Payment Status" options={paymentFilterOpts}
                                selectedValues={filters.payment ? [filters.payment] : []}
                                onToggle={v => setFilters(f => ({ ...f, payment: f.payment === v ? "" : v }))} />
                            <FilterChecklist title="Active Status" options={memberStatusOpts}
                                selectedValues={filters.memberStatus ? [filters.memberStatus] : []}
                                onToggle={v => setFilters(f => ({ ...f, memberStatus: f.memberStatus === v ? "" : v }))} />
                            <div className="filter-modal__row">
                                <FilterChecklist title="Year Level" options={yearOptions}
                                    selectedValues={filters.years}
                                    onToggle={v => handleFilterToggle("years", v)} />
                                <label className="dash-form__field filter-section-field">
                                    Section
                                    <input value={filters.section} inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 1"
                                        onChange={e => setFilters(f => ({ ...f, section: digitsOnly(e.target.value) }))} />
                                </label>
                            </div>
                        </div>
                        <div className="member-modal__footer">
                            <button type="button" className="btn btn--outline" onClick={clearFilters}>Clear Filters</button>
                            <button type="button" className="btn btn--primary" onClick={() => setIsFilterOpen(false)}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            {isCardsModalOpen && (
                <MemberSelectionModal
                    eyebrow="Membership Cards"
                    title="Download Membership Cards"
                    members={members}
                    busyLabel="Generating membership cards..."
                    submitLabel={(count, isAll) => isAll
                        ? "Download All Membership Cards"
                        : `Download ${count || ""} Membership Card${count === 1 ? "" : "s"}`}
                    onSubmit={handleDownloadCards}
                    onClose={() => setIsCardsModalOpen(false)}
                />
            )}

            {isReminderModalOpen && (
                <MemberSelectionModal
                    eyebrow="Payment Reminder"
                    title="Send Payment Reminder"
                    members={reminderEligibleMembers}
                    emptyMessage="No unpaid members match your search or filters."
                    busyLabel="Sending payment reminders..."
                    submitLabel={(count, isAll) => isAll
                        ? `Send Payment Reminder to All (${count})`
                        : `Send Payment Reminder${count ? ` (${count})` : ""}`}
                    confirm={{
                        title: "Send payment reminders?",
                        message: (count, isAll) => `This will email a payment reminder to ${isAll ? "all " : ""}${count} selected member${count === 1 ? "" : "s"}. Members you didn't select won't be emailed.`,
                        confirmLabel: "Send",
                    }}
                    onSubmit={handleSendReminders}
                    onClose={() => setIsReminderModalOpen(false)}
                />
            )}

            {isScannerOpen && (
                <MemberLookupModal
                    members={members}
                    onPaymentRecorded={handleScannerPaymentRecorded}
                    onLoadPaymentHistory={getMemberPaymentHistory}
                    onClose={() => setIsScannerOpen(false)}
                />
            )}
        </>
    )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


function FilterChecklist({ title, options, selectedValues, onToggle }) {
    return (
        <fieldset className="filter-checklist">
            <legend>{title}</legend>
            <div className="filter-checklist__grid">
                {options.map(o => (
                    <label key={o.value} className="feature-checklist__item">
                        <input type="checkbox" checked={selectedValues.includes(o.value)}
                            onChange={() => onToggle(o.value)} />
                        <span>{o.label}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    )
}

function CameraIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M8.5 4 7 6H4c-.6 0-1 .2-1.4.6C2.2 7 2 7.4 2 8v10c0 .6.2 1 .6 1.4.4.4.8.6 1.4.6h16c.6 0 1-.2 1.4-.6.4-.4.6-.8.6-1.4V8c0-.6-.2-1-.6-1.4C21 6.2 20.6 6 20 6h-3l-1.5-2h-7ZM12 17.5c-1.2 0-2.2-.4-3-1.3-.8-.8-1.3-1.8-1.3-3s.4-2.2 1.3-3c.8-.8 1.8-1.3 3-1.3s2.2.4 3 1.3c.8.8 1.3 1.8 1.3 3s-.4 2.2-1.3 3c-.8.9-1.8 1.3-3 1.3Zm0-2c.6 0 1.2-.2 1.6-.7.4-.4.7-1 .7-1.6s-.2-1.2-.7-1.6c-.4-.4-1-.7-1.6-.7s-1.2.2-1.6.7c-.4.4-.7 1-.7 1.6s.2 1.2.7 1.6c.4.5 1 .7 1.6.7Z" />
        </svg>
    );
}

function EmailIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
        >
            <path d="M4 5h16c.6 0 1 .4 1 1v12c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V6c0-.6.4-1 1-1Zm0 3 8 5 8-5" />
        </svg>
    )
}

function MegaphoneIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
        >
            <path d="M3 11v2a2 2 0 0 0 2 2h1l2.5 5h2l-1.5-5H12l7 4V6l-7 4H3z" />
            <path d="M17 10v6" />
        </svg>
    )
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
        </svg>
    )
}