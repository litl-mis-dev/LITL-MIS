import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { pageDetails } from "../data/officers/dashboardData";

const APP_NAME = "LITL MIS";

// Same names as each page's own heading.
const PUBLIC_TITLES = {
    "/login": "Sign in",
    "/register": "Student Registration",
    "/otp": "Verify your email",
    "/forgot-password": "Forgot password?",
    "/reset-password": "Set new password",
    "/verify": "Verify a certificate",
    "/adviser-invite": "Accept invitation",
};

const MEMBER_TITLES = {
    "": "Dashboard",
    qrcode: "Membership Card",
    documents: "Documents",
    events: "Events",
    membership: "Membership",
    profile: "Profile",
};

function titleFor(pathname) {
    const [section, page = "", ...rest] = pathname.replace(/\/+$/, "").split("/").slice(1);
    if (section === "officers") {
        if (page === "events" && rest.at(-1) === "attendance") return "Event Attendance";
        return pageDetails[page]?.title ?? null;
    }
    if (section === "members") return MEMBER_TITLES[page] ?? null;
    if (section === "developer") return "Developer";
    if (section === "verify") return PUBLIC_TITLES["/verify"];
    return PUBLIC_TITLES[`/${section ?? ""}`] ?? null;
}

// Gives every page its own browser-tab title ("Members List · LITL MIS"), so
// tabs, bookmarks, history and screen readers can tell pages apart.
export default function PageTitle() {
    const { pathname } = useLocation();
    useEffect(() => {
        const title = titleFor(pathname);
        document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
    }, [pathname]);
    return null;
}
