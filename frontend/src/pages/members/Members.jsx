import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { listEvents } from "../../services/event.service.js";
//import { getActiveSemester, getMyPaymentHistory } from "../../services/financial.service.js";
import { getMemberFundSummary, getMyPaymentHistory } from "../../services/financial.service.js";
import { getSocket } from "../../services/socket.js";
import "../../assets/styles/members/MemberDashboard.css";

const SEMESTER_LABELS = { FIRST: "First", SECOND: "Second" };

const quickLinks = [
  { id: "qr", label: "Digital ID", path: "/members/qrcode", icon: <QrIcon /> },
  { id: "documents", label: "Documents", path: "/members/documents", icon: <DocumentIcon /> },
  { id: "events", label: "Events", path: "/members/events", icon: <CalendarIcon /> },
  { id: "membership", label: "Membership", path: "/members/membership", icon: <CheckBadgeIcon /> },
];

export default function Members() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeSemester, setActiveSemester] = useState(null);
  const [fundValues, setFundValues] = useState({ totalFund: null, remainingFund: null });
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const member = useMemo(() => getMemberProfile(user), [user]);
  const currentRecord = useMemo(
    () => findCurrentPaymentRecord(paymentHistory, activeSemester),
    [paymentHistory, activeSemester]
  );
  const membershipStatus = useMemo(
    () => getMembershipStatusSummary(currentRecord, isLoading),
    [currentRecord, isLoading]
  );
  const fundSummary = useMemo(
    () => getFundSummary(fundValues, isLoading),
    [fundValues, isLoading]
  );
  const upcomingEvents = useMemo(() => getUpcomingEvents(events), [events]);

  const loadAll = useCallback(() => {
    let isMounted = true;

    Promise.allSettled([
      getMemberFundSummary(),
      getMyPaymentHistory(),
      listEvents(),
    ]).then(([semesterResult, historyResult, eventsResult]) => {
      if (!isMounted) return;

      if (semesterResult.status === "fulfilled") {
        setActiveSemester(semesterResult.value.semester ?? null);
        setFundValues({
          totalFund: semesterResult.value.totalFund ?? null,
          remainingFund: semesterResult.value.remainingFund ?? null,
        });
      }

      if (historyResult.status === "fulfilled") {
        setPaymentHistory(historyResult.value.history ?? []);
      }

      if (eventsResult.status === "fulfilled") {
        setEvents(eventsResult.value.events ?? []);
      }
    }).finally(() => {
      if (isMounted) setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => loadAll(), [loadAll]);

  // Real-time: own payment status and event list can change without a
  // page refresh. Signals only — the data itself is always re-fetched.
  useEffect(() => {
    const socket = getSocket();
    const handlePayment = () => loadAll();
    const handleEvent = () => loadAll();
    socket.on('payment:self-changed', handlePayment);
    socket.on('event:changed', handleEvent);
    return () => {
      socket.off('payment:self-changed', handlePayment);
      socket.off('event:changed', handleEvent);
    };
  }, [loadAll]);

  return (
    <div className="member-home">
      <div className="dash__header">
        <div>
          <p className="dash__eyebrow">Member Dashboard</p>
          <h1 className="dash__title">Dashboard</h1>
          <p className="dash__subtitle">
            View your membership details, digital ID, documents, and upcoming LITL events.
          </p>
        </div>
      </div>

      <div className="member-home__top">
          <section className="member-profile-hero" aria-label="Member profile summary">
            <div className="member-profile-hero__identity">
              <div className="member-profile-hero__avatar">
                {member.avatar ? (
                  <img src={member.avatar} alt="" />
                ) : (
                  <span>{member.initials}</span>
                )}
              </div>

              <div className="member-profile-hero__details">
                <h1>{member.name}</h1>
                <p>{member.studentNumber || "Student number unavailable"}</p>
                <p>{member.email || "Email unavailable"}</p>
                <p className="member-profile-hero__program">{member.program}</p>
                <p>{member.sectionLabel}</p>
              </div>
            </div>

            <div className="member-profile-hero__term">
              <span>Active Semester</span>
              <strong>{formatSemester(activeSemester, isLoading)}</strong>
            </div>
          </section>

          <aside className="member-fund-stack" aria-label="Fund summary">
            <FundCard label="Remaining Fund" value={fundSummary.remainingFund} helper="Available balance" />
            <FundCard label="Total Fund" value={fundSummary.totalFund} helper="Current semester fund" />
          </aside>
      </div>

      <div className="member-home__grid">
        <div className="member-home__main">
          <section className="member-home-card member-quick-access">
            <h2>Quick access to your information</h2>
            <div className="member-quick-access__grid">
              {quickLinks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="member-quick-link"
                  onClick={() => navigate(item.path)}
                >
                  <span className="member-quick-link__icon">{item.icon}</span>
                  <span className="member-quick-link__body">
                    <strong>{item.label}</strong>
                    <span>Open</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="member-home-card member-events-summary">
            <div>
              <h2>Upcoming School Events</h2>
              {upcomingEvents.length ? (
                <div className="member-events-summary__list">
                  {upcomingEvents.map((event) => (
                    <article key={event.id} className="member-events-summary__item">
                      <strong>{event.title}</strong>
                      <span>{formatEventDate(event.date)} | {formatTime(event.time)}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <p>No events yet</p>
              )}
            </div>

            <button type="button" className="btn btn--primary" onClick={() => navigate("/members/events")}>
              Today
            </button>
          </section>
        </div>

        <aside className="member-side-stack">
          <section className={`member-home-card member-status-card member-status-card--${membershipStatus.tone}`} aria-label="Membership status">
            <div className="member-status-card__header">
              <div>
                <h2>My Membership Status</h2>
                <p>{member.memberType}</p>
              </div>
              <span className="member-status-card__badge">{membershipStatus.label}</span>
            </div>

            <dl className="member-status-list">
              <StatusRow label="Semester" value={formatSemester(activeSemester, isLoading)} />
              <StatusRow label="Payment" value={membershipStatus.paymentMeta} />
              <StatusRow label="Access" value={membershipStatus.accessMeta} />
            </dl>

            <button
              type="button"
              className="member-status-card__link"
              onClick={() => navigate("/members/membership")}
            >
              View membership records
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function StatusRow({ label, value }) {
  return (
    <div className="member-status-row">
      <dt>{label}</dt>
      <dd>{value || "-"}</dd>
    </div>
  );
}

function FundCard({ label, value, helper }) {
  return (
    <section className="member-home-card member-fund-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </section>
  );
}

function getMemberProfile(user) {
  const member = user?.member ?? {};
  const name = user?.name || [member.firstName, member.middleName, member.lastName, member.suffix]
    .filter(Boolean)
    .join(" ");
  const yearLevel = user?.yearLevel || member.yearLevel || "";
  const section = user?.section || member.section || "";

  return {
    name: name || "Member",
    email: user?.email || member.email || "",
    avatar: user?.avatar || member.avatar || "",
    studentNumber: user?.studentNumber || member.studentNumber || "",
    program: user?.program || member.program || member.course || "Bachelor of Science in Information Technology",
    sectionLabel: yearLevel || section ? `${yearLevel}${yearLevel && section ? " - " : ""}${section}` : "Section unavailable",
    memberType: user?.role === "MEMBER" ? "Regular Student" : "Member",
    initials: getInitials(name || user?.email || "Member"),
  };
}

function getInitials(value) {
  return String(value)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "M";
}

function findCurrentPaymentRecord(history, activeSemester) {
  if (!history.length) return null;
  if (!activeSemester?.id) return history.at(-1);

  return history.find((item) => Number(item.semesterId) === Number(activeSemester.id)) ?? null;
}

function getMembershipStatusSummary(record, isLoading) {
  if (isLoading) {
    return {
      label: "Loading",
      tone: "loading",
      paymentMeta: "Checking",
      accessMeta: "Checking",
    };
  }

  if (!record || record.status === "UNPAID") {
    return {
      label: "Pending",
      tone: "pending",
      paymentMeta: "Pending",
      accessMeta: "Available after payment",
    };
  }

  const isSettled = record.status === "SETTLED";

  return {
    label: isSettled ? "Settled" : "Active",
    tone: isSettled ? "settled" : "active",
    paymentMeta: record.payment?.paidAt ? formatShortTime(record.payment.paidAt) : "Recorded",
    accessMeta: "Verified",
  };
}

function getUpcomingEvents(events) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return events
    .filter((event) => {
      if (!event.date) return true;
      return new Date(`${event.date}T00:00:00`) >= today;
    })
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(0, 2);
}

function getFundSummary(fundValues, isLoading) {
  if (isLoading) {
    return {
      remainingFund: "Loading...",
      totalFund: "Loading...",
    };
  }

  return {
    remainingFund: formatCurrency(fundValues?.remainingFund),
    totalFund: formatCurrency(fundValues?.totalFund),
  };
}

function formatSemester(semester, isLoading) {
  if (isLoading) return "Loading...";
  if (!semester) return "No active semester";

  return `${semester.schoolYear} - ${SEMESTER_LABELS[semester.semester] ?? semester.semester}`;
}

function formatEventDate(value) {
  if (!value) return "Date to be set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(new Date(`${value}T00:00:00`));
}

function formatShortTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return "Time to be set";
  const [hours, minutes] = value.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatCurrency(value) {
  const number = Number(value ?? 0);

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number.isFinite(number) ? number : 0);
}

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 4h6v6H4V4Zm2 2v2h2V6H6Zm8-2h6v6h-6V4Zm2 2v2h2V6h-2ZM4 14h6v6H4v-6Zm2 2v2h2v-2H6Zm9-2h2v2h-2v-2Zm-2 2h2v2h-2v-2Zm4 0h3v2h-3v-2Zm-4 3h4v2h-4v-2Zm6 0h1v2h-1v-2Z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 3h7l5 5v13H7V3Zm6 1.5V9h4.5L13 4.5ZM9 13h8v-2H9v2Zm0 4h8v-2H9v2Z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 2h2v3h6V2h2v3h3v16H4V5h3V2Zm11 8H6v9h12v-9Z" />
    </svg>
  );
}

function CheckBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2 9.7 4.4 6.4 4l-.6 3.3L3 9l1.6 3L3 15l2.8 1.7.6 3.3 3.3-.4L12 22l2.3-2.4 3.3.4.6-3.3L21 15l-1.6-3L21 9l-2.8-1.7-.6-3.3-3.3.4L12 2Zm-1.1 13.4-3.3-3.3L9 10.7l1.9 1.9L15 8.5l1.4 1.4-5.5 5.5Z" />
    </svg>
  );
}
