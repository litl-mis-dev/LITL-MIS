import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthHeader from '../../components/AuthHeader'
import { acceptAdviserInvite, lookupAdviserInvite } from '../../services/adviser.service'
import '../../assets/styles/auth/LoginOTP.css'
import RequiredMark from '../../components/ui/RequiredMark.jsx'
import { formatPersonName } from '../../utils/formInputs.js'

const NAME_FIELDS = new Set(['firstName', 'lastName'])

// Opened from the President's invitation email:
//   https://litltrece.me/adviser-invite#token=…
// The token sits in the URL fragment, which browsers never send to the
// server; it is posted in the request body and removed from the address bar.
function readTokenFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return params.get('token') || ''
}

export default function AcceptAdviserInvite() {
  const navigate = useNavigate()
  const [token] = useState(readTokenFromHash)
  const [invite, setInvite] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({ firstName: '', lastName: '', suffix: '', sex: '', password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    // Keep the one-time token out of browser history and screenshots.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)

    let active = true
    lookupAdviserInvite(token)
      .then((data) => {
        if (!active) return
        setInvite(data)
        setForm((current) => ({ ...current, firstName: data.firstName, lastName: data.lastName, suffix: data.suffix ?? '' }))
      })
      .catch((err) => {
        if (active) setLoadError(err.response?.data?.message || 'This invitation link is invalid or has expired.')
      })
    return () => { active = false }
  }, [token])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setIsSubmitting(true)
    try {
      const data = await acceptAdviserInvite({ token, ...form })
      navigate('/login', { replace: true, state: { message: data.message } })
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const update = (field) => (e) => setForm({
    ...form,
    [field]: NAME_FIELDS.has(field) ? formatPersonName(e.target.value) : e.target.value,
  })

  return (
    <main className="auth-page">
      <AuthHeader actionLabel="Sign in" actionTo="/login" />

      <section className="auth-page auth-content">
        <section className="auth-card" aria-labelledby="auth-title">
          <h1 id="auth-title">Accept invitation</h1>

          {!invite && !loadError && <p className="form-message">Checking your invitation…</p>}
          {loadError && <p className="form-message form-message-error">{loadError}</p>}

          {invite && (
            <form className="auth-form" onSubmit={handleSubmit}>
              <p className="form-message">
                You&apos;ve been invited to join LITL-MIS as <strong>{invite.titleLabel}</strong>.
              </p>

              <label className="field">
                <span>Email</span>
                <input type="email" value={invite.email} readOnly autoComplete="username" />
              </label>
              <label className="field">
                <span>First name<RequiredMark /></span>
                <input type="text" value={form.firstName} onChange={update('firstName')} required maxLength={30} autoComplete="given-name" />
              </label>
              <label className="field">
                <span>Last name<RequiredMark /></span>
                <input type="text" value={form.lastName} onChange={update('lastName')} required maxLength={30} autoComplete="family-name" />
              </label>
              <label className="field">
                <span>Suffix (optional)</span>
                <input type="text" value={form.suffix} onChange={update('suffix')} maxLength={10} placeholder="Jr., III" />
              </label>
              <label className="field">
                <span>Sex<RequiredMark /></span>
                <select value={form.sex} onChange={update('sex')} required>
                  <option value="" disabled>Select</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </select>
              </label>
              <label className="field">
                <span>Password<RequiredMark /></span>
                <input type="password" value={form.password} onChange={update('password')} required autoComplete="new-password" />
              </label>
              <label className="field">
                <span>Confirm password<RequiredMark /></span>
                <input type="password" value={form.confirmPassword} onChange={update('confirmPassword')} required autoComplete="new-password" />
              </label>
              <p className="text-xs text-gray-500">
                At least 8 characters, with an uppercase letter, a lowercase letter, a number and a special character.
              </p>

              <button aria-busy={isSubmitting} type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? 'Creating account...' : 'Create my account'}
              </button>
              {error && <p className="form-message form-message-error">{error}</p>}
            </form>
          )}
        </section>
      </section>
    </main>
  )
}
