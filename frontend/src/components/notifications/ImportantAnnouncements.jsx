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
// Clicking one opens its full details.
export default function ImportantAnnouncements({ announcements }) {
  const { openAnnouncement } = useNotifications()
  if (!announcements || announcements.length === 0) return null

  return (
    <div className="topbar__announcements">
      <p className="topbar__announcements-heading">📢 Important Announcements</p>
      <div className="topbar__announcements-list">
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
              {a.createdBy?.name ? `Posted by ${a.createdBy.name} • ` : ""}
              {RECIPIENT_LABELS[a.recipients] ?? "For Everyone"}
              {a.expiresAt ? ` • Expires ${formatExpiry(a.expiresAt)}` : ""}
            </span>
          </button>
        ))}
      </div>
      <hr className="topbar__announcements-divider" />
    </div>
  )
}
