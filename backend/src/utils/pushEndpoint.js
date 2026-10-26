// The server POSTs to every stored push endpoint, so an endpoint must be a
// real browser push service — otherwise any logged-in user could make the
// server send requests to internal addresses (SSRF).
const PUSH_SERVICE_HOSTS = [
  /^(fcm|android)\.googleapis\.com$/,   // Chrome, Android, Opera — FCM
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)push\.apple\.com$/,             // Safari
  /(^|\.)notify\.windows\.com$/,         // Edge — WNS
]

const MAX_ENDPOINT_LENGTH = 500 // PushSubscription.endpoint is VARCHAR(500)
const MAX_KEY_LENGTH = 191      // p256dh / auth are default VARCHAR(191)

const isAllowedPushEndpoint = (endpoint) => {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return false
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  return PUSH_SERVICE_HOSTS.some((pattern) => pattern.test(url.hostname))
}

const isValidPushKey = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_LENGTH

module.exports = { isAllowedPushEndpoint, isValidPushKey }
