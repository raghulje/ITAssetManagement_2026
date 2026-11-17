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
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank', 'noopener,noreferrer')
  if (!win) {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'file'
    a.click()
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
}
