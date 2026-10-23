import { useState, useEffect, useCallback } from 'react'
import { getActiveSemesterStats, listSemesters, advanceSemester, initFirstSemester } from '../../../services/financial.service'
import SuccessDialog from '../../../components/officers/SuccessDialog'

function formatCurrency(value) {
  const n = parseFloat(value) || 0
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const SEMESTER_LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester' }
const CONFIRM_KEYWORD = 'ACTIVATE'

export default function SemesterManager({ onSemesterChanged }) {
  const [isOpen, setIsOpen]               = useState(false)
  const [step, setStep]                   = useState('view') // 'view' | 'confirm'

  // Stats
  const [stats, setStats]                 = useState(null)
  const [semesters, setSemesters]         = useState([])
  const [loadingStats, setLoadingStats]   = useState(false)
  const [statsError, setStatsError]       = useState('')

  // Confirmation step
  const [confirmInput, setConfirmInput]   = useState('')
  const [isAdvancing, setIsAdvancing]     = useState(false)
  const [advanceError, setAdvanceError]   = useState('')

  // Success
  const [isSuccessOpen, setIsSuccessOpen] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  const [initSchoolYear, setInitSchoolYear] = useState('')
  const [initSemester,   setInitSemester]   = useState('FIRST')
  const [initConfirm,    setInitConfirm]    = useState('')
  const [initError,      setInitError]      = useState('')
  const [isIniting,      setIsIniting]      = useState(false)

  const fetchAll = useCallback(async () => {
    setLoadingStats(true)
    setStatsError('')
    try {
      const [statsData, semesterData] = await Promise.all([
        getActiveSemesterStats(),
        listSemesters()
      ])
      setStats(statsData)
      setSemesters(semesterData.semesters || [])
    } catch {
      setStatsError('Failed to load semester information.')
    } finally {
      setLoadingStats(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) fetchAll()
  }, [isOpen, fetchAll])

  function openModal() { setIsOpen(true) }

  function closeModal() {
    setIsOpen(false)
    setStep('view')
    setConfirmInput('')
    setAdvanceError('')
    setStatsError('')
  }

  function handleClickAdvance() {
    setConfirmInput('')
    setAdvanceError('')
    setStep('confirm')
  }

  function handleCancelConfirm() {
    setStep('view')
    setConfirmInput('')
    setAdvanceError('')
  }

  async function handleInitFirstSemester() {
    const SY_REGEX = /^\d{4}-\d{4}$/
    setInitError('')
    if (!initSchoolYear.trim() || !SY_REGEX.test(initSchoolYear.trim())) {
      setInitError('Enter a valid school year (e.g. 2025-2026).')
      return
    }
    if (initConfirm.trim() !== 'ACTIVATE') {
      setInitError('You must type ACTIVATE to confirm.')
      return
    }
    setIsIniting(true)
    try {
      const result = await initFirstSemester(initSchoolYear.trim(), initSemester, 'ACTIVATE')
      await fetchAll()
      setSuccessMessage(result.message)
      setIsSuccessOpen(true)
      setInitSchoolYear(''); setInitSemester('FIRST'); setInitConfirm(''); setInitError('')
      onSemesterChanged?.()
    } catch (err) {
      setInitError(err.response?.data?.message || 'Failed to initialize semester.')
    } finally {
      setIsIniting(false)
    }
  }

  async function handleConfirmAdvance() {
    if (confirmInput.trim() !== CONFIRM_KEYWORD) return
    setIsAdvancing(true)
    setAdvanceError('')
    try {
      const result = await advanceSemester(CONFIRM_KEYWORD)
      await fetchAll()
      setSuccessMessage(result.message)
      setIsSuccessOpen(true)
      setStep('view')
      setConfirmInput('')
      onSemesterChanged?.()
    } catch (err) {
      setAdvanceError(err.response?.data?.message || 'Failed to advance semester. Please try again.')
    } finally {
      setIsAdvancing(false)
    }
  }

  // ── Derived display values ────────────────────────────────────────────────
  const activeSemester = stats?.semester
  const isSchoolYearChange = stats?.isSchoolYearChange ?? false

  const buttonLabel = activeSemester
    ? (isSchoolYearChange ? 'Activate Next School Year' : 'Activate Next Semester')
    : null

  const currentLabel = activeSemester
    ? `${activeSemester.schoolYear} | ${SEMESTER_LABELS[activeSemester.semester] ?? activeSemester.semester}`
    : '—'

  const nextLabel = stats?.nextSemesterLabel ?? '—'

  const confirmEnabled = confirmInput.trim() === CONFIRM_KEYWORD && !isAdvancing

  const actionsList = [
    'End the current semester.',
    isSchoolYearChange
      ? `Create and activate ${nextLabel}.`
      : `Activate ${nextLabel}.`,
    ...(isSchoolYearChange ? ['Promote all active members to the next year level.'] : []),
    parseFloat(stats?.remainingBalance ?? 0) > 0
      ? `Carry over ${formatCurrency(stats?.remainingBalance)} as the beginning balance.`
      : null,
    'Generate the required financial records.',
    'Record all activities in the Activity Log.',
  ].filter(Boolean)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <button type="button" onClick={openModal} className="btn btn--outline btn--sm">
        Manage Semester
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="max-h-[calc(100vh-108px)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl">

            {/* Header */}
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Semester Management</h2>
                <p className="mt-1 text-sm text-gray-500">
                  The system automatically determines the next academic period.
                </p>
              </div>
              <button type="button" onClick={closeModal}
                className="rounded-md px-2 py-1 text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                aria-label="Close modal">&times;</button>
            </div>

            <div className="space-y-5 px-6 py-5">
              {statsError && <p className="text-sm text-red-600">{statsError}</p>}

              {loadingStats && <p className="text-sm text-gray-500">Loading...</p>}

              {/* ── VIEW step ──────────────────────────────────────────────── */}
              {!loadingStats && step === 'view' && (
                <>
                  {/* Current semester stats card */}
                  {activeSemester ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Current Semester</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">{currentLabel}</p>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div>
                          <p className="text-xs text-gray-500">Status</p>
                          <span className="mt-0.5 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Active
                          </span>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Remaining Balance</p>
                          <p className="mt-0.5 text-sm font-semibold text-gray-900">
                            {formatCurrency(stats?.remainingBalance ?? 0)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Active Members</p>
                          <p className="mt-0.5 text-sm font-semibold text-gray-900">
                            {stats?.activeMemberCount ?? 0}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Next Period</p>
                          <p className="mt-0.5 text-sm font-medium text-gray-700">{nextLabel}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 space-y-3">
                      <p className="text-sm font-semibold text-yellow-900">No active semester found.</p>
                      <p className="text-sm text-yellow-800">Initialize the first semester to activate the financial module.</p>

                      {initError && <p className="text-sm text-red-600">{initError}</p>}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">School Year</label>
                          <input type="text" value={initSchoolYear}
                            onChange={e => { setInitSchoolYear(e.target.value); setInitError('') }}
                            placeholder="e.g. 2025-2026"
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Semester</label>
                          <select value={initSemester} onChange={e => setInitSemester(e.target.value)}
                            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200">
                            <option value="FIRST">1st Semester</option>
                            <option value="SECOND">2nd Semester</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Type <span className="font-mono font-bold">ACTIVATE</span> to confirm:
                        </label>
                        <input type="text" value={initConfirm}
                          onChange={e => { setInitConfirm(e.target.value); setInitError('') }}
                          placeholder="ACTIVATE"
                          className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200" />
                      </div>

                      <button type="button" onClick={handleInitFirstSemester}
                        disabled={isIniting || initConfirm.trim() !== 'ACTIVATE' || !initSchoolYear.trim()}
                        className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover) disabled:cursor-not-allowed disabled:opacity-50">
                        {isIniting ? 'Initializing...' : 'Initialize First Semester'}
                      </button>
                    </div>
                  )}

                  {/* Semester history table */}
                  {semesters.length > 0 && (
                    <div className="overflow-hidden rounded-md border border-gray-200">
                      <div className="grid grid-cols-[1fr_80px_110px_110px] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
                        <span>School Year / Semester</span>
                        <span>Status</span>
                        <span>Beginning</span>
                        <span>Ending</span>
                      </div>
                      {semesters.map(s => (
                        <div key={s.id} className="grid grid-cols-[1fr_80px_110px_110px] items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm text-gray-700 last:border-b-0">
                          <span>{s.schoolYear} — {SEMESTER_LABELS[s.semester] ?? s.semester}</span>
                          <span>
                            {s.isActive
                              ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>
                              : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Inactive</span>}
                          </span>
                          <span className="tabular-nums">{formatCurrency(s.beginningBalance)}</span>
                          <span className="tabular-nums">{s.endingBalance != null ? formatCurrency(s.endingBalance) : '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action button */}
                  {activeSemester && buttonLabel && (
                    <div className="flex justify-end border-t border-gray-200 pt-4">
                      <button type="button" onClick={handleClickAdvance}
                        className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover)">
                        {buttonLabel}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ── CONFIRM step ───────────────────────────────────────────── */}
              {step === 'confirm' && (
                <div className="space-y-4">
                  {advanceError && <p className="text-sm text-red-600">{advanceError}</p>}

                  {/* Current / Next */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Current Semester</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{currentLabel}</p>
                    </div>
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                      <p className="text-xs font-medium text-orange-600">Next Semester</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{nextLabel}</p>
                    </div>
                  </div>

                  {/* Actions list */}
                  <div>
                    <p className="text-sm font-medium text-gray-900">The following actions will be performed:</p>
                    <ul className="mt-2 space-y-1">
                      {actionsList.map((action, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                          <span className="mt-0.5 text-gray-400">•</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Cannot be undone warning */}
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                    ⚠ This action cannot be undone.
                  </p>

                  {/* Type-to-confirm */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Type <span className="font-mono font-bold">{CONFIRM_KEYWORD}</span> to confirm:
                    </label>
                    <input type="text" value={confirmInput}
                      onChange={e => setConfirmInput(e.target.value)}
                      disabled={isAdvancing}
                      placeholder={CONFIRM_KEYWORD}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200 disabled:bg-gray-100"
                      autoFocus
                    />
                  </div>

                  {/* Buttons */}
                  <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={handleCancelConfirm} disabled={isAdvancing}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                      Cancel
                    </button>
                    <button type="button" onClick={handleConfirmAdvance}
                      disabled={!confirmEnabled}
                      className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover) disabled:cursor-not-allowed disabled:opacity-50">
                      {isAdvancing ? 'Processing...' : 'Confirm Activation'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <SuccessDialog
        isOpen={isSuccessOpen}
        title="Semester advanced"
        message={successMessage}
        onClose={() => setIsSuccessOpen(false)}
      />
    </>
  )
}
