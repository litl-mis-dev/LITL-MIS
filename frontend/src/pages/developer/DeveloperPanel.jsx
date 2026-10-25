import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import ConfirmationDialog from "../../components/officers/ConfirmationDialog.jsx";
import LogoLoader from "../../components/LogoLoader";
import {
    getDeveloperStatus, getDeveloperPendingUsers, developerApproveUser, developerRejectUser,
    getPresidentCandidates, assignPresident,
} from "../../services/developer.service";

async function fetchPanelData() {
    const { presidentAssigned } = await getDeveloperStatus();
    if (presidentAssigned) return { presidentAssigned, pending: [], candidates: [] };
    const [pending, candidates] = await Promise.all([getDeveloperPendingUsers(), getPresidentCandidates()]);
    return { presidentAssigned, pending, candidates };
}

const fullName = (m) => [m?.firstName, m?.middleName, m?.lastName, m?.suffix].filter(Boolean).join(" ");

// Home screen for the Developer account — the first account on an empty
// system. While no President exists it can approve or reject registrations
// and assign the President; after that it has nothing left to do. The server
// enforces all of this; this page only reflects it.
export default function DeveloperPanel() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [presidentAssigned, setPresidentAssigned] = useState(false);
    const [pending, setPending] = useState([]);
    const [candidates, setCandidates] = useState([]);
    const [selectedMemberId, setSelectedMemberId] = useState("");
    const [confirm, setConfirm] = useState(null); // { title, message, label, run }
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [reloadKey, setReloadKey] = useState(0);

    // (Re)load whenever reloadKey changes — after every approve/reject/assign.
    useEffect(() => {
        let active = true;
        fetchPanelData()
            .then((data) => {
                if (!active) return;
                setPresidentAssigned(data.presidentAssigned);
                setPending(data.pending);
                setCandidates(data.candidates);
            })
            .catch((err) => {
                if (active) setError(err.response?.data?.message || "Could not load. Please refresh the page.");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [reloadKey]);

    async function runAction(action, successMessage) {
        setBusy(true);
        setError("");
        setNotice("");
        try {
            await action();
            setNotice(successMessage);
        } catch (err) {
            setError(err.response?.data?.message || "Something went wrong. Please try again.");
        } finally {
            setBusy(false);
            setConfirm(null);
            setReloadKey((k) => k + 1);
        }
    }

    function askApprove(u) {
        setConfirm({
            title: "Approve registration",
            message: `Approve ${fullName(u.member) || u.email}? They will be able to sign in as a member.`,
            label: "Approve",
            run: () => runAction(() => developerApproveUser(u.id), "Registration approved."),
        });
    }

    function askReject(u) {
        setConfirm({
            title: "Reject registration",
            message: `Reject ${fullName(u.member) || u.email}? They can register again later.`,
            label: "Reject",
            run: () => runAction(() => developerRejectUser(u.id), "Registration rejected."),
        });
    }

    function askAssignPresident() {
        const candidate = candidates.find((c) => String(c.id) === selectedMemberId);
        if (!candidate) return;
        setConfirm({
            title: "Assign President",
            message: `Make ${candidate.name} the President? After this, the President handles all approvals and role assignments, and this Developer account can no longer make changes.`,
            label: "Assign President",
            run: () => runAction(() => assignPresident(candidate.id), `${candidate.name} is now the President.`),
        });
    }

    async function handleSignOut() {
        await logout();
        navigate("/", { replace: true });
    }

    if (loading) return <LogoLoader label="Loading" fullScreen />;

    return (
        <main className="min-h-screen bg-gray-50 px-4 py-8">
            <div className="mx-auto max-w-3xl space-y-6">
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Developer account</p>
                        <h1 className="text-2xl font-bold text-gray-900">{user?.name || user?.email}</h1>
                    </div>
                    <button
                        type="button"
                        onClick={handleSignOut}
                        className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Sign out
                    </button>
                </header>

                {error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
                {notice && <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700" role="status">{notice}</p>}

                {presidentAssigned ? (
                    <section className="rounded-lg border border-gray-200 bg-white p-6">
                        <h2 className="text-lg font-semibold text-gray-900">A President has been assigned</h2>
                        <p className="mt-2 text-sm text-gray-600">
                            The President now handles member approvals and role assignments. This Developer
                            account has no further actions.
                        </p>
                    </section>
                ) : (
                    <>
                        <section className="rounded-lg border border-gray-200 bg-white p-6">
                            <h2 className="text-lg font-semibold text-gray-900">Pending registrations</h2>
                            <p className="mt-1 text-sm text-gray-600">
                                Approve the registration of the person who will become President.
                            </p>
                            {pending.length === 0 ? (
                                <p className="mt-4 text-sm text-gray-500">No registrations are waiting for approval.</p>
                            ) : (
                                <ul className="mt-4 divide-y divide-gray-100">
                                    {pending.map((u) => (
                                        <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                            <div className="min-w-0">
                                                <p className="font-medium text-gray-900">{fullName(u.member) || "—"}</p>
                                                <p className="text-sm text-gray-500">
                                                    {u.studentNumber} · {u.email}
                                                    {u.member?.yearLevel ? ` · ${u.member.yearLevel}` : ""}
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button type="button" disabled={busy} onClick={() => askReject(u)}
                                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                                    Reject
                                                </button>
                                                <button type="button" disabled={busy} onClick={() => askApprove(u)}
                                                    className="rounded-md bg-(--primary) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--primary-hover) disabled:opacity-50">
                                                    Approve
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className="rounded-lg border border-gray-200 bg-white p-6">
                            <h2 className="text-lg font-semibold text-gray-900">Assign the President</h2>
                            <p className="mt-1 text-sm text-gray-600">
                                Only approved, active members can be chosen. This is the only role the Developer can assign.
                            </p>
                            {candidates.length === 0 ? (
                                <p className="mt-4 text-sm text-gray-500">No approved members yet. Approve a registration first.</p>
                            ) : (
                                <div className="mt-4 flex flex-wrap items-end gap-3">
                                    <label className="min-w-0 flex-1">
                                        <span className="mb-1 block text-sm font-medium text-gray-700">Member</span>
                                        <select
                                            value={selectedMemberId}
                                            onChange={(e) => setSelectedMemberId(e.target.value)}
                                            className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900"
                                        >
                                            <option value="">Select a member…</option>
                                            {candidates.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.name} — {c.studentNumber} ({c.yearLevel})
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <button type="button" disabled={busy || !selectedMemberId} onClick={askAssignPresident}
                                        className="h-10 rounded-md bg-(--primary) px-4 text-sm font-medium text-white hover:bg-(--primary-hover) disabled:opacity-50">
                                        Assign President
                                    </button>
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>

            <ConfirmationDialog
                isOpen={Boolean(confirm)}
                title={confirm?.title}
                message={confirm?.message}
                confirmLabel={busy ? "Working…" : confirm?.label}
                onConfirm={() => !busy && confirm?.run()}
                onCancel={() => !busy && setConfirm(null)}
            />
        </main>
    );
}
