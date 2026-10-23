import { useCallback, useEffect, useState } from "react";
import { listEvents } from "../../services/event.service.js";
import { getSocket } from "../../services/socket.js";
import "../../assets/styles/members/MemberDashboard.css";

const TAG_CLASS = {
  open: "open",
  upcoming: "upcoming",
  "coming soon": "upcoming",
  closed: "closed",
  cancelled: "cancelled",
};

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");

  const loadEvents = useCallback(() => {
    return listEvents()
      .then((data) => setEvents(data.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Real-time: new events, edits, and archiving appear instantly.
  useEffect(() => {
    const socket = getSocket();
    const handler = () => loadEvents();
    socket.on('event:changed', handler);
    return () => socket.off('event:changed', handler);
  }, [loadEvents]);

  const filteredEvents = events.filter((event) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query
      || event.title?.toLowerCase().includes(query)
      || event.location?.toLowerCase().includes(query)
      || event.description?.toLowerCase().includes(query)
      || event.Proponent?.toLowerCase().includes(query);

    return matchesSearch;
  });

  return (
    <>
      <div className="dash__header">
        <div>
          <p className="dash__eyebrow">Calendar</p>
          <h1 className="dash__title">Events</h1>
          <p className="dash__subtitle">Upcoming activities and events open to members.</p>
        </div>
      </div>

      <section className="member-card">
        <div className="member-card__header member-card__header--compact">
          <div>
            <p className="member-card__eyebrow">List</p>
            <h2 className="member-card__title">Available Events</h2>
          </div>
        </div>

        <div className="member-event-toolbar">
          <label className="member-search">
            <span className="sr-only">Search events</span>
            <input
              type="search"
              placeholder="Search events..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="member-events">
          {loading ? (
            <p className="member-events__state">Loading events...</p>
          ) : filteredEvents.length === 0 ? (
            <p className="member-events__state">
              {search.trim() ? "No events match your search." : "No events available at the moment."}
            </p>
          ) : (
            filteredEvents.map((event) => (
              <EventCard key={event.id} event={event} onView={() => setSelected(event)} />
            ))
          )}
        </div>
      </section>

      <EventModal event={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function EventCard({ event, onView }) {
  return (
    <article className="member-event">
      <div className="member-event__top">
        <span className={`member-event__tag member-event__tag--${getTagClass(event.status)}`}>
          {event.status}
        </span>
      </div>

      <div className="member-event__body">
        <h3>{event.title}</h3>
        <p>{formatDate(event.date)} | {formatTime(event.time)}</p>
        <p>{event.location || "To be announced"}</p>

        <div className="member-event__actions">
          <button type="button" className="btn btn--sm btn--outline" onClick={onView}>
            View
          </button>
        </div>
      </div>
    </article>
  );
}

function EventModal({ event, onClose }) {
  if (!event) return null;

  return (
    <>
      <div className="event-modal__backdrop" onClick={onClose} />
      <div className="event-modal__panel" role="dialog" aria-modal="true" aria-labelledby="member-event-title">
        <div className="event-modal__header">
          <div className="event-modal__header-top">
            <span className={`member-event__tag member-event__tag--${getTagClass(event.status)}`}>
              {event.status}
            </span>
            <button type="button" className="event-modal__close" onClick={onClose} aria-label="Close event details">
              <CloseIcon />
            </button>
          </div>
          <h2 id="member-event-title" className="event-modal__title">{event.title}</h2>
        </div>

        <div className="event-modal__body">
          <dl className="event-modal__details">
            <Detail label="What" value={event.description || "No description provided."} />
            <Detail label="When" value={`${formatDate(event.date)} | ${formatTime(event.time)}`} />
            <Detail label="Where" value={event.location || "Location to be set"} />
            <Detail label="Proponent" value={event.Proponent || event.proponent || "LITL"} />
          </dl>

          {event.googleFormUrl && (
            <div className="event-modal__actions">
              <a className="event-modal__join-btn" href={event.googleFormUrl} target="_blank" rel="noreferrer">
                Open Registration Form
              </a>
            </div>
          )}

          <button type="button" className="event-modal__close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }) {
  return (
    <div className="event-modal__field">
      <dt className="event-modal__field-label">{label}</dt>
      <dd className="event-modal__field-value">{value}</dd>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "Date to be set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatTime(value) {
  if (!value) return "Time to be set";
  const [hours, minutes] = value.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function getTagClass(status = "") {
  return TAG_CLASS[status.toLowerCase()] ?? "upcoming";
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
    </svg>
  );
}
