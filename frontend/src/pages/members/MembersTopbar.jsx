import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isNonMemberRole } from "../../utils/roles";
import { useNotifications } from "../../context/NotificationContext";
import { timeAgo } from "../../utils/timeAgo";
import ImportantAnnouncements from "../../components/notifications/ImportantAnnouncements.jsx";
import PushPrompt from "../../components/notifications/PushPrompt.jsx";
import "../../assets/styles/officers/Topbar.css";
import { useAutoCloseModal } from "../../utils/useAutoCloseModal.js";

export default function Topbar({ onMenuToggle, onNavigate, isCollapsed = false }) {
  const [showNotif, setShowNotif] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSwitchingDashboard, setIsSwitchingDashboard] = useState(false);
  const switchTimerRef = useRef(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead, removeNotification, clearAll, importantAnnouncements } = useNotifications();
  const [isExpanded, setIsExpanded] = useState(false);
    const notifRef = useRef(null);

  // Close notifications on outside click, Escape, or when another modal opens.
  useAutoCloseModal({
    isOpen: showNotif,
    containerRef: notifRef,
    onClose: () => {
      setShowNotif(false);
      setIsExpanded(false);
    },
  });
  const userRef = useRef(null);

  // Close the account menu on outside click, Escape, or when another modal opens.
  useAutoCloseModal({
    isOpen: showUser,
    containerRef: userRef,
    onClose: () => setShowUser(false),
  });
  const canSwitchDashboard = user?.role && user.role !== "MEMBER" && !isNonMemberRole(user.role);
  const displayName = getDisplayName(user, canSwitchDashboard ? "Officer" : "Member");
  const displayRole = formatRole(user?.role ?? "Member");
  const displayAvatar = getAvatar(user);

  useEffect(() => {
    return () => window.clearTimeout(switchTimerRef.current);
  }, []);

  function handleSwitchDashboard() {
    setShowUser(false);
    setIsSwitchingDashboard(true);
    switchTimerRef.current = window.setTimeout(() => {
      navigate("/officers/dashboard");
    }, 360);
  }

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      await logout();
      setShowUser(false);
      navigate("/", { replace: true });
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <header className={`topbar ${isCollapsed ? "topbar--collapsed" : ""}`}>
      <button
        className="topbar__menu-btn"
        onClick={onMenuToggle}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span /><span /><span />
      </button>

      <div className="topbar__status" />

      <div className="topbar__actions">
        <div className="topbar__notif-wrapper" ref={notifRef}>
          <button
            className="topbar__icon-btn"
            onClick={() => {
              setShowNotif(!showNotif);
              setShowUser(false);
            }}
            aria-label="Notifications"
          >
            <BellIcon />
            {unreadCount > 0 && <span className="topbar__badge">{unreadCount}</span>}
          </button>
          {showNotif && !isExpanded && (
            <div className="topbar__dropdown">
              <div className="topbar__dropdown-header">
                <p className="topbar__dropdown-title">Notifications</p>
                <div className="topbar__notif-header-actions">
                  {unreadCount > 0 && (
                    <button className="topbar__notif-action-btn" onClick={markAllRead}>
                      Mark all as read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button className="topbar__notif-action-btn" onClick={clearAll}>
                      Clear all
                    </button>
                  )}
                </div>
              </div>

              <div className="topbar__notif-list">
                <PushPrompt />
                <ImportantAnnouncements announcements={importantAnnouncements} />
                {notifications.length === 0 && (
                  <p className="topbar__notif-empty">No notifications yet.</p>
                )}
                {notifications.slice(0, 8).map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onOpen={() => {
                      if (!notification.isRead) markRead(notification.id);
                      setShowNotif(false);
                      if (notification.link) navigate(notification.link);
                    }}
                    onRemove={(e) => {
                      e.stopPropagation();
                      removeNotification(notification.id);
                    }}
                  />
                ))}
              </div>

              {notifications.length > 0 && (
                <button
                  className="topbar__notif-see-all"
                  onClick={() => setIsExpanded(true)}
                >
                  See all notifications
                </button>
              )}
            </div>
          )}

          {showNotif && isExpanded && (
            <div
              className="topbar__notif-overlay"
              role="dialog"
              aria-modal="true"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowNotif(false);
                  setIsExpanded(false);
                }
              }}
            >
              <div className="topbar__notif-expanded-panel">
                <div className="topbar__dropdown-header">
                  <p className="topbar__dropdown-title">All Notifications</p>
                  <div className="topbar__notif-header-actions">
                    {unreadCount > 0 && (
                      <button className="topbar__notif-action-btn" onClick={markAllRead}>
                        Mark all as read
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button className="topbar__notif-action-btn" onClick={clearAll}>
                        Clear all
                      </button>
                    )}
                    <button
                      className="icon-btn icon-btn--plain"
                      onClick={() => setIsExpanded(false)}
                      aria-label="Close"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                </div>

                <div className="topbar__notif-list topbar__notif-list--expanded">
                  <PushPrompt />
                <ImportantAnnouncements announcements={importantAnnouncements} />
                  {notifications.length === 0 && (
                    <p className="topbar__notif-empty">No notifications yet.</p>
                  )}
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onOpen={() => {
                        if (!notification.isRead) markRead(notification.id);
                        setShowNotif(false);
                        setIsExpanded(false);
                        if (notification.link) navigate(notification.link);
                      }}
                      onRemove={(e) => {
                        e.stopPropagation();
                        removeNotification(notification.id);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="topbar__user-wrapper" ref={userRef}>
          <button
            className="topbar__user-btn"
            onClick={() => {
              setShowUser(!showUser);
              setShowNotif(false);
            }}
            aria-label="Account menu"
          >
            {displayAvatar ? (
              <img src={displayAvatar} alt={displayName} className="topbar__avatar" />
            ) : (
              <span className="topbar__avatar topbar__avatar--initials">
                {getInitials(displayName, "O")}
              </span>
            )}
            <div className="topbar__user-info">
              <span className="topbar__user-name">{displayName}</span>
              <span className="topbar__user-role">{displayRole}</span>
            </div>
            <span className="topbar__caret">v</span>
          </button>
          {showUser && (
            <div className="topbar__dropdown topbar__dropdown--right">
              <button className="topbar__dd-item" onClick={() => { onNavigate("profile"); setShowUser(false); }}>
                Profile
              </button>
              {canSwitchDashboard && (
                <button className="topbar__dd-item" onClick={handleSwitchDashboard} disabled={isSwitchingDashboard}>
                  Switch dashboard
                </button>
              )}
              <hr className="topbar__dd-divider" />
              <button
                className="topbar__dd-item topbar__dd-item--danger"
                onClick={handleSignOut}
                disabled={isSigningOut}
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </div>
      {isSwitchingDashboard && (
        <div className="dashboard-switch-transition" role="status" aria-live="polite">
          <div className="dashboard-switch-transition__panel">
            <span className="dashboard-switch-transition__spinner" aria-hidden="true" />
            <span>Switching dashboard...</span>
          </div>
        </div>
      )}
    </header>
  );
}

function getDisplayName(user, fallback) {
  return user?.name || user?.fullName || user?.email || fallback;
}

function getAvatar(user) {
  return user?.member?.avatar || user?.avatar || "";
}

function getInitials(name, fallback) {
  return name
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || fallback;
}

function formatRole(role) {
  return role
    .toString()
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="topbar__icon-svg">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function NotificationItem({ notification, onOpen, onRemove }) {
  return (
    <div
      className={`topbar__notif-item ${notification.isRead ? "" : "topbar__notif-item--unread"}`}
      onClick={onOpen}
    >
      <span className="topbar__notif-dot" />
      <div className="topbar__notif-body">
        <p className="topbar__notif-title-line">{notification.title}</p>
        <p className="topbar__notif-text">{notification.message}</p>
        <p className="topbar__notif-time">{timeAgo(notification.createdAt)}</p>
      </div>
      <button
        className="topbar__notif-remove"
        onClick={onRemove}
        aria-label="Remove notification"
        title="Remove notification"
      >
        ×
      </button>
    </div>
  );
}
