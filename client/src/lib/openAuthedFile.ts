import { getApiBase } from '../api/baseUrl'

/** File routes need the login token. A normal link opens without it and returns Unauthorized. */
export async function openAuthedFile(fileId: number | string, fileName?: string) {
  const token = localStorage.getItem('refex_token')
  const res = await fetch(`${getApiBase()}/files/${fileId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { messages?: string | string[] }
    const messages = Array.isArray(data.messages) ? data.messages.join(', ') : data.messages
    throw new Error(messages || 'Could not open file')
  }
  const headerType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const type = headerType && headerType !== 'application/octet-stream'
    ? headerType
    : typeFromName(fileName) || headerType || 'application/octet-stream'
  const raw = await res.blob()
  const blob = raw.type === type ? raw : new Blob([raw], { type })
  const url = URL.createObjectURL(blob)
  // Do not pass noopener here: browsers then return null and a download fallback would also run.
  const win = window.open(url, '_blank')
  if (win) win.opener = null
  if (!win) {
    URL.revokeObjectURL(url)
    throw new Error('Allow pop-ups for this site to preview the file')
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
}

function typeFromName(fileName?: string) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'txt') return 'text/plain'
  return ''
}
