const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'RESET_TOKEN_SECRET',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
  'FRONTEND_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_URL',
]

const validateEnv = () => {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key])
  if (missing.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  if (process.env.NODE_ENV === 'production') {
    const problems = []

    if (/localhost|127\.0\.0\.1/i.test(process.env.FRONTEND_URL)) {
      problems.push('FRONTEND_URL points at localhost — CORS and cookies would break for real users')
    }
    if (!/^https:\/\//i.test(process.env.FRONTEND_URL)) {
      problems.push('FRONTEND_URL must be an https:// URL (auth cookie is Secure + SameSite=None)')
    }
    // No localhost check on DATABASE_URL: on Hostinger, MySQL runs on the same
    // server as the app and must be reached at 127.0.0.1. The FRONTEND_URL
    // checks above still catch a dev .env deployed by mistake.
    if (process.env.JWT_SECRET.length < 32) {
      problems.push('JWT_SECRET must be at least 32 characters')
    }
    if (process.env.RESET_TOKEN_SECRET.length < 32) {
      problems.push('RESET_TOKEN_SECRET must be at least 32 characters')
    }
    if (process.env.JWT_SECRET === process.env.RESET_TOKEN_SECRET) {
      problems.push('JWT_SECRET and RESET_TOKEN_SECRET must be different')
    }

    if (problems.length > 0) {
      console.error('FATAL: Unsafe production configuration:\n - ' + problems.join('\n - '))
      process.exit(1)
    }
  }
}

module.exports = validateEnv