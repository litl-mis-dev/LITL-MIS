// Shared rules for form inputs, used by every form that takes a schedule or a
// person's name. The backend enforces the same date/time rules
// (backend/src/utils/schedule.js) — these only keep the inputs in line.

// Class hours: the only times a schedule may be set to.
export const CLASS_HOURS_START = "07:00";
export const CLASS_HOURS_END = "22:00";
export const CLASS_HOURS_MESSAGE = "Choose a time within class hours (7:00 AM to 10:00 PM).";
export const PAST_DATE_MESSAGE = "Choose today or a future date.";

// Today as "YYYY-MM-DD" in the user's own timezone. (toISOString() is UTC,
// which is still "yesterday" before 8 AM in the Philippines.)
export function todayDateString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isPastDate(dateString) {
  return Boolean(dateString) && dateString < todayDateString();
}

export function isWithinClassHours(timeString) {
  if (!/^\d{2}:\d{2}/.test(timeString || "")) return false;
  const time = timeString.slice(0, 5);
  return time >= CLASS_HOURS_START && time <= CLASS_HOURS_END;
}

// Smallest date a schedule's date input may show. A record being edited can
// keep a date that has since passed, but can't be moved to another past date.
export function minScheduleDate(originalDate) {
  const today = todayDateString();
  return originalDate && originalDate < today ? originalDate : today;
}

// Title Case: capitalizes the first letter of every word and leaves the rest
// as typed, so "juan dela cruz" → "Juan Dela Cruz" while "McDonald" and
// "BSIT" stay as they are. Names also start a word after ' and - ("o'neil"
// → "O'Neil", "mary-jane" → "Mary-Jane"); other text only after spaces,
// ( and /, so "don't" stays "Don't".
export function toTitleCase(value, { name = false } = {}) {
  const wordStart = name ? /(^|[\s'(/-])(\p{Ll})/gu : /(^|[\s(/])(\p{Ll})/gu;
  return String(value ?? "").replace(wordStart, (_, separator, letter) => separator + letter.toUpperCase());
}

// A person's name, capitalized as it is typed (see toTitleCase).
export function formatPersonName(value) {
  return toTitleCase(value, { name: true });
}

// onBlur for any text field that should be in Title Case: rewrites the
// field's text and sends it through the field's own onChange, so it works
// with whatever state the form keeps. Add data-name to treat it as a name.
export function titleCaseOnBlur(event) {
  const field = event.target;
  const next = toTitleCase(field.value, { name: "name" in field.dataset });
  if (next === field.value) return;
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(field, next);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
