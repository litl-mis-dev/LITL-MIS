import { createContext, useContext, useState, useEffect,useRef } from 'react'
import { getCurrentUser, loginUser, logoutUser } from '../services/auth.service'
import { getMyPermissions } from '../services/rolePermission.service.js'
import { MODULES } from '../utils/permissionModules.js'

// Everything hidden until the real matrix loads — MEMBER (no officer
// role) simply never has any of these calls made for it.
const EMPTY_PERMISSIONS = Object.fromEntries(MODULES.map((m) => [m, 'NONE']))

const AuthContext = createContext(null)
const MIN_AUTH_LOADING_MS = 700
const PROFILE_STORAGE_PREFIX = 'litl-officer-profile:'
const LOCAL_PROFILE_FIELDS = []

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getProfileStorageKey(userId) {
  return `${PROFILE_STORAGE_PREFIX}${userId}`
}

function readStoredProfile(userId) {
  if (!userId) return null

  try {
    return JSON.parse(localStorage.getItem(getProfileStorageKey(userId))) || null
  } catch {
    return null
  }
}

function mergeStoredProfile(user) {
  if (!user?.id) return user

  const storedProfile = readStoredProfile(user.id)
  if (!storedProfile) return user

  const localProfile = Object.fromEntries(
    LOCAL_PROFILE_FIELDS
      .filter((key) => storedProfile[key])
      .map((key) => [key, storedProfile[key]])
  )

  return { ...user, ...localProfile }
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
      setUser(mergeStoredProfile(data.user))

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

    const nextUser = mergeStoredProfile(authUser)
    setUser(nextUser)
    if (nextUser?.role && nextUser.role !== 'MEMBER') {
      await loadMyPermissions()
    }
    return nextUser
  }

  const logout = async () => {
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

 /* const refreshUser = async () => {
    try {
      const data = await getCurrentUser()
      const nextUser = mergeStoredProfile(data.user)
      setUser(nextUser)
      return nextUser
    } catch {
      return user
    }
  }*/

    const refreshUser = async () => {
      try {
        const data = await getCurrentUser()
        setUser(mergeStoredProfile(data.user))
      } catch { }
    }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUserProfile, refreshUser, permissions }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
