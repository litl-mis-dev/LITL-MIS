import { useState, useEffect, useCallback } from 'react'
import DashboardHeader from '../../../components/officers/DashboardHeader.jsx'
import AddReturnFund from './AddEditReturnFund.jsx'
import FinancialRecordsTable, { SearchIcon } from './FinancialRecordsTable.jsx'
import { downloadReturnFundCertificate } from '../../../utils/downloadReturnFundCertificate.js'
import { listReturnFunds, listDisbursements } from '../../../services/financial.service'
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

function mapApiToRow(rf) {
  return {
    id:               rf.reference,
    date:             formatDate(rf.createdAt),
    returnedBy:       rf.receivedFrom,
    reason:           rf.disbursement?.purposeOfFund ?? '',
    titleOfActivities: rf.disbursement?.titleOfActivities ?? '',
    amount:           formatCurrency(rf.amount),
    sourceOfFund:     rf.disbursement?.fundCategory?.name ?? '',
    details: {
      _id:            rf.id,
      disbursementId: rf.disbursementId,
      receivedFrom:   rf.receivedFrom,
      amount:         formatCurrency(rf.amount),
      purposeOfFund:  rf.disbursement?.purposeOfFund ?? '',
      titleOfActivities: rf.disbursement?.titleOfActivities ?? '',
      sourceOfFundName: rf.disbursement?.fundCategory?.name ?? '',
      refundedBy:     rf.refundedBy,
      refundedByPosition: rf.refundedByPosition,
      receivedBy:     rf.receivedBy,
      receivedByPosition: rf.receivedByPosition,
      auditedBy:      rf.auditedBy,
      auditedByPosition: rf.auditedByPosition,
      approvedBy:     rf.approvedBy,
      approvedByPosition: rf.approvedByPosition,
    },
  }
}

function recordMatchesSearch(record, searchTerm) {
  const q = searchTerm.trim().toLowerCase()
  if (!q) return true
  return [
    record.id, record.date, record.returnedBy, record.reason,
    record.titleOfActivities, record.amount, record.sourceOfFund,
  ].some(v => String(v ?? '').toLowerCase().includes(q))
}

const columns = [
  { key: 'id',               label: 'Reference'           },
  { key: 'date',             label: 'Date'                },
  { key: 'returnedBy',       label: 'Returned By'         },
  { key: 'reason',           label: 'Purpose of Fund'     },
  { key: 'titleOfActivities', label: 'Title of Activities' },
  { key: 'amount',           label: 'Amount'              },
  { key: 'sourceOfFund',     label: 'Source of Fund'      },
  { key: 'actions',          label: 'Action'              },
]

export default function Returning({ showHeader = true }) {
  const { canManageFinancials } = useRole()
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  // A return can only be recorded against an existing disbursement, which
  // itself requires a finalized fund category — so this transitively carries
  // the same "no finalized category yet" dependency Disbursement has. Made
  // explicit here rather than left as a silently empty dropdown.
  const [hasDisbursements, setHasDisbursements] = useState(true)
  const [disbursementsChecked, setDisbursementsChecked] = useState(false)

  const filteredRecords = records.filter(r => recordMatchesSearch(r, searchTerm))

  const fetchDisbursementAvailability = useCallback(async () => {
    try {
      const data = await listDisbursements()
      setHasDisbursements((data.disbursements || []).length > 0)
    } catch {
      setHasDisbursements(false)
    } finally {
      setDisbursementsChecked(true)
    }
  }, [])

  const fetchReturnFunds = useCallback(async () => {
    try {
      setError('')
      const data = await listReturnFunds()
      setRecords((data.returnFunds || []).map(mapApiToRow))
    } catch {
      setError('Failed to load return fund records. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchReturnFunds() }, [fetchReturnFunds])
  useEffect(() => { fetchDisbursementAvailability() }, [fetchDisbursementAvailability])

  // Real-time: new/archived returned-fund records appear live in the
  // shared financial view. Disbursements (and the fund categories they
  // depend on) can also change availability of this action live.
  useEffect(() => {
    const socket = getSocket()
    const handler = () => fetchReturnFunds()
    const availabilityHandler = () => fetchDisbursementAvailability()
    socket.on('returnFund:changed', handler)
    socket.on('disbursement:changed', availabilityHandler)
    socket.on('fundCategory:changed', availabilityHandler)
    return () => {
      socket.off('returnFund:changed', handler)
      socket.off('disbursement:changed', availabilityHandler)
      socket.off('fundCategory:changed', availabilityHandler)
    }
  }, [fetchReturnFunds, fetchDisbursementAvailability])

  return (
    <>
      {showHeader && <DashboardHeader page="returning" />}
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Return Fund Records</h2>
            <p className="card__sub">Record list of all returning fund activity.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block w-full sm:w-64">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <SearchIcon />
              </span>
              <input type="search" value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                placeholder="Search records" aria-label="Search return fund records" />
            </label>
            {canManageFinancials && (
              <AddReturnFund
                onSuccess={fetchReturnFunds}
                disabled={disbursementsChecked && !hasDisbursements}
                disabledReason="No disbursement records available yet to return funds from. Record a disbursement first (which requires a finalized fund category)."
              />
            )}
          </div>
        </div>

        {canManageFinancials && disbursementsChecked && !hasDisbursements && (
          <p className="px-4 pt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md mx-4 mt-3 py-2">
            No disbursement records yet — returning funds is disabled until at least one disbursement has been recorded.
          </p>
        )}

        {loading && <p className="px-4 py-8 text-center text-sm text-gray-500">Loading return funds...</p>}
        {error   && <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && (
          <FinancialRecordsTable
            columns={columns}
            rows={filteredRecords}
            emptyMessage="No return fund records found."
            onDownload={downloadReturnFundCertificate}
          />
        )}
      </div>
    </>
  )
}
