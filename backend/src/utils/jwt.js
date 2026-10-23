const jwt = require('jsonwebtoken')

// Login session token — short-lived purpose, includes tokenVersion for invalidation
const signAuthToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
  )
}

const verifyAuthToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
}

const signResetToken = (userId, tokenVersion = 0) => {
  return jwt.sign(
    { id: userId, purpose: 'PASSWORD_RESET', tokenVersion },
    process.env.RESET_TOKEN_SECRET,
    { expiresIn: '10m', algorithm: 'HS256' }
  )
}

const verifyResetToken = (token) => {
  const decoded = jwt.verify(token, process.env.RESET_TOKEN_SECRET, { algorithms: ['HS256'] })
  if (decoded.purpose !== 'PASSWORD_RESET') throw new Error('Wrong token purpose')
  return decoded
}

module.exports = { signAuthToken, verifyAuthToken, signResetToken, verifyResetToken }