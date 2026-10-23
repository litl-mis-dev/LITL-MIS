import { FileDownloadIcon } from '../../../components/icons/ActionIcons.jsx'
import { useRole } from '../../../utils/useRole'

export function SearchIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor"
      strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

// Downloading a certificate is an action, not a view — a role with VIEW-only
// access to Financial can see this table but must not be able to generate or
// download the certificate/receipt for any record in it. This check lives
// here (the single shared table used by both Disbursement and Returning) so
// every caller is covered, rather than relying on each page to remember to
// hide the button itself.
export default function FinancialRecordsTable({ columns, rows, emptyMessage, onDownload }) {
  const { canManageFinancials } = useRole()
  const showActionsColumn = columns.some(col => col.key === 'actions') && canManageFinancials

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {columns
              .filter(col => col.key !== 'actions' || showActionsColumn)
              .map(col => <th key={col.key}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-6 text-center text-sm text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map(row => (
              <tr key={row.id}>
                {columns.map(col => {
                  if (col.key === 'actions') {
                    // View-only: no action column rendered at all — not even
                    // a disabled button — nothing to click, nothing to probe.
                    if (!showActionsColumn) return null
                    return (
                      <td key={col.key}>
                        <button type="button" onClick={() => onDownload(row)}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                          aria-label={`Download ${row.id} certificate`}
                          title="Download certificate">
                          <FileDownloadIcon className="h-4 w-4" />
                        </button>
                      </td>
                    )
                  }
                  return <td key={col.key}>{row[col.key]}</td>
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}