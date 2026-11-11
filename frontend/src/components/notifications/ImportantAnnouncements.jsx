import { useNotifications } from "../../context/NotificationContext"

const RECIPIENT_LABELS = {
  MEMBERS: "For Members",
  OFFICERS: "For Officers",
  BOTH: "For Everyone",
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return null
  return new Date(expiresAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })
}

// Pinned, non-dismissible announcements. Deliberately has no remove/dismiss
// affordance anywhere in this component — Important Announcements can only
// stop appearing by expiring server-side (see announcement.controller.js).
// Clicking one opens its full details. The member's own payment reminder
// (pinned for 7 days) is listed here too. More than three scroll.
const VISIBLE_WITHOUT_SCROLL = 3

export default function ImportantAnnouncements({ announcements }) {
  const { openAnnouncement } = useNotifications()
  if (!announcements || announcements.length === 0) return null
  const isScrollable = announcements.length > VISIBLE_WITHOUT_SCROLL

  return (
    <div className="topbar__announcements">
      <p className="topbar__announcements-heading">📢 Important Announcements ({announcements.length})</p>
      <div
        className={`topbar__announcements-list ${isScrollable ? "topbar__announcements-list--scroll" : ""}`}
        tabIndex={isScrollable ? 0 : undefined}
        aria-label={isScrollable ? "Important announcements, scroll to see more" : undefined}
      >
        {announcements.map((a) => (
          <button
            key={a.id}
            type="button"
            className="topbar__announcement-card topbar__announcement-card--clickable"
            onClick={() => openAnnouncement(a)}
          >
            <span className="topbar__announcement-title">📌 {a.title}</span>
            <span className="topbar__announcement-message">{a.message}</span>
            <span className="topbar__announcement-meta">
              {a.kind === "PAYMENT_REMINDER"
                ? "Payment reminder for you"
                : `${a.createdBy?.name ? `Posted by ${a.createdBy.name} • ` : ""}${RECIPIENT_LABELS[a.recipients] ?? "For Everyone"}`}
              {a.expiresAt ? ` • Expires ${formatExpiry(a.expiresAt)}` : ""}
            </span>
          </button>
        ))}
      </div>
      <hr className="topbar__announcements-divider" />
    </div>
  )
}
