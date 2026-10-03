const KEY = 'refex_login_next'

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
