import "../../assets/styles/officers/Sidebar.css";
import logo from '../../assets/images/LITL_Logo.png';
import { useRole } from '../../utils/useRole.js';

// Which RBAC module gates each nav item. A page with NONE access is hidden
// entirely from the nav (the backend also blocks the API either way).
// Dashboard and Documents have no RBAC — every officer can see them, so
// they're intentionally left out of this map. Hash Chain also has no RBAC,
// but is hidden specifically for the Adviser (handled separately below).
const NAV_ITEM_MODULES = {
  'members-list': 'MEMBER_LIST',
  audit:          'AUDIT',
  events:         'EVENT',
  certification:  'CERTIFICATION',
  financial:      'FINANCIAL',
  'activity-logs': 'ACTIVITY_LOGS',
};

const defaultNavItems = [
  {
    label: "Dashboard",
    icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M520-600v-240h320v240H520ZM120-440v-400h320v400H120Zm400 320v-400h320v400H520Zm-400 0v-240h320v240H120Zm80-400h160v-240H200v240Zm400 320h160v-240H600v240Zm0-480h160v-80H600v80ZM200-200h160v-80H200v80Zm160-320Zm240-160Zm0 240ZM360-280Z" /></svg>),
    page: "dashboard"
  },
  {
    label: "Members List",
    icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm720 0v-120q0-44-24.5-84.5T666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120H760ZM247-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm466 0q-47 47-113 47-11 0-28-2.5t-28-5.5q27-32 41.5-71t14.5-81q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113q0 66-47 113ZM120-240h480v-32q0-11-5.5-20T580-306q-54-27-109-40.5T360-360q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q440-607 440-640t-23.5-56.5Q393-720 360-720t-56.5 23.5Q280-673 280-640t23.5 56.5Q327-560 360-560t56.5-23.5ZM360-240Zm0-400Z" /></svg>),
    page: "members-list"
  },
  {
    label: "Audit",
    icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h360l200 200v520q0 33-23.5 56.5T720-80H240Zm320-560v-160H240v640h480v-480H560Z" /></svg>),
    page: "audit"
  },
  {
    label: "Hash Chain",
    icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M280-280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h120v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h120v80H280Zm80-160v-80h240v80H360Zm200 160v-80h120q50 0 85-35t35-85q0-50-35-85t-85-35H560v-80h120q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H560Z" /></svg>),
    page: "hash-chain"
  },
  {
    label: "Events",
    icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-160 0q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480q17 0 28.5 11.5T360-440q0 17-11.5 28.5T320-400Zm320 0q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400Z" /></svg>),
    page: "events"
  },
  {
    label: "Documents",
    icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520Z" /></svg>),
    page: "documents"
  },
  {
    label: "Certification",
    icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M480-80 360-200H200v-160L80-480l120-120v-160h160l120-120 120 120h160v160l120 120-120 120v160H600L480-80Zm0-112 86-88h114v-114l88-86-88-86v-114H566l-86-88-86 88H280v114l-88 86 88 86v114h114l86 88Zm-42-146 226-226-56-58-170 170-86-84-56 56 142 142Zm42-142Z" /></svg>),
    page: "certification"
  },
  {
    label: "Financial",
    icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M200-120q-33 0-56.5-23.5T120-200v-640h80v640h640v80H200Zm40-120v-360h160v360H240Zm200 0v-560h160v560H440Zm200 0v-200h160v200H640Z" /></svg>),
    page: "financial"
  },
];

const activityLogsItem = {
  label: "Activity Logs",
  icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="M160-120q-33 0-56.5-23.5T80-200v-560q0-33 23.5-56.5T160-840h560q33 0 56.5 23.5T800-760v80h-80v-80H160v560h560v-80h80v80q0 33-23.5 56.5T720-120H160Zm160-160-56-56 144-144-144-144 56-56 200 200-200 200Zm240 0v-80h320v80H560Zm0-160v-80h320v80H560Zm0-160v-80h320v80H560Z" /></svg>),
  page: "activity-logs"
};

