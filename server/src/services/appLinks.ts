import { refexOneWebBase } from './saml.js'

export function publicAppBase() {
  return (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'https://asset.refexone.com')
    .replace(/\/$/, '')
}

/** RefexOne portal home — email View now / footer (not asset.refexone.com, not SAML). */
export function refexOneHomeUrl() {
  return refexOneWebBase()
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

/** Email CTA: open the RefexOne portal, not this app and not a SAMLRequest URL. */
export function appSignedInUrl(_path?: string) {
  return refexOneHomeUrl()
}
