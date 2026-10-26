import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { assignOfficerRole, getApprovedMembers, getAdvisers, removeOfficerRole } from "../../../services/officer.service.js";
import { getRolePermissions, updateRolePermissions as savePermissions } from "../../../services/rolePermission.service.js";
import { ROLE_LABELS, OFFICER_ROLES, ASSIGNABLE_OFFICER_ROLES } from "../../../utils/roles.js";
import { MODULES, MODULE_LABELS } from "../../../utils/permissionModules.js";
import { useAuth } from "../../../context/AuthContext.jsx";
import { useRole } from "../../../utils/useRole.js";
import ConfirmActionButton from "../../../components/officers/ConfirmActionButton.jsx";

// ─── Constants ────────────────────────────────────────────────────────────────

// The Adviser is not a member position — it is not assignable to members.
const roleOptions = ASSIGNABLE_OFFICER_ROLES.map((role) => ({
    value: role,
    label: ROLE_LABELS[role] ?? role,
}));

const LEVEL_OPTIONS = [
    { value: "NONE", label: "No Access" },
    { value: "VIEW", label: "View" },
    { value: "EDIT", label: "Edit" },
];

const PRESIDENT_ROLE = "PRESIDENT_ADMIN";

// ─── Main component ───────────────────────────────────────────────────────────

