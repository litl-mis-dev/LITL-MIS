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

// "jUAN carlos" → "Juan Carlos", "mary-jane" → "Mary-Jane", "o'neil" → "O'Neil".
// Capitalizes the first letter of every word and lowercases the rest, keeping
// the spacing as typed so it can run on every keystroke.
export function formatPersonName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, separator, letter) => separator + letter.toUpperCase());
}
