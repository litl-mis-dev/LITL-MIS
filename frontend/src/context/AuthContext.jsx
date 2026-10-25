import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { getCurrentUser, loginUser, logoutUser } from '../services/auth.service'
import { getMyPermissions } from '../services/rolePermission.service.js'
import { unsubscribePush } from '../services/notification.service'
import { disablePushNotifications } from '../utils/push'
import { MODULES } from '../utils/permissionModules.js'

// Everything hidden until the real matrix loads — MEMBER (no officer
// role) simply never has any of these calls made for it.
const EMPTY_PERMISSIONS = Object.fromEntries(MODULES.map((m) => [m, 'NONE']))

const AuthContext = createContext(null)
const MIN_AUTH_LOADING_MS = 700

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  // Current user's own { MODULE: 'NONE'|'VIEW'|'EDIT' } map — used for nav
  // filtering and page gating. Loaded fresh on login and on initial auth check.
  const [permissions, setPermissions] = useState(EMPTY_PERMISSIONS)
  const [loading, setLoading] = useState(true)

  const loadMyPermissions = async () => {
    try {
      const data = await getMyPermissions()
      setPermissions({ ...EMPTY_PERMISSIONS, ...(data.permissions ?? {}) })
    } catch {
      setPermissions(EMPTY_PERMISSIONS) // fail safe: nothing visible until it loads
    }
  }

  const hasCheckedAuth = useRef(false)

useEffect(() => {
  if (hasCheckedAuth.current) return
  hasCheckedAuth.current = true

  const initAuth = async () => {
    const loadingStartedAt = Date.now()

    try {
      const data = await getCurrentUser()
      setUser(data.user)

      if (data.user?.role && data.user.role !== 'MEMBER') {
        await loadMyPermissions()
      }
    } catch {
      setUser(null)
    } finally {
      const elapsed = Date.now() - loadingStartedAt
      const remaining = Math.max(0, MIN_AUTH_LOADING_MS - elapsed)
      await wait(remaining)
      setLoading(false)
    }
  }

  initAuth()
}, [])

  const login = async (identifier, password) => {
    const data = await loginUser(identifier, password)
    let authUser = data.user

    try {
      const current = await getCurrentUser()
      authUser = current.user || authUser
    } catch {
      authUser = data.user
    }

    const nextUser = authUser
    setUser(nextUser)
    if (nextUser?.role && nextUser.role !== 'MEMBER') {
      await loadMyPermissions()
    }
    return nextUser
  }

  const logout = async () => {
    // Stop this browser receiving the signed-out user's push notifications
    // (shared lab computers). Best-effort: never block signing out.
    try {
      const endpoint = await disablePushNotifications()
      if (endpoint) await unsubscribePush(endpoint)
    } catch {
      // ignore — the server also drops stale endpoints on the next subscribe
    }
    await logoutUser()
    setUser(null)
    setPermissions(EMPTY_PERMISSIONS)
  }

  const updateUserProfile = (profile) => {
    if (!user?.id) return null
    const nextUser = { ...user, ...profile }
    setUser(nextUser)
    return nextUser
  }

    const refreshUser = async () => {
      try {
        const data = await getCurrentUser()
        setUser(data.user)
      } catch {
        // keep the current user if the refresh fails
      }
    }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUserProfile, refreshUser, permissions }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
