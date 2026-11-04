import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ROLE_HOME } from '../utils/roles'
import LogoLoader from '../components/LogoLoader'

export default function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LogoLoader label="Loading" fullScreen />
  }

  if (user && !location.pathname.startsWith('/verify')) {
    const home = ROLE_HOME[user.role] ?? '/'
    return <Navigate to={home} replace />
  }

  return children
}