import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import DashboardHeader from "../../../components/officers/DashboardHeader.jsx";
import { useRole } from "../../../utils/useRole.js";
import SuccessDialog from "../../../components/officers/SuccessDialog.jsx";
import { CloseIcon as ActionCloseIcon, DeleteIcon, EditIcon } from "../../../components/icons/ActionIcons.jsx";
import { listEvents, createEvent, updateEvent, archiveEvent, recordAttendance, getEventAttendance as getAttendance } from "../../../services/event.service.js";
import { getSocket } from "../../../services/socket.js";
import ConfirmActionButton from "../../../components/officers/ConfirmActionButton.jsx";

const accessOptions        = ["Members", "Officers"];
const maxDescriptionLength = 2000;
const addStatusOptions     = ["Coming soon", "Open"];
const statusOptions        = ["Coming soon", "Open", "Closed", "Cancelled"];
const scannerElementId     = "officers-event-qr-reader";
const monthOptions = [
    { value: "01", label: "January" },  { value: "02", label: "February" },
    { value: "03", label: "March" },    { value: "04", label: "April" },
    { value: "05", label: "May" },      { value: "06", label: "June" },
    { value: "07", label: "July" },     { value: "08", label: "August" },
    { value: "09", label: "September" },{ value: "10", label: "October" },
    { value: "11", label: "November" }, { value: "12", label: "December" },
];

const emptyEvent = {
    title: "", date: "", time: "", location: "", Proponent: "",
    description: "", status: "Coming soon", access: ["Officers"],
    hasGoogleForm: false, googleFormUrl: "",
};

