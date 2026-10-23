import { lazy } from "react";
import LazyPage from "./LazyPage";
import ProtectedRoute from "./ProtectedRoute";
import { HASH_CHAIN_ROLES, MEMBER_SIDE_ROLES } from "../utils/roles";

const Dashboard = lazy(() => import("../pages/officers/Dashboard"));
const MembersList = lazy(() => import("../pages/officers/members-list/MembersList"));
const Profile = lazy(() => import("../pages/officers/Profile"));
const Financial = lazy(() => import("../pages/officers/financial/Financial"));
const SwitchDashboard = lazy(() => import("../pages/officers/SwitchDashboard"));
const Audit = lazy(() => import("../pages/officers/Audit"));
const ActivityLogs = lazy(() => import("../pages/officers/ActivityLogs"));
const Documents = lazy(() => import("../pages/officers/Documents"));
const Events = lazy(() => import("../pages/officers/events/Events"));
const EventAttendance = lazy(() => import("../pages/officers/events/EventAttendance"));
const HashChainMonitoring = lazy(() => import("../pages/officers/HashChainMonitoring"));
const Settings = lazy(() => import("../pages/officers/settings/Settings"));
const Certification = lazy(() => import("../pages/officers/Certification"));

export const officersRoutes = [
    {
        path: "dashboard",
        // No RBAC on Dashboard — every officer can view it.
        element: <LazyPage><Dashboard /></LazyPage>,
    },
    {
        path: "members-list",
        element: <LazyPage><MembersList /></LazyPage>,
        module: "MEMBER_LIST",
    },
    {
        path: "audit",
        element: <LazyPage><Audit /></LazyPage>,
        module: "AUDIT",
    },
    {
        path: "hash-chain",
        // No RBAC on Hash Chain — every officer can view it EXCEPT the
        // Adviser / Dept. Chair, who has no access to this module at all.
        element: (
            <ProtectedRoute allowedRoles={HASH_CHAIN_ROLES}>
                <LazyPage><HashChainMonitoring /></LazyPage>
            </ProtectedRoute>
        ),
    },
    {
        path: "activity-logs",
        element: <LazyPage><ActivityLogs /></LazyPage>,
        module: "ACTIVITY_LOGS",
    },
    {
        path: "settings",
        element: <LazyPage><Settings /></LazyPage>,
        // No single module — Settings.jsx renders whichever section(s) the
        // role actually has access to, and an empty state if none.
    },
    {
        path: "events",
        element: <LazyPage><Events /></LazyPage>,
        module: "EVENT",
    },
    {
        path: "events/:eventId/attendance",
        element: <LazyPage><EventAttendance /></LazyPage>,
        module: "EVENT",
    },
    {
        path: "documents",
        // No RBAC on Documents — every officer can access it. Edit vs
        // view-only (Adviser) is handled inside the page itself.
        element: <LazyPage><Documents /></LazyPage>,
    },
    {
        path: "certification",
        element: <LazyPage><Certification /></LazyPage>,
        module: "CERTIFICATION",
    },
    {
        path: "financial",
        element: <LazyPage><Financial /></LazyPage>,
        module: "FINANCIAL",
    },
    {
        path: "fund-report",
        element: <LazyPage><Financial initialSection="fund-report" /></LazyPage>,
        module: "FINANCIAL",
    },
    {
        path: "disbursement",
        element: <LazyPage><Financial initialSection="disbursement" /></LazyPage>,
        module: "FINANCIAL",
    },
    {
        path: "returning",
        element: <LazyPage><Financial initialSection="returning" /></LazyPage>,
        module: "FINANCIAL",
    },
    {
        path: "switch-dashboard",
        // The Adviser has no Member side, so no Member/Officer switch either.
        element: (
            <ProtectedRoute allowedRoles={MEMBER_SIDE_ROLES}>
                <LazyPage><SwitchDashboard /></LazyPage>
            </ProtectedRoute>
        ),
    },
    {
        path: "profile",
        element: <LazyPage><Profile /></LazyPage>,
    },
];