const crypto = require('crypto')

// 32 random bytes -> 64 character hex string. Not sequential, not guessable.
// Used as the public-facing identifier for a PendingRegistration instead of its DB id.
const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex')
}

module.exports = { generateVerificationToken }