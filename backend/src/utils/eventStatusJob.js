const { logInfo, logError } = require('./logger')
const { applyScheduledStatuses } = require('../services/eventStatus.service')

// Opens and closes events on their schedule (services/eventStatus.service.js).
// Runs once at start-up, which also catches up on anything missed while the
// server was down, then every minute.
const EVENT_STATUS_INTERVAL_MS = 60 * 1000

// A slow run must not overlap the next one.
let running = false

const runEventStatusUpdates = async () => {
  if (running) return
  running = true
  try {
    const changed = await applyScheduledStatuses()
    if (changed > 0) logInfo('Event statuses updated on schedule', { count: changed })
  } catch (err) {
    logError('Scheduled event status update failed', err)
  } finally {
    running = false
  }
}

const startEventStatusJob = () => {
  runEventStatusUpdates()
  setInterval(runEventStatusUpdates, EVENT_STATUS_INTERVAL_MS)
  logInfo('Event status job started', { intervalMinutes: EVENT_STATUS_INTERVAL_MS / 60000 })
}

module.exports = { startEventStatusJob, runEventStatusUpdates }
