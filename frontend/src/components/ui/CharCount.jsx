// "12/50" under a text field, so people see how much room is left; amber near
// the limit and red at it. Pair it with the field's own maxLength. Screen
// readers already announce maxLength, so the count is hidden from them.
export default function CharCount({ value, max }) {
    const length = String(value ?? "").length;
    const state = length >= max ? " char-count--full" : length >= max * 0.9 ? " char-count--near" : "";
    return <span className={`char-count${state}`} aria-hidden="true">{length}/{max}</span>;
}
