import { useState, useEffect, useCallback } from 'react'
import DashboardHeader from '../../../components/officers/DashboardHeader.jsx'
import FinancialRecordsTable, { SearchIcon } from './FinancialRecordsTable.jsx'
import { downloadReturnFundCertificate } from '../../../utils/downloadReturnFundCertificate.js'
import { mapReturnFundRow, returnFundColumns } from '../../../utils/financialRecordRows.js'
import { listReturnFunds } from '../../../services/financial.service'
import { getSocket } from '../../../services/socket'
import LoadingState from '../../../components/ui/LoadingState.jsx'

function recordMatchesSearch(record, searchTerm) {
  const q = searchTerm.trim().toLowerCase()
  if (!q) return true
  return [
    record.id, record.date, record.returnedBy, record.reason,
    record.titleOfActivities, record.amount, record.sourceOfFund,
  ].some(v => String(v ?? '').toLowerCase().includes(q))
}

// Return Funds are created with each disbursement and only change when its
// amount spent is recorded on the Disbursement page, so there's nothing to
// add or edit here.
export default function Returning({ showHeader = true }) {
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const filteredRecords = records.filter(r => recordMatchesSearch(r, searchTerm))

  const fetchReturnFunds = useCallback(async () => {
    try {
      setError('')
      const data = await listReturnFunds()
      setRecords((data.returnFunds || []).map(mapReturnFundRow))
    } catch {
      setError('Failed to load return fund records. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchReturnFunds() }, [fetchReturnFunds])

  // Real-time: returns created or updated with their disbursement appear live.
  useEffect(() => {
    const socket = getSocket()
    const handler = () => fetchReturnFunds()
    socket.on('returnFund:changed', handler)
    socket.on('disbursement:changed', handler)
    return () => {
      socket.off('returnFund:changed', handler)
      socket.off('disbursement:changed', handler)
    }
  }, [fetchReturnFunds])

  return (
    <>
      {showHeader && <DashboardHeader page="returning" />}
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Return Fund Records</h2>
            <p className="card__sub">Created with each disbursement. Record the amount spent on the Disbursement page to update a return.</p>
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
          </div>
        </div>

        {loading && <LoadingState label="Loading return funds…" />}
        {error   && <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>}
        {!loading && !error && (
          <FinancialRecordsTable
            columns={returnFundColumns}
            rows={filteredRecords}
            pageResetKey={searchTerm}
            emptyMessage="No return fund records found."
            onDownload={downloadReturnFundCertificate}
            canDownloadRow={(row) => !row.details.nothingReturnedYet}
          />
        )}
      </div>
    </>
  )
}
