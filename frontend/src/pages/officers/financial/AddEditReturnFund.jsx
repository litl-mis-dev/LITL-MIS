import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import SuccessDialog from '../../../components/officers/SuccessDialog'
import { listDisbursements, createReturnFund, getActiveSemester } from '../../../services/financial.service'
import { getSignatories } from '../../../services/officer.service'

const TEXT_ONLY_REGEX = /^[A-Za-z\s'.,-]+$/
const MAX_AMOUNT = 100_000
const CONFIRM_KEYWORD = 'CONFIRM'

function stripCurrencyFormatting(value) {
  return String(value).replace(/[₱,\s]/g, '')
}

function formatPesoDisplay(raw) {
  const cleaned = String(raw).replace(/[^0-9.]/g, '')
  const parts   = cleaned.split('.')
  const intPart = parts[0] || ''
  const decPart = parts.length > 1 ? parts[1].slice(0, 2) : ''
  if (!intPart && !decPart) return ''
  const intNum = parseInt(intPart || '0', 10)
  if (isNaN(intNum)) return ''
  return decPart !== '' ? `₱${intNum.toLocaleString('en-PH')}.${decPart}` : `₱${intNum.toLocaleString('en-PH')}`
}

function formatCurrencyDisplay(value) {
  const n = parseFloat(String(value).replace(/[₱,\s]/g, '')) || 0
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function todayFormatted() {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .format(new Date())
}

const emptyForm = {
  disbursementId: '', disbursementLabel: '', receivedFrom: '', amount: '',
  purposeOfFund: '', titleOfActivities: '', sourceOfFundName: '',
  refundedBy: '', refundedByPosition: '',
  receivedBy: '', receivedByPosition: '',
  auditedBy: '', auditedByPosition: '',
  approvedBy: '', approvedByPosition: '',
}

function SignatoryReadOnly({ nameLabel, nameValue, positionValue, error }) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700">{nameLabel}</label>
        <input type="text" value={nameValue} readOnly
          className="mt-1 w-full rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
          placeholder="—" />
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Position</label>
        <input type="text" value={positionValue} readOnly
          className="mt-1 w-full rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
          placeholder="—" />
      </div>
    </>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 border-b border-gray-100 py-2 text-sm last:border-b-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value || '—'}</span>
    </div>
  )
}

