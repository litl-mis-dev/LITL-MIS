import { lazy } from "react";
import LazyPage from "./LazyPage";
import LandingPages from "../pages/LandingPage";
import Login from "../pages/auth/Login";
import Registration from "../pages/auth/Registration";
import OneTimePassword from "../pages/auth/OneTimePassword";
import ForgotPassword from "../pages/ForgotPassword";
import ResetPassword from "../pages/ResetPassword";
import AcceptAdviserInvite from "../pages/auth/AcceptAdviserInvite";

// Loaded only when opened: it carries the camera QR scanner library, which
// otherwise every visitor downloaded with the first page.
const CertificateVerificationPage = lazy(() => import("../pages/CertificateVerificationPage"));

export const authRoutes = [
    {
        path: "/",
        element: <LandingPages />,
    },
    {
        path: "/login",
        element: <Login />,
    },
    {
        path: "/verify",
        element: <LazyPage><CertificateVerificationPage /></LazyPage>,
    },
    {
        path: "/verify/:token",
        element: <LazyPage><CertificateVerificationPage /></LazyPage>,
    },
    {
        path: "/register",
        element: <Registration />,
    },
    {
        path: "/otp",
        element: <OneTimePassword />,
    },
    {
        path: "/forgot-password",
        element: <ForgotPassword />,
    },
    {
        path: "/reset-password",
        element: <ResetPassword />,
    },
    {
        // Opened from the President's invitation email (token in the #fragment).
        path: "/adviser-invite",
        element: <AcceptAdviserInvite />,
    },
];
