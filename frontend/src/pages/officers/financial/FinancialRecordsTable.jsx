import { useCallback, useRef, useState } from 'react'
import { EyeIcon, FileDownloadIcon } from '../../../components/icons/ActionIcons.jsx'
import FileViewerModal from '../../../components/ui/FileViewerModal.jsx'
import { useRole } from '../../../utils/useRole'
import Spinner from '../../../components/ui/Spinner.jsx'
import LastEdited from '../../../components/ui/LastEdited.jsx'
import EditHistory from '../../../components/ui/EditHistory.jsx'

// Every row's history is its disbursement's: a Return Fund only changes
// through its disbursement's amount spent.
const historyIdOf = (row) => ('disbursementId' in row.details ? row.details.disbursementId : row.details._id)

function LastEditedCell({ row }) {
  const historyId = historyIdOf(row)
  return (
    <div className="last-edited-cell">
      <LastEdited edit={row.lastEdit} />
      {row.lastEdit && historyId && (
        <EditHistory type="disbursement" id={historyId} variant="link"
          refreshKey={row.lastEdit.at} title={`Edit history · ${row.id}`} />
      )}
    </div>
  )
}
import TablePagination from '../../../components/ui/TablePagination.jsx'
import { usePagination } from '../../../utils/usePagination.js'

export function SearchIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor"
      strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

// Reference numbers, dates and amounts stay on one line; amounts line up on the right.
const NOWRAP_COLUMNS = new Set(['id', 'date', 'amount', 'amountSpent'])
const MONEY_COLUMNS = new Set(['amount', 'amountSpent'])
const cellClass = (key) => [NOWRAP_COLUMNS.has(key) && 'data-table__nowrap', MONEY_COLUMNS.has(key) && 'data-table__money'].filter(Boolean).join(' ') || undefined

// Downloading a certificate is an action, not a view — a role with VIEW-only
// access to Financial can see this table but must not be able to generate or
// download the certificate/receipt for any record in it. This check lives
// here (the single shared table used by both Disbursement and Returning) so
// every caller is covered, rather than relying on each page to remember to
// hide the button itself.
// `onView(row)` (optional) returns the certificate as a PDF Blob, opened inside
// the system by a View button next to Download.
// `renderRowActions(row)` adds buttons before a row's download button, and
// `canDownloadRow(row)` hides the download for rows with nothing to download.
// 10 rows per page, numbered on across pages; `pageResetKey` (e.g. the search text)
// sends the table back to page 1 when it changes.
export default function FinancialRecordsTable({ columns, rows, emptyMessage, onDownload, onView, renderRowActions, canDownloadRow = () => true, pageResetKey = rows.length }) {
  const { canManageFinancials } = useRole()
  const pager = usePagination(rows, { resetKey: pageResetKey })
  const showActionsColumn = columns.some(col => col.key === 'actions') && canManageFinancials

  // The certificate PDF is drawn in the browser: spinner on that row's button,
  // one download at a time (a ref, since drawing can delay the redraw that
  // disables the buttons), and a message if it fails.
  const [downloadingId, setDownloadingId] = useState(null)
  const [downloadError, setDownloadError] = useState('')
  const isDownloadingRef = useRef(false)
  const [viewingRow, setViewingRow] = useState(null)
  const loadViewingRow = useCallback(() => onView(viewingRow), [onView, viewingRow])

  async function handleDownload(row) {
    if (isDownloadingRef.current) return
    isDownloadingRef.current = true
    setDownloadingId(row.id)
    setDownloadError('')
    try {
      await onDownload(row)
    } catch {
      setDownloadError(`Could not create the certificate for ${row.id}. Please try again.`)
    } finally {
      isDownloadingRef.current = false
      setDownloadingId(null)
    }
  }

  return (
    <div className="table-wrapper">
      {downloadError && <p className="mb-3 text-sm font-semibold text-red-700" role="alert">{downloadError}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th className="data-table__number">No.</th>
            {columns
              .filter(col => col.key !== 'actions' || showActionsColumn)
              .map(col => <th key={col.key} className={MONEY_COLUMNS.has(col.key) ? 'data-table__money' : undefined}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="py-6 text-center text-sm text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            pager.pageRows.map((row, index) => (
              <tr key={row.id}>
                <td className="data-table__number">{pager.rowNumber(index)}</td>
                {columns.map(col => {
                  if (col.key === 'actions') {
                    // View-only: no action column rendered at all — not even
                    // a disabled button — nothing to click, nothing to probe.
                    if (!showActionsColumn) return null
                    return (
                      <td key={col.key}>
                        <div className="flex items-center gap-2">
                          {renderRowActions?.(row)}
                          {onView && canDownloadRow(row) && (
                            <button type="button" onClick={() => setViewingRow(row)}
                              className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                              aria-label={`View ${row.id} certificate`}
                              title="View certificate">
                              <EyeIcon className="h-4 w-4" />
                            </button>
                          )}
                          {canDownloadRow(row) && (
                            <button type="button" onClick={() => handleDownload(row)}
                              className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                              disabled={downloadingId !== null}
                              aria-busy={downloadingId === row.id}
                              aria-label={`Download ${row.id} certificate`}
                              title="Download certificate">
                              {downloadingId === row.id ? <Spinner /> : <FileDownloadIcon className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                      </td>
                    )
                  }
                  return (
                    <td key={col.key} className={cellClass(col.key)}>
                      {col.key === 'lastEdited' ? <LastEditedCell row={row} /> : row[col.key]}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <TablePagination {...pager} onPageChange={pager.setPage} label="Records" />
      {viewingRow && (
        <FileViewerModal eyebrow="Certificate" title={viewingRow.id} load={loadViewingRow} onClose={() => setViewingRow(null)} />
      )}
    </div>
  )
}