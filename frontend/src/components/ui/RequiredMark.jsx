// Red asterisk placed right after a required field's label text. Screen
// readers already announce the input's `required` attribute, so the mark
// itself is hidden from them.
export default function RequiredMark() {
  return <span className="required-mark" aria-hidden="true">*</span>;
}
