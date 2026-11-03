import LandingPages from "../pages/LandingPage";
import Login from "../pages/auth/Login";
import Registration from "../pages/auth/Registration";
import OneTimePassword from "../pages/auth/OneTimePassword";
import ForgotPassword from "../pages/ForgotPassword";
import ResetPassword from "../pages/ResetPassword";
import CertificateVerificationPage from "../pages/CertificateVerificationPage";
import AcceptAdviserInvite from "../pages/auth/AcceptAdviserInvite";

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
        element: <CertificateVerificationPage />,
    },
    {
        path: "/verify/:token",
        element: <CertificateVerificationPage />,
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
