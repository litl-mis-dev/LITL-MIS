// "(optional)" after the label of a field that may be left empty, so every
// form says which fields are required (RequiredMark) and which are not.
export default function OptionalMark() {
  return <span className="optional-mark"> (optional)</span>;
}
