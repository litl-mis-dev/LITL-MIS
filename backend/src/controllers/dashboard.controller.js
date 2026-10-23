const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { getSemesterEndingBalance, getTotalFund, getTurnoverAmount } = require('../services/calculations.service')
const { ROLE_POSITION_LABELS, MEMBERSHIP_USER_FILTER } = require('../utils/roles')

const getDashboardStats = async (req, res) => {
  try {
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })

    // ── Stat cards ────────────────────────────────────────────────────────────
    const totalMembers = await prisma.member.count({
      where: { status: 'ACTIVE', user: { status: 'APPROVED', ...MEMBERSHIP_USER_FILTER } }
    })

    let paidCount     = 0
    let totalFund     = '0'
    let remainingFund = '0'

    if (activeSemester) {
      paidCount = await prisma.payment.count({
        where: { semesterId: activeSemester.id, isArchived: false, member: { user: MEMBERSHIP_USER_FILTER } }
      })
      const fund     = await getTotalFund(activeSemester.id)
      const turnover = await getTurnoverAmount(activeSemester.id)

      const total = fund.plus(turnover)

      const remaining = await getSemesterEndingBalance(activeSemester.id)
      totalFund     = total.toFixed(2)
      remainingFund = remaining.toFixed(2)
    }

    const paidPercent = totalMembers > 0
      ? Math.round((paidCount / totalMembers) * 100)
      : 0

    const stats = [
      {
        label: 'Total Student',
        value: totalMembers.toLocaleString('en-PH'),
        change: 'Active approved members',
        color: 'indigo',
        icon: 'students',
      },
      {
        label: 'No. Paid Members',
        value: paidCount.toLocaleString('en-PH'),
        change: `${paidPercent}% of total members paid`,
        color: 'blue',
        icon: 'paidMembers',
      },
      {
        label: 'Total Fund',
        value: `₱${parseFloat(totalFund).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        change: activeSemester
          ? `${activeSemester.schoolYear} ${activeSemester.semester === 'FIRST' ? '1st' : '2nd'} Semester`
          : 'No active semester',
        color: 'green',
        icon: 'totalFund',
      },
      {
        label: 'Remaining Fund',
        value: `₱${parseFloat(remainingFund).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        change: 'Available after disbursements',
        color: 'red',
        icon: 'remainingFund',
      },
    ]

    // ── Membership growth — payments per month for active semester ────────────
    // Groups payment records by month (paidAt), shows cumulative paid members
    let membershipGrowthData = []
    if (activeSemester) {
      const payments = await prisma.payment.findMany({
        where: { semesterId: activeSemester.id, isArchived: false, member: { user: MEMBERSHIP_USER_FILTER } },
        select: { paidAt: true },
        orderBy: { paidAt: 'asc' }
      })

      const monthMap = new Map()
      for (const p of payments) {
        const key = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(p.paidAt))
        monthMap.set(key, (monthMap.get(key) || 0) + 1)
      }

      let cumulative = 0
      membershipGrowthData = [...monthMap.entries()].map(([month, count]) => {
        cumulative += count
        return { month, members: cumulative }
      })
    }

    // ── Fund flow — disbursements and returns grouped by month ────────────────
    let fundFlowData = []
    if (activeSemester) {
      const [disbursements, returnFunds, payments] = await Promise.all([
        prisma.disbursement.findMany({
          where: { semesterId: activeSemester.id, isArchived: false },
          select: { amount: true, createdAt: true }
        }),
        prisma.returnFund.findMany({
          where: { semesterId: activeSemester.id, isArchived: false },
          select: { amount: true, createdAt: true }
        }),
        prisma.payment.findMany({
          where: { semesterId: activeSemester.id, isArchived: false, member: { user: MEMBERSHIP_USER_FILTER } },
          select: { amount: true, paidAt: true }
        })
      ])

      const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      const flowMap    = new Map()

      const getKey = (date) =>
        new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(date))

      for (const d of disbursements) {
        const k = getKey(d.createdAt)
        const entry = flowMap.get(k) || { month: k, collected: 0, disbursement: 0, return: 0 }
        entry.disbursement += parseFloat(d.amount)
        flowMap.set(k, entry)
      }
      for (const r of returnFunds) {
        const k = getKey(r.createdAt)
        const entry = flowMap.get(k) || { month: k, collected: 0, disbursement: 0, return: 0 }
        entry.return += parseFloat(r.amount)
        flowMap.set(k, entry)
      }
      for (const p of payments) {
        const k = getKey(p.paidAt)
        const entry = flowMap.get(k) || { month: k, collected: 0, disbursement: 0, return: 0 }
        entry.collected += parseFloat(p.amount)
        flowMap.set(k, entry)
      }

      fundFlowData = [...flowMap.values()]
        .sort((a, b) => monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month))
    }

    // ── Upcoming events — Open or Coming Soon, sorted by date ─────────────────
    const upcomingEventsRaw = await prisma.event.findMany({
      where: {
        isArchived: false,
        status: { in: ["OPEN", "COMING_SOON"] }
      },
      orderBy: { date: 'asc' },
      take: 5,
      select: { title: true, date: true, time: true, location: true, status: true }
    })

    const colors = ['blue', 'green', 'orange', 'indigo', 'red']
    const upcomingEvents = upcomingEventsRaw.map((e, i) => {
      const dateStr = e.date
        ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
            .format(new Date(`${e.date}T00:00:00`))
        : 'TBD'
      return {
        title: e.title,
        desc:  `${dateStr}${e.location ? ` – ${e.location}` : ''}`,
        meta:  e.status,
        color: colors[i % colors.length],
      }
    })

    // ── Latest audit log entries (most recent 5 officer actions) ──────────────
    const recentLogs = await prisma.auditLog.findMany({
      where: {
        actor: {
          role: { not: 'MEMBER' }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        actor: {
          select: {
            role: true,
            member: { select: { firstName: true, lastName: true } }
          }
        }
      }
    })

    const ROLE_LABELS = ROLE_POSITION_LABELS

    const logColors = ['green', 'blue', 'orange', 'indigo', 'red']
    const latestAnnouncements = recentLogs.map((log, i) => {
      const m = log.actor?.member
      const actorName = m ? `${m.firstName} ${m.lastName}` : 'System'
      const roleLabel = ROLE_LABELS[log.actor?.role] ?? log.actor?.role ?? ''
      const when = new Intl.DateTimeFormat('en-US', {
        month: 'short', day: '2-digit', year: 'numeric'
      }).format(new Date(log.createdAt))
      return {
        title: log.action ?? log.description ?? 'Activity recorded',
        desc:  `${when} · ${actorName}`,
        meta:  roleLabel,
        color: logColors[i % logColors.length],
      }
    })

    return res.json({
      stats,
      membershipGrowthData,
      fundFlowData,
      upcomingEvents,
      latestAnnouncements,
    })
  } catch (err) {
    logError('Get dashboard stats', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { getDashboardStats }