import { useState, useEffect, useCallback } from 'react'
import DashboardHeader from '../../../components/officers/DashboardHeader.jsx'
import AddDisbursement from './AddEditDisbursement.jsx'
import FinancialRecordsTable, { SearchIcon } from './FinancialRecordsTable.jsx'
import { downloadDisbursementCertificate } from '../../../utils/downloadDisbursementCertificate.js'
import { listDisbursements, listCategories } from '../../../services/financial.service'
import { useRole } from '../../../utils/useRole'
import { getSocket } from '../../../services/socket'

function formatCurrency(value) {
  const n = parseFloat(value) || 0
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(isoString) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .format(new Date(isoString))
}

function mapApiToRow(d) {
  return {
    id: d.reference,
    date: formatDate(d.createdAt),
    recipient: d.name,
    purpose: d.purposeOfFund,
    titleOfActivities: d.titleOfActivities,
    amount: formatCurrency(d.amount),
    sourceOfFund: d.fundCategory?.name ?? '',
    details: {
      _id: d.id,
      name: d.name,
      amount: formatCurrency(d.amount),
      purposeOfFund: d.purposeOfFund,
      titleOfActivities: d.titleOfActivities,
      sourceOfFundName: d.fundCategory?.name ?? '',
      fundCategoryId: d.fundCategory?.id ?? '',
      disbursedBy: d.disbursedBy,
      disbursedByPosition: d.disbursedByPosition,
      approvedBy: d.approvedBy,
      approvedByPosition: d.approvedByPosition,
      receivedBy: d.receivedBy,
      receivedByPosition: d.receivedByPosition,
    },
  }
}

function recordMatchesSearch(record, searchTerm) {
  const q = searchTerm.trim().toLowerCase()
  if (!q) return true
  return [
    record.id, record.date, record.recipient, record.purpose,
    record.titleOfActivities, record.amount, record.sourceOfFund,
  ].some(v => String(v ?? '').toLowerCase().includes(q))
}

const columns = [
  { key: 'id', label: 'Reference' },
  { key: 'date', label: 'Date' },
  { key: 'recipient', label: 'Recipient' },
  { key: 'purpose', label: 'Purpose of Fund' },
  { key: 'titleOfActivities', label: 'Title of Activities' },
  { key: 'amount', label: 'Amount' },
  { key: 'sourceOfFund', label: 'Source of Fund' },
  { key: 'actions', label: 'Action' },
]

export default function Disbursement({ showHeader = true }) {
  const { canManageFinancials } = useRole()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
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
      setRecords((data.disbursements || []).map(mapApiToRow))
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
              <input type="search" value={searchTerm}
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

        {loading && <p className="px-4 py-8 text-center text-sm text-gray-500">Loading disbursements...</p>}
        {error && <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && (
          <FinancialRecordsTable
            columns={columns}
            rows={filteredRecords}
            emptyMessage="No disbursement records found."
            onDownload={downloadDisbursementCertificate}
          />
        )}
      </div>
    </>
  )
}
