import { lazy } from "react";
import LazyPage from "./LazyPage";
const Members = lazy(() => import("../pages/Members/Members"));
const QRCode = lazy(() => import("../pages/Members/QRCode"));
const Documents = lazy(() => import("../pages/Members/Documents"));
const Events = lazy(() => import("../pages/Members/Events"));
const Membership = lazy(() => import("../pages/Members/Membership"));
const Profile = lazy(() => import("../pages/Members/Profile"));
const Settings = lazy(() => import("../pages/Members/Settings"));

export const memberRoutes = [
  { index: true, element: <LazyPage><Members /></LazyPage> },
  { path: "qrcode", element: <LazyPage><QRCode /></LazyPage> },
  { path: "documents", element: <LazyPage><Documents /></LazyPage> },
  { path: "events", element: <LazyPage><Events /></LazyPage> },
  { path: "membership", element: <LazyPage><Membership /></LazyPage> },
  { path: "profile", element: <LazyPage><Profile /></LazyPage> },
  { path: "settings", element: <LazyPage><Settings /></LazyPage> },
];
