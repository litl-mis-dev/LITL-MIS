import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "../../components/officers/Sidebar.jsx";
import Topbar from "../../components/officers/Topbar.jsx";
import "../../assets/styles/officers/Dashboard.css";

const pagePaths = {
    dashboard: "/officers/dashboard",
    "members-list": "/officers/members-list",
    financial: "/officers/financial",
    audit: "/officers/audit",
    "hash-chain": "/officers/hash-chain",
    "activity-logs": "/officers/activity-logs",
    settings: "/officers/settings",
    events: "/officers/events",
    documents: "/officers/documents",
    certification: "/officers/certification",

    // Profile dropdown
    profile: "/officers/profile",
    "switch-dashboard": "/officers/switch-dashboard",
};

const pathPages = Object.fromEntries(
    Object.entries(pagePaths).map(([page, path]) => [path, page])
);

export default function DashboardLayout() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
        try {
            return localStorage.getItem("litl_sidebar_collapsed") === "true";
        } catch {
            return false;
        }
    });
    const navigate = useNavigate();
    const location = useLocation();
    const currentPage = getCurrentPage(location.pathname);

    function handleNavigate(page) {
        navigate(pagePaths[page] ?? "/");
        setIsSidebarOpen(false);
    }

    function handleToggleCollapse() {
        setIsSidebarCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem("litl_sidebar_collapsed", String(next));
            } catch {}
            return next;
        });
    }

    function handleMenuToggle() {
        if (typeof window !== "undefined" && window.innerWidth >= 1024) {
            handleToggleCollapse();
        } else {
            setIsSidebarOpen((isOpen) => !isOpen);
        }
    }

    return (
        <>
            <Sidebar
                currentPage={currentPage}
                onNavigate={handleNavigate}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                isCollapsed={isSidebarCollapsed}
            />
            <Topbar
                onMenuToggle={handleMenuToggle}
                onNavigate={handleNavigate}
                isCollapsed={isSidebarCollapsed}
            />
            <div className={`dash ${isSidebarCollapsed ? "dash--collapsed" : ""}`}>
                {/* Pages show immediately (with a short fade-in, see App.css);
                    each page shows its own loading state while its data loads. */}
                <Outlet context={{ onNavigate: handleNavigate }} />
            </div>
        </>
    );
}

function getCurrentPage(pathname) {
    if (pathname.startsWith("/officers/events")) {
        return "events";
    }

    if (
        pathname === "/officers/financial" ||
        pathname === "/officers/fund-report" ||
        pathname === "/officers/disbursement" ||
        pathname === "/officers/returning"
    ) {
        return "financial";
    }

    return pathPages[pathname] ?? "dashboard";
}
