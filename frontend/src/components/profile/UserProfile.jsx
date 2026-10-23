import { useEffect, useMemo, useRef, useState } from "react";
import DashboardHeader from "../officers/DashboardHeader.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { isNonMemberRole } from "../../utils/roles.js";
import {
    changePassword,
    uploadAvatar,
    requestEmailChange,
    resendEmailChangeOtp,
    verifyEmailChange,
} from "../../services/auth.service.js";
import "../../assets/styles/auth/LoginOTP.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const PASSWORD_REGEX =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-])[A-Za-z\d@$!%*?&.#_-]{8,}$/;
const CVSU_REGEX        = /@cvsu\.edu\.ph$/i;
const MAX_AVATAR_MB     = 2;
const MAX_AVATAR_BYTES  = MAX_AVATAR_MB * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 320;
const AVATAR_MAX_DATA_URL_LENGTH = 85000;

const emptyProfile = {
    name: "", email: "", emailType: "", studentNumber: "",
    role: "", position: "", sex: "", yearLevel: "", section: "",
    memberStatus: "", qrCode: "", avatar: "",
};

const emptyPasswordForm = { currentPassword: "", newPassword: "", confirmNewPassword: "" };

const SEX_LABELS = {
    MALE:              "Male",
    FEMALE:            "Female",
    PREFER_NOT_TO_SAY: "Prefer not to say",
};

// ─── Shared UI components (identical to Registration.jsx) ─────────────────────

function EyeIcon({ visible }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" style={{ width: 19, height: 19 }}>
            {visible ? (
                <>
                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                    <circle cx="12" cy="12" r="3" />
                </>
            ) : (
                <>
                    <path d="M3 3l18 18" />
                    <path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.1 4" />
                    <path d="M6.6 6.6A17 17 0 0 0 2.5 12s3.5 7 9.5 7a9.8 9.8 0 0 0 4.2-.9" />
                    <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1" />
                </>
            )}
        </svg>
    );
}

function PasswordStrength({ password }) {
    if (!password) return null;
    const score = [
        password.length >= 8,
        /[a-z]/.test(password),
        /[A-Z]/.test(password),
        /\d/.test(password),
        /[@$!%*?&.#_-]/.test(password),
    ].filter(Boolean).length;

    const levels = [
        { label: "Very Weak",   color: "#e74c3c" },
        { label: "Weak",        color: "#e74c3c" },
        { label: "Fair",        color: "#f39c12" },
        { label: "Good",        color: "#f1c40f" },
        { label: "Strong",      color: "#2ecc71" },
        { label: "Very Strong", color: "#27ae60" },
    ];
    const level = levels[score];

    return (
        <div style={{ marginTop: 6 }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} style={{
                        flex: 1, height: 4, borderRadius: 2,
                        background: i <= score ? level.color : "#e5e7eb",
                    }} />
                ))}
            </div>
            <p style={{ fontSize: 11, color: level.color, margin: 0 }}>{level.label}</p>
        </div>
    );
}

