import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRole } from '../utils/useRole'
import { ROLE_HOME } from '../utils/roles'
import LogoLoader from '../components/LogoLoader'

// requiredModule/requiredLevel let a route additionally require at least
// VIEW (or EDIT) on a specific RBAC module — the backend enforces this too,
// this is just so the person lands somewhere sane instead of a blank/403 page.
export default function ProtectedRoute({ children, allowedRoles, requiredModule, requiredLevel = 'VIEW' }) {
  const { user, loading } = useAuth()
  const { can } = useRole()

  if (loading) {
    return <LogoLoader label="Loading" fullScreen />
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const home = ROLE_HOME[user.role] ?? '/'
    return <Navigate to={home} replace />
  }

  if (requiredModule && !can(requiredModule, requiredLevel)) {
    const home = ROLE_HOME[user.role] ?? '/'
    return <Navigate to={home} replace />
  }

  return children
}