export default function ManageRolesSettings() {
    const { user } = useAuth();
    const { canManageOfficers } = useRole();
    const isPresident = user?.role === PRESIDENT_ROLE;

    // ── Officer role assignment state ─────────────────────────────────────────
    const [members,    setMembers]    = useState([]);
    const [draftRoles, setDraftRoles] = useState({});
    const [searchTerm, setSearchTerm] = useState("");
    const [loading,    setLoading]    = useState(true);
    const [savingId,   setSavingId]   = useState(null);
    const [editingId,  setEditingId]  = useState(null);
    const [message,    setMessage]    = useState("");
    const [error,      setError]      = useState("");

    useEffect(() => {
        loadMembers();
    }, []);

    const editingMember = useMemo(
        () => members.find((member) => member.memberId === editingId) ?? null,
        [editingId, members]
    );

    const filteredMembers = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();

        // Default view: only members who currently hold an officer role.
        // Searching still looks across every eligible member so a plain
        // member can still be found and promoted into a vacant role.
        if (!query) {
            return members.filter((member) => OFFICER_ROLES.includes(member.role));
        }

        return members.filter((member) => {
            const roleLabel = ROLE_LABELS[member.role] ?? member.role ?? "Member";
            return [member.name, member.email, member.studentNumber, roleLabel]
                .some((value) => value?.toLowerCase().includes(query));
        });
    }, [members, searchTerm]);

    async function loadMembers() {
        setLoading(true);
        setError("");
        try {
            const [data, adviserData] = await Promise.all([
                getApprovedMembers(),
                // Advisers are not members, but their officer-side permissions
                // must stay configurable here. A failure must not hide members.
                getAdvisers().catch(() => ({ advisers: [] })),
            ]);
            // Every active, approved member is eligible to be searched and
            // assigned a role here — not just members who already hold one.
            // (Assigning officer roles now lives exclusively on this screen;
            // it was removed from the Member List, so this must be able to
            // find plain members too, not only current officers.)
            const eligibleMembers = [
                ...(data.members ?? []).filter((member) => member.memberStatus === "ACTIVE"),
                ...(adviserData.advisers ?? []),
            ];
            setMembers(eligibleMembers);
            setDraftRoles(Object.fromEntries(
                eligibleMembers.map((member) => [
                    member.memberId,
                    OFFICER_ROLES.includes(member.role) ? member.role : "",
                ])
            ));
        } catch {
            setError("Failed to load members. Please refresh.");
        } finally {
            setLoading(false);
        }
    }

    async function handleSaveRole(member) {
        const nextRole    = draftRoles[member.memberId] ?? "";
        const currentRole = member.role ?? "MEMBER";
        if (!canManageOfficers || !nextRole || nextRole === currentRole) return;

        setSavingId(member.memberId);
        setMessage(""); setError("");
        try {
            await assignOfficerRole(member.memberId, nextRole);
            setMembers((current) => current.map((item) =>
                item.memberId === member.memberId ? { ...item, role: nextRole } : item
            ));
            setDraftRoles((current) => ({ ...current, [member.memberId]: nextRole }));
            setEditingId(null);
            setMessage(`${member.name}'s role was updated.`);
        } catch (err) {
            setError(err.response?.data?.message ?? "Failed to update officer role.");
        } finally {
            setSavingId(null);
        }
    }

    async function handleRemoveRole(member) {
        const currentRole = member.role ?? "MEMBER";
        if (!canManageOfficers || currentRole === "MEMBER") return;

        setSavingId(member.memberId);
        setMessage(""); setError("");
        try {
            await removeOfficerRole(member.id);
            setMembers((current) => current.map((item) =>
                item.memberId === member.memberId ? { ...item, role: "MEMBER" } : item
            ));
            setDraftRoles((current) => ({ ...current, [member.memberId]: "" }));
            setEditingId(null);
            setMessage(`${member.name}'s officer role was removed.`);
        } catch (err) {
            setError(err.response?.data?.message ?? "Failed to remove officer role.");
        } finally {
            setSavingId(null);
        }
    }

    function handleStartEdit(member) {
        setEditingId(member.memberId);
        setDraftRoles((current) => ({
            ...current,
            [member.memberId]: OFFICER_ROLES.includes(member.role) ? member.role : "",
        }));
        setMessage(""); setError("");
    }

    function handleCancelEdit(member) {
        setEditingId(null);
        setDraftRoles((current) => ({
            ...current,
            [member.memberId]: OFFICER_ROLES.includes(member.role) ? member.role : "",
        }));
        setMessage(""); setError("");
    }

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div className="settings-section-body manage-roles-settings">
            {!canManageOfficers && (
                <p className="settings-message settings-message--warning">
                    Only the President and Vice President can assign or remove officer roles.
                </p>
            )}
            {message && <p className="settings-message">{message}</p>}
            {error   && <p className="settings-message settings-message--error">{error}</p>}

            <div className="manage-roles-toolbar">
                <label className="member-search manage-roles-search">
                    <input
                        type="search"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search name, email, student no., or role"
                    />
                </label>
            </div>

            <div className="table-wrapper">
                <table className="data-table manage-roles-table">
                    <thead>
                        <tr>
                            <th>Member</th>
                            <th>Student Number</th>
                            <th>Current Role</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan="4" className="data-table__empty">Loading members...</td>
                            </tr>
                        )}

                        {!loading && filteredMembers.map((member) => {
                            const currentRole = member.role ?? "MEMBER";
                            const isSaving    = savingId === member.memberId;

                            return (
                                <tr key={member.memberId}>
                                    <td>
                                        <div className="user-cell">
                                            <div>
                                                <p className="user-cell__name">{member.name}</p>
                                                <p className="user-cell__email">{member.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{member.studentNumber}</td>
                                    <td>
                                        <span className="manage-roles-badge">
                                            {ROLE_LABELS[currentRole] ?? currentRole}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="manage-roles-actions">
                                            <button
                                                type="button"
                                                className="btn btn--primary btn--sm"
                                                onClick={() => handleStartEdit(member)}
                                                disabled={!canManageOfficers || isSaving || (!member.isAdviser && member.memberStatus !== "ACTIVE")}
                                            >
                                                Edit
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}

                        {!loading && filteredMembers.length === 0 && (
                            <tr>
                                <td colSpan="4" className="data-table__empty">
                                    No officers match your search.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {editingMember && (
                <RoleEditModal
                    member={editingMember}
                    draftRole={draftRoles[editingMember.memberId] ?? ""}
                    isSaving={savingId === editingMember.memberId}
                    canManageOfficers={canManageOfficers}
                    isPresident={isPresident}
                    onDraftRoleChange={(role) => {
                        setDraftRoles((current) => ({
                            ...current,
                            [editingMember.memberId]: role,
                        }));
                        setMessage(""); setError("");
                    }}
                    onSave={() => handleSaveRole(editingMember)}
                    onRemove={() => handleRemoveRole(editingMember)}
                    onCancel={() => handleCancelEdit(editingMember)}
                />
            )}
        </div>
    );
}

// ─── RoleEditModal ────────────────────────────────────────────────────────────
// Assigns this member's officer role, AND lets the President edit the
// permissions for whichever role is currently selected in the dropdown.
// Permissions are loaded from the DB when the modal opens (and whenever the
// selected role changes), and saved back scoped to that single role only.

function RoleEditModal({ member, draftRole, isSaving, canManageOfficers, isPresident, onDraftRoleChange, onSave, onRemove, onCancel }) {
    const currentRole = member.role ?? "MEMBER";
    const isChanged   = draftRole !== currentRole;
    const previewRole = draftRole || currentRole;
    const isLockedRole = previewRole === PRESIDENT_ROLE;
    // Advisers are not members: their role is fixed, only permissions are editable.
    const isAdviser = Boolean(member.isAdviser);
    const modalRoleOptions = isAdviser
        ? [{ value: currentRole, label: ROLE_LABELS[currentRole] ?? currentRole }]
        : roleOptions;

    const [permissions,        setPermissions]        = useState({});
    const [initialPermissions, setInitialPermissions]  = useState({});
    const [isLoadingPerms,     setIsLoadingPerms]      = useState(true);
    const [isSavingPerms,      setIsSavingPerms]       = useState(false);
    const [permError,          setPermError]           = useState("");
    const [permSuccess,        setPermSuccess]         = useState("");

    // Load the current permissions for whichever role is being previewed —
    // re-runs if the President changes the role dropdown mid-edit.
    useEffect(() => {
        let cancelled = false;
        setIsLoadingPerms(true);
        setPermError(""); setPermSuccess("");

        getRolePermissions()
            .then((data) => {
                if (cancelled) return;
                const rows = data.permissions ?? [];
                const map = Object.fromEntries(
                    MODULES.map((module) => {
                        const row = rows.find((r) => r.role === previewRole && r.module === module);
                        return [module, row ? row.level : "NONE"];
                    })
                );
                setPermissions({
                    ...map,
                    ACTIVITY_LOGS: map.ACTIVITY_LOGS === "EDIT" ? "VIEW" : map.ACTIVITY_LOGS,
                });
                setInitialPermissions(map);
            })
            .catch(() => {
                if (!cancelled) setPermError("Failed to load permissions for this role.");
            })
            .finally(() => {
                if (!cancelled) setIsLoadingPerms(false);
            });

        return () => { cancelled = true; };
    }, [previewRole]);

    const hasPermChanges = MODULES.some((module) => permissions[module] !== initialPermissions[module]);

    function handleChangeLevel(module, level) {
        if (!isPresident || isLockedRole) return;
        setPermissions((current) => ({ ...current, [module]: level }));
        setPermSuccess(""); setPermError("");
    }

    async function handleSavePermissions() {
        if (!isPresident || isLockedRole || !hasPermChanges) return;

        setIsSavingPerms(true);
        setPermError(""); setPermSuccess("");
        try {
            // Only this role's rows are sent — other roles are never touched.
            const payload = MODULES.map((module) => ({
                role: previewRole,
                module,
                level: permissions[module],
            }));
            await savePermissions(payload);
            setInitialPermissions(permissions);
            setPermSuccess("Permissions saved successfully.");
        } catch (err) {
            setPermError(err.response?.data?.message || "Failed to save permissions.");
        } finally {
            setIsSavingPerms(false);
        }
    }

    return createPortal(
        <div
            className="member-modal manage-roles-overlay"
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}
        >
            <div
                className="member-modal__panel manage-roles-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="manage-role-title"
            >
                <div className="member-modal__header">
                    <div>
                        <p className="member-modal__eyebrow">Edit Officer Role</p>
                        <h2 id="manage-role-title" className="member-modal__title">{member.name}</h2>
                    </div>
                    <button type="button" className="icon-btn icon-btn--plain" onClick={onCancel} disabled={isSaving}>
                        <CloseIcon />
                    </button>
                </div>

                <div className="member-modal__form manage-roles-modal__body">
                    <label className="dash-form__field">
                        Officer Role
                        <select
                            value={draftRole}
                            onChange={(e) => onDraftRoleChange(e.target.value)}
                            disabled={!canManageOfficers || isSaving || isAdviser}
                        >
                            <option value="" disabled>Select officer role</option>
                            {modalRoleOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    {isAdviser && (
                        <p className="settings-message settings-message--warning" style={{ margin: "0 0 8px" }}>
                            The Adviser is not a member. Only their officer-side permissions can be changed here.
                        </p>
                    )}

                    {/* Permissions for the role currently selected above */}
                    <section className="manage-roles-access" aria-label="Role permissions">
                        <p>Permissions for <strong>{ROLE_LABELS[previewRole] ?? previewRole}</strong></p>

                        {isLockedRole && (
                            <p className="settings-message settings-message--warning" style={{ margin: "0 0 8px" }}>
                                The President's permissions are always fully enabled and cannot be changed.
                            </p>
                        )}
                        {!isPresident && !isLockedRole && (
                            <p className="settings-message settings-message--warning" style={{ margin: "0 0 8px" }}>
                                Only the President can change role permissions.
                            </p>
                        )}
                        {permError   && <p className="settings-message settings-message--error">{permError}</p>}
                        {permSuccess && <p className="settings-message">{permSuccess}</p>}

                        {isLoadingPerms ? (
                            <p style={{ fontSize: 12, color: "#6b7280" }}>Loading permissions…</p>
                        ) : (
                            <div className="manage-roles-access__list">
                                {MODULES.map((module) => {
                                    const level = isLockedRole
                                        ? (module === "ACTIVITY_LOGS" ? "VIEW" : "EDIT")
                                        : (permissions[module] ?? "NONE");
                                    const levelOptions = module === "ACTIVITY_LOGS"
                                        ? LEVEL_OPTIONS.filter((option) => option.value !== "EDIT")
                                        : LEVEL_OPTIONS;
                                    const canEdit = isPresident && !isLockedRole;

                                    return (
                                        <label
                                            key={module}
                                            className={`manage-roles-access__item ${level !== "NONE" ? "manage-roles-access__item--allowed" : ""}`}
                                        >
                                            <span>{MODULE_LABELS[module] ?? module}</span>
                                            <select
                                                value={level}
                                                onChange={(e) => handleChangeLevel(module, e.target.value)}
                                                disabled={!canEdit}
                                            >
                                                {levelOptions.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </label>
                                    );
                                })}
                            </div>
                        )}

                        {isPresident && !isLockedRole && (
                            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                                <button
                                    type="button"
                                    className="btn btn--outline btn--sm"
                                    onClick={handleSavePermissions}
                                    disabled={!hasPermChanges || isSavingPerms || isLoadingPerms}
                                >
                                    {isSavingPerms ? "Saving..." : "Save Permissions"}
                                </button>
                            </div>
                        )}
                    </section>

                    <div className="member-modal__actions">
                        <button type="button" className="btn btn--outline" onClick={onCancel} disabled={isSaving}>
                            Cancel
                        </button>
                        {!isAdviser && (
                        <ConfirmActionButton
                            className="btn btn--outline"
                            onConfirm={onRemove}
                            disabled={!canManageOfficers || isSaving || currentRole === "MEMBER"}
                            title="Remove officer role?"
                            message={`${member.name} will lose their ${ROLE_LABELS[currentRole] ?? currentRole} role and revert to a regular member. This can be undone later by reassigning a role.`}
                            confirmLabel="Remove"
                            cancelLabel="Cancel"
                        >
                            Remove
                        </ConfirmActionButton>
                        )}
                        {!isAdviser && (
                        <button
                            type="button"
                            className="btn btn--primary"
                            onClick={onSave}
                            disabled={!canManageOfficers || !draftRole || !isChanged || isSaving}
                        >
                            {isSaving ? "Saving..." : "Save Changes"}
                        </button>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
        </svg>
    );
}