function PasswordRequirements({ password }) {
    const requirements = [
        { label: "At least 8 characters", met: password.length >= 8 },
        { label: "One uppercase letter", met: /[A-Z]/.test(password) },
        { label: "One lowercase letter", met: /[a-z]/.test(password) },
        { label: "One number", met: /\d/.test(password) },
        { label: "One special character (@$!%*?&.#_-)", met: /[@$!%*?&.#_-]/.test(password) },
    ];

    return (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {requirements.map((req) => (
                <li
                    key={req.label}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: req.met ? "#16a34a" : "#9ca3af",
                        marginBottom: 2,
                    }}
                >
                    <span>{req.met ? "✓" : "○"}</span>
                    <span>{req.label}</span>
                </li>
            ))}
        </ul>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UserProfile({ variant = "member" }) {
    const isOfficer    = variant === "officer";
    const profileLabel = isOfficer ? "Officer" : "Member";

    const { user, updateUserProfile, refreshUser, logout } = useAuth();
    // Advisers are not members: no member status, no member QR code.
    const isAdviser = isNonMemberRole(user?.role);
    const initialProfile = useMemo(() => buildProfile(user, profileLabel), [user, profileLabel]);

    const [form, setForm] = useState(initialProfile);
    useEffect(() => { setForm(initialProfile); }, [initialProfile]);

    // ── Avatar ────────────────────────────────────────────────────────────────
    const avatarInputRef  = useRef(null);
    const [avatarPreview, setAvatarPreview] = useState(null);
    const [avatarLoading, setAvatarLoading] = useState(false);
    const [avatarError,   setAvatarError]   = useState("");
    const [avatarSuccess, setAvatarSuccess] = useState("");

    // ── Email change ──────────────────────────────────────────────────────────
    // Two-step modal, styled to match ForgotPassword.jsx (email step) and
    // OneTimePassword.jsx (the Registration OTP screen) as closely as possible.
    const emailInputRef = useRef(null);
    const otpInputsRef   = useRef([]);
    const [emailStep,    setEmailStep]    = useState("idle"); // idle | email | otp
    const [newEmail,     setNewEmail]     = useState("");
    const [emailErr,     setEmailErr]     = useState("");
    const [emailLoading, setEmailLoading] = useState(false);
    const [emailSuccess, setEmailSuccess] = useState("");
    const [changeToken,  setChangeToken]  = useState("");
    const [otpDigits,    setOtpDigits]    = useState(["", "", "", "", "", ""]);
    const [otpErr,       setOtpErr]       = useState("");
    const [resendCooldown, setResendCooldown] = useState(0);

    useEffect(() => {
        if (emailStep === "email") {
            emailInputRef.current?.focus();
        }
    }, [emailStep]);

    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = setInterval(() => setResendCooldown((s) => s - 1), 1000);
        return () => clearInterval(timer);
    }, [resendCooldown]);

    // ── Password ──────────────────────────────────────────────────────────────
    const [pwForm,     setPwForm]     = useState(emptyPasswordForm);
    const [pwErrors,   setPwErrors]   = useState({});
    const [pwSrvErr,   setPwSrvErr]   = useState("");
    const [pwNotice,   setPwNotice]   = useState("");
    const [pwLoading,  setPwLoading]  = useState(false);
    const [showCurPw,  setShowCurPw]  = useState(false);
    const [showNewPw,  setShowNewPw]  = useState(false);
    const [showConPw,  setShowConPw]  = useState(false);

    // ── Avatar handlers ───────────────────────────────────────────────────────

    async function handleAvatarSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";

        const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        if (!allowed.includes(file.type)) { setAvatarError("Please upload a JPG, PNG, GIF, or WebP image."); return; }
        if (file.size > MAX_AVATAR_BYTES) { setAvatarError(`Image must be less than ${MAX_AVATAR_MB}MB.`); return; }

        setAvatarError(""); setAvatarSuccess("");
        try {
            const compressedAvatar = await prepareAvatarImage(file);
            setAvatarPreview(compressedAvatar);
        } catch {
            setAvatarError("Could not prepare this image. Please try a smaller JPG, PNG, GIF, or WebP file.");
        }
    }

    function cancelAvatarChange() {
        setAvatarPreview(null); setAvatarError(""); setAvatarSuccess("");
    }

    async function saveAvatar() {
        if (!avatarPreview) return;
        setAvatarLoading(true); setAvatarError(""); setAvatarSuccess("");
        try {
            const data = await uploadAvatar(avatarPreview); // sends base64 to backend
            // Backend uploads to Supabase and returns the public URL — use THAT, not the base64
            updateUserProfile({ avatar: data.avatar });
            await refreshUser(); // re-fetch to get the latest member.avatar from DB
            setAvatarPreview(null);
            setAvatarSuccess("Profile picture updated.");
        } catch (err) {
            setAvatarError(err.response?.data?.message || "Failed to save profile picture. Please try again.");
        } finally {
            setAvatarLoading(false);
        }
    }

    // ── Email change handlers ─────────────────────────────────────────────────

    function openEmailModal() {
        setEmailStep("email"); setNewEmail(""); setEmailErr(""); setEmailSuccess("");
    }

    function closeEmailModal() {
        setEmailStep("idle"); setNewEmail(""); setEmailErr("");
        setChangeToken(""); setOtpDigits(["", "", "", "", "", ""]); setOtpErr("");
        setEmailLoading(false); setResendCooldown(0);
    }

    async function handleSendCode(e) {
        e.preventDefault();
        const email = newEmail.trim().toLowerCase();
        if (!email)                             { setEmailErr("Email address is required."); return; }
        if (!CVSU_REGEX.test(email))            { setEmailErr("Only CvSU institutional emails (@cvsu.edu.ph) are accepted."); return; }
        if (email === form.email.toLowerCase()) { setEmailErr("This is already your current email address."); return; }

        setEmailLoading(true); setEmailErr("");
        try {
            const data = await requestEmailChange(email);
            setChangeToken(data.changeToken);
            setOtpDigits(["", "", "", "", "", ""]);
            setOtpErr("");
            setResendCooldown(60);
            setEmailStep("otp");
        } catch (err) {
            setEmailErr(err.response?.data?.message || "Failed to send verification code. Please try again.");
        } finally {
            setEmailLoading(false);
        }
    }

    // ── OTP step handlers — mirrors OneTimePassword.jsx exactly ──────────────

    function handleOtpDigitChange(index, value) {
        if (!/^\d?$/.test(value)) return;
        const next = [...otpDigits];
        next[index] = value;
        setOtpDigits(next);
        if (value && index < 5) otpInputsRef.current[index + 1]?.focus();
    }

    function handleOtpKeyDown(index, e) {
        if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
            otpInputsRef.current[index - 1]?.focus();
        }
    }

    function handleOtpPaste(e) {
        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (!pasted) return;
        e.preventDefault();
        const next = pasted.split("");
        while (next.length < 6) next.push("");
        setOtpDigits(next);
        otpInputsRef.current[Math.min(pasted.length, 5)]?.focus();
    }

    async function handleVerifyOtp(e) {
        e.preventDefault();
        setOtpErr("");

        const otp = otpDigits.join("");
        if (otp.length !== 6) { setOtpErr("Please enter the complete 6-digit code."); return; }

        setEmailLoading(true);
        try {
            await verifyEmailChange(changeToken, otp);
            await refreshUser();
            closeEmailModal();
            setEmailSuccess("Email address updated successfully.");
        } catch (err) {
            setOtpErr(err.response?.data?.message || "Something went wrong. Please try again.");
        } finally {
            setEmailLoading(false);
        }
    }

    async function handleResendOtp() {
        if (resendCooldown > 0) return;
        setOtpErr("");
        try {
            await resendEmailChangeOtp(changeToken);
            setResendCooldown(60);
            setOtpDigits(["", "", "", "", "", ""]);
            otpInputsRef.current[0]?.focus();
        } catch (err) {
            setOtpErr(err.response?.data?.message || "Could not resend code. Please try again.");
        }
    }

    // ── Password handlers ──────────────────────────────────────────────────────

    function handlePwInput(e) {
        const { name, value } = e.target;
        setPwForm((f) => ({ ...f, [name]: value }));
        setPwErrors((errs) => ({ ...errs, [name]: "" }));
        setPwSrvErr(""); setPwNotice("");
    }

    function resetPwForm() {
        setPwForm(emptyPasswordForm); setPwErrors({});
        setPwSrvErr(""); setPwNotice("");
        setShowCurPw(false); setShowNewPw(false); setShowConPw(false);
    }

    async function handlePwSubmit(e) {
        e.preventDefault();
        const errs = {};
        if (!pwForm.currentPassword) errs.currentPassword = "Current password is required.";
        if (!pwForm.newPassword) {
            errs.newPassword = "New password is required.";
        } else if (!PASSWORD_REGEX.test(pwForm.newPassword)) {
            errs.newPassword = "Password must contain uppercase, lowercase, number, special character, and be at least 8 characters.";
        } else if (pwForm.currentPassword === pwForm.newPassword) {
            errs.newPassword = "New password must be different from your current password.";
        }
        if (!pwForm.confirmNewPassword) {
            errs.confirmNewPassword = "Please confirm your new password.";
        } else if (pwForm.newPassword !== pwForm.confirmNewPassword) {
            errs.confirmNewPassword = "Passwords do not match.";
        }
        if (Object.keys(errs).length > 0) { setPwErrors(errs); return; }

        setPwLoading(true); setPwErrors({}); setPwSrvErr("");
        try {
            await changePassword(pwForm.currentPassword, pwForm.newPassword, pwForm.confirmNewPassword);
            resetPwForm();
            setPwNotice("Password changed successfully. You will be logged out of all other sessions.");
            setTimeout(() => logout(), 2500);
        } catch (err) {
            setPwSrvErr(err.response?.data?.message || "Failed to change password. Please try again.");
        } finally {
            setPwLoading(false);
        }
    }

    // ── Derived ───────────────────────────────────────────────────────────────

    const displayAvatar = avatarPreview || form.avatar;
    const initials      = getInitials(form.name || form.email || profileLabel);
    const canChangeEmail = form.emailType !== "CVSU";

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <>
            {isOfficer ? (
                <DashboardHeader page="profile" />
            ) : (
                <div className="dash__header">
                    <div>
                        <p className="dash__eyebrow">Account</p>
                        <h1 className="dash__title">Profile</h1>
                        <p className="dash__subtitle">View and manage your account.</p>
                    </div>
                </div>
            )}

            <div className="profile-grid">

                {/* ── Left column ─────────────────────────────────────────── */}
                <div className="profile-side-column">

                    <section className="card profile-summary-card">
                        {/* Avatar with pencil icon */}
                        <div style={{ position: "relative", display: "inline-block" }}>
                            <div className="profile-avatar" aria-hidden="true">
                                {displayAvatar
                                    ? <img src={displayAvatar} alt="Profile" />
                                    : <span>{initials}</span>
                                }
                            </div>

                            {/* Pencil icon — upper-right corner */}
                            <button
                                type="button"
                                onClick={() => avatarInputRef.current?.click()}
                                aria-label="Change profile picture"
                                style={{
                                    position: "absolute", top: 2, right: 2,
                                    width: 26, height: 26, borderRadius: "50%",
                                    background: "#111827", border: "2.5px solid #fff",
                                    color: "#fff", cursor: "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                                }}
                            >
                                <PencilIcon />
                            </button>

                            <input
                                ref={avatarInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/gif,image/webp"
                                onChange={handleAvatarSelect}
                                style={{ display: "none" }}
                            />
                        </div>

                        {avatarError   && <p style={{ fontSize: 12, color: "#ef4444", margin: "8px 0 0", textAlign: "center" }}>{avatarError}</p>}
                        {avatarSuccess && <p style={{ fontSize: 12, color: "#16a34a", margin: "8px 0 0", textAlign: "center" }}>{avatarSuccess}</p>}

                        {avatarPreview && (
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                <button type="button" className="btn btn--outline btn--sm"
                                    onClick={cancelAvatarChange} disabled={avatarLoading}>
                                    Cancel
                                </button>
                                <button type="button" className="btn btn--primary btn--sm"
                                    onClick={saveAvatar} disabled={avatarLoading}>
                                    {avatarLoading ? "Saving…" : "Save Photo"}
                                </button>
                            </div>
                        )}

                        <div className="profile-summary-card__body">
                            <h2>{form.name || profileLabel}</h2>
                            <p>{form.position || formatRole(form.role || profileLabel)}</p>
                            {!isAdviser && form.memberStatus && (
                                <span className={`profile-status profile-status--${form.memberStatus.toLowerCase()}`}>
                                    {formatMemberStatus(form.memberStatus)}
                                </span>
                            )}
                        </div>
                    </section>

                    {!isAdviser && (
                    <section className="card profile-qr-card" aria-label="Member QR code">
                        {form.qrCode ? (
                            <img className="profile-qr-image" src={form.qrCode} alt="Member QR code" />
                        ) : (
                            <div className="profile-qr-placeholder__box" aria-hidden="true">
                                <span /><span /><span />
                            </div>
                        )}
                        <div className="profile-qr-card__body">
                            <h2>QR Code</h2>
                            <p>{form.name || "QR code will appear here"}</p>
                            <p>{form.studentNumber || "QR code will appear here"}</p>
                        </div>
                    </section>
                    )}
                </div>

                {/* ── Right column ─────────────────────────────────────────── */}
                <div className="profile-main-column">

                    {/* Details card */}
                    <section className="card profile-details-card">
                        <div className="card__header">
                            <div>
                                <h2 className="card__title">{profileLabel} Details</h2>
                                <p className="card__sub">
                                    Your registered information. Contact an administrator to update personal details.
                                </p>
                            </div>
                        </div>

                        {emailSuccess && <p className="profile-alert profile-alert--success">{emailSuccess}</p>}

                        <div className="dash-form profile-form">
                            <ReadOnlyField label="Full Name"      value={form.name} />

                            {/* Email with inline Change button */}
                            <div className="dash-form__field" style={{ flexDirection: "column" }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                                    Email
                                </span>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <input
                                        type="text"
                                        value={form.email}
                                        readOnly
                                        tabIndex={-1}
                                        style={{ flex: 1, cursor: "default", background: "var(--color-surface,#f9fafb)" }}
                                    />
                                    {canChangeEmail && (
                                        <button type="button" className="btn btn--outline btn--sm"
                                            onClick={openEmailModal} style={{ whiteSpace: "nowrap" }}>
                                            Change
                                        </button>
                                    )}
                                </div>
                                {/*!canChangeEmail && (
                                    <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                                        Institutional CvSU emails cannot be changed.
                                    </p>
                                )*/}
                            </div>

                            <ReadOnlyField label="Student Number" value={form.studentNumber} />
                            <ReadOnlyField label="Sex"            value={SEX_LABELS[form.sex] ?? form.sex} />
                            {!isAdviser && <ReadOnlyField label="Year Level"     value={form.yearLevel} />}
                            {!isAdviser && <ReadOnlyField label="Section"        value={form.section} />}
                            {!isAdviser && <ReadOnlyField label="Member Status"  value={formatMemberStatus(form.memberStatus)} />}
                            <ReadOnlyField label={`${profileLabel} Role`} value={form.position} />
                        </div>
                    </section>

                    {/* Change Password card */}
                    <section className="card profile-password-card">
                        <div className="card__header">
                            <div>
                                <h2 className="card__title">Change Password</h2>
                                <p className="card__sub">
                                    Update your sign-in password. All other sessions will be logged out.
                                </p>
                            </div>
                        </div>

                        {pwSrvErr  && <p className="profile-alert profile-alert--error">{pwSrvErr}</p>}
                        {pwNotice  && <p className="profile-alert profile-alert--success">{pwNotice}</p>}

                        <form className="dash-form profile-password-form" onSubmit={handlePwSubmit}>
                            <label className="dash-form__field">
                                Current Password
                                <div style={{ position: "relative" }}>
                                    <input type={showCurPw ? "text" : "password"} name="currentPassword"
                                        value={pwForm.currentPassword} onChange={handlePwInput}
                                        autoComplete="current-password" disabled={pwLoading}
                                        style={{ paddingRight: 40 }} />
                                    <button type="button" onClick={() => setShowCurPw((v) => !v)}
                                        tabIndex={-1} aria-label="Toggle" style={eyeBtn}>
                                        <EyeIcon visible={showCurPw} />
                                    </button>
                                </div>
                                {pwErrors.currentPassword && <p style={errStyle}>{pwErrors.currentPassword}</p>}
                            </label>

                            <label className="dash-form__field">
                                New Password
                                <div style={{ position: "relative" }}>
                                    <input type={showNewPw ? "text" : "password"} name="newPassword"
                                        value={pwForm.newPassword} onChange={handlePwInput}
                                        autoComplete="new-password" placeholder="Minimum 8 characters"
                                        disabled={pwLoading} style={{ paddingRight: 40 }} />
                                    <button type="button" onClick={() => setShowNewPw((v) => !v)}
                                        tabIndex={-1} aria-label="Toggle" style={eyeBtn}>
                                        <EyeIcon visible={showNewPw} />
                                    </button>
                                </div>
                                <PasswordStrength password={pwForm.newPassword} />
                                {pwForm.newPassword && <PasswordRequirements password={pwForm.newPassword} />}
                                {pwErrors.newPassword && <p style={errStyle}>{pwErrors.newPassword}</p>}
                            </label>

                            <label className="dash-form__field">
                                Confirm New Password
                                <div style={{ position: "relative" }}>
                                    <input type={showConPw ? "text" : "password"} name="confirmNewPassword"
                                        value={pwForm.confirmNewPassword} onChange={handlePwInput}
                                        autoComplete="new-password" placeholder="Re-enter your new password"
                                        disabled={pwLoading} style={{ paddingRight: 40 }} />
                                    <button type="button" onClick={() => setShowConPw((v) => !v)}
                                        tabIndex={-1} aria-label="Toggle" style={eyeBtn}>
                                        <EyeIcon visible={showConPw} />
                                    </button>
                                </div>
                                {pwForm.newPassword && pwForm.confirmNewPassword && (
                                    <p style={{ ...errStyle, color: pwForm.newPassword === pwForm.confirmNewPassword ? "#16a34a" : "#ef4444" }}>
                                        {pwForm.newPassword === pwForm.confirmNewPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
                                    </p>
                                )}
                                {pwErrors.confirmNewPassword && <p style={errStyle}>{pwErrors.confirmNewPassword}</p>}
                            </label>

                            <div className="dash-form__actions">
                                <button type="button" className="btn btn--outline"
                                    onClick={resetPwForm} disabled={pwLoading}>
                                    Clear
                                </button>
                                <button type="submit" className="btn btn--primary" disabled={pwLoading}>
                                    {pwLoading ? "Saving…" : "Save Password"}
                                </button>
                            </div>
                        </form>
                    </section>

                </div>
            </div>

            {/* ── Email Change Modal — step 1 mirrors ForgotPassword.jsx, step 2
                   mirrors the Registration OTP screen (OneTimePassword.jsx),
                   same CSS classes and markup. ──────────────────────────────── */}
            {emailStep !== "idle" && (
                <div className="member-modal" role="presentation"
                    onClick={(e) => { if (e.target === e.currentTarget) closeEmailModal(); }}>
                    <section className="auth-card" style={{ margin: 0, position: "relative" }}
                        role="dialog" aria-modal="true" aria-labelledby="email-change-title">

                        <button type="button" onClick={closeEmailModal} aria-label="Close"
                            style={{
                                position: "absolute", top: 14, right: 14,
                                background: "none", border: "none", cursor: "pointer",
                                color: "#9ca3af", padding: 4, display: "flex",
                            }}>
                            <CloseIcon />
                        </button>

                        {/* Step 1 — enter new email (same look as ForgotPassword.jsx) */}
                        {emailStep === "email" && (
                            <>
                                <div style={{ textAlign: "center", marginBottom: 16 }}>
                                    <div style={{
                                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                                        width: 56, height: 56, borderRadius: "50%",
                                        background: "#fff7ed", border: "1px solid #fed7aa", marginBottom: 4,
                                    }}>
                                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                                            stroke="#ef8315" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M4 4h16v16H4z" />
                                            <path d="m4 6 8 6 8-6" />
                                        </svg>
                                    </div>
                                </div>

                                <h1 id="email-change-title" style={{ marginBottom: 8 }}>Change your email</h1>
                                <p style={{ textAlign: "center", fontSize: 13, color: "#6d6d6d", marginBottom: 24, marginTop: 0 }}>
                                    Current email: <strong>{form.email}</strong>. Enter your new CvSU email
                                    and we'll send you a verification code to confirm the change.
                                </p>

                                <form className="auth-form" onSubmit={handleSendCode}>
                                    <label className="field">
                                        <span>New CvSU email</span>
                                        <input
                                            ref={emailInputRef}
                                            type="email"
                                            placeholder="juan.delacruz@cvsu.edu.ph"
                                            autoComplete="email"
                                            value={newEmail}
                                            onChange={(e) => { setNewEmail(e.target.value); setEmailErr(""); }}
                                            required
                                        />
                                    </label>

                                    {emailErr && <p className="form-message form-message-error">{emailErr}</p>}

                                    <button type="submit" className="primary-button" disabled={emailLoading}>
                                        {emailLoading ? "Sending code..." : "Send verification code"}
                                    </button>
                                </form>

                                <div style={{ textAlign: "center", fontSize: 13, marginTop: 20, color: "#6d6d6d" }}>
                                    <button type="button" onClick={closeEmailModal}
                                        style={{ background: "none", border: "none", padding: 0, color: "#555", textDecoration: "underline", cursor: "pointer", fontSize: 13 }}>
                                        Cancel
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Step 2 — verify OTP (identical markup/styles to OneTimePassword.jsx) */}
                        {emailStep === "otp" && (
                            <>
                                <div style={{ textAlign: "center", marginBottom: 16 }}>
                                    <div style={{
                                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                                        width: 56, height: 56, borderRadius: "50%",
                                        background: "#fff7ed", border: "1px solid #fed7aa", marginBottom: 4,
                                    }}>
                                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                                            stroke="#ef8315" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M4 4h16v16H4z" />
                                            <path d="m4 6 8 6 8-6" />
                                        </svg>
                                    </div>
                                </div>

                                <form onSubmit={handleVerifyOtp}>
                                    <h1>Verify your new email</h1>
                                    <p style={{ textAlign: "center", fontSize: 13, color: "#6d6d6d", margin: "0 0 24px" }}>
                                        We sent a 6-digit verification code to <strong>{newEmail}</strong> to confirm the change.
                                    </p>

                                    <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 8 }}
                                        onPaste={handleOtpPaste}>
                                        {otpDigits.map((digit, index) => (
                                            <div key={index}>
                                                <label htmlFor={`email-otp-${index + 1}`} className="sr-only">
                                                    {`Digit ${index + 1}`}
                                                </label>
                                                <input
                                                    ref={(el) => (otpInputsRef.current[index] = el)}
                                                    id={`email-otp-${index + 1}`}
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={1}
                                                    value={digit}
                                                    onChange={(e) => handleOtpDigitChange(index, e.target.value)}
                                                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                                                    style={{
                                                        width: 44, height: 48, textAlign: "center",
                                                        fontSize: 20, fontWeight: 600,
                                                        border: "1px solid #d6d6d6", borderRadius: 8,
                                                        outline: "none", background: "#fff", color: "#222",
                                                        transition: "border-color 0.15s",
                                                    }}
                                                    onFocus={(e) => (e.target.style.borderColor = "#ef8315")}
                                                    onBlur={(e) => (e.target.style.borderColor = "#d6d6d6")}
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    <p style={{ textAlign: "center", fontSize: 12, color: "#9d9d9d", margin: "0 0 20px" }}>
                                        Please enter the 6-digit code we sent via email.
                                    </p>

                                    {otpErr && (
                                        <p className="form-message form-message-error" style={{ marginBottom: 12 }}>
                                            {otpErr}
                                        </p>
                                    )}

                                    <button type="submit" className="primary-button" disabled={emailLoading}>
                                        {emailLoading ? "Verifying..." : "Verify code"}
                                    </button>

                                    <p style={{ textAlign: "center", fontSize: 13, color: "#6d6d6d", marginTop: 20 }}>
                                        Didn't receive the code?{" "}
                                        <button
                                            type="button"
                                            onClick={handleResendOtp}
                                            disabled={resendCooldown > 0}
                                            style={{
                                                background: "none", border: "none", padding: 0,
                                                fontSize: 13, fontWeight: 600,
                                                color: resendCooldown > 0 ? "#aaa" : "#ef8315",
                                                textDecoration: "underline",
                                                cursor: resendCooldown > 0 ? "not-allowed" : "pointer",
                                            }}
                                        >
                                            {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
                                        </button>
                                    </p>

                                    <p style={{ textAlign: "center", fontSize: 13, marginTop: 12 }}>
                                        <button
                                            type="button"
                                            onClick={() => { setEmailStep("email"); setOtpErr(""); }}
                                            style={{ background: "none", border: "none", padding: 0, fontSize: 13, color: "#6d6d6d", textDecoration: "underline", cursor: "pointer" }}
                                        >
                                            ← Go back
                                        </button>
                                    </p>
                                </form>
                            </>
                        )}
                    </section>
                </div>
            )}
        </>
    );
}

// ─── Inline styles ────────────────────────────────────────────────────────────

const eyeBtn = {
    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
    background: "none", border: "none", cursor: "pointer", color: "#6b7280",
    display: "flex", alignItems: "center", padding: 0,
};

const errStyle = { fontSize: 12, color: "#ef4444", marginTop: 4, marginBottom: 0 };

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReadOnlyField({ label, value }) {
    return (
        <label className="dash-form__field">
            {label}
            <input type="text" value={value || "—"} readOnly tabIndex={-1}
                style={{ cursor: "default", background: "var(--color-surface,#f9fafb)" }} />
        </label>
    );
}

function PencilIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
        </svg>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prepareAvatarImage(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);

        image.onload = () => {
            URL.revokeObjectURL(objectUrl);

            const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(image.width, image.height));
            const width = Math.max(1, Math.round(image.width * scale));
            const height = Math.max(1, Math.round(image.height * scale));
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");

            if (!context) {
                reject(new Error("Canvas is unavailable."));
                return;
            }

            canvas.width = width;
            canvas.height = height;
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);

            const qualities = [0.82, 0.72, 0.62, 0.52, 0.42, 0.32];
            const dataUrl = qualities
                .map((quality) => canvas.toDataURL("image/jpeg", quality))
                .find((value) => value.length <= AVATAR_MAX_DATA_URL_LENGTH);

            if (!dataUrl) {
                reject(new Error("Compressed avatar is still too large."));
                return;
            }

            resolve(dataUrl);
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Image could not be loaded."));
        };

        image.src = objectUrl;
    });
}

function buildProfile(user, fallbackRole) {
    if (!user) return emptyProfile;
    const member = user.member || {};
    return {
        name:         user.name || user.fullName || user.email?.split("@")[0] || "",
        email:        user.email || "",
        emailType:    user.emailType || "",
        studentNumber: user.studentNumber || member.studentNumber || "",
        role:         user.role || fallbackRole.toUpperCase(),
        position:     user.position || formatRole(user.role || fallbackRole),
        sex:          user.sex || member.sex || "",
        yearLevel:    user.yearLevel || member.yearLevel || "",
        section:      user.section || member.section || "",
        memberStatus: user.memberStatus || member.status || "",
        qrCode:       user.qrCode || member.qrCode || "",
        avatar:       member.avatar || user.avatar || "",
    };
}

function formatRole(role) {
    return role.toString().toLowerCase().split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatMemberStatus(status) {
    return status
        ? status.toString().toLowerCase().replace(/^\w/, (l) => l.toUpperCase())
        : "";
}

function getInitials(name) {
    return name.split(/\s+|@/).filter(Boolean).slice(0, 2)
        .map((p) => p.charAt(0).toUpperCase()).join("") || "U";
}
