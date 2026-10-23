import { useState, useEffect, useCallback } from 'react'
import DashboardHeader from '../../../components/officers/DashboardHeader.jsx'
import EditCategories from './EditCategories.jsx'
import SemesterManager from './SemesterManager.jsx'
import { useRole } from '../../../utils/useRole'
import { listCategories } from '../../../services/financial.service'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value) {
  const n = parseFloat(value) || 0
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatPercentage(value) {
  return `${parseFloat(value) || 0}%`
}

function parseCurrency(value) {
  return parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0
}

const SEMESTER_LABELS = { FIRST: '1st', SECOND: '2nd' }

// ── Table ─────────────────────────────────────────────────────────────────────

const mainColumns = [
  { key: 'name',       label: 'Category'   },
  { key: 'percentage', label: 'Percentage' },
  { key: 'total',      label: 'Total'      },
  { key: 'disbursed',  label: 'Disbursed'  },
  { key: 'returned',   label: 'Returned'   },
  { key: 'remaining',  label: 'Remaining'  },
]

function FinancialTable({ columns, rows }) {
  return (
    <div className="table-wrapper table-wrapper--scroll">
      <table className="data-table">
        <thead>
          <tr>{columns.map(col => <th key={col.key}>{col.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.rowKey} className={row.isSummary ? 'font-semibold' : ''}>
              {columns.map(col => (
                <td key={col.key}>
                  {col.key === 'name' && row.isTurnoverFund
                    ? <>↻ {row[col.key]}</>
                    : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Summary row ───────────────────────────────────────────────────────────────

function buildOverallFundRow(records) {
  const totals = records.reduce((acc, r) => ({
    total:     acc.total     + parseCurrency(r.total),
    disbursed: acc.disbursed + parseCurrency(r.disbursed),
    returned:  acc.returned  + parseCurrency(r.returned),
    remaining: acc.remaining + parseCurrency(r.remaining),
  }), { total: 0, disbursed: 0, returned: 0, remaining: 0 })

  return {
    rowKey: 'overall', name: 'Overall Total Fund', percentage: '100%',
    total:     formatCurrency(totals.total),
    disbursed: formatCurrency(totals.disbursed),
    returned:  formatCurrency(totals.returned),
    remaining: formatCurrency(totals.remaining),
    isSummary: true,
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FundReport({ showHeader = true }) {
  const { canArchiveFinancials, canManageFinancials } = useRole()

  const [records,           setRecords]           = useState([])
  const [semester,          setSemester]          = useState(null)
  const [categoriesLocked,  setCategoriesLocked]  = useState(false)
  const [loading,           setLoading]           = useState(true)
  const [error,             setError]             = useState('')

  const fetchCategories = useCallback(async () => {
    try {
      setError('')
      const data = await listCategories()

      setSemester(data.semester ?? null)

      // categoriesLocked = true means categories were already finalized for
      // this school year — the Add/Edit button must be hidden entirely.
      setCategoriesLocked(data.categoriesLocked ?? false)

      setRecords(
        (data.categories || []).map(cat => ({
          id:             cat.id,
          rowKey:         String(cat.id),
          name:           cat.name,
          isTurnoverFund: cat.isTurnoverFund,
          percentage:     cat.isTurnoverFund ? '—' : formatPercentage(cat.percentage),
          total:          formatCurrency(cat.allocatedAmount),
          disbursed:      formatCurrency(cat.totalDisbursed),
          returned:       formatCurrency(cat.totalReturned),
          remaining:      formatCurrency(cat.availableFund),
        }))
      )
    } catch {
      setError('Failed to load fund report. Please refresh.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  const displayRows        = [buildOverallFundRow(records), ...records]
  const hasRegularCategories = records.filter(r => !r.isTurnoverFund).length > 0
  const categoryButtonLabel  = hasRegularCategories ? 'Add Category' : 'Add Category'

  // Show the category button only when:
  // 1. The user has financial management permission
  // 2. Categories have NOT been finalized yet for this school year
  // 3. The active semester is the 1st semester (backend also enforces this,
  //    but hiding it in the UI avoids a confusing disabled-looking button)
  const showCategoryButton =
    canManageFinancials &&
    !categoriesLocked &&
    semester?.semester === 'FIRST'

  return (
    <>
      {showHeader && <DashboardHeader page="fund-report" />}
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Fund Report</h2>
            <p className="card__sub">
              {semester
                ? `Active: ${semester.schoolYear} — ${SEMESTER_LABELS[semester.semester] ?? semester.semester} Semester`
                : 'No active semester'}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {canArchiveFinancials && (
              <SemesterManager onSemesterChanged={fetchCategories} />
            )}

            {showCategoryButton && (
              <EditCategories
                onSuccess={fetchCategories}
                buttonLabel={categoryButtonLabel}
              />
            )}

            {/* Once finalized, show a read-only indicator instead of the button */}
            {canManageFinancials && categoriesLocked && (
              <span style={{
                fontSize: 12,
                color: 'var(--color-text-secondary, #6b7280)',
                padding: '6px 12px',
                border: '1px solid var(--color-border, #e5e7eb)',
                borderRadius: 6,
                background: 'var(--color-bg-secondary, #f9fafb)',
                whiteSpace: 'nowrap',
              }}>
                Categories finalized
              </span>
            )}
          </div>
        </div>

        {loading && (
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            Loading fund report...
          </p>
        )}
        {error && (
          <p className="px-4 py-8 text-center text-sm text-red-600">
            {error}
          </p>
        )}
        {!loading && !error && (
          <FinancialTable columns={mainColumns} rows={displayRows} />
        )}
      </div>
    </>
  )
}