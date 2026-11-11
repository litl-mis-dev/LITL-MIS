import { createPortal } from "react-dom";

// Renders a modal straight into <body>. A modal opened from inside a page
// card (or the top bar) would otherwise be trapped in that element's layer,
// so the sidebar, top bar or a later card could cover it. Layers come from
// the --z-* scale in App.css.
export default function ModalPortal({ children }) {
  return createPortal(children, document.body);
}