export default function AddReturnFund({ onSuccess, buttonLabel = 'Add Return Fund', disabled = false, disabledReason = '' }) {
  const [isOpen, setIsOpen]                   = useState(false)
  const [step, setStep]                       = useState('form')
  const [formData, setFormData]               = useState({ ...emptyForm })
  const [snapshot, setSnapshot]               = useState(null)
  const [errors, setErrors]                   = useState({})
  const [serverError, setServerError]         = useState('')
  const [isSubmitting, setIsSubmitting]       = useState(false)
  const [disbursements, setDisbursements]     = useState([])
  const [activeSemesterLabel, setActiveSemesterLabel] = useState('')
  const [signatoriesError, setSignatoriesError] = useState('')
  const [confirmInput, setConfirmInput]       = useState('')
  const [isSuccessOpen, setIsSuccessOpen]     = useState(false)

  useEffect(() => {
    if (!isOpen) return

    listDisbursements()
      .then(data => setDisbursements(data.disbursements || []))
      .catch(() => setDisbursements([]))

    getActiveSemester()
      .then(data => {
        if (data.semester) {
          const L = { FIRST: '1st Semester', SECOND: '2nd Semester' }
          setActiveSemesterLabel(`${data.semester.schoolYear} — ${L[data.semester.semester] ?? data.semester.semester}`)
        }
      })
      .catch(() => {})

    getSignatories()
      .then(({ signatories }) => {
        setFormData(f => ({
          ...f,
          receivedBy:         signatories.senFinance?.name     ?? '',
          receivedByPosition: signatories.senFinance?.position ?? '',
          auditedBy:          signatories.senAudit?.name       ?? '',
          auditedByPosition:  signatories.senAudit?.position   ?? '',
          approvedBy:         signatories.president?.name      ?? '',
          approvedByPosition: signatories.president?.position  ?? '',
        }))
        setSignatoriesError('')
      })
      .catch(() => setSignatoriesError('Could not load officer signatories. Please refresh.'))
  }, [isOpen])

  function openModal() { setIsOpen(true) }

  function closeModal() {
    if (isSubmitting) return
    setIsOpen(false); setStep('form')
    setFormData({ ...emptyForm }); setErrors({}); setServerError('')
    setSignatoriesError(''); setSnapshot(null); setConfirmInput('')
  }

  function handleDisbursementSelect(e) {
    const id = Number(e.target.value)
    if (!id) {
      setFormData(f => ({ ...f, disbursementId: '', disbursementLabel: '', purposeOfFund: '', titleOfActivities: '', sourceOfFundName: '' }))
      return
    }
    const selected = disbursements.find(d => d.id === id)
    if (!selected) return
    setFormData(f => ({
      ...f,
      disbursementId:    id,
      disbursementLabel: `${selected.reference} — ${selected.titleOfActivities}`,
      purposeOfFund:     selected.purposeOfFund,
      titleOfActivities: selected.titleOfActivities,
      sourceOfFundName:  selected.fundCategory?.name ?? '',
    }))
    setErrors(err => ({ ...err, disbursementId: '' }))
  }

  function handleTextChange(e) {
    const { name, value } = e.target
    if (value === '' || TEXT_ONLY_REGEX.test(value)) {
      setFormData(f => ({ ...f, [name]: value }))
    }
    setErrors(err => ({ ...err, [name]: '' }))
  }

  function handleAmountChange(e) {
    const stripped = e.target.value.replace(/[^0-9.]/g, '')
    if ((parseFloat(stripped) || 0) > MAX_AMOUNT) return
    setFormData(f => ({ ...f, amount: formatPesoDisplay(e.target.value) }))
    setErrors(err => ({ ...err, amount: '' }))
  }

  function validateForm() {
    const nextErrors = {}
    const amountVal  = parseFloat(stripCurrencyFormatting(formData.amount)) || 0

    if (!formData.disbursementId) nextErrors.disbursementId = 'Please select a disbursement.'

    if (!formData.receivedFrom.trim()) nextErrors.receivedFrom = 'Received From is required.'
    else if (!TEXT_ONLY_REGEX.test(formData.receivedFrom.trim())) nextErrors.receivedFrom = 'Letters only — no numbers or special characters.'

    if (!formData.amount.trim()) nextErrors.amount = 'Amount is required.'
    else if (amountVal <= 0) nextErrors.amount = 'Amount must be greater than ₱0.00.'
    else if (amountVal > MAX_AMOUNT) nextErrors.amount = `Amount cannot exceed ₱${MAX_AMOUNT.toLocaleString('en-PH')}.`

    if (!formData.refundedBy.trim()) nextErrors.refundedBy = 'Refunded By is required.'
    else if (!TEXT_ONLY_REGEX.test(formData.refundedBy.trim())) nextErrors.refundedBy = 'Letters only — no numbers or special characters.'

    if (!formData.refundedByPosition.trim()) nextErrors.refundedByPosition = 'Position is required.'
    else if (!TEXT_ONLY_REGEX.test(formData.refundedByPosition.trim())) nextErrors.refundedByPosition = 'Letters only — no numbers or special characters.'

    if (!formData.receivedBy.trim()) nextErrors.receivedBy = 'Senator for Finance not found. Please assign an officer with that role.'
    if (!formData.auditedBy.trim()) nextErrors.auditedBy = 'Senator for Audit not found. Please assign an officer with that role.'
    if (!formData.approvedBy.trim()) nextErrors.approvedBy = 'President not found. Please assign an officer with that role.'

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function handleReviewSubmit(e) {
    e.preventDefault()
    if (!validateForm()) return
    setSnapshot({ ...formData })
    setConfirmInput('')
    setServerError('')
    setStep('confirm')
  }

  function handleGoBack() {
    setStep('form'); setConfirmInput(''); setServerError('')
  }

  async function handleConfirmSubmit() {
    if (confirmInput.trim() !== CONFIRM_KEYWORD || isSubmitting) return
    setIsSubmitting(true); setServerError('')
    try {
      await createReturnFund({
        disbursementId:     Number(snapshot.disbursementId),
        receivedFrom:       snapshot.receivedFrom,
        amount:             stripCurrencyFormatting(snapshot.amount),
        refundedBy:         snapshot.refundedBy,
        refundedByPosition: snapshot.refundedByPosition,
        receivedBy:         snapshot.receivedBy,
        receivedByPosition: snapshot.receivedByPosition,
        auditedBy:          snapshot.auditedBy,
        auditedByPosition:  snapshot.auditedByPosition,
        approvedBy:         snapshot.approvedBy,
        approvedByPosition: snapshot.approvedByPosition,
        confirmText: CONFIRM_KEYWORD
      })
      closeModal()
      setIsSuccessOpen(true)
      onSuccess?.()
    } catch (err) {
      setServerError(err.response?.data?.message || 'Failed to save return fund.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const confirmEnabled = confirmInput.trim() === CONFIRM_KEYWORD && !isSubmitting

  return (
    <>
      <button type="button" onClick={openModal}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        aria-disabled={disabled}
        className="btn btn--sm bg-(--primary) text-white hover:bg-(--primary-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--primary)">
        {buttonLabel}
      </button>
      {disabled && disabledReason && (
        <p className="mt-1 text-xs text-amber-700 sm:max-w-[220px]">{disabledReason}</p>
      )}

      {isOpen && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="flex max-h-[calc(100dvh-48px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="return-fund-title">

            {/* Header */}
            <div className="flex shrink-0 items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 id="return-fund-title" className="text-xl font-semibold text-gray-900">
                  {step === 'form' ? 'Add Return Fund' : 'Confirm Return Fund'}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {step === 'form'
                    ? 'Complete all details. You will review before submitting.'
                    : 'Review the summary carefully before confirming.'}
                </p>
              </div>
              <button type="button" onClick={closeModal} disabled={isSubmitting}
                className="rounded-md px-2 py-1 text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40"
                aria-label="Close modal">&times;</button>
            </div>

            {/* ── FORM STEP ─────────────────────────────────────────────── */}
            {step === 'form' && (
              <form onSubmit={handleReviewSubmit} className="min-h-0 overflow-y-auto space-y-4 px-6 py-5">
                {signatoriesError && <p className="text-sm text-red-600">{signatoriesError}</p>}

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="rf-disbursement">
                    Disbursement Reference
                  </label>
                  <select id="rf-disbursement" value={formData.disbursementId}
                    onChange={handleDisbursementSelect}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200">
                    <option value="">Select a disbursement</option>
                    {disbursements.map(d => (
                      <option key={d.id} value={d.id}>{d.reference} — {d.titleOfActivities}</option>
                    ))}
                  </select>
                  {errors.disbursementId && <p className="mt-1 text-sm text-red-600">{errors.disbursementId}</p>}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Purpose of Fund</label>
                    <input type="text" value={formData.purposeOfFund} readOnly
                      className="mt-1 w-full rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
                      placeholder="Auto-filled from disbursement" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Title of Activity</label>
                    <input type="text" value={formData.titleOfActivities} readOnly
                      className="mt-1 w-full rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
                      placeholder="Auto-filled from disbursement" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Source of Fund</label>
                  <input type="text" value={formData.sourceOfFundName} readOnly
                    className="mt-1 w-full rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
                    placeholder="Auto-filled from disbursement" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="rf-receivedFrom">Received from</label>
                  <input id="rf-receivedFrom" name="receivedFrom" type="text" value={formData.receivedFrom}
                    onChange={handleTextChange} maxLength={50}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                    placeholder="Enter name" />
                  {errors.receivedFrom && <p className="mt-1 text-sm text-red-600">{errors.receivedFrom}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="rf-amount">Amount Returned</label>
                  <input id="rf-amount" name="amount" type="text" value={formData.amount}
                    onChange={handleAmountChange}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                    placeholder="₱0.00" />
                  {errors.amount && <p className="mt-1 text-sm text-red-600">{errors.amount}</p>}
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <h3 className="text-sm font-semibold text-gray-900">Signatories</h3>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="rf-refundedBy">Refunded by</label>
                      <input id="rf-refundedBy" name="refundedBy" type="text" value={formData.refundedBy}
                        onChange={handleTextChange} maxLength={50}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                        placeholder="Enter name" />
                      {errors.refundedBy && <p className="mt-1 text-sm text-red-600">{errors.refundedBy}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="rf-refundedByPos">Position</label>
                      <input id="rf-refundedByPos" name="refundedByPosition" type="text" value={formData.refundedByPosition}
                        onChange={handleTextChange} maxLength={50}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                        placeholder="Enter position" />
                      {errors.refundedByPosition && <p className="mt-1 text-sm text-red-600">{errors.refundedByPosition}</p>}
                    </div>
                    <SignatoryReadOnly nameLabel="Received by" nameValue={formData.receivedBy} positionValue={formData.receivedByPosition} error={errors.receivedBy} />
                    <SignatoryReadOnly nameLabel="Audited by" nameValue={formData.auditedBy} positionValue={formData.auditedByPosition} error={errors.auditedBy} />
                    <SignatoryReadOnly nameLabel="Approved by" nameValue={formData.approvedBy} positionValue={formData.approvedByPosition} error={errors.approvedBy} />
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
                  <button type="button" onClick={closeModal}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button type="submit"
                    className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover)">
                    Review & Submit
                  </button>
                </div>
              </form>
            )}

            {/* ── CONFIRM STEP ──────────────────────────────────────────── */}
            {step === 'confirm' && snapshot && (
              <div className="min-h-0 overflow-y-auto space-y-4 px-6 py-5">
                {serverError && <p className="text-sm text-red-600">{serverError}</p>}

                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2">
                  <SummaryRow label="Disbursement" value={snapshot.disbursementLabel} />
                  <SummaryRow label="Description"  value={snapshot.purposeOfFund} />
                  <SummaryRow label="Amount"       value={formatCurrencyDisplay(snapshot.amount)} />
                  <SummaryRow label="Received from" value={snapshot.receivedFrom} />
                  <SummaryRow label="Semester"     value={activeSemesterLabel} />
                  <SummaryRow label="Date"         value={todayFormatted()} />
                </div>

                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  ⚠ This transaction cannot be edited or undone after confirmation.
                </p>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Type <span className="font-mono font-bold">{CONFIRM_KEYWORD}</span> to confirm:
                  </label>
                  <input type="text" value={confirmInput}
                    onChange={e => setConfirmInput(e.target.value)}
                    disabled={isSubmitting}
                    placeholder={CONFIRM_KEYWORD}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200 disabled:bg-gray-100"
                    autoFocus
                  />
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={handleGoBack} disabled={isSubmitting}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                    Go Back
                  </button>
                  <button type="button" onClick={handleConfirmSubmit} disabled={!confirmEnabled}
                    className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover) disabled:cursor-not-allowed disabled:opacity-50">
                    {isSubmitting ? 'Saving...' : 'Confirm Return Fund'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {createPortal(
      <SuccessDialog
        isOpen={isSuccessOpen}
        title="Return fund created"
        message="The return fund was recorded successfully."
        onClose={() => setIsSuccessOpen(false)}
      />,
      document.body
      )}
    </>
  )
}
