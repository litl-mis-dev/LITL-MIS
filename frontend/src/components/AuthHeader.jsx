import { Link } from 'react-router-dom'
import logo from '../assets/images/LogoAndText.png'

function AuthHeader({ actionLabel, actionTo }) {
  return (
    <header className="auth-header">
      <div className="auth-header-inner">
        <Link to="/" className="auth-brand" aria-label="Go to LITL portal">
          <img src={logo} alt="LITL Logo" />
        </Link>

        <nav className="auth-header-actions" aria-label="Authentication navigation">
          <Link to="/" className="auth-header-link">
            Portal
          </Link>
          <Link to={actionTo} className="auth-header-cta">
            {actionLabel}
          </Link>
        </nav>
      </div>
    </header>
  )
}

export default AuthHeader
