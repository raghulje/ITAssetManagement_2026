import { getApiBase } from '../api/baseUrl'

const KEY = 'refex_login_next'
const IT_ASSET_MANAGER_ROLE = 'IT Asset Manager'

export function safeAppPath(value: string | null | undefined, fallback = '/') {
  const raw = String(value || '').trim()
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  if (raw.startsWith('/login') || raw.startsWith('/logout') || raw.startsWith('/api/')) return fallback
  return raw
}

export function rememberLoginNext(path: string) {
  const next = safeAppPath(path)
  try { sessionStorage.setItem(KEY, next) } catch { /* ignore */ }
  return next
}

export function consumeLoginNext(preferred?: string | null) {
  let stored = ''
  try {
    stored = sessionStorage.getItem(KEY) || ''
    sessionStorage.removeItem(KEY)
  } catch { /* ignore */ }
  return safeAppPath(preferred || stored, '/')
}

export function isItAssetManagerRole(groups: string[] | null | undefined) {
  return (groups || []).some((name) => name.trim().toLowerCase() === IT_ASSET_MANAGER_ROLE.toLowerCase())
}

/** Send an anonymous QR scan to RefexOne SSO, then back to this app path. */
export async function beginRefexOneSso(returnTo: string) {
  const next = rememberLoginNext(returnTo)
  try {
    const res = await fetch(`${getApiBase()}/auth/saml/status`)
    const data = await res.json() as {
      payload?: { enabled?: boolean; idp_configured?: boolean; login_path?: string }
      enabled?: boolean
      idp_configured?: boolean
      login_path?: string
    }
    const s = data.payload || data
    if (s.enabled && s.idp_configured) {
      const path = String(s.login_path || '/api/v1/auth/saml/login')
      window.location.replace(`${path}?returnTo=${encodeURIComponent(next)}`)
      return
    }
  } catch {
    /* fall through to local login */
  }
  window.location.replace(`/login?next=${encodeURIComponent(next)}`)
}
