import { useCallback, useEffect, useState } from "react";
import SuccessDialog from "../../../components/officers/SuccessDialog.jsx";
import { advanceSemester, getActiveSemesterStats, listSemesters } from "../../../services/financial.service.js";
import { CONFIRM_KEYWORD, SEMESTER_LABELS } from "./settingsConfig.js";
import { useRole } from "../../../utils/useRole.js";

export default function ActiveSemesterSettings() {
    const { can } = useRole();
    const canEdit = can("FINANCIAL", "EDIT");
    const [step, setStep] = useState("view");
    const [stats, setStats] = useState(null);
    const [semesters, setSemesters] = useState([]);
    const [loadingStats, setLoadingStats] = useState(true);
    const [statsError, setStatsError] = useState("");
    const [confirmInput, setConfirmInput] = useState("");
    const [isAdvancing, setIsAdvancing] = useState(false);
    const [advanceError, setAdvanceError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    const fetchAll = useCallback(async () => {
        setLoadingStats(true);
        setStatsError("");

        try {
            const [statsData, semesterData] = await Promise.all([
                getActiveSemesterStats(),
                listSemesters(),
            ]);
            setStats(statsData);
            setSemesters(semesterData.semesters || []);
        } catch {
            setStatsError("Failed to load semester information.");
        } finally {
            setLoadingStats(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const activeSemester = stats?.semester;
    const isSchoolYearChange = stats?.isSchoolYearChange ?? false;
    const buttonLabel = activeSemester
        ? (isSchoolYearChange ? "Activate Next School Year" : "Activate Next Semester")
        : null;
    const currentLabel = activeSemester
        ? `${activeSemester.schoolYear} | ${SEMESTER_LABELS[activeSemester.semester] ?? activeSemester.semester}`
        : "-";
    const nextLabel = stats?.nextSemesterLabel ?? "-";
    const confirmEnabled = confirmInput.trim() === CONFIRM_KEYWORD && !isAdvancing;
    const actionsList = buildActionsList({ isSchoolYearChange, nextLabel, remainingBalance: stats?.remainingBalance });

    function handleClickAdvance() {
        if (!canEdit) return;
        setConfirmInput("");
        setAdvanceError("");
        setStep("confirm");
    }

    function handleCancelConfirm() {
        setStep("view");
        setConfirmInput("");
        setAdvanceError("");
    }

    async function handleConfirmAdvance() {
        if (!confirmEnabled) return;

        setIsAdvancing(true);
        setAdvanceError("");
        try {
            const result = await advanceSemester(CONFIRM_KEYWORD);
            await fetchAll();
            setSuccessMessage(result.message);
            setStep("view");
            setConfirmInput("");
        } catch (err) {
            setAdvanceError(err.response?.data?.message || "Failed to advance semester. Please try again.");
        } finally {
            setIsAdvancing(false);
        }
    }

    return (
        <>
            <div className="settings-section-body">
                {statsError && <p className="settings-message settings-message--error">{statsError}</p>}
                {loadingStats && <p className="settings-loading">Loading semester information...</p>}

                {!loadingStats && step === "view" && (
                    <>
                        <SemesterSummary
                            activeSemester={activeSemester}
                            currentLabel={currentLabel}
                            nextLabel={nextLabel}
                            remainingBalance={stats?.remainingBalance}
                            activeMemberCount={stats?.activeMemberCount}
                        />

                        <SemesterHistory semesters={semesters} />

                        {canEdit && activeSemester && buttonLabel && (
                            <div className="settings-form-actions settings-form-actions--bordered">
                                <button type="button" onClick={handleClickAdvance} className="btn btn--primary">
                                    {buttonLabel}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {step === "confirm" && (
                    <SemesterConfirmation
                        currentLabel={currentLabel}
                        nextLabel={nextLabel}
                        actionsList={actionsList}
                        confirmInput={confirmInput}
                        confirmEnabled={confirmEnabled}
                        isAdvancing={isAdvancing}
                        advanceError={advanceError}
                        onConfirmInputChange={setConfirmInput}
                        onCancel={handleCancelConfirm}
                        onConfirm={handleConfirmAdvance}
                    />
                )}
            </div>

            <SuccessDialog
                isOpen={Boolean(successMessage)}
                title="Semester advanced"
                message={successMessage}
                onClose={() => setSuccessMessage("")}
            />
        </>
    );
}

function SemesterSummary({ activeSemester, currentLabel, nextLabel, remainingBalance, activeMemberCount }) {
    if (!activeSemester) {
        return (
            <p className="settings-message settings-message--warning">
                No active semester found.
            </p>
        );
    }

    return (
        <div className="settings-summary-card">
            <p className="settings-summary-card__eyebrow">Current Semester</p>
            <p className="settings-summary-card__title">{currentLabel}</p>
            <div className="settings-summary-grid">
                <Metric label="Status" value="Active" tone="success" />
                <Metric label="Remaining Balance" value={formatCurrency(remainingBalance)} />
                <Metric label="Active Members" value={activeMemberCount ?? 0} />
                <Metric label="Next Period" value={nextLabel} />
            </div>
        </div>
    );
}

function Metric({ label, value, tone }) {
    return (
        <div className="settings-metric">
            <p>{label}</p>
            <span className={tone === "success" ? "settings-pill settings-pill--success" : ""}>{value}</span>
        </div>
    );
}

function SemesterHistory({ semesters }) {
    if (!semesters.length) return null;

    return (
        <div className="settings-semester-table">
            <div className="settings-semester-table__row settings-semester-table__row--head">
                <span>School Year / Semester</span>
                <span>Status</span>
                <span>Beginning</span>
                <span>Ending</span>
            </div>
            {semesters.map((semester) => (
                <div key={semester.id} className="settings-semester-table__row">
                    <span>{semester.schoolYear} - {SEMESTER_LABELS[semester.semester] ?? semester.semester}</span>
                    <span>
                        {semester.isActive ? (
                            <span className="settings-pill settings-pill--success">Active</span>
                        ) : (
                            <span className="settings-pill">Inactive</span>
                        )}
                    </span>
                    <span>{formatCurrency(semester.beginningBalance)}</span>
                    <span>{semester.endingBalance != null ? formatCurrency(semester.endingBalance) : "-"}</span>
                </div>
            ))}
        </div>
    );
}

function SemesterConfirmation({
    currentLabel,
    nextLabel,
    actionsList,
    confirmInput,
    confirmEnabled,
    isAdvancing,
    advanceError,
    onConfirmInputChange,
    onCancel,
    onConfirm,
}) {
    return (
        <div className="settings-confirmation">
            {advanceError && <p className="settings-message settings-message--error">{advanceError}</p>}

            <div className="settings-confirmation__periods">
                <div>
                    <p>Current Semester</p>
                    <span>{currentLabel}</span>
                </div>
                <div>
                    <p>Next Semester</p>
                    <span>{nextLabel}</span>
                </div>
            </div>

            <div>
                <p className="settings-confirmation__title">The following actions will be performed:</p>
                <ul className="settings-confirmation__list">
                    {actionsList.map((action) => (
                        <li key={action}>{action}</li>
                    ))}
                </ul>
            </div>

            <p className="settings-message settings-message--error">This action cannot be undone.</p>

            <label className="settings-confirmation__field">
                <span>Type <strong>{CONFIRM_KEYWORD}</strong> to confirm:</span>
                <input
                    type="text"
                    value={confirmInput}
                    onChange={(event) => onConfirmInputChange(event.target.value)}
                    disabled={isAdvancing}
                    placeholder={CONFIRM_KEYWORD}
                    autoFocus
                />
            </label>

            <div className="settings-form-actions settings-form-actions--bordered">
                <button type="button" onClick={onCancel} disabled={isAdvancing} className="btn btn--outline">
                    Cancel
                </button>
                <button type="button" onClick={onConfirm} disabled={!confirmEnabled} className="btn btn--primary">
                    {isAdvancing ? "Processing..." : "Confirm Activation"}
                </button>
            </div>
        </div>
    );
}

function buildActionsList({ isSchoolYearChange, nextLabel, remainingBalance }) {
    return [
        "End the current semester.",
        isSchoolYearChange ? `Create and activate ${nextLabel}.` : `Activate ${nextLabel}.`,
        ...(isSchoolYearChange ? ["Promote all active members to the next year level."] : []),
        parseFloat(remainingBalance ?? 0) > 0
            ? `Carry over ${formatCurrency(remainingBalance)} as the beginning balance.`
            : null,
        "Generate the required financial records.",
        "Record all activities in the Activity Log.",
    ].filter(Boolean);
}

function formatCurrency(value) {
    const n = parseFloat(value) || 0;
    return `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
