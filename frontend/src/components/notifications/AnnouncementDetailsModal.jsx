import { useEffect, useState } from "react";
import { getAnnouncement } from "../../services/announcement.service";
import "../../assets/styles/AnnouncementModal.css";
import ModalPortal from "../ui/ModalPortal.jsx";

const RECIPIENT_LABELS = {
  MEMBERS: "Members",
  OFFICERS: "Officers",
  BOTH: "Members and Officers",
};

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// Full details of one announcement. `announcementId` loads it from the server
// (including who posted it); `fallback` is what's shown while it loads, or
// instead of it for notifications sent before announcements had links.
export default function AnnouncementDetailsModal({ announcementId, fallback, onClose }) {
  const [details, setDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(announcementId));
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!announcementId) return undefined;
    let active = true;
    getAnnouncement(announcementId)
      .then((announcement) => { if (active) setDetails(announcement); })
      .catch(() => { if (active) setLoadError("This announcement is no longer available."); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [announcementId]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const announcement = details ?? fallback ?? {};
  const isImportant = announcement.priority === "IMPORTANT";
  const isPaymentReminder = announcement.kind === "PAYMENT_REMINDER";

  return (
    <ModalPortal>
      <div
        className="announcement-modal"
        role="presentation"
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      >
        <div className="announcement-modal__panel" role="dialog" aria-modal="true" aria-labelledby="announcement-modal-title">
          <div className="announcement-modal__header">
            <div>
              <p className="announcement-modal__eyebrow">
                {isPaymentReminder ? "Payment Reminder" : isImportant ? "Important Announcement" : "Announcement"}
              </p>
              <h2 id="announcement-modal-title" className="announcement-modal__title">
                {announcement.title || "Announcement"}
              </h2>
            </div>
            <button type="button" className="announcement-modal__close" onClick={onClose} aria-label="Close announcement">
              ×
            </button>
          </div>

          <div className="announcement-modal__body">
            {loadError && !fallback && <p className="announcement-modal__error">{loadError}</p>}
            {announcement.message && <p className="announcement-modal__message">{announcement.message}</p>}

            <dl className="announcement-modal__meta">
              {!isPaymentReminder && (
                <div>
                  <dt>Posted by</dt>
                  <dd>
                    {announcement.createdBy
                      ? `${announcement.createdBy.name}${announcement.createdBy.position && announcement.createdBy.position !== announcement.createdBy.name ? ` · ${announcement.createdBy.position}` : ""}`
                      : isLoading ? "Loading…" : "Not available"}
                  </dd>
                </div>
              )}
              {announcement.createdAt && (
                <div><dt>{isPaymentReminder ? "Sent on" : "Posted on"}</dt><dd>{formatDateTime(announcement.createdAt)}</dd></div>
              )}
              {announcement.recipients && !isPaymentReminder && (
                <div><dt>Sent to</dt><dd>{RECIPIENT_LABELS[announcement.recipients] ?? announcement.recipients}</dd></div>
              )}
              {isImportant && announcement.expiresAt && (
                <div><dt>Pinned until</dt><dd>{formatDateTime(announcement.expiresAt)}</dd></div>
              )}
            </dl>
          </div>

          <div className="announcement-modal__footer">
            <button type="button" className="announcement-modal__button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
