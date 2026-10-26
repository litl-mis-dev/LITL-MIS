import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  getPendingRegistration,
  verifyEmailOtp,
  resendEmailVerificationOtp,
  verifyPasswordResetOtp,
  resendPasswordResetOtp
} from '../../services/auth.service'
import '../../assets/styles/auth/LoginOTP.css'

function OneTimePassword() {
  const navigate = useNavigate()
  const location = useLocation()

  // Purpose is explicitly passed by the navigating page.
  // 'EMAIL_VERIFICATION' comes from Registration.jsx after register succeeds.
  // 'PASSWORD_RESET' comes from ForgotPassword.jsx after requesting a reset.
  const statePurpose = location.state?.purpose
  const verificationToken = location.state?.verificationToken  // only set right after register
  const resetEmail = location.state?.email                      // only set for PASSWORD_RESET
  const stateEmail = location.state?.email

  // If the router state is gone (browser was closed/reopened, new tab, Back button),
  // try to resume a pending registration from the httpOnly cookie instead.
  const canTryResume =
    !statePurpose || (statePurpose === 'EMAIL_VERIFICATION' && !verificationToken)
  const [isResuming, setIsResuming] = useState(canTryResume)
  const [resumed, setResumed] = useState(null) // { email, otpExpiresAt, resendAvailableAt }

  const purpose = statePurpose || (resumed ? 'EMAIL_VERIFICATION' : undefined)
  const registrationEmail = stateEmail || resumed?.email

  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const inputsRef = useRef([])

  useEffect(() => {
    if (!canTryResume) return
    let cancelled = false

    getPendingRegistration()
      .then((data) => {
        if (cancelled) return
        setResumed(data)
        const wait = Math.ceil((new Date(data.resendAvailableAt).getTime() - Date.now()) / 1000)
        setResendCooldown(Math.max(0, wait))
      })
      .catch(() => {
        // 404 = nothing pending (or it expired). The guard below handles redirecting.
      })
      .finally(() => {
        if (!cancelled) setIsResuming(false)
      })

    return () => { cancelled = true }
  }, [canTryResume])

  useEffect(() => {
    if (isResuming) return // wait until the resume check finishes

    // Guard: if someone lands here without a valid flow, send them away.
    if (!purpose) {
      navigate('/login', { replace: true })
      return
    }
    if (purpose === 'EMAIL_VERIFICATION' && !verificationToken && !resumed) {
      navigate('/register', { replace: true })
      return
    }
    if (purpose === 'PASSWORD_RESET' && !resetEmail) {
      navigate('/forgot-password', { replace: true })
      return
    }
  }, [isResuming, purpose, verificationToken, resumed, resetEmail, navigate])

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => setResendCooldown((s) => s - 1), 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  const handleDigitChange = (index, value) => {
    if (!/^\d?$/.test(value)) return // digits only, one at a time
    const next = [...digits]
    next[index] = value
    setDigits(next)
    // Auto-advance to next input
    if (value && index < 5) {
      inputsRef.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index, e) => {
    // On backspace with empty field, move focus back
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    e.preventDefault()
    const next = pasted.split('')
    while (next.length < 6) next.push('')
    setDigits(next)
    inputsRef.current[Math.min(pasted.length, 5)]?.focus()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const otp = digits.join('')
    if (otp.length !== 6) {
      setError('Please enter the complete 6-digit code.')
      return
    }

    setIsSubmitting(true)

    try {
      if (purpose === 'EMAIL_VERIFICATION') {
        // Registration flow: verify the OTP tied to the pending registration
        const data = await verifyEmailOtp(verificationToken, otp)
        navigate('/login', {
          state: { message: data?.message || 'Email verified. Your account is now awaiting officer approval.' },
          replace: true
        })
      } else {
        // Password reset flow: verify the OTP tied to the real user account
        const data = await verifyPasswordResetOtp(resetEmail, otp)
        navigate('/reset-password', {
          state: { resetToken: data.resetToken },
          replace: true
        })
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setError('')

    try {
      if (purpose === 'EMAIL_VERIFICATION') {
        await resendEmailVerificationOtp(verificationToken)
      } else {
        await resendPasswordResetOtp(resetEmail)
      }
      setResendCooldown(60)
      setDigits(['', '', '', '', '', ''])
      inputsRef.current[0]?.focus()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not resend code. Please try again.')
    }
  }

  // Determine UI text based on purpose
  const headingText = purpose === 'EMAIL_VERIFICATION'
    ? 'Verify your email'
    : 'Check your email'

const descriptionText =
  purpose === 'EMAIL_VERIFICATION' ? (
    <>
      We sent a 6-digit verification code to{' '}
      <strong>{registrationEmail}</strong> to confirm your registration.
    </>
  ) : (
    <>
      We sent a 6-digit code to <strong>{resetEmail}</strong>. Enter it below
      to reset your password.
    </>
  );

  // Don't flash the form (or redirect) while we check for a resumable registration
  if (isResuming) return null

  return (
    <main className="auth-page" style={{ paddingTop: 90 }}>
      <section className="auth-card" aria-labelledby="auth-title">
        {/* Email icon */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              marginBottom: 4
            }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef8315"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 4h16v16H4z" />
              <path d="m4 6 8 6 8-6" />
            </svg>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <h1 id="auth-title">{headingText}</h1>
          <p style={{ textAlign: 'center', fontSize: 13, color: '#6d6d6d', margin: '0 0 24px' }}>
            {descriptionText}
          </p>

          {/* 6-digit input boxes */}
          <div
            style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 8 }}
            onPaste={handlePaste}
          >
            {digits.map((digit, index) => (
              <div key={index}>
                <label htmlFor={`code-${index + 1}`} className="sr-only">
                  {`Digit ${index + 1}`}
                </label>
                <input
                  ref={(el) => (inputsRef.current[index] = el)}
                  id={`code-${index + 1}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  style={{
                    width: 44,
                    height: 48,
                    textAlign: 'center',
                    fontSize: 20,
                    fontWeight: 600,
                    border: '1px solid #d6d6d6',
                    borderRadius: 8,
                    outline: 'none',
                    background: '#fff',
                    color: '#222',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#ef8315')}
                  onBlur={(e) => (e.target.style.borderColor = '#d6d6d6')}
                />
              </div>
            ))}
          </div>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#9d9d9d', margin: '0 0 20px' }}>
            Please enter the 6-digit code we sent via email.
          </p>

          {error && (
            <p className="form-message form-message-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Verifying...' : 'Verify code'}
          </button>

          {/* Resend */}
          <p style={{ textAlign: 'center', fontSize: 13, color: '#6d6d6d', marginTop: 20 }}>
            Didn't receive the code?{' '}
            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 13,
                fontWeight: 600,
                color: resendCooldown > 0 ? '#aaa' : '#ef8315',
                textDecoration: 'underline',
                cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
            </button>
          </p>

          {/* Back link */}
          <p style={{ textAlign: 'center', fontSize: 13, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => navigate(purpose === 'EMAIL_VERIFICATION' ? '/register' : '/forgot-password')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 13,
                color: '#6d6d6d',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              ← Go back
            </button>
          </p>
        </form>
      </section>
    </main>
  )
}

export default OneTimePassword
