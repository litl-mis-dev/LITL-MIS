import { useNavigate } from "react-router-dom";
import { useNotifications } from "../../context/NotificationContext.jsx";

const MAX_VISIBLE = 4;

// Notification types that are reminders rather than news.
const REMINDER_TYPES = new Set(["EVENT_REMINDER", "PAYMENT_REMINDER"]);

const KIND_LABELS = { important: "Important", reminder: "Reminder", notification: "New" };

// Notices & Reminders — the first card on the member dashboard. Everything in
// it is the signed-in member's own: pinned announcements (including their
// payment reminder), their unread notifications, and reminders worked out
// from their dashboard data (an unpaid fee, an event today). Nothing new is
// fetched; it reads what the bell and the dashboard already load.
export default function MemberNotices({ semesterLabel, isFeeUnpaid, events }) {
  const navigate = useNavigate();
  const { notifications, importantAnnouncements, openAnnouncement, markRead } = useNotifications();

  const pinned = importantAnnouncements ?? [];
  const hasPinnedPaymentReminder = pinned.some((a) => a.kind === "PAYMENT_REMINDER");
  const pinnedAnnouncementIds = new Set(pinned.map((a) => String(a.id)));

  const items = [
    ...pinned.map((a) => ({
      key: `pinned-${a.kind ?? "announcement"}-${a.id}`,
      kind: a.kind === "PAYMENT_REMINDER" ? "reminder" : "important",
      title: a.title,
      message: a.message,
      onClick: () => openAnnouncement(a),
    })),
    ...(isFeeUnpaid && semesterLabel && !hasPinnedPaymentReminder ? [{
      key: "fee-unpaid",
      kind: "reminder",
      title: "Membership Fee Not Yet Paid",
      message: `Your membership fee for the ${semesterLabel} is still unpaid.`,
      onClick: () => navigate("/members/membership"),
    }] : []),
    ...eventsToday(events).map((event) => ({
      key: `event-today-${event.id}`,
      kind: "reminder",
      title: `Today: ${event.title}`,
      message: [formatTime(event.time), event.location].filter(Boolean).join(" · "),
      onClick: () => navigate("/members/events"),
    })),
    ...notifications
      .filter((n) => !n.isRead && !isPinnedAgain(n, pinnedAnnouncementIds, hasPinnedPaymentReminder))
      .map((n) => ({
        key: `notification-${n.id}`,
        kind: REMINDER_TYPES.has(n.type) ? "reminder" : "notification",
        title: n.title,
        message: n.message,
        onClick: () => {
          markRead(n.id);
          if (n.type === "ANNOUNCEMENT") openAnnouncement(n);
          else if (typeof n.link === "string" && n.link.startsWith("/")) navigate(n.link);
        },
      })),
  ];

  const visible = items.slice(0, MAX_VISIBLE);
  const hiddenCount = items.length - visible.length;

  return (
    <section className="member-home-card member-notices" aria-labelledby="member-notices-title">
      <div className="member-notices__header">
        <h2 id="member-notices-title">Notices &amp; Reminders</h2>
        {items.length > 0 && <span className="member-notices__count">{items.length}</span>}
      </div>

      {items.length === 0 ? (
        <p className="member-notices__empty">You&apos;re all caught up. New announcements and reminders will show here.</p>
      ) : (
        <ul className="member-notices__list">
          {visible.map((item) => (
            <li key={item.key}>
              <button type="button" className={`member-notice member-notice--${item.kind}`} onClick={item.onClick}>
                <span className="member-notice__tag">{KIND_LABELS[item.kind]}</span>
                <span className="member-notice__body">
                  <strong>{item.title}</strong>
                  {item.message && <span>{item.message}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hiddenCount > 0 && (
        <p className="member-notices__more">+{hiddenCount} more in your notifications (the bell at the top).</p>
      )}
    </section>
  );
}

// An announcement or payment-reminder notification that is already pinned
// above would otherwise be listed twice. Only the member's own reminder
// (linking to Membership) is pinned — not an officer's "reminders sent" notice.
function isPinnedAgain(notification, pinnedAnnouncementIds, hasPinnedPaymentReminder) {
  if (notification.type === "PAYMENT_REMINDER") return hasPinnedPaymentReminder && notification.link === "/members/membership";
  if (notification.type !== "ANNOUNCEMENT") return false;
  const id = typeof notification.link === "string"
    ? new URLSearchParams(notification.link.split("?")[1] ?? "").get("announcement")
    : null;
  return id !== null && pinnedAnnouncementIds.has(id);
}

// Events the member can attend today. Tomorrow's events arrive as a pushed
// reminder notification, which is listed with the notifications.
function eventsToday(events) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return (events ?? [])
    .filter((e) => e.date === today && (e.status === "Open" || e.status === "Coming soon"))
    .slice(0, 2);
}

function formatTime(value) {
  if (!value) return "";
  const [hours, minutes] = value.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}
