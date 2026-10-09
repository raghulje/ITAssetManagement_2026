import { getApiBase } from '../api/baseUrl'

/** Browser <img>/<video> cannot send Authorization, so append the JWT for GET file URLs. */
export function authorizedMediaUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (path.startsWith('blob:') || path.startsWith('data:')) return path
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('refex_token') : null
  const base = /^https?:\/\//i.test(path) ? path : `${getApiBase()}${path}`
  if (!token) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}access_token=${encodeURIComponent(token)}`
}
