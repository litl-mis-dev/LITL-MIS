import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AuthHeader from '../../components/AuthHeader'
import { ROLE_HOME } from '../../utils/roles'
import '../../assets/styles/auth/LoginOTP.css'

function IconInput({ icon, error, ...props }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
        {icon}
      </span>
      <input
        {...props}
        className={(error ? "border-red-400" : "border-gray-300") + " w-full h-10 px-3 rounded-lg text-sm text-gray-900 bg-white outline-none placeholder-gray-400 transition pl-8"}
      />
    </div>
  )
}

function Login() {
  const [visiblePassword, setVisiblePassword] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const location = useLocation()
  const [message, setMessage] = useState(location.state?.message || '')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuth()

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    setError('')
    setIsSubmitting(true)

    try {
      const user = await login(identifier.trim(), password)
      navigate(ROLE_HOME[user.role] ?? '/')
    } catch (err) {
      const backendMessage = err.response?.data?.message || 'Something went wrong. Please try again.'
      setError(backendMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  function togglePasswordVisibility() {
    setVisiblePassword((current) => !current)
  }

  return (
    <main className="auth-page">
      <AuthHeader actionLabel="Create Account" actionTo="/register" />

      <section className="auth-page auth-content">
        <section className="auth-card" aria-labelledby="auth-title">
          <h1 id="auth-title">Sign in</h1>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Email or Student Number</span>
              <input
                type="text"
                name="identifier"
                placeholder="Enter your email or student number"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Password</span>
              <div className="password-field">
                <IconInput
                  type={visiblePassword ? 'text' : 'password'}
                  name="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  error={false}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={togglePasswordVisibility}
                  aria-label={visiblePassword ? 'Hide password' : 'Show password'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {visiblePassword ? (
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
                </button>
              </div>
            </label>

            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Logging in...' : 'Log in'}
            </button>

            {message && <p className="form-message">{message}</p>}
            {error && <p className="form-message form-message-error">{error}</p>}
          </form>

          <div className="text-center text-xs text-gray-500 mt-4 leading-7">
            <Link to="/forgot-password" className="text-gray-400 hover:underline">Forgot your password?</Link>
            <br />
            <Link to="/register" className="text-blue-600 font-semibold hover:underline">New member? Register here</Link>
            <br />
            <Link to="/" className="text-gray-400 hover:underline">Back to Portal</Link>
          </div>
        </section>
      </section>
    </main>
  )
}

export default Login
