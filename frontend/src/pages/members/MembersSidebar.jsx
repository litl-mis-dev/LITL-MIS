import "../../assets/styles/officers/Sidebar.css";
import logo from '../../assets/images/LITL_Logo.png';

const defaultNavItems = [
  {
    label: "Dashboard",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
        <path d="M520-600v-240h320v240H520ZM120-440v-400h320v400H120Zm400 320v-400h320v400H520Zm-400 0v-240h320v240H120Zm80-400h160v-240H200v240Zm400 320h160v-240H600v240Zm0-480h160v-80H600v80ZM200-200h160v-80H200v80Zm160-320Zm240-160Zm0 240ZM360-280Z" />
      </svg>
    ),
    page: "dashboard",
  },
  {
    label: "Digital ID",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
        <path d="M120-760v-160h160v80H200v80h-80Zm0 560v-160h80v80h80v80H120Zm560 0v-80h80v-80h80v160H680ZM680-760v-80h80v80h-80Zm-480 400v-240h240v240H200Zm80-80h80v-80h-80v80Zm-80-320v-240h240v240H200Zm80-80h80v-80h-80v80Zm320 400v-240h240v240H600Zm80-80h80v-80h-80v80Zm-80-320v-240h240v240H600Zm80-80h80v-80h-80v80ZM440-440v-80h80v80h-80Zm0-160v-80h80v80h-80Zm-80 80v-80h80v80h-80Zm160 0v-80h80v80h-80Zm0 160v-80h80v80h-80Zm80-80v-80h80v80h-80Z" />
      </svg>
    ),
    page: "qr",
  },
  {
    label: "Documents",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
        <path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520Z" />
      </svg>
    ),
    page: "documents",
  },
  {
    label: "Events",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
        <path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-160 0q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480q17 0 28.5 11.5T360-440q0 17-11.5 28.5T320-400Zm320 0q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400Z" />
      </svg>
    ),
    page: "events",
  },
  {
    label: "Membership",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
        <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm-35-145 230-230-56-57-174 174-84-84-56 57 140 140Z" />
      </svg>
    ),
    page: "membership",
  },
];

export default function MembersSidebar({
  currentPage,
  onNavigate,
  isOpen,
  onClose,
  navItems = defaultNavItems,
  title = "LITL MIS",
  isCollapsed = false,
}) {
  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
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
          {navItems.map((item) => (
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