export default function Events() {
    const navigate = useNavigate();
    const { can } = useRole();
    const canEdit = can("EVENT", "EDIT");

    // ── Data state ────────────────────────────────────────────────────────────
    const [events,            setEvents]            = useState([]);
    const [loading,           setLoading]           = useState(true);
    const [error,             setError]             = useState("");
    const [selectedEventId,   setSelectedEventId]   = useState(null);
    const [attendanceRecords, setAttendanceRecords] = useState({}); // { [eventId]: [{code, member, checkedInAt, scannedAt}] }

    // ── UI state ──────────────────────────────────────────────────────────────
    const [searchTerm,              setSearchTerm]              = useState("");
    const [filters,                 setFilters]                 = useState({ status: "All", month: "All", year: "All" });
    const [isAddModalOpen,          setIsAddModalOpen]          = useState(false);
    const [isViewModalOpen,         setIsViewModalOpen]         = useState(false);
    const [isAccessModalOpen,       setIsAccessModalOpen]       = useState(false);
    const [isFilterModalOpen,       setIsFilterModalOpen]       = useState(false);
    const [isScannerOpen,           setIsScannerOpen]           = useState(false);
    const [scannerSessionKey,       setScannerSessionKey]       = useState(0);
    const [scanningEventId,         setScanningEventId]         = useState(null);
    const [isSuccessDialogOpen,     setIsSuccessDialogOpen]     = useState(false);
    const [isAttendanceSuccessOpen, setIsAttendanceSuccessOpen] = useState(false);
    const [accessError,             setAccessError]             = useState("");
    const [scannerError,            setScannerError]            = useState("");
    const [scannerStatus,           setScannerStatus]           = useState("");
    const [scanResult,              setScanResult]              = useState("");
    const [formEvent,               setFormEvent]               = useState(emptyEvent);
    const [editingEvent,            setEditingEvent]            = useState(null);
    const [isSaving,                setIsSaving]                = useState(false);

    const scannerRef               = useRef(null);
    const scannerRestartTimeoutRef = useRef(null);

    // ── Derived values ────────────────────────────────────────────────────────
    const selectedEvent      = events.find(e => e.id === selectedEventId) ?? null;
    const scanningEvent      = events.find(e => e.id === scanningEventId) ?? null;
    const selectedAttendance = selectedEvent ? getNewest(attendanceRecords[selectedEvent.id] ?? []) : [];
    const scanningAttendance = scanningEvent  ? getNewest(attendanceRecords[scanningEvent.id]  ?? []) : [];

    const yearOptions = useMemo(() => (
        [...new Set(events.map(e => e.date?.slice(0, 4)).filter(Boolean))].sort()
    ), [events]);

    const activeFilterCount = [filters.status, filters.month, filters.year].filter(v => v !== "All").length;

    const filteredEvents = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return events
            .filter(event => {
                const matchesSearch = !q
                    || event.title.toLowerCase().includes(q)
                    || event.location.toLowerCase().includes(q)
                    || event.Proponent.toLowerCase().includes(q);
                const [yr, mo] = event.date?.split("-") ?? [];
                return matchesSearch
                    && (filters.status === "All" || event.status === filters.status)
                    && (filters.month  === "All" || mo === filters.month)
                    && (filters.year   === "All" || yr === filters.year);
            })
            .sort((a, b) => {
                if (isHappeningEvent(a) !== isHappeningEvent(b)) return isHappeningEvent(a) ? -1 : 1;
                return a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
            });
    }, [events, filters, searchTerm]);

    // ── Fetch ─────────────────────────────────────────────────────────────────
    const fetchEvents = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const data = await listEvents();
            const eventsData = data.events ?? [];
            setEvents(eventsData);
            setSelectedEventId(prev => prev ?? eventsData[0]?.id ?? null);
        } catch {
            setError("Failed to load events. Please refresh.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchEvents(); }, [fetchEvents]);
    useEffect(() => () => clearScannerRestart(), []);

    // ── Real-time ────────────────────────────────────────────────────────────
    // New events, edits, and archiving appear instantly. Attendance changes
    // for the currently-open event refresh just that event's attendance list
    // (avoids clobbering an in-progress scan session for other events).
    useEffect(() => {
        const socket = getSocket();
        const handleEventChange = () => fetchEvents();
        const handleAttendanceChange = (payload) => {
            const eventId = payload?.eventId;
            if (eventId == null) return;
            if (eventId !== selectedEventId && eventId !== scanningEventId) return;
            getAttendance(eventId).then((data) => {
                const records = (data.attendances ?? []).map(a => ({
                    code:       a.qrCode,
                    member:     a.member ?? null,
                    checkedInAt: new Date(a.checkedInAt).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }),
                    scannedAt:  new Date(a.checkedInAt).getTime(),
                }));
                setAttendanceRecords(prev => ({ ...prev, [eventId]: records }));
            }).catch(() => {});
        };
        socket.on('event:changed', handleEventChange);
        socket.on('attendance:changed', handleAttendanceChange);
        return () => {
            socket.off('event:changed', handleEventChange);
            socket.off('attendance:changed', handleAttendanceChange);
        };
    }, [selectedEventId, scanningEventId]);

    // ── Scanner lifecycle ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!isScannerOpen) return undefined;

        let isCancelled = false;
        const scanner   = new Html5Qrcode(scannerElementId);
        const startDelay = window.setTimeout(() => startScanner(), 120);

        setScannerError(""); setScannerStatus("Starting camera..."); setScanResult("");

        async function startScanner() {
            try {
                scannerRef.current = scanner;
                const cameras = await Html5Qrcode.getCameras();
                if (isCancelled) return;
                if (!cameras.length) {
                    setScannerStatus("");
                    setScannerError("No camera found.");
                    return;
                }
                const backCamera = cameras.find(c => /back|rear|environment/i.test(c.label));
                const cameraId   = backCamera?.id ?? cameras[0].id;
                await scanner.start(
                    cameraId,
                    { fps: 12 },
                    (decoded) => { if (isCancelled) return; handleQrScan(decoded); stopScanner(); },
                    () => {}
                );
                if (!isCancelled) setScannerStatus("Point the camera at a member QR code.");
            } catch {
                if (isCancelled) return;
                setScannerStatus("");
                setScannerError("Camera could not be opened. Allow camera permission and use HTTPS.");
            }
        }

        return () => {
            isCancelled = true;
            window.clearTimeout(startDelay);
            stopScannerInstance(scanner);
        };
    }, [isScannerOpen, scannerSessionKey]);

    // ── Event CRUD ────────────────────────────────────────────────────────────
    async function handleAddEvent(e) {
        e.preventDefault();
        if (formEvent.access.length === 0) { setAccessError("Select at least one access option."); return; }
        setIsSaving(true);
        try {
            const data = await createEvent({
                ...formEvent,
                googleFormUrl: formEvent.hasGoogleForm ? formEvent.googleFormUrl : "",
            });
            await fetchEvents();
            setSelectedEventId(data.event.id);
            setFormEvent(emptyEvent);
            setAccessError("");
            setIsAddModalOpen(false);
            setIsSuccessDialogOpen(true);
        } catch {
            // form stays open on error
        } finally {
            setIsSaving(false);
        }
    }

    function handleFormChange(field, value) {
        setFormEvent(prev => ({ ...prev, [field]: value }));
        if (field === "access" && value.length > 0) setAccessError("");
        if (field === "hasGoogleForm" && !value) setFormEvent(prev => ({ ...prev, googleFormUrl: "" }));
    }

    function openAddEventModal() { setFormEvent(emptyEvent); setAccessError(""); setIsAddModalOpen(true); }

    function openEditEventModal() {
        if (!selectedEvent) return;
        setEditingEvent({ ...selectedEvent });
        setAccessError("");
        setIsAccessModalOpen(true);
    }

    function closeEditEventModal() { setEditingEvent(null); setAccessError(""); setIsAccessModalOpen(false); }

    function handleEditField(field, value) {
        setEditingEvent(prev => ({ ...prev, [field]: value }));
        if (field === "access" && value.length > 0) setAccessError("");
        if (field === "hasGoogleForm" && !value) setEditingEvent(prev => ({ ...prev, googleFormUrl: "" }));
    }

    async function handleSaveEdit(e) {
        e.preventDefault();
        if (!editingEvent) return;
        if (editingEvent.access.length === 0) { setAccessError("Select at least one access option."); return; }
        setIsSaving(true);
        try {
            await updateEvent(editingEvent.id, {
                ...editingEvent,
                googleFormUrl: editingEvent.hasGoogleForm ? editingEvent.googleFormUrl : "",
            });
            await fetchEvents();
            closeEditEventModal();
        } catch { } finally {
            setIsSaving(false);
        }
    }

    async function handleDeleteEvent(eventId) {
        try {
            await archiveEvent(eventId);
            await fetchEvents();
            setAttendanceRecords(prev => { const next = { ...prev }; delete next[eventId]; return next; });
            setSelectedEventId(events.find(e => e.id !== eventId)?.id ?? null);
        } catch { }
    }

    // ── QR Scanner ────────────────────────────────────────────────────────────
    async function openScannerModal(eventId) {
        setSelectedEventId(eventId);
        setScanningEventId(eventId);
        setScanResult(""); setScannerError(""); setScannerStatus("");
        setScannerSessionKey(k => k + 1);
        setIsScannerOpen(true);

        try {
            const data = await getAttendance(eventId);
            // Include member so the sidebar shows real names, not raw QR text
            const records = (data.attendances ?? []).map(a => ({
                code:       a.qrCode,
                member:     a.member ?? null,
                checkedInAt: new Date(a.checkedInAt).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }),
                scannedAt:  new Date(a.checkedInAt).getTime(),
            }));
            setAttendanceRecords(prev => ({ ...prev, [eventId]: records }));
        } catch { }
    }

    function handleQrScan(decodedText) {
        const checkedInAt = new Date().toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
        const scannedAt   = Date.now();
        setScanResult(decodedText);

        recordAttendance(scanningEventId, decodedText)
            .then(() => {
                setScannerError("");
                setIsAttendanceSuccessOpen(true);
                // member not available immediately on scan — will resolve on next getAttendance call
                setAttendanceRecords(prev => ({
                    ...prev,
                    [scanningEventId]: [
                        { code: decodedText, member: null, checkedInAt, scannedAt },
                        ...(prev[scanningEventId] ?? [])
                    ]
                }));
                scheduleScannerRestart(1800);
            })
            .catch(err => {
                const status = err.response?.status;
                if (status === 409) {
                    setScannerError("This QR code is already checked in for this event.");
                } else {
                    setScannerError("Failed to record attendance. Please try again.");
                }
                scheduleScannerRestart(1600);
            });
    }

    function closeScannerModal() {
        clearScannerRestart();
        stopScanner();
        setIsScannerOpen(false);
        setScanningEventId(null);
        setScannerStatus("");
    }

    function scheduleScannerRestart(delayMs = 0) {
        clearScannerRestart();
        scannerRestartTimeoutRef.current = window.setTimeout(() => {
            setScanResult(""); setScannerError(""); setIsAttendanceSuccessOpen(false);
            setScannerSessionKey(k => k + 1);
        }, delayMs);
    }

    function clearScannerRestart() {
        if (!scannerRestartTimeoutRef.current) return;
        window.clearTimeout(scannerRestartTimeoutRef.current);
        scannerRestartTimeoutRef.current = null;
    }

    function stopScanner() {
        const scanner = scannerRef.current;
        if (!scanner) return;
        scannerRef.current = null;
        stopScannerInstance(scanner);
    }

    function stopScannerInstance(scanner) {
        const clear = () => { try { const r = scanner.clear(); r?.catch?.(() => {}); } catch {} };
        if (scanner.isScanning) { Promise.resolve(scanner.stop()).then(clear).catch(clear); return; }
        clear();
    }

    function handleBackdropClick(e, onClose) { if (e.target === e.currentTarget) onClose(); }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <>
            <DashboardHeader
                page="events"
                actions={canEdit ? <button type="button" className="btn btn--primary" onClick={openAddEventModal}>Add Event</button> : null}
            />

            <section className="card events-board">
                <div className="card__header events-board__header">
                    <div>
                        <h2 className="card__title">Event Cards</h2>
                        <p className="card__sub">Happening events appear first and can scan member QR codes.</p>
                    </div>
                    <div className="member-list-actions">
                        <label className="member-search">
                            <span className="sr-only">Search events</span>
                            <input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search events" />
                        </label>
                        <div className="event-filter-actions">
                            <button type="button" className="btn btn--outline btn--filter" onClick={() => setIsFilterModalOpen(true)}>
                                Advanced Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                            </button>
                            {activeFilterCount > 0 && (
                                <button type="button" className="icon-btn" onClick={() => setFilters({ status: "All", month: "All", year: "All" })} aria-label="Clear event filters">
                                    <ActionCloseIcon />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {loading && <p className="px-4 py-8 text-center text-sm text-gray-500">Loading events...</p>}
                {error   && <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>}

                {!loading && !error && (
                    <div className="events-grid">
                        {filteredEvents.map(event => (
                            <article
                                key={event.id}
                                className={`event-card ${selectedEventId === event.id ? "event-card--active" : ""}`}
                                onDoubleClick={() => { setSelectedEventId(event.id); setIsViewModalOpen(true); }}
                            >
                                <button type="button" className="event-card__select" onClick={() => setSelectedEventId(event.id)} aria-label={`Select ${event.title}`} />
                                <div className="event-card__top">
                                    <span className={`event-status event-status--${getStatusClass(event.status)}`}>
                                        {isHappeningEvent(event) ? "Happening" : event.status}
                                    </span>
                                    <span className="event-card__date">{formatDate(event.date)}</span>
                                </div>
                                <h3 className="event-card__title">{event.title}</h3>
                                <p className="event-card__description">{event.description}</p>
                                <dl className="event-card__meta">
                                    <div><dt>Time</dt><dd>{formatTime(event.time)}</dd></div>
                                    <div><dt>Place</dt><dd>{event.location}</dd></div>
                                    <div><dt>Access</dt><dd>{event.access.join(", ")}</dd></div>
                                    <div><dt>Attendance</dt><dd>{attendanceRecords[event.id]?.length ?? event.attendanceCount ?? 0}</dd></div>
                                </dl>
                                <div className="event-card__actions">
                                    <button type="button" className="btn btn--outline btn--sm" onClick={() => { setSelectedEventId(event.id); setIsViewModalOpen(true); }}>View</button>
                                    {canEdit && isHappeningEvent(event) && (
                                        <button type="button" className="btn btn--scan btn--icon-only btn--sm" onClick={() => openScannerModal(event.id)} aria-label={`Scan QR for ${event.title}`}>
                                            <CameraIcon />
                                        </button>
                                    )}
                                </div>
                            </article>
                        ))}
                        {filteredEvents.length === 0 && (
                            <div className="events-empty">
                                <h2 className="card__title">No events found</h2>
                                <p className="card__sub">Adjust your search or create a new event card.</p>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ── Add Event Modal ─────────────────────────────────────────────── */}
            {isAddModalOpen && (
                <div className="member-modal event-modal" role="presentation" onClick={e => handleBackdropClick(e, () => setIsAddModalOpen(false))}>
                    <div className="member-modal__panel" role="dialog" aria-modal="true">
                        <ModalHeader eyebrow="Event" title="Add Event" onClose={() => setIsAddModalOpen(false)} />
                        <form className="member-modal__form" onSubmit={handleAddEvent}>
                            <label className="dash-form__field">Event title
                                <input value={formEvent.title} onChange={e => handleFormChange("title", e.target.value)} maxLength={50} required autoFocus />
                            </label>
                            <label className="dash-form__field">Proponent
                                <input value={formEvent.Proponent} onChange={e => handleFormChange("Proponent", e.target.value)} maxLength={50} required />
                            </label>
                            <label className="dash-form__field">Date
                                <input type="date" value={formEvent.date} onChange={e => handleFormChange("date", e.target.value)} required />
                            </label>
                            <label className="dash-form__field">Time
                                <input type="time" value={formEvent.time} onChange={e => handleFormChange("time", e.target.value)} required />
                            </label>
                            <label className="dash-form__field">Location
                                <input value={formEvent.location} onChange={e => handleFormChange("location", e.target.value)} maxLength={50} required />
                            </label>
                            <label className="dash-form__field">Status
                                <select value={formEvent.status} onChange={e => handleFormChange("status", e.target.value)}>
                                    {addStatusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </label>
                            <label className="dash-form__field event-form__wide">Description
                                <textarea value={formEvent.description} onChange={e => handleFormChange("description", e.target.value.slice(0, maxDescriptionLength))} maxLength={maxDescriptionLength} required />
                                <span className="event-form__hint">{formEvent.description.length}/{maxDescriptionLength} characters</span>
                            </label>
                            <label className="feature-checklist__item event-form__wide event-form__toggle">
                                <input type="checkbox" checked={formEvent.hasGoogleForm} onChange={e => handleFormChange("hasGoogleForm", e.target.checked)} />
                                <span>Add Google Form URL link</span>
                            </label>
                            {formEvent.hasGoogleForm && (
                                <label className="dash-form__field event-form__wide">Google Form URL
                                    <input type="url" value={formEvent.googleFormUrl} onChange={e => handleFormChange("googleFormUrl", e.target.value)} placeholder="https://forms.google.com/..." required />
                                </label>
                            )}
                            <fieldset className="feature-checklist" aria-invalid={accessError ? "true" : "false"}>
                                <legend>Allowed access</legend>
                                <div className="feature-checklist__grid">
                                    {accessOptions.map(role => (
                                        <label key={role} className="feature-checklist__item">
                                            <input type="checkbox" checked={formEvent.access.includes(role)}
                                                onChange={() => handleFormChange("access",
                                                    formEvent.access.includes(role)
                                                        ? formEvent.access.filter(r => r !== role)
                                                        : [...formEvent.access, role]
                                                )} />
                                            <span>{role}</span>
                                        </label>
                                    ))}
                                </div>
                                {accessError && <p className="event-form__error">{accessError}</p>}
                            </fieldset>
                            <div className="member-modal__actions">
                                <button type="button" className="btn btn--outline" onClick={() => setIsAddModalOpen(false)} disabled={isSaving}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={isSaving}>{isSaving ? "Creating..." : "Create"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── View Event Modal ────────────────────────────────────────────── */}
            {isViewModalOpen && selectedEvent && (
                <div className="member-modal event-modal" role="presentation" onClick={e => handleBackdropClick(e, () => setIsViewModalOpen(false))}>
                    <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true">
                        <ModalHeader eyebrow="Event details" title={selectedEvent.title} onClose={() => setIsViewModalOpen(false)} />
                        <div className="filter-modal__body">
                            <div className="event-view-status">
                                <span className={`event-status event-status--${getStatusClass(selectedEvent.status)}`}>
                                    {isHappeningEvent(selectedEvent) ? "Happening" : selectedEvent.status}
                                </span>
                            </div>
                            <dl className="documents-meta-list event-details-meta">
                                <div><dt>Date and time</dt><dd>{formatDate(selectedEvent.date)} | {formatTime(selectedEvent.time)}</dd></div>
                                <div><dt>Location</dt><dd>{selectedEvent.location}</dd></div>
                                <div><dt>Proponent</dt><dd>{selectedEvent.Proponent}</dd></div>
                                <div><dt>Access</dt><dd>{selectedEvent.access.join(", ")}</dd></div>
                                <div><dt>Attendees</dt><dd>{selectedAttendance.length}</dd></div>
                                {selectedEvent.googleFormUrl && (
                                    <div><dt>Google Form</dt><dd><a className="event-link" href={selectedEvent.googleFormUrl} target="_blank" rel="noreferrer">Open form</a></dd></div>
                                )}
                            </dl>
                            <section className="event-details-description">
                                <h3>Description</h3>
                                <p>{selectedEvent.description}</p>
                            </section>
                            {selectedAttendance.length > 0 && (
                                <div className="attendance-list">
                                    <h3>Recent check-ins</h3>
                                    {selectedAttendance.slice(0, 5).map(record => (
                                        <div key={`${record.code}-${record.scannedAt}`} className="attendance-list__item">
                                            {/* Show resolved member name — falls back to raw QR text */}
                                            <span>{record.member?.name ?? record.code}</span>
                                            <strong>{record.checkedInAt}</strong>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="member-modal__footer event-details-actions">
                            <div className="event-details-actions__danger">
                                {canEdit && !isDoneEvent(selectedEvent) && (
                                    <ConfirmActionButton
                                        className="icon-btn icon-btn--danger"
                                        onConfirm={() => { handleDeleteEvent(selectedEvent.id); setIsViewModalOpen(false); }}
                                        title="Delete this event?"
                                        message={`"${selectedEvent.title}" will be archived and removed from the events list. Its recorded attendance will be kept.`}
                                        confirmLabel="Delete"
                                        cancelLabel="Cancel"
                                    >
                                        <span aria-label={`Delete ${selectedEvent.title}`}><DeleteIcon /></span>
                                    </ConfirmActionButton>
                                )}
                            </div>
                            <div className="event-details-actions__main">
                                {canEdit && !isDoneEvent(selectedEvent) && (
                                    <button type="button" className="icon-btn" aria-label={`Edit ${selectedEvent.title}`} onClick={openEditEventModal}>
                                        <EditIcon />
                                    </button>
                                )}
                                {canViewAttendance(selectedEvent) && (
                                    <button type="button" className="btn btn--outline event-details-actions__attendees"
                                        onClick={() => navigate(`/officers/events/${selectedEvent.id}/attendance`)}>
                                        Show Attendees
                                    </button>
                                )}
                                {canEdit && isHappeningEvent(selectedEvent) && (
                                    <button type="button" className="btn btn--scan btn--icon-only" onClick={() => openScannerModal(selectedEvent.id)} aria-label={`Scan QR for ${selectedEvent.title}`}>
                                        <CameraIcon />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Edit Event Modal ────────────────────────────────────────────── */}
            {isAccessModalOpen && editingEvent && (
                <div className="member-modal event-modal" role="presentation" onClick={e => handleBackdropClick(e, closeEditEventModal)}>
                    <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true">
                        <ModalHeader eyebrow="Event settings" title="Edit Event" onClose={closeEditEventModal} />
                        <form className="member-modal__form" onSubmit={handleSaveEdit}>
                            <label className="dash-form__field">Event title
                                <input value={editingEvent.title} onChange={e => handleEditField("title", e.target.value)} maxLength={50} required />
                            </label>
                            <label className="dash-form__field">Proponent
                                <input value={editingEvent.Proponent} onChange={e => handleEditField("Proponent", e.target.value)} maxLength={50} required />
                            </label>
                            <label className="dash-form__field">Date
                                <input type="date" value={editingEvent.date} onChange={e => handleEditField("date", e.target.value)} required />
                            </label>
                            <label className="dash-form__field">Time
                                <input type="time" value={editingEvent.time} onChange={e => handleEditField("time", e.target.value)} required />
                            </label>
                            <label className="dash-form__field">Location
                                <input value={editingEvent.location} onChange={e => handleEditField("location", e.target.value)} maxLength={50} required />
                            </label>
                            <label className="dash-form__field">Status
                                <select value={editingEvent.status} onChange={e => handleEditField("status", e.target.value)}>
                                    {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </label>
                            <label className="dash-form__field event-form__wide">Description
                                <textarea value={editingEvent.description} onChange={e => handleEditField("description", e.target.value.slice(0, maxDescriptionLength))} maxLength={maxDescriptionLength} required />
                                <span className="event-form__hint">{editingEvent.description.length}/{maxDescriptionLength} characters</span>
                            </label>
                            <label className="feature-checklist__item event-form__wide event-form__toggle">
                                <input type="checkbox" checked={editingEvent.hasGoogleForm} onChange={e => handleEditField("hasGoogleForm", e.target.checked)} />
                                <span>Add Google Form URL link</span>
                            </label>
                            {editingEvent.hasGoogleForm && (
                                <label className="dash-form__field event-form__wide">Google Form URL
                                    <input type="url" value={editingEvent.googleFormUrl} onChange={e => handleEditField("googleFormUrl", e.target.value)} placeholder="https://forms.google.com/..." required />
                                </label>
                            )}
                            <fieldset className="filter-checklist">
                                <legend>Allowed access</legend>
                                <div className="filter-checklist__grid">
                                    {accessOptions.map(role => (
                                        <label key={role} className="feature-checklist__item">
                                            <input type="checkbox" checked={editingEvent.access.includes(role)}
                                                onChange={() => handleEditField("access",
                                                    editingEvent.access.includes(role)
                                                        ? editingEvent.access.filter(r => r !== role)
                                                        : [...editingEvent.access, role]
                                                )} />
                                            <span>{role}</span>
                                        </label>
                                    ))}
                                </div>
                                {accessError && <p className="event-form__error">{accessError}</p>}
                            </fieldset>
                            <div className="member-modal__actions">
                                <button type="button" className="btn btn--outline" onClick={closeEditEventModal} disabled={isSaving}>Cancel</button>
                                <button type="submit" className="btn btn--primary" disabled={isSaving}>{isSaving ? "Saving..." : "Save"}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Filter Modal ────────────────────────────────────────────────── */}
            {isFilterModalOpen && (
                <div className="member-modal event-modal" role="presentation" onClick={e => handleBackdropClick(e, () => setIsFilterModalOpen(false))}>
                    <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true">
                        <ModalHeader eyebrow="Filters" title="Advanced Filter" onClose={() => setIsFilterModalOpen(false)} />
                        <div className="filter-modal__body">
                            <div className="filter-modal__row">
                                <label className="dash-form__field">Status
                                    <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                                        <option value="All">All status</option>
                                        {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </label>
                                <label className="dash-form__field">Month
                                    <select value={filters.month} onChange={e => setFilters(f => ({ ...f, month: e.target.value }))}>
                                        <option value="All">All months</option>
                                        {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                </label>
                            </div>
                            <label className="dash-form__field">Year
                                <select value={filters.year} onChange={e => setFilters(f => ({ ...f, year: e.target.value }))}>
                                    <option value="All">All years</option>
                                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            </label>
                        </div>
                        <div className="member-modal__footer">
                            <button type="button" className="btn btn--outline" onClick={() => setFilters({ status: "All", month: "All", year: "All" })}>Reset</button>
                            <button type="button" className="btn btn--primary" onClick={() => setIsFilterModalOpen(false)}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Scanner Modal ───────────────────────────────────────────────── */}
            {isScannerOpen && scanningEvent && (
                <div className="member-modal event-modal" role="presentation" onClick={e => handleBackdropClick(e, closeScannerModal)}>
                    <div className="member-modal__panel member-modal__panel--filter" role="dialog" aria-modal="true">
                        <ModalHeader eyebrow="Event check-in" title={`Scan QR - ${scanningEvent.title}`} onClose={closeScannerModal} />
                        <div className="filter-modal__body">
                            <dl className="documents-meta-list qr-scanner-event">
                                <div><dt>Event</dt><dd>{scanningEvent.title}</dd></div>
                                <div><dt>Schedule</dt><dd>{formatDate(scanningEvent.date)} | {formatTime(scanningEvent.time)}</dd></div>
                            </dl>
                            <div className="qr-scanner-layout">
                                <div className="qr-scanner">
                                    <div key={scannerSessionKey} id={scannerElementId} className="qr-scanner__reader" />
                                    {scannerStatus && !scanResult && <p className="qr-scanner__status">{scannerStatus}</p>}
                                </div>
                                <div className="attendance-list qr-attendance-list">
                                    <h3>Scanned for this event</h3>
                                    {scanningAttendance.length > 0 ? (
                                        scanningAttendance.map(record => (
                                            <div key={`${record.code}-${record.scannedAt}`} className="attendance-list__item">
                                                <span>{record.member?.name ?? record.code}</span>
                                                <strong>{record.checkedInAt}</strong>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="attendance-list__empty">No QR codes scanned yet.</p>
                                    )}
                                </div>
                            </div>
                            {scannerError && <p className="event-form__error">{scannerError}</p>}
                            {scanResult && (
                                <div className={`qr-scan-result ${scannerError ? "qr-scan-result--warning" : ""}`}>
                                    <span>{scannerError ? "Duplicate scan" : "Checked in"}</span>
                                    <strong>{scanResult}</strong>
                                </div>
                            )}
                        </div>
                        <div className="member-modal__footer">
                            <button type="button" className="btn btn--outline"
                                onClick={() => {
                                    clearScannerRestart();
                                    setScanResult(""); setScannerError(""); setIsAttendanceSuccessOpen(false);
                                    scheduleScannerRestart();
                                }}>
                                Scan Again
                            </button>
                            <button type="button" className="btn btn--primary" onClick={closeScannerModal}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            <SuccessDialog isOpen={isSuccessDialogOpen}     title="Event Added"      message="The event was created successfully."                          buttonLabel="Done" onClose={() => setIsSuccessDialogOpen(false)} />
            <SuccessDialog isOpen={isAttendanceSuccessOpen} title="Attendance Done"  message="The QR code was scanned and attendance was recorded."         buttonLabel="OK"   onClose={() => setIsAttendanceSuccessOpen(false)} />
        </>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModalHeader({ eyebrow, title, onClose }) {
    return (
        <div className="member-modal__header">
            <div>
                <p className="member-modal__eyebrow">{eyebrow}</p>
                <h2 className="member-modal__title">{title}</h2>
            </div>
            <button type="button" className="icon-btn icon-btn--plain" onClick={onClose} aria-label="Close modal">
                <CloseIcon />
            </button>
        </div>
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(v) {
    if (!v) return "Date to be set";
    return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(`${v}T00:00:00`));
}

function formatTime(v) {
    if (!v) return "Time to be set";
    const [h, m] = v.split(":");
    const d = new Date(); d.setHours(Number(h), Number(m), 0, 0);
    return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(d);
}

function isHappeningEvent(e)  { return e.status === "Open"; }
function isDoneEvent(e)        { return e.status === "Closed" || e.status === "Done"; }
function canViewAttendance(e)  { return isHappeningEvent(e) || isDoneEvent(e); }
function getStatusClass(s)     { return s.toLowerCase().replace(/\s+/g, "-"); }
function getNewest(records)    { return [...records].sort((a, b) => (b.scannedAt ?? 0) - (a.scannedAt ?? 0)); }

function CameraIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M8.5 4 7 6H4c-.6 0-1 .2-1.4.6C2.2 7 2 7.4 2 8v10c0 .6.2 1 .6 1.4.4.4.8.6 1.4.6h16c.6 0 1-.2 1.4-.6.4-.4.6-.8.6-1.4V8c0-.6-.2-1-.6-1.4C21 6.2 20.6 6 20 6h-3l-1.5-2h-7ZM12 17.5c-1.2 0-2.2-.4-3-1.3-.8-.8-1.3-1.8-1.3-3s.4-2.2 1.3-3c.8-.8 1.8-1.3 3-1.3s2.2.4 3 1.3c.8.8 1.3 1.8 1.3 3s-.4 2.2-1.3 3c-.8.9-1.8 1.3-3 1.3Zm0-2c.6 0 1.2-.2 1.6-.7.4-.4.7-1 .7-1.6s-.2-1.2-.7-1.6c-.4-.4-1-.7-1.6-.7s-1.2.2-1.6.7c-.4.4-.7 1-.7 1.6s.2 1.2.7 1.6c.4.5 1 .7 1.6.7Z" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19Z" />
        </svg>
    );
}