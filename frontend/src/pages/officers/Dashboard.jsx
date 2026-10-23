import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import DashboardHeader from "../../components/officers/DashboardHeader.jsx";
import { getDashboardStats } from "../../services/dashboard.service.js";
import { getSocket } from "../../services/socket.js";

const REALTIME_SIGNALS = [
  'event:changed', 'attendance:changed', 'membership:changed', 'officerRole:changed',
  'payment:changed', 'disbursement:changed', 'returnFund:changed',
  'document:changed', 'certificate:changed',
];

export default function Dashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);

  const loadStats = useCallback(() => {
    return getDashboardStats()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Real-time: every widget updates automatically by listening to the
  // real-time signals it depends on. Several signals can arrive together
  // (e.g. a payment also touches the ledger), so refetches are debounced
  // to a single request rather than firing once per signal.
  useEffect(() => {
    const socket = getSocket();
    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => loadStats(), 300);
    };
    REALTIME_SIGNALS.forEach((event) => socket.on(event, handler));
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      REALTIME_SIGNALS.forEach((event) => socket.off(event, handler));
    };
  }, [loadStats]);

  const stats               = data?.stats               ?? [];
  const membershipGrowthData = data?.membershipGrowthData ?? [];
  const fundFlowData         = data?.fundFlowData         ?? [];
  const upcomingEvents       = data?.upcomingEvents       ?? [];
  const latestAnnouncements  = data?.latestAnnouncements  ?? [];

  return (
    <>
      <DashboardHeader page="dashboard" />

      {loading ? (
        <p style={{ padding: "32px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
          Loading dashboard…
        </p>
      ) : (
        <>
          <div className="dash__stats">
            {stats.map((s) => (
              <div key={s.label} className={`stat-card stat-card--${s.color}`}>
                <div className="stat-card__top">
                  <span className="stat-card__icon" aria-hidden="true">
                    <StatIcon name={s.icon} />
                  </span>
                  <span className="stat-card__label">{s.label}</span>
                </div>
                <p className="stat-card__value">{s.value}</p>
                <p className="stat-card__change">{s.change}</p>
              </div>
            ))}
          </div>

          <div className="dash__analytics">
            <div className="card dash__chart-card">
              <div className="card__header">
                <div>
                  <h2 className="card__title">Membership Growth</h2>
                  <p className="card__sub">Paid membership progress across the current semester.</p>
                </div>
              </div>
              {membershipGrowthData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={membershipGrowthData} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v) => [`${Number(v).toLocaleString()} members`, "Paid Members"]}
                      contentStyle={{
                        fontSize: 13,
                        borderRadius: 8,
                        backgroundColor: "#ffffff",
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 8px 20px rgba(0, 0, 0, 0.08)",
                      }}
                    />
                    <Line type="monotone" dataKey="members" stroke="#ef8315" strokeWidth={3} dot={{ r: 4, fill: "#ef8315" }} activeDot={{ r: 6 }} name="Paid members" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No payment data for the current semester." />
              )}
            </div>

            <div className="card dash__chart-card">
              <div className="card__header">
                <div>
                  <h2 className="card__title">Fund Flow</h2>
                  <p className="card__sub">Fund collected, disbursement, and return by month.</p>
                </div>
              </div>
              {fundFlowData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={fundFlowData} margin={{ top: 4, right: 8, left: 0, bottom: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={formatCurrencyTick}
                    />
                    <Tooltip
                      formatter={(v, name) => [`₱${Number(v).toLocaleString()}`, name]}
                      contentStyle={{
                        fontSize: 13,
                        borderRadius: 8,
                        backgroundColor: "#ffffff",
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 8px 20px rgba(0, 0, 0, 0.08)",
                      }}
                    />
                    <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ paddingTop: 12, fontSize: 12, fontWeight: 700 }} />
                    <Bar dataKey="collected"    fill="#ef8315" radius={[4,4,0,0]} name="Fund Collected" />
                    <Bar dataKey="disbursement" fill="#dc2626" radius={[4,4,0,0]} name="Disbursement" />
                    <Bar dataKey="return"       fill="#16a34a" radius={[4,4,0,0]} name="Return" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No financial data for the current semester." />
              )}
            </div>
          </div>

          <div className="dash__info-panels">
            <InfoPanel
              title="Upcoming Events"
              subtitle="Scheduled activities — Open or Coming Soon."
              items={upcomingEvents}
              empty="No upcoming events."
            />
            <InfoPanel
              title="Recent Activity"
              subtitle="Latest officer actions from the activity log."
              items={latestAnnouncements}
              empty="No recent activity."
            />
          </div>
        </>
      )}
    </>
  );
}

function formatCurrencyTick(v) {
  const n = Number(v) || 0;
  if (n === 0) return "₱0";
  if (Math.abs(n) >= 1_000_000) {
    const formatted = (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1);
    return `₱${formatted}M`;
  }
  if (Math.abs(n) >= 1_000) {
    const formatted = (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1);
    return `₱${formatted}k`;
  }
  return `₱${n.toLocaleString()}`;
}

function EmptyChart({ message }) {
  return (
    <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#94a3b8", fontSize: 13 }}>{message}</p>
    </div>
  );
}

function StatIcon({ name }) {
  const paths = {
    students:      "M160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-280q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-80q33 0 56.5-23.5T560-680q0-33-23.5-56.5T480-760q-33 0-56.5 23.5T400-680q0 33 23.5 56.5T480-600Z",
    paidMembers:   "M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Z",
    totalFund:     "M560-440q-50 0-85-35t-35-85q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35ZM280-320q-33 0-56.5-23.5T200-400v-320q0-33 23.5-56.5T280-800h560q33 0 56.5 23.5T920-720v320q0 33-23.5 56.5T840-320H280Zm80-80h400q0-33 23.5-56.5T840-480v-160q-33 0-56.5-23.5T760-720H360q0 33-23.5 56.5T280-640v160q33 0 56.5 23.5T360-400Zm400 240H120q-33 0-56.5-23.5T40-240v-400h80v400h640v80Z",
    remainingFund: "M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480h-80q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93v80Zm40-160v-280H240v-80h360v360h-80Zm180 80-56-56 64-64H560v-80h148l-64-64 56-56 160 160-160 160Z",
  };
  return (
    <svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true">
      <path d={paths[name] ?? paths.students} />
    </svg>
  );
}

function InfoPanel({ title, subtitle, items, empty }) {
  return (
    <div className="card dash__activity-card">
      <div className="card__header">
        <div>
          <h2 className="card__title">{title}</h2>
          <p className="card__sub">{subtitle}</p>
        </div>
      </div>
      <div className="activity-list">
        {items.length === 0 ? (
          <p style={{ padding: "16px 0", color: "#94a3b8", fontSize: 13 }}>{empty}</p>
        ) : items.map((item, i) => (
          <div key={i} className="activity-item">
            <span className={`activity-item__icon activity-item__icon--${item.color}`}>
              {item.title.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </span>
            <div>
              <p className="activity-item__title">{item.title}</p>
              <p className="activity-item__desc">{item.desc}</p>
              <p className="activity-item__meta">{item.meta}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}