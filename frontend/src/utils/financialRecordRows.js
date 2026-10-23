// Row shapes and table columns for Disbursement and Return Fund records. Shared by
// the Financial module pages and Settings ▸ Archive so both show — and generate
// certificates from — exactly the same data.

function formatCurrency(value) {
  const n = parseFloat(value) || 0
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(isoString) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .format(new Date(isoString))
}

export function mapDisbursementRow(d) {
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

export const disbursementColumns = [
  { key: 'id', label: 'Reference' },
  { key: 'date', label: 'Date' },
  { key: 'recipient', label: 'Recipient' },
  { key: 'purpose', label: 'Purpose of Fund' },
  { key: 'titleOfActivities', label: 'Title of Activities' },
  { key: 'amount', label: 'Amount' },
  { key: 'sourceOfFund', label: 'Source of Fund' },
  { key: 'actions', label: 'Action' },
]

export function mapReturnFundRow(rf) {
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

export const returnFundColumns = [
  { key: 'id',               label: 'Reference'           },
  { key: 'date',             label: 'Date'                },
  { key: 'returnedBy',       label: 'Returned By'         },
  { key: 'reason',           label: 'Purpose of Fund'     },
  { key: 'titleOfActivities', label: 'Title of Activities' },
  { key: 'amount',           label: 'Amount'              },
  { key: 'sourceOfFund',     label: 'Source of Fund'      },
  { key: 'actions',          label: 'Action'              },
]


// Fund Report — same columns, rows and formatting as the Financial module's
// Fund Report: an "Overall Total Fund" row first, then each category.
export const fundReportColumns = [
  { key: 'name',       label: 'Category'   },
  { key: 'percentage', label: 'Percentage' },
  { key: 'total',      label: 'Total'      },
  { key: 'disbursed',  label: 'Disbursed'  },
  { key: 'returned',   label: 'Returned'   },
  { key: 'remaining',  label: 'Remaining'  },
]

function parseCurrency(value) {
  return parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0
}

export function buildFundReportRows(categories) {
  const records = categories.map(cat => ({
    rowKey:         String(cat.id),
    name:           cat.name,
    isTurnoverFund: cat.isTurnoverFund,
    percentage:     cat.isTurnoverFund ? '—' : `${parseFloat(cat.percentage) || 0}%`,
    total:          formatCurrency(cat.allocatedAmount),
    disbursed:      formatCurrency(cat.totalDisbursed),
    returned:       formatCurrency(cat.totalReturned),
    remaining:      formatCurrency(cat.availableFund),
  }))
  const sum = key => records.reduce((acc, r) => acc + parseCurrency(r[key]), 0)
  return [
    {
      rowKey: 'overall', name: 'Overall Total Fund', percentage: '100%',
      total: formatCurrency(sum('total')), disbursed: formatCurrency(sum('disbursed')),
      returned: formatCurrency(sum('returned')), remaining: formatCurrency(sum('remaining')),
      isSummary: true,
    },
    ...records,
  ]
}