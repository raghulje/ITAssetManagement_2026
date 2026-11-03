/** CSV helpers for list export */

import { getApiBase } from '../api/baseUrl'

/** Authenticated download for server CSV endpoints (Bearer token). */
export async function downloadAuthedCsv(path: string, filename: string) {
  const t = localStorage.getItem('refex_token')
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: {
      Accept: 'text/csv,application/octet-stream,*/*',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg = Array.isArray((data as { messages?: string[] }).messages)
      ? (data as { messages: string[] }).messages.join(', ')
      : ((data as { messages?: string; message?: string }).messages
        || (data as { message?: string }).message
        || res.statusText)
    throw new Error(String(msg))
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function csvEscape(v: unknown) {
  const s = v == null ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const lines = [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function nestText(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'object' && v && 'name' in v) return String((v as { name?: string }).name ?? '')
  return String(v)
}
