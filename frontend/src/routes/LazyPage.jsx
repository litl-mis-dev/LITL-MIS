import { Suspense } from "react";
import LogoLoader from "../components/LogoLoader";

export default function LazyPage({ children }) {
  return <Suspense fallback={<LogoLoader />}>{children}</Suspense>;
}