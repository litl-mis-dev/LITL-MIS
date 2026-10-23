import { lazy } from "react";
import LazyPage from "./LazyPage";
const Members = lazy(() => import("../pages/members/Members"));
const QRCode = lazy(() => import("../pages/members/QRCode"));
const Documents = lazy(() => import("../pages/members/Documents"));
const Events = lazy(() => import("../pages/members/Events"));
const Membership = lazy(() => import("../pages/members/Membership"));
const Profile = lazy(() => import("../pages/members/Profile"));
const Settings = lazy(() => import("../pages/members/Settings"));

export const memberRoutes = [
  { index: true, element: <LazyPage><Members /></LazyPage> },
  { path: "qrcode", element: <LazyPage><QRCode /></LazyPage> },
  { path: "documents", element: <LazyPage><Documents /></LazyPage> },
  { path: "events", element: <LazyPage><Events /></LazyPage> },
  { path: "membership", element: <LazyPage><Membership /></LazyPage> },
  { path: "profile", element: <LazyPage><Profile /></LazyPage> },
  { path: "settings", element: <LazyPage><Settings /></LazyPage> },
];
