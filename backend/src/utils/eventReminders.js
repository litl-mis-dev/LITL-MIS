const { logInfo, logError } = require('./logger')
const { notifyEventReminders } = require('../services/notification.service')

const EVENT_REMINDER_INTERVAL_MS = 15 * 60 * 1000 // every 15 minutes

// A run that takes longer than the interval must not overlap the next one,
// or both could remind the same people.
let running = false

const runEventReminders = async () => {
  if (running) return
  running = true
  try {
    const sent = await notifyEventReminders()
    if (sent > 0) logInfo('Event reminders sent', { count: sent })
  } catch (err) {
    logError('Event reminders failed', err)
  } finally {
    running = false
  }
}

const startEventReminderJob = () => {
  runEventReminders()
  setInterval(runEventReminders, EVENT_REMINDER_INTERVAL_MS)
  logInfo('Event reminder job started', { intervalMinutes: EVENT_REMINDER_INTERVAL_MS / 60000 })
}

module.exports = { startEventReminderJob, runEventReminders }
