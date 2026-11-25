import { useState, useEffect, useCallback } from 'react'
import DashboardHeader from '../../../components/officers/DashboardHeader.jsx'
import AddDisbursement from './AddEditDisbursement.jsx'
import FinancialRecordsTable, { SearchIcon } from './FinancialRecordsTable.jsx'
import AmountSpentDialog from './AmountSpentDialog.jsx'
import { downloadDisbursementCertificate } from '../../../utils/downloadDisbursementCertificate.js'
import { mapDisbursementRow, disbursementColumns } from '../../../utils/financialRecordRows.js'
import { listDisbursements, listCategories } from '../../../services/financial.service'
import { useRole } from '../../../utils/useRole'
import { getSocket } from '../../../services/socket'
import LoadingState from '../../../components/ui/LoadingState.jsx'
import { EditIcon } from '../../../components/icons/ActionIcons.jsx'
import EditHistory from '../../../components/ui/EditHistory.jsx'
import { LIMITS } from '../../../utils/fieldLimits.js'

function recordMatchesSearch(record, searchTerm) {
  const q = searchTerm.trim().toLowerCase()
  if (!q) return true
  return [
    record.id, record.date, record.recipient, record.purpose,
    record.titleOfActivities, record.amount, record.amountSpent, record.sourceOfFund,
  ].some(v => String(v ?? '').toLowerCase().includes(q))
}

export default function Disbursement({ showHeader = true }) {
  const { canManageFinancials } = useRole()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [amountSpentRow, setAmountSpentRow] = useState(null)
  const [savedMessage, setSavedMessage] = useState('')
  // Disbursements are drawn from a finalized fund category, so the action
  // must stay disabled until at least one has been created for the active
  // semester — mirrors categoriesLocked from GET /financial/categories,
  // which is the same flag Fund Categories management uses to know a
  // semester's categories have been finalized.
  const [categoriesLocked, setCategoriesLocked] = useState(true)
  const [categoriesChecked, setCategoriesChecked] = useState(false)

  const filteredRecords = records.filter(r => recordMatchesSearch(r, searchTerm))

  const fetchCategoryStatus = useCallback(async () => {
    try {
      const data = await listCategories()
      setCategoriesLocked(Boolean(data.categoriesLocked))
    } catch {
      // If this fails we don't know the real state — default to blocking
      // disbursement rather than silently allowing an invalid one.
      setCategoriesLocked(false)
    } finally {
      setCategoriesChecked(true)
    }
  }, [])

  const fetchDisbursements = useCallback(async () => {
    try {
      setError('')
      const data = await listDisbursements()
      setRecords((data.disbursements || []).map(mapDisbursementRow))
    } catch {
      setError('Failed to load disbursements. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDisbursements() }, [fetchDisbursements])
  useEffect(() => { fetchCategoryStatus() }, [fetchCategoryStatus])

  // Real-time: new/archived disbursements (and returns, which affect the
  // remaining amount shown per record) appear live in the shared ledger view.
  // Fund categories being finalized/archived also flips whether Add
  // Disbursement is allowed, so it needs the same live refresh.
  useEffect(() => {
    const socket = getSocket()
    const handler = () => fetchDisbursements()
    const categoryHandler = () => fetchCategoryStatus()
    socket.on('disbursement:changed', handler)
    socket.on('returnFund:changed', handler)
    socket.on('fundCategory:changed', categoryHandler)
    return () => {
      socket.off('disbursement:changed', handler)
      socket.off('returnFund:changed', handler)
      socket.off('fundCategory:changed', categoryHandler)
    }
  }, [fetchDisbursements, fetchCategoryStatus])

  return (
    <>
      {showHeader && <DashboardHeader page="disbursement" />}
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Disbursement Records</h2>
            <p className="card__sub">Record list of all disbursement activity.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block w-full sm:w-64">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <SearchIcon />
              </span>
              <input type="search" maxLength={LIMITS.search} value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                placeholder="Search records" aria-label="Search disbursement records" />
            </label>
            {canManageFinancials && (
              <AddDisbursement
                onSuccess={fetchDisbursements}
                disabled={categoriesChecked && !categoriesLocked}
                disabledReason="Fund categories haven't been finalized for the active semester yet. Finalize categories in Fund Categories before recording a disbursement."
              />
            )}
          </div>
        </div>

        {canManageFinancials && categoriesChecked && !categoriesLocked && (
          <p className="px-4 pt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md mx-4 mt-3 py-2">
            No finalized fund categories yet for the active semester — disbursements are disabled until categories are set up.
          </p>
        )}

        {savedMessage && (
          <p className="mx-4 mt-3 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800" role="status">{savedMessage}</p>
        )}

        {loading && <LoadingState label="Loading disbursements…" />}
        {error && <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && (
          <FinancialRecordsTable
            columns={disbursementColumns}
            rows={filteredRecords}
            pageResetKey={searchTerm}
            emptyMessage="No disbursement records found."
            onDownload={downloadDisbursementCertificate}
            renderRowActions={(row) => (
              <>
                {row.details.canRecordAmountSpent && (
                  <button type="button" onClick={() => { setSavedMessage(''); setAmountSpentRow(row) }}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                    aria-label={`Update amount spent for ${row.id}`}
                    title="Update amount spent">
                    <EditIcon className="h-4 w-4" />
                  </button>
                )}
                <EditHistory type="disbursement" id={row.details._id} variant="button"
                  refreshKey={row.amountSpent} title={`Edit history · ${row.id}`} />
              </>
            )}
          />
        )}
      </div>

      {amountSpentRow && (
        <AmountSpentDialog
          row={amountSpentRow}
          onClose={() => setAmountSpentRow(null)}
          onSaved={(message) => {
            setAmountSpentRow(null)
            setSavedMessage(message)
            fetchDisbursements()
          }}
        />
      )}
    </>
  )
}
