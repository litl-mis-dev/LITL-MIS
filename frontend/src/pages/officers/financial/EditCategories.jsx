import { useState, useEffect } from 'react'
import ConfirmActionButton from '../../../components/officers/ConfirmActionButton'
import SuccessDialog from '../../../components/officers/SuccessDialog'
import { listCategories, createCategoriesBatch } from '../../../services/financial.service'
const initialFormData = { categories: '', percentage: '' }
const CATEGORY_REGEX = /^[A-Za-z\s]+$/

function parsePercentage(value) {
  const p = parseFloat(String(value).replace('%', ''))
  return isFinite(p) ? p : 0
}

function onlyNumbers(value) { return value.replace(/\D/g, '') }

export default function EditCategories({ onSuccess, buttonLabel = 'Add Category' }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingExisting, setIsLoadingExisting] = useState(false)

  const [formData, setFormData] = useState(initialFormData)
  const [topFormError, setTopFormError] = useState('')

  // Unified list — both pre-filled existing categories AND newly added ones.
  // dbId is null for new rows, the real database id for pre-filled ones.
  const [categories, setCategories] = useState([])
  const [originalSnapshot, setOriginalSnapshot] = useState([])

  const [formLevelError, setFormLevelError] = useState('')
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isSuccessOpen, setIsSuccessOpen] = useState(false)
  const [pendingCategories, setPendingCategories] = useState([])
  const [serverError, setServerError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const savedTotal = categories.reduce((t, c) => t + parsePercentage(c.percentage), 0)
  const currentPct = parsePercentage(formData.percentage)
  const isExceeded = formData.percentage.trim() && savedTotal + currentPct > 100

  const [isSecondSemester, setIsSecondSemester] = useState(false)

  useEffect(() => {
    listCategories()
      .then(data => {
        setIsSecondSemester(data.semester?.semester === 'SECOND')
      })
      .catch(() => {})
  }, [])

  async function openModal() {
    setIsOpen(true)
    setIsLoadingExisting(true)
    setFormLevelError('')
    try {
      const data = await listCategories()
      const existing = (data.categories || [])
        .filter(cat => !cat.isTurnoverFund) // system-managed, not editable here
        .map(cat => ({
          uid: crypto.randomUUID(),
          dbId: cat.id,
          categories: cat.name,
          percentage: String(parseFloat(cat.percentage))
        }))
      setCategories(existing)
      setOriginalSnapshot(existing.map(c => ({ ...c })))
    } catch {
      setFormLevelError('Failed to load existing categories. You can still add new ones below.')
      setCategories([])
      setOriginalSnapshot([])
    } finally {
      setIsLoadingExisting(false)
    }
  }

  function closeModal() {
    setIsOpen(false); setIsConfirmOpen(false)
    setPendingCategories([]); setTopFormError(''); setFormLevelError('')
    setFormData(initialFormData); setCategories([]); setOriginalSnapshot([])
    setServerError('')
    setConfirmText('')
  }

  function handleTopFormChange(e) {
    const { name, value } = e.target

    if (name === 'percentage') {
      setFormData(f => ({ ...f, percentage: onlyNumbers(value) }))
      setTopFormError('')
      return
    }

    if (value === '' || CATEGORY_REGEX.test(value)) {
      setFormData(f => ({ ...f, [name]: value }))
      setTopFormError('')
    }
  }

  function validateTopForm() {
    if (!formData.categories.trim()) { setTopFormError('Category name is required.'); return false }
    if (!formData.percentage.trim()) { setTopFormError('Percentage is required.'); return false }
    if (currentPct <= 0) { setTopFormError('Percentage must be greater than 0%.'); return false }
    if (isExceeded) { setTopFormError('Total percentage cannot exceed 100%.'); return false }
    return true
  }

  function handleAddCategory() {
    if (!validateTopForm()) return
    setCategories(cats => [...cats, {
      uid: crypto.randomUUID(),
      dbId: null,
      categories: formData.categories.trim(),
      percentage: String(currentPct),
    }])
    setFormData(initialFormData)
    setTopFormError('')
  }

  function handleDeleteCategory(uid) {
    setCategories(cats => cats.filter(c => c.uid !== uid))
  }

  function handleRowChange(uid, field, value) {
    if (field === 'percentage') {
      setCategories(cats =>
        cats.map(c =>
          c.uid === uid
            ? { ...c, percentage: onlyNumbers(value) }
            : c
        )
      )
      return
    }

    if (value === '' || CATEGORY_REGEX.test(value)) {
      setCategories(cats =>
        cats.map(c =>
          c.uid === uid
            ? { ...c, categories: value }
            : c
        )
      )
    }
  }

  function validateAllRows(rows) {
    if (rows.length === 0) {
      setFormLevelError('Please add at least one category.')
      return false
    }
    for (const r of rows) {
      if (!r.categories.trim()) {
        setFormLevelError('Every category needs a name.')
        return false
      }
      const pct = parsePercentage(r.percentage)
      if (!r.percentage || pct <= 0) {
        setFormLevelError(`"${r.categories || 'Untitled'}" needs a percentage greater than 0%.`)
        return false
      }
    }
    const total = rows.reduce((sum, r) => sum + parsePercentage(r.percentage), 0)
    if (total > 100) {
      setFormLevelError(`Total percentage is ${total}%, which exceeds 100%. Please adjust before saving.`)
      return false
    }
    setFormLevelError('')
    return true
  }

  function prepareSubmit() {
    setFormLevelError('')
    const hasPendingTopInput = formData.categories.trim() || formData.percentage.trim()
    let finalRows = categories

    if (hasPendingTopInput) {
      if (!validateTopForm()) return false
      finalRows = [...categories, {
        uid: crypto.randomUUID(),
        dbId: null,
        categories: formData.categories.trim(),
        percentage: String(currentPct),
      }]
    }

    if (!validateAllRows(finalRows)) return false

    setPendingCategories(finalRows)
    return true
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (prepareSubmit()) setIsConfirmOpen(true)
  }

  async function handleConfirmSubmit() {
    setIsSubmitting(true)
    setServerError('')
    try {
      const finalRows = pendingCategories

      const toCreate = finalRows.filter(r => !r.dbId)
      
      const keptIds = new Set(finalRows.filter(r => r.dbId).map(r => r.dbId))
      const toArchiveIds = originalSnapshot
        .filter(o => !keptIds.has(o.dbId))
        .map(o => o.dbId)

      if (toCreate.length > 0) {
        await createCategoriesBatch(
          toCreate.map(r => ({ name: r.categories, percentage: parsePercentage(r.percentage) })),
          confirmText
        )
      }
      
      for (const id of toArchiveIds) {
        await archiveCategory(id)
      }

      closeModal()
      setIsSuccessOpen(true)
    } catch (err) {
      setServerError(err.response?.data?.message || 'Failed to save categories.')
      setIsConfirmOpen(false)
    } finally {
      setIsSubmitting(false)
      // Always refresh the parent, even on partial failure, so the list
      // reflects whatever DID succeed rather than showing stale data.
      onSuccess?.()
    }
  }

  function handleCancelSubmit() { setIsConfirmOpen(false); setPendingCategories([]) }

  const hasExisting = originalSnapshot.length > 0
  const modalTitle = hasExisting ? 'Edit Categories' : 'Add Categories'

  return (
    <>
    {!isSecondSemester && (
      <button type="button" onClick={openModal}
        className="btn btn--sm bg-(--primary) text-white hover:bg-(--primary-hover)">
        {buttonLabel}
      </button>)}

      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-3 py-4 sm:px-4 sm:py-6">
          <div className="max-h-[calc(100vh-92px)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl sm:max-h-[calc(100vh-108px)]">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-4 sm:px-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">{modalTitle}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {hasExisting
                    ? 'Edit names and percentages directly, remove categories with ×, or add new ones below.'
                    : 'Complete the details before submitting.'}
                </p>
              </div>
              <button type="button" onClick={closeModal}
                className="rounded-md px-2 py-1 text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                aria-label="Close modal">&times;</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-4 py-5 sm:px-6">
              {serverError && <p className="text-sm text-red-600">{serverError}</p>}
              {formLevelError && <p className="text-sm text-red-600">{formLevelError}</p>}
              {isLoadingExisting && <p className="text-sm text-gray-500">Loading existing categories...</p>}

              {/* Add new row */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="categories">New Category</label>
                  <input id="categories" name="categories" type="text" value={formData.categories}
                    onChange={handleTopFormChange} maxLength={50}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                    placeholder="Enter category name" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="percentage">Percentage</label>
                  <div className="mt-1 grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                    <input id="percentage" name="percentage" type="text" inputMode="numeric"
                      value={formData.percentage} onChange={handleTopFormChange} maxLength={3}
                      className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${isExceeded ? 'border-red-500 bg-red-50 text-red-700 focus:border-red-500 focus:ring-red-200' : 'border-gray-300 focus:border-orange-500 focus:ring-orange-200'}`}
                      placeholder="Enter percentage" />
                    <button type="button" onClick={handleAddCategory}
                      className="group flex h-10 w-11 items-center justify-center rounded-md border-2 border-(--primary) hover:bg-(--primary) focus:outline-none focus:ring-2 focus:ring-orange-200"
                      aria-label="Add category">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"
                        className="h-6 w-6 text-black group-hover:text-white transition-colors duration-100" fill="currentColor">
                        <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              {topFormError && <p className="text-sm text-red-600 -mt-2">{topFormError}</p>}

              {/* Unified, inline-editable list — existing + new together */}
              {categories.length > 0 && (
                <div className="overflow-hidden rounded-md border border-gray-200">
                  <div className="grid grid-cols-[minmax(0,1fr)_120px_52px] items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
                    <span>Category</span>
                    <span>Percentage</span>
                    <span className="text-center">Action</span>
                  </div>
                  {categories.map(cat => (
                    <div key={cat.uid} className="grid grid-cols-[minmax(0,1fr)_120px_52px] items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm text-gray-700 last:border-b-0">
                      <input
                        type="text"
                        value={cat.categories}
                        maxLength={50}
                        onChange={(e) => handleRowChange(cat.uid, 'categories', e.target.value)}
                        className="w-full rounded border border-gray-200 px-2 py-1 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-200"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={cat.percentage}
                          maxLength={3}
                          onChange={(e) => handleRowChange(cat.uid, 'percentage', e.target.value)}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm text-right outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-200"
                        />
                        <span className="text-gray-400">%</span>
                      </div>
                      <button type="button" onClick={() => handleDeleteCategory(cat.uid)}
                        className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-lg font-semibold leading-none text-red-600 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-200"
                        aria-label={`Remove ${cat.categories}`}>&times;</button>
                    </div>
                  ))}
                  <div className="grid grid-cols-[minmax(0,1fr)_120px_52px] gap-2 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800">
                    <span>Total</span>
                    <span className="text-right">{savedTotal}%</span>
                    <span />
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Type <span className="font-mono font-bold">CONFIRM</span> to save:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="CONFIRM"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeModal}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancel  
                </button>
                
                <ConfirmActionButton
                  className="rounded-md bg-(--primary) px-4 py-2 text-sm font-medium text-white hover:bg-(--primary-hover)"
                  isOpen={isConfirmOpen}
                  title="Save category changes?"
                  message="Are you sure you want to save these fund category changes?"
                  confirmLabel={isSubmitting ? 'Saving...' : 'Save'}
                  cancelLabel="Cancel"
                  onOpenChange={setIsConfirmOpen}
                  onCancel={handleCancelSubmit}
                  beforeOpen={prepareSubmit}
                  onConfirm={handleConfirmSubmit}

                  beforeOpen={() => {
                    if (confirmText.trim() !== 'CONFIRM') {
                      setFormLevelError('You must type CONFIRM to save categories.')
                      return false
                    }
                    return prepareSubmit()
                  }}
                >
                  Save Categories
                </ConfirmActionButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <SuccessDialog
        isOpen={isSuccessOpen}
        title="Categories saved"
        message="The category changes were saved successfully."
        onClose={() => setIsSuccessOpen(false)}
      />
    </>
  )
}
