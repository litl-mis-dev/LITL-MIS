import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { requestPasswordReset } from '../services/auth.service'
import '../assets/styles/auth/LoginOTP.css'

function ForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Please enter your email address.')
      return
    }

    setIsSubmitting(true)

    try {
      await requestPasswordReset(email.trim().toLowerCase())
      // Always navigate to OTP screen regardless of whether the email exists.
      // The backend intentionally returns the same generic response either way
      // to prevent attackers from discovering which emails are registered.
      navigate('/otp', { state: { email: email.trim().toLowerCase(), purpose: 'PASSWORD_RESET' } })
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page" style={{ paddingTop: 60 }}>
      

      <section className="auth-card" aria-labelledby="auth-title">
        {/* Lock icon */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            marginBottom: 4
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="#ef8315" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>

        <h1 id="auth-title" style={{ marginBottom: 8 }}>Forgot password?</h1>
        <p style={{ textAlign: 'center', fontSize: 13, color: '#6d6d6d', marginBottom: 24, marginTop: 0 }}>
          Enter your registered email address and we'll send you a verification code to reset your password.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              placeholder="Enter your registered email"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError('') }}
              required
            />
          </label>

          {error && <p className="form-message form-message-error">{error}</p>}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Sending code...' : 'Send verification code'}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: 13, marginTop: 20, color: '#6d6d6d' }}>
          <Link
            to="/login"
            style={{ color: '#555', textDecoration: 'underline' }}
          >
            ← Back to sign in
          </Link>
        </div>
      </section>
    </main>
  )
}

export default ForgotPassword
