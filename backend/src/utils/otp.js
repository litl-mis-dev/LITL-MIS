const crypto = require('crypto')
const bcrypt = require('bcrypt')

// Generates a cryptographically secure 6-digit OTP (not Math.random)
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString()
}

// Hash the OTP before storing — same principle as passwords
const hashOtp = async (otp) => {
  return await bcrypt.hash(otp, 10)
}

// Compare a submitted OTP against the stored hash
const compareOtp = async (otp, hash) => {
  return await bcrypt.compare(otp, hash)
}

module.exports = { generateOtp, hashOtp, compareOtp }