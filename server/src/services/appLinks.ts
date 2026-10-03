import { idpConfigured, samlEnabled } from './saml.js'

export function publicAppBase() {
  return (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'https://asset.refexone.com')
    .replace(/\/$/, '')
}

/** Safe in-app path only (no open redirects). */
export function safeAppPath(value: string | null | undefined, fallback = '/') {
  const raw = String(value || '').trim()
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  if (raw.startsWith('/login') || raw.startsWith('/logout') || raw.startsWith('/api/')) return fallback
  return raw
}

/** Absolute page URL on this app. */
export function appPageUrl(path: string) {
  const clean = safeAppPath(path.startsWith('/') ? path : `/${path}`, '/')
  return `${publicAppBase()}${clean}`
}

/**
 * Email / portal CTA: go through RefexOne SAML when it is configured
 * so the user lands on the same record after SSO, not the home page.
 */
export function appSignedInUrl(path: string) {
  const clean = safeAppPath(path.startsWith('/') ? path : `/${path}`, '/')
  const direct = `${publicAppBase()}${clean}`
  if (!samlEnabled() || !idpConfigured()) return direct
  return `${publicAppBase()}/api/v1/auth/saml/login?returnTo=${encodeURIComponent(clean)}`
}
