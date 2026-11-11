import { useEffect, useRef, useState } from "react";
import ConfirmationDialog from "../../../components/officers/ConfirmationDialog.jsx";
import LoadingState from "../../../components/ui/LoadingState.jsx";
import {
    getAdvisers, inviteAdviser, resendAdviserInvite, revokeAdviserInvite,
    deactivateAdviser, reactivateAdviser, changeAdviserTitle,
} from "../../../services/adviser.service.js";
import RequiredMark from "../../../components/ui/RequiredMark.jsx";
import { formatPersonName } from "../../../utils/formInputs.js";

// Settings ▸ Advisers — President only. Advisers and the Department Chair
// join by email invitation; both titles have the same access. Seat limits,
// who may do what, and link expiry are all enforced by the server.

const TITLES = [
    { value: "ADVISER", label: "Adviser" },
    { value: "DEPT_CHAIR", label: "Department Chair" },
];
const EMPTY_FORM = { firstName: "", lastName: "", suffix: "", email: "", title: "ADVISER" };

const inputClass = "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900";
const primaryButton = "rounded-md bg-(--primary) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--primary-hover) disabled:opacity-50";
const secondaryButton = "rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

const formatDate = (value) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

export default function AdviserSettings() {
    const [data, setData] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [form, setForm] = useState(EMPTY_FORM);
    const [titleDrafts, setTitleDrafts] = useState({});
    const [confirm, setConfirm] = useState(null); // { title, message, label, run }
    const [busy, setBusy] = useState(false);
    const [sending, setSending] = useState(false);
    // Blocks a second submit even if it arrives before React re-renders.
    const sendingRef = useRef(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        let active = true;
        getAdvisers()
            .then((result) => { if (active) setData(result); })
            .catch((err) => { if (active) setError(err.response?.data?.message || "Could not load advisers."); });
        return () => { active = false; };
    }, [reloadKey]);

    async function run(action) {
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const result = await action();
            setNotice(result?.message || "Done.");
            return true;
        } catch (err) {
            setError(err.response?.data?.message || "Something went wrong. Please try again.");
            return false;
        } finally {
            setBusy(false);
            setConfirm(null);
            setReloadKey((k) => k + 1);
        }
    }

    async function handleInvite(event) {
        event.preventDefault();
        if (sendingRef.current) return;
        sendingRef.current = true;
        setSending(true);
        try {
            const sent = await run(() => inviteAdviser({
                firstName: form.firstName,
                lastName: form.lastName,
                suffix: form.suffix,
                email: form.email,
                title: form.title,
            }));
            if (sent) setForm(EMPTY_FORM);
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }

    const ask = (title, message, label, action) => setConfirm({ title, message, label, run: () => run(action) });

    if (!data) {
        return error
            ? <p className="text-sm text-red-700" role="alert">{error}</p>
            : <LoadingState label="Loading advisers…" />;
    }

    const seatFull = (title) => data.seats[title].used >= data.seats[title].limit;

    return (
        <div className="space-y-6">
            {error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
            {notice && <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700" role="status">{notice}</p>}

            <div className="flex flex-wrap gap-3">
                {TITLES.map((t) => (
                    <div key={t.value} className="rounded-lg border border-gray-200 px-4 py-2">
                        <p className="text-xs uppercase tracking-wide text-gray-500">{t.label} seats</p>
                        <p className="text-lg font-semibold text-gray-900">
                            {data.seats[t.value].used} / {data.seats[t.value].limit}
                        </p>
                    </div>
                ))}
            </div>
            <p className="text-sm text-gray-600">
                Advisers and the Department Chair have the same access. Pending invitations hold a seat until they
                are accepted, revoked, or expire after 48 hours.
            </p>

            <form onSubmit={handleInvite} className="rounded-lg border border-gray-200 p-4" aria-busy={sending}>
                <h3 className="font-semibold text-gray-900">Invite an adviser</h3>
                {/* Fields lock while the invitation is being sent. */}
                <fieldset disabled={sending} className="mt-3 grid gap-3 sm:grid-cols-2 disabled:opacity-60">
                    <label>
                        <span className="mb-1 block text-sm font-medium text-gray-700">First name<RequiredMark /></span>
                        <input className={inputClass} value={form.firstName} required maxLength={30}
                            onChange={(e) => setForm({ ...form, firstName: formatPersonName(e.target.value) })} />
                    </label>
                    <label>
                        <span className="mb-1 block text-sm font-medium text-gray-700">Last name<RequiredMark /></span>
                        <input className={inputClass} value={form.lastName} required maxLength={30}
                            onChange={(e) => setForm({ ...form, lastName: formatPersonName(e.target.value) })} />
                    </label>
                    <label>
                        <span className="mb-1 block text-sm font-medium text-gray-700">Suffix (optional)</span>
                        <input className={inputClass} value={form.suffix} maxLength={10} placeholder="Jr., III"
                            onChange={(e) => setForm({ ...form, suffix: e.target.value })} />
                    </label>
                    <label>
                        <span className="mb-1 block text-sm font-medium text-gray-700">Email<RequiredMark /></span>
                        <input className={inputClass} type="email" value={form.email} required
                            onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </label>
                    <label>
                        <span className="mb-1 block text-sm font-medium text-gray-700">Title<RequiredMark /></span>
                        <select className={inputClass} value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}>
                            {TITLES.map((t) => (
                                <option key={t.value} value={t.value} disabled={seatFull(t.value)}>
                                    {t.label}{seatFull(t.value) ? " (no free seat)" : ""}
                                </option>
                            ))}
                        </select>
                    </label>
                </fieldset>
                <button type="submit" className={`${primaryButton} mt-4`} disabled={busy || sending || seatFull(form.title)} aria-busy={sending}>
                    {sending ? "Sending invitation…" : "Send invitation"}
                </button>
                {sending && (
                    <p className="mt-2 text-sm text-gray-500" role="status">Sending the email — this can take a few seconds.</p>
                )}
            </form>

            <section>
                <h3 className="font-semibold text-gray-900">Active</h3>
                {data.active.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">No active advisers.</p>
                ) : (
                    <ul className="mt-2 divide-y divide-gray-100">
                        {data.active.map((a) => {
                            const draft = titleDrafts[a.userId] ?? a.title;
                            return (
                                <li key={a.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="font-medium text-gray-900">{a.name}</p>
                                        <p className="text-sm text-gray-500">{a.titleLabel} · {a.email}</p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <select className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm" value={draft}
                                            aria-label={`Title for ${a.name}`}
                                            onChange={(e) => setTitleDrafts({ ...titleDrafts, [a.userId]: e.target.value })}>
                                            {TITLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                        <button type="button" className={secondaryButton} disabled={busy || draft === a.title}
                                            onClick={() => ask("Change title",
                                                `Change ${a.name} to ${TITLES.find((t) => t.value === draft)?.label}?`,
                                                "Change title", () => changeAdviserTitle(a.userId, draft))}>
                                            Save title
                                        </button>
                                        <button type="button" className={secondaryButton} disabled={busy}
                                            onClick={() => ask("Deactivate adviser",
                                                `Deactivate ${a.name}? They will be signed out everywhere and can no longer sign in. Their history is kept, and you can reactivate them later if a seat is free.`,
                                                "Deactivate", () => deactivateAdviser(a.userId))}>
                                            Deactivate
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <section>
                <h3 className="font-semibold text-gray-900">Invitations</h3>
                {data.invites.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">No open invitations.</p>
                ) : (
                    <ul className="mt-2 divide-y divide-gray-100">
                        {data.invites.map((i) => (
                            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="font-medium text-gray-900">{i.name} · {i.titleLabel}</p>
                                    <p className="text-sm text-gray-500">
                                        {i.email} · {i.isExpired ? "Expired" : `Expires ${formatDate(i.expiresAt)}`}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <button type="button" className={secondaryButton} disabled={busy}
                                        onClick={() => ask("Resend invitation",
                                            `Send a new link to ${i.email}? The previous link will stop working.`,
                                            "Resend", () => resendAdviserInvite(i.id))}>
                                        Resend
                                    </button>
                                    <button type="button" className={secondaryButton} disabled={busy}
                                        onClick={() => ask("Revoke invitation",
                                            `Revoke the invitation for ${i.email}? The link will stop working and the seat is freed.`,
                                            "Revoke", () => revokeAdviserInvite(i.id))}>
                                        Revoke
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <h3 className="font-semibold text-gray-900">Past advisers</h3>
                {data.past.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">No deactivated advisers.</p>
                ) : (
                    <ul className="mt-2 divide-y divide-gray-100">
                        {data.past.map((a) => (
                            <li key={a.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="font-medium text-gray-900">{a.name}</p>
                                    <p className="text-sm text-gray-500">{a.titleLabel} · {a.email} · Deactivated</p>
                                </div>
                                <button type="button" className={secondaryButton} disabled={busy || seatFull(a.title)}
                                    title={seatFull(a.title) ? `No free ${a.titleLabel} seat` : undefined}
                                    onClick={() => ask("Reactivate adviser",
                                        `Reactivate ${a.name} as ${a.titleLabel}? They will be able to sign in again.`,
                                        "Reactivate", () => reactivateAdviser(a.userId))}>
                                    Reactivate
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <ConfirmationDialog
                isOpen={Boolean(confirm)}
                title={confirm?.title}
                message={confirm?.message}
                confirmLabel={busy ? "Working…" : confirm?.label}
                busy={busy}
                onConfirm={() => !busy && confirm?.run()}
                onCancel={() => !busy && setConfirm(null)}
            />
        </div>
    );
}