const settingsItem = {
  label: "Settings",
  icon: (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#000000"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm110-280q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Z" /></svg>),
  page: "settings"
};

export default function Sidebar({
  currentPage,
  onNavigate,
  isOpen,
  onClose,
  navItems = defaultNavItems,
  title = "LITL MIS",
  isCollapsed = false,
}) {
  const { can, role } = useRole();

  // Hide any nav item whose gating module resolves to NONE for this role.
  // Hash Chain has no RBAC module but is still hidden from the Adviser, who
  // has no access to it at all.
  const visibleItems = navItems.filter((item) => {
    if (item.page === 'hash-chain') return role !== 'ADVISER_DEPT_CHAIR';
    const module = NAV_ITEM_MODULES[item.page];
    return !module || can(module, 'VIEW');
  });

  const showActivityLogs = can('ACTIVITY_LOGS', 'VIEW');
  const showSettings = can('SETTINGS_ROLES', 'VIEW') || can('SETTINGS_DESIGN', 'VIEW') || can('FINANCIAL', 'EDIT');

  return (
    <>
      {isOpen && (
        <div className="sidebar-overlay" onClick={onClose} />
      )}

      <aside className={`sidebar ${isOpen ? "sidebar--open" : ""} ${isCollapsed ? "sidebar--collapsed" : ""}`}>
        <div className="sidebar__brand">
          <button
            type="button"
            className="sidebar__brand-btn"
            onClick={() => {
              onNavigate?.("dashboard");
              onClose?.();
            }}
            title="Go to Dashboard"
          >
            <span className="sidebar__logo">
              <img src={logo} alt="LITL Logo" className="sidebar__logo-img" />
            </span>
            <span className="sidebar__title">
              {title === "LITL MIS" ? (
                <>
                  <span className="sidebar__title-main">LITL</span>
                  <span className="sidebar__title-tag">MIS</span>
                </>
              ) : (
                title
              )}
            </span>
          </button>
        </div>

        <nav className="sidebar__nav">
          {visibleItems.map((item) => (
            <button
              key={item.page}
              className={`sidebar__item ${currentPage === item.page ? "sidebar__item--active" : ""}`}
              onClick={() => {
                onNavigate?.(item.page);
                onClose?.();
              }}
              data-tooltip={item.label}
              title={isCollapsed ? item.label : undefined}
            >
              <span className="sidebar__icon">{item.icon}</span>
              <span className="sidebar__label">{item.label}</span>
            </button>
          ))}

          {showActivityLogs && (
            <button
              className={`sidebar__item ${currentPage === activityLogsItem.page ? "sidebar__item--active" : ""}`}
              onClick={() => {
                onNavigate?.(activityLogsItem.page);
                onClose?.();
              }}
              data-tooltip={activityLogsItem.label}
              title={isCollapsed ? activityLogsItem.label : undefined}
            >
              <span className="sidebar__icon">{activityLogsItem.icon}</span>
              <span className="sidebar__label">{activityLogsItem.label}</span>
            </button>
          )}

          {showSettings && (
            <button
              className={`sidebar__item ${currentPage === settingsItem.page ? "sidebar__item--active" : ""}`}
              onClick={() => {
                onNavigate?.(settingsItem.page);
                onClose?.();
              }}
              data-tooltip={settingsItem.label}
              title={isCollapsed ? settingsItem.label : undefined}
            >
              <span className="sidebar__icon">{settingsItem.icon}</span>
              <span className="sidebar__label">{settingsItem.label}</span>
            </button>
          )}
        </nav>

        <div className="sidebar__footer">
          <p className="sidebar__footer-text">
            &copy; {new Date().getFullYear()} League of Information Technology Leaders
          </p>
        </div>
      </aside>
    </>
  );
}