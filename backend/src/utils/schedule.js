// Date/time rules for anything users schedule (events). Mirrors
// frontend/src/utils/formInputs.js — the frontend limits the inputs, this
// is the check that actually holds.

const ORG_TIMEZONE = 'Asia/Manila'
const CLASS_HOURS_START = '07:00'
const CLASS_HOURS_END = '22:00'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

// Today as "YYYY-MM-DD" in the organization's timezone. The server clock is
// UTC, which would still be "yesterday" before 8 AM in the Philippines.
function todayInOrgTimezone(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function isWithinClassHours(value) {
  return typeof value === 'string' && TIME_REGEX.test(value)
    && value >= CLASS_HOURS_START && value <= CLASS_HOURS_END
}

// Returns an error message, or null when the date/time may be used.
function validateScheduleDate(value, now = new Date()) {
  if (!isValidDateString(value)) return 'Enter a valid date.'
  if (value < todayInOrgTimezone(now)) return 'The date must be today or a future date.'
  return null
}

function validateScheduleTime(value) {
  if (!isWithinClassHours(value)) return 'The time must be within class hours (7:00 AM to 10:00 PM).'
  return null
}

module.exports = {
  CLASS_HOURS_START, CLASS_HOURS_END,
  todayInOrgTimezone, isValidDateString, isWithinClassHours,
  validateScheduleDate, validateScheduleTime,
}
