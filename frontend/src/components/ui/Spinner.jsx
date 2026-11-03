// Small inline spinner. Inherits the text color and size (1em), so it fits
// next to any label. Decorative — pair it with visible text or LoadingState.
export default function Spinner({ className = "" }) {
  return <span className={`ui-spinner ${className}`.trim()} aria-hidden="true" />;
}
