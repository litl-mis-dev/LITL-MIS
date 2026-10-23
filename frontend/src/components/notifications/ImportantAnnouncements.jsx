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
export default function ImportantAnnouncements({ announcements }) {
  if (!announcements || announcements.length === 0) return null

  return (
    <div className="topbar__announcements">
      <p className="topbar__announcements-heading">📢 Important Announcements</p>
      <div className="topbar__announcements-list">
        {announcements.map((a) => (
          <div key={a.id} className="topbar__announcement-card">
            <p className="topbar__announcement-title">📌 {a.title}</p>
            <p className="topbar__announcement-message">{a.message}</p>
            <p className="topbar__announcement-meta">
              {RECIPIENT_LABELS[a.recipients] ?? "For Everyone"}
              {a.expiresAt ? ` • Expires ${formatExpiry(a.expiresAt)}` : ""}
            </p>
          </div>
        ))}
      </div>
      <hr className="topbar__announcements-divider" />
    </div>
  )
}