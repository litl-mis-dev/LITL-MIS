import { useState, useEffect } from 'react'
import SuccessDialog from '../../../components/officers/SuccessDialog'
import { listCategories, createDisbursement } from '../../../services/financial.service'
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
  name: '', amount: '', purposeOfFund: '', titleOfActivities: '', fundCategoryId: '',
  disbursedBy: '', disbursedByPosition: '', approvedBy: '', approvedByPosition: '',
  receivedBy: '', receivedByPosition: '',
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

export default function AddDisbursement({ onSuccess, buttonLabel = 'Add Disbursement', disabled = false, disabledReason = '' }) {
  const [isOpen, setIsOpen]                   = useState(false)
  const [step, setStep]                       = useState('form') // 'form' | 'confirm'
  const [formData, setFormData]               = useState({ ...emptyForm })
  const [snapshot, setSnapshot]               = useState(null)
  const [errors, setErrors]                   = useState({})
  const [serverError, setServerError]         = useState('')
  const [isSubmitting, setIsSubmitting]       = useState(false)
  const [categories, setCategories]           = useState([])
  const [activeSemesterLabel, setActiveSemesterLabel] = useState('')
  const [signatoriesError, setSignatoriesError] = useState('')
  const [confirmInput, setConfirmInput]       = useState('')
  const [isSuccessOpen, setIsSuccessOpen]     = useState(false)

  useEffect(() => {
    if (!isOpen) return

    listCategories()
      .then(data => {
        setCategories([
          ...(data.categories || []),
          ...(data.turnoverCategory ? [data.turnoverCategory] : [])
        ])
        if (data.semester) {
          const L = { FIRST: '1st Semester', SECOND: '2nd Semester' }
          setActiveSemesterLabel(`${data.semester.schoolYear} — ${L[data.semester.semester] ?? data.semester.semester}`)
        }
      })
      .catch(() => setCategories([]))

    getSignatories()
      .then(({ signatories }) => {
        setFormData(f => ({
          ...f,
          disbursedBy:         signatories.senFinance?.name     ?? '',
          disbursedByPosition: signatories.senFinance?.position ?? '',
          approvedBy:          signatories.president?.name      ?? '',
          approvedByPosition:  signatories.president?.position  ?? '',
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

  function handleTextChange(e) {
    const { name, value } = e.target
    if (name === 'titleOfActivities' || value === '' || TEXT_ONLY_REGEX.test(value)) {
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

  function handleSelectChange(e) {
    const { name, value } = e.target
    setFormData(f => ({ ...f, [name]: value }))
    setErrors(err => ({ ...err, [name]: '' }))
  }

  function validateForm() {
    const nextErrors = {}
    const amountVal = parseFloat(stripCurrencyFormatting(formData.amount)) || 0

    if (!formData.name.trim()) nextErrors.name = 'Name is required.'
    else if (!TEXT_ONLY_REGEX.test(formData.name.trim())) nextErrors.name = 'Letters only — no numbers or special characters.'
    else if (formData.name.trim().length < 2) nextErrors.name = 'Must be at least 2 characters.'

    if (!formData.amount.trim()) nextErrors.amount = 'Amount is required.'
    else if (amountVal <= 0) nextErrors.amount = 'Amount must be greater than ₱0.00.'
    else if (amountVal > MAX_AMOUNT) nextErrors.amount = `Amount cannot exceed ₱${MAX_AMOUNT.toLocaleString('en-PH')}.`

    if (!formData.purposeOfFund.trim()) nextErrors.purposeOfFund = 'Purpose of fund is required.'
    else if (!TEXT_ONLY_REGEX.test(formData.purposeOfFund.trim())) nextErrors.purposeOfFund = 'Letters only — no numbers or special characters.'
    else if (formData.purposeOfFund.trim().length < 5) nextErrors.purposeOfFund = 'Must be at least 5 characters.'

    if (!formData.titleOfActivities.trim()) nextErrors.titleOfActivities = 'Title of activity is required.'
    else if (formData.titleOfActivities.trim().length < 2) nextErrors.titleOfActivities = 'Must be at least 2 characters.'

    if (!formData.fundCategoryId) nextErrors.fundCategoryId = 'Please select a source of fund.'

    if (!formData.disbursedBy.trim()) nextErrors.disbursedBy = 'Senator for Finance not found. Please assign an officer with that role.'
    if (!formData.approvedBy.trim()) nextErrors.approvedBy = 'President not found. Please assign an officer with that role.'

    if (!formData.receivedBy.trim()) nextErrors.receivedBy = 'Received By is required.'
    else if (!TEXT_ONLY_REGEX.test(formData.receivedBy.trim())) nextErrors.receivedBy = 'Letters only — no numbers or special characters.'

    if (!formData.receivedByPosition.trim()) nextErrors.receivedByPosition = 'Position is required.'
    else if (!TEXT_ONLY_REGEX.test(formData.receivedByPosition.trim())) nextErrors.receivedByPosition = 'Letters only — no numbers or special characters.'

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
      await createDisbursement({
        name: snapshot.name,
        amount: stripCurrencyFormatting(snapshot.amount),
        purposeOfFund: snapshot.purposeOfFund,
        titleOfActivities: snapshot.titleOfActivities,
        fundCategoryId: Number(snapshot.fundCategoryId),
        disbursedBy: snapshot.disbursedBy,
        disbursedByPosition: snapshot.disbursedByPosition,
        approvedBy: snapshot.approvedBy,
        approvedByPosition: snapshot.approvedByPosition,
        receivedBy: snapshot.receivedBy,
        receivedByPosition: snapshot.receivedByPosition,
        confirmText: CONFIRM_KEYWORD
      })
      closeModal()
      setIsSuccessOpen(true)
      onSuccess?.()
    } catch (err) {
      setServerError(err.response?.data?.message || 'Failed to save disbursement.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedCategory = categories.find(c => String(c.id) === String(snapshot?.fundCategoryId))
  const confirmEnabled   = confirmInput.trim() === CONFIRM_KEYWORD && !isSubmitting

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

      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="max-h-[calc(100vh-108px)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl">

            {/* Header */}
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {step === 'form' ? 'Add Disbursement' : 'Confirm Disbursement'}
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
              <form onSubmit={handleReviewSubmit} className="space-y-4 px-6 py-5">
                {signatoriesError && <p className="text-sm text-red-600">{signatoriesError}</p>}

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="dis-name">Name</label>
                  <input id="dis-name" name="name" type="text" value={formData.name}
                    onChange={handleTextChange} maxLength={50}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                    placeholder="Enter recipient name" />
                  {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="dis-category">Source of Fund</label>
                  <select id="dis-category" name="fundCategoryId" value={formData.fundCategoryId}
                    onChange={handleSelectChange}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200">
                    <option value="">Select source</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.isTurnoverFund ? '↻ ' : ''}{cat.name} — Available: ₱{Number(cat.availableFund).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </option>
                    ))}
                  </select>
                  {errors.fundCategoryId && <p className="mt-1 text-sm text-red-600">{errors.fundCategoryId}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="dis-amount">Amount</label>
                  <input id="dis-amount" name="amount" type="text" value={formData.amount}
                    onChange={handleAmountChange}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                    placeholder="₱0.00" />
                  {errors.amount && <p className="mt-1 text-sm text-red-600">{errors.amount}</p>}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700" htmlFor="dis-purpose">Purpose of Fund</label>
                    <input id="dis-purpose" name="purposeOfFund" type="text" value={formData.purposeOfFund}
                      onChange={handleTextChange} maxLength={50}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                      placeholder="Enter purpose" />
                    {errors.purposeOfFund && <p className="mt-1 text-sm text-red-600">{errors.purposeOfFund}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700" htmlFor="dis-title">Title of Activity</label>
                    <input id="dis-title" name="titleOfActivities" type="text" value={formData.titleOfActivities}
                      onChange={handleTextChange} maxLength={50}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                      placeholder="Enter activity" />
                    {errors.titleOfActivities && <p className="mt-1 text-sm text-red-600">{errors.titleOfActivities}</p>}
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <h3 className="text-sm font-semibold text-gray-900">Signatories</h3>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <SignatoryReadOnly nameLabel="Disbursed by" nameValue={formData.disbursedBy} positionValue={formData.disbursedByPosition} error={errors.disbursedBy} />
                    <SignatoryReadOnly nameLabel="Approved by" nameValue={formData.approvedBy} positionValue={formData.approvedByPosition} error={errors.approvedBy} />
                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="dis-receivedBy">Received by</label>
                      <input id="dis-receivedBy" name="receivedBy" type="text" value={formData.receivedBy}
                        onChange={handleTextChange} maxLength={50}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                        placeholder="Enter receiver name" />
                      {errors.receivedBy && <p className="mt-1 text-sm text-red-600">{errors.receivedBy}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700" htmlFor="dis-receivedByPos">Received by Position</label>
                      <input id="dis-receivedByPos" name="receivedByPosition" type="text" value={formData.receivedByPosition}
                        onChange={handleTextChange} maxLength={50}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                        placeholder="Enter receiver position" />
                      {errors.receivedByPosition && <p className="mt-1 text-sm text-red-600">{errors.receivedByPosition}</p>}
                    </div>
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
              <div className="space-y-4 px-6 py-5">
                {serverError && <p className="text-sm text-red-600">{serverError}</p>}

                {/* Transaction summary */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2">
                  <SummaryRow label="Category"    value={selectedCategory?.name} />
                  <SummaryRow label="Description" value={`${snapshot.purposeOfFund} — ${snapshot.titleOfActivities}`} />
                  <SummaryRow label="Recipient"   value={snapshot.name} />
                  <SummaryRow label="Amount"      value={formatCurrencyDisplay(snapshot.amount)} />
                  <SummaryRow label="Semester"    value={activeSemesterLabel} />
                  <SummaryRow label="Date"        value={todayFormatted()} />
                </div>

                {/* Immutability warning */}
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  ⚠ This transaction cannot be edited or undone after confirmation.
                </p>

                {/* Type-to-confirm */}
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
                    {isSubmitting ? 'Saving...' : 'Confirm Disbursement'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <SuccessDialog
        isOpen={isSuccessOpen}
        title="Disbursement created"
        message="The disbursement was recorded successfully."
        onClose={() => setIsSuccessOpen(false)}
      />
    </>
  )
}
