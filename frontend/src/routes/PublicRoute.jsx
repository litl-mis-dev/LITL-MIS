import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ROLE_HOME } from '../utils/roles'
import LogoLoader from '../components/LogoLoader'

const PUBLIC_ROUTE_LABELS = {
  '/': 'Landing Page',
  '/verify': 'Certificate Verification',
  '/login': 'Login',
  '/register': 'Register',
  '/otp': 'Verification',
  '/forgot-password': 'Forgot Password',
  '/reset-password': 'Reset Password'
}

export default function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [isPageLoading, setIsPageLoading] = useState(true)

  useEffect(() => {
    setIsPageLoading(true)
    const loadingTimer = window.setTimeout(() => setIsPageLoading(false), 700)

    return () => window.clearTimeout(loadingTimer)
  }, [location.pathname])

  if (loading) {
    return <LogoLoader label="Loading" fullScreen />
  }

  if (user && !location.pathname.startsWith('/verify')) {
    const home = ROLE_HOME[user.role] ?? '/'
    return <Navigate to={home} replace />
  }

  if (isPageLoading) {
    const label = PUBLIC_ROUTE_LABELS[location.pathname] ?? 'Page'
    return <LogoLoader label={`Loading ${label}...`} fullScreen />
  }

  return children
}