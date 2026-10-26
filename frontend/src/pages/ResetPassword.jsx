import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { resetPassword } from '../services/auth.service'
import '../assets/styles/auth/LoginOTP.css'

function EyeIcon({ visible }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ width: 19, height: 19 }}>
      {visible ? (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.1 4" />
          <path d="M6.6 6.6A17 17 0 0 0 2.5 12s3.5 7 9.5 7a9.8 9.8 0 0 0 4.2-.9" />
          <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1" />
        </>
      )}
    </svg>
  )
}

// Simple password strength indicator
function PasswordStrength({ password }) {
  if (!password) return null

  const hasLength = password.length >= 8
  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasNumber = /\d/.test(password)
  const hasSpecial = /[@$!%*?&.#_-]/.test(password)

  const score = [
    hasLength,
    hasLower,
    hasUpper,
    hasNumber,
    hasSpecial
  ].filter(Boolean).length

  const levels = [
  { label: 'Very Weak', color: '#e74c3c' },
  { label: 'Weak', color: '#e74c3c' },
  { label: 'Fair', color: '#f39c12' },
  { label: 'Good', color: '#f1c40f' },
  { label: 'Strong', color: '#2ecc71' },
  { label: 'Very Strong', color: '#27ae60' },
]

  const level = levels[score]

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= score ? level.color : '#e5e7eb',
              transition: 'background 0.2s'
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: 11, color: level.color, margin: 0 }}>{level.label}</p>
    </div>
  )
}

function PasswordRequirements({ password }) {
  const requirements = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One number', met: /\d/.test(password) },
    { label: 'One special character (@$!%*?&.#_-)', met: /[@$!%*?&.#_-]/.test(password) },
  ]

  return (
    <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
      {requirements.map((req) => (
        <li
          key={req.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: req.met ? '#27ae60' : '#9ca3af',
            marginBottom: 2,
          }}
        >
          <span>{req.met ? '✓' : '○'}</span>
          <span>{req.label}</span>
        </li>
      ))}
    </ul>
  )
}

function ResetPassword() {
  const navigate = useNavigate()
  const location = useLocation()

  // resetToken must come from OneTimePassword.jsx via navigate state
  const resetToken = location.state?.resetToken

  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    // If someone lands here directly with no reset token, send them back
    if (!resetToken) {
      navigate('/forgot-password', { replace: true })
    }
  }, [resetToken, navigate])

  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-])[A-Za-z\d@$!%*?&.#_-]{8,}$/

  const validate = () => {
    if (!newPassword) return 'Please enter a new password.'
    if (!PASSWORD_REGEX.test(newPassword)) {
      return 'Password must be at least 8 characters and contain an uppercase letter, lowercase letter, number, and special character.'
    }
    if (!confirmNewPassword) return 'Please confirm your new password.'
    if (newPassword !== confirmNewPassword) return 'Passwords do not match.'
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setIsSubmitting(true)

    try {
      await resetPassword(resetToken, newPassword, confirmNewPassword)
      // Navigate to login with a success flag so Login.jsx can show a message
      navigate('/login', {
        state: { message: 'Password reset successfully. Please log in with your new password.' },
        replace: true
      })
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page" style={{ paddingTop: 60 }}>

      <section className="auth-card" aria-labelledby="auth-title">
        {/* Key icon */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#fff7ed',
              border: '1px solid #fed7aa',
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef8315"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: 'block' }}
            >
              {/* key head */}
              <circle cx="7" cy="15" r="3.2" />

              {/* shaft */}
              <path d="M10 15h10" />

              {/* teeth */}
              <path d="M17 15v4" />
              <path d="M20 15v3" />
            </svg>
          </div>
        </div>

        <h1 id="auth-title" style={{ marginBottom: 8 }}>Set new password</h1>
        <p style={{ textAlign: 'center', fontSize: 13, color: '#6d6d6d', marginBottom: 24, marginTop: 0 }}>
          Your new password must be at least 8 characters and include a letter and a number.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>New password</span>
            <div className="password-field">
              <input
                type={showNew ? 'text' : 'password'}
                placeholder="Enter new password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError('') }}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowNew(v => !v)}
                aria-label={showNew ? 'Hide password' : 'Show password'}
              >
                <EyeIcon visible={showNew} />
              </button>
            </div>
            <PasswordStrength password={newPassword} />
            {newPassword && <PasswordRequirements password={newPassword} />}
          </label>

          <label className="field">
            <span>Confirm new password</span>
            <div className="password-field">
              <input
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter new password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => { setConfirmNewPassword(e.target.value); setError('') }}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirm(v => !v)}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                <EyeIcon visible={showConfirm} />
              </button>
            </div>
            {/* Inline match indicator once both fields have content */}
            {newPassword && confirmNewPassword && (
              <p style={{
                fontSize: 11,
                margin: '4px 0 0',
                color: newPassword === confirmNewPassword ? '#27ae60' : '#e74c3c'
              }}>
                {newPassword === confirmNewPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
              </p>
            )}
          </label>

          {error && <p className="form-message form-message-error">{error}</p>}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting password...' : 'Reset password'}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: 13, marginTop: 20, color: '#6d6d6d' }}>
          <Link to="/login" style={{ color: '#555', textDecoration: 'underline' }}>
            ← Back to sign in
          </Link>
        </div>
      </section>
    </main>
  )
}

export default ResetPassword
