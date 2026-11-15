import { useState } from 'react'
import ModalPortal from '../../../components/ui/ModalPortal.jsx'
import RequiredMark from '../../../components/ui/RequiredMark.jsx'
import { recordAmountSpent } from '../../../services/financial.service'

const CONFIRM_KEYWORD = 'CONFIRM'

function formatCurrency(value) {
  const n = Number(value) || 0
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Records how much of a disbursement was actually spent. The disbursement
// keeps its released amount; its Return Fund becomes released − spent. The
// amount spent can only go down, like the server enforces.
export default function AmountSpentDialog({ row, onClose, onSaved }) {
  const { released, amountSpentValue: currentSpent } = row.details
  const [amount, setAmount] = useState('')
  const [confirmInput, setConfirmInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [serverError, setServerError] = useState('')

  const typed = amount.trim() === '' ? null : Number(amount)
  const amountError =
    typed === null ? ''
      : !Number.isFinite(typed) || typed < 0 ? 'Enter an amount of ₱0.00 or more.'
        : !/^\d+(\.\d{1,2})?$/.test(amount.trim()) ? 'Use at most 2 decimal places.'
          : typed >= currentSpent ? `Must be lower than the current ${formatCurrency(currentSpent)}. It can only go down.`
            : ''
  const valid = typed !== null && !amountError
  const newReturn = valid ? released - typed : null
  const canSave = valid && confirmInput.trim() === CONFIRM_KEYWORD && !isSaving

  async function handleSave(e) {
    e.preventDefault()
    if (!canSave) return
    setIsSaving(true)
    setServerError('')
    try {
      const result = await recordAmountSpent(row.details._id, amount.trim(), CONFIRM_KEYWORD)
      onSaved?.(result.message)
    } catch (err) {
      setServerError(err.response?.data?.message || 'Could not record the amount spent. Please try again.')
      setIsSaving(false)
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/50 px-4 py-6">
        <form onSubmit={handleSave} role="dialog" aria-modal="true" aria-labelledby="amount-spent-title"
          className="max-h-[calc(100vh-108px)] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
            <div>
              <h2 id="amount-spent-title" className="text-xl font-semibold text-gray-900">Update Amount Spent</h2>
              <p className="mt-1 text-sm text-gray-500">{row.id} · {row.titleOfActivities}</p>
            </div>
            <button type="button" onClick={onClose} disabled={isSaving}
              className="rounded-md px-2 py-1 text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40"
              aria-label="Close">&times;</button>
          </div>

          <div className="space-y-4 px-6 py-5">
            <dl className="rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm">
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-gray-500">Released</dt>
                <dd className="font-medium text-gray-900">{formatCurrency(released)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-gray-500">Current amount spent</dt>
                <dd className="font-medium text-gray-900">{formatCurrency(currentSpent)}</dd>
              </div>
            </dl>

            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="amount-spent">New amount spent<RequiredMark /></label>
              <input id="amount-spent" type="text" inputMode="decimal" value={amount} autoFocus
                onChange={e => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setServerError('') }}
                aria-invalid={Boolean(amountError)} aria-describedby="amount-spent-help"
                className={`mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${amountError ? 'border-red-500 focus:ring-red-200' : 'border-gray-300 focus:border-orange-500 focus:ring-orange-200'}`}
                placeholder="0.00" disabled={isSaving} />
              <p id="amount-spent-help" className={`mt-1 text-sm ${amountError ? 'text-red-600' : 'text-gray-600'}`} aria-live="polite">
                {amountError || (newReturn !== null
                  ? <>Return Fund becomes <strong>{formatCurrency(newReturn)}</strong>, recorded automatically.</>
                  : 'The difference from the released amount is returned to the fund.')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="amount-spent-confirm">
                Type <span className="font-mono font-semibold">{CONFIRM_KEYWORD}</span> to record it<RequiredMark />
              </label>
              <input id="amount-spent-confirm" type="text" value={confirmInput} autoComplete="off"
                onChange={e => setConfirmInput(e.target.value)} disabled={isSaving}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200" />
            </div>

            {serverError && <p className="text-sm font-medium text-red-600" role="alert">{serverError}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
            <button type="button" onClick={onClose} disabled={isSaving}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={!canSave} aria-busy={isSaving}
              className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover) disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving ? 'Recording…' : 'Record Amount Spent'}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  )
}
