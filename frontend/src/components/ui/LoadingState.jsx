import Spinner from "./Spinner";

// Loading feedback for a section, table, panel or form while its data loads.
// `inline` is the compact, left-aligned version for inside cards and forms.
// (Full pages use LogoLoader; buttons just get aria-busy.)
export default function LoadingState({ label = "Loading…", inline = false, className = "" }) {
  return (
    <div
      className={`ui-loading ${inline ? "ui-loading--inline" : ""} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
