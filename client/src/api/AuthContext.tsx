import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, setToken } from './client'
import { domainScopeFromPermissions, type DomainCode, type DomainScope } from '../lib/domainScope'
import { goToRefexOne } from '../utils/refexOneUrl'

const ACTIVE_DOMAIN_KEY = 'refex_active_domain'

function readStoredDomain(): DomainCode | '' {
  try {
    const v = localStorage.getItem(ACTIVE_DOMAIN_KEY)
    return v === 'it' || v === 'admin' ? v : ''
  } catch {
    return ''
  }
}

function writeStoredDomain(code: DomainCode) {
  try {
    localStorage.setItem(ACTIVE_DOMAIN_KEY, code)
  } catch { /* ignore */ }
}

type User = {
  id: number
  username: string
  first_name: string
  last_name: string
  email?: string
  name?: string
  permissions?: Record<string, unknown>
}

type AuthCtx = {
  user: User | null
  loading: boolean
  permissions: Record<string, unknown>
  /** Admin or Superuser role flag — Settings / Reports / HRMS Profile */
  isAdmin: boolean
  domainScope: DomainScope
  /** Current IT / Admin workspace for Superuser (and anyone with both domains). */
  activeDomain: DomainCode
  setActiveDomain: (code: DomainCode) => void
  can: (permission: string) => boolean
  login: (email: string, password: string) => Promise<void>
  loginWithToken: (token: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

function isTruthy(v: unknown) {
  return v === '1' || v === 1 || v === true || v === 'true'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeDomain, setActiveDomainState] = useState<DomainCode>(() => readStoredDomain() || 'it')

  useEffect(() => {
    const t = localStorage.getItem('refex_token')
    if (!t) {
      setLoading(false)
      return
    }
    authApi.me()
      .then((u) => setUser(u as User))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const permissions = (user?.permissions && typeof user.permissions === 'object')
    ? user.permissions
    : {}

  const isAdmin = isTruthy(permissions.superuser) || isTruthy(permissions.admin)
  const domainScope = domainScopeFromPermissions(permissions)

  useEffect(() => {
    if (!user) return
    if (!domainScope.codes.includes(activeDomain)) {
      const next = domainScope.codes[0] || 'it'
      setActiveDomainState(next)
      writeStoredDomain(next)
    }
  }, [user, domainScope, activeDomain])

  const setActiveDomain = useCallback((code: DomainCode) => {
    if (code !== 'it' && code !== 'admin') return
    setActiveDomainState(code)
    writeStoredDomain(code)
  }, [])

  const can = useCallback((permission: string) => {
    if (isTruthy(permissions.superuser) || isTruthy(permissions.admin)) return true
    return isTruthy(permissions[permission])
  }, [permissions])

  const value = useMemo<AuthCtx>(() => ({
    user,
    loading,
    permissions,
    isAdmin,
    domainScope,
    activeDomain,
    setActiveDomain,
    can,
    async login(email, password) {
      const res = await authApi.login(email, password)
      setToken(res.token)
      setUser(res.user as unknown as User)
    },
    async loginWithToken(token) {
      setToken(token)
      const u = await authApi.me()
      setUser(u as User)
    },
    logout() {
      setToken(null)
      setUser(null)
      try {
        sessionStorage.removeItem('refex_login_next')
      } catch { /* ignore */ }
      // Match P2P: leave this app and return to the RefexOne portal
      goToRefexOne()
    },
    async refreshUser() {
      const u = await authApi.me()
      setUser(u as User)
    },
  }), [user, loading, permissions, isAdmin, domainScope, activeDomain, setActiveDomain, can])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}

export function useCan(permission: string) {
  return useAuth().can(permission)
}
