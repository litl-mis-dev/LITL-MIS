import TablePagination from '../../../components/ui/TablePagination.jsx'
import { usePagination } from '../../../utils/usePagination.js'

// The Fund Report table (Financial ▸ Fund Report and History ▸ Archive).
// Categories are shown 10 per page, numbered on across pages; the total row stays at
// the bottom of every page, unnumbered. ↻ marks the Turnover Fund.
// Amounts (and percentages) line up on the right.
const NUMBER_COLUMNS = new Set(['percentage', 'total', 'disbursed', 'returned', 'remaining'])
const numberClass = (key) => (NUMBER_COLUMNS.has(key) ? 'data-table__money' : undefined)

export default function FundReportTable({ columns, rows, pageResetKey = '' }) {
  const categories = rows.filter(row => !row.isSummary)
  const summaryRows = rows.filter(row => row.isSummary)
  const pager = usePagination(categories, { resetKey: pageResetKey })

  const renderCells = (row) => columns.map(col => (
    <td key={col.key} className={numberClass(col.key)}>
      {col.key === 'name' && row.isTurnoverFund ? <>↻ {row[col.key]}</> : row[col.key]}
    </td>
  ))

  return (
    <div className="table-wrapper table-wrapper--scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th className="data-table__number">No.</th>
            {columns.map(col => <th key={col.key} className={numberClass(col.key)}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {pager.pageRows.map((row, index) => (
            <tr key={row.rowKey}>
              <td className="data-table__number">{pager.rowNumber(index)}</td>
              {renderCells(row)}
            </tr>
          ))}
          {summaryRows.map(row => (
            <tr key={row.rowKey} className="font-semibold">
              <td className="data-table__number" />
              {renderCells(row)}
            </tr>
          ))}
        </tbody>
      </table>
      <TablePagination {...pager} onPageChange={pager.setPage} label="Fund categories" />
    </div>
  )
}
