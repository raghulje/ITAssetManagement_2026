import { api, type ApiList, type SelectOption } from './client'
import { getApiBase } from './baseUrl'

function qs(params: Record<string, string | number | boolean | undefined> = {}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v))
  })
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const employeesApi = {
  list: (params: Record<string, string | number | boolean | undefined> = {}) =>
    api<ApiList<Record<string, unknown>>>(`/employees${qs(params)}`),
  get: (id: number | string) => api<Record<string, unknown>>(`/employees/${id}`),
  create: (body: unknown) =>
    api<{ status: string; messages: string[]; payload: Record<string, unknown> }>('/employees', {
      method: 'POST',
      json: body,
    }),
  update: (id: number | string, body: unknown) =>
    api<{ status: string; messages: string[]; payload: Record<string, unknown> }>(`/employees/${id}`, {
      method: 'PUT',
      json: body,
    }),
  remove: (id: number | string) =>
    api<{ status: string; messages: string[] }>(`/employees/${id}`, { method: 'DELETE' }),
  assets: (id: number | string, params: Record<string, string | number | undefined> = {}) =>
    api<ApiList<Record<string, unknown>>>(`/employees/${id}/assets${qs(params)}`),
  assignments: (id: number | string, params: Record<string, string | number | undefined> = {}) =>
    api<{ rows: Record<string, unknown>[]; summary: { total: number; it: number; admin: number } }>(
      `/employees/${id}/assignments${qs(params)}`,
    ),
  assignmentHistory: (id: number | string, params: Record<string, string | number | undefined> = {}) =>
    api<ApiList<Record<string, unknown>>>(`/employees/${id}/assignment-history${qs(params)}`),
  history: (id: number | string) => api<ApiList<Record<string, unknown>>>(`/employees/${id}/history`),
  selectlist: (search?: string) =>
    api<{ results: SelectOption[]; pagination: { more: boolean } }>(
      `/employees/selectlist${qs({ search })}`,
    ),
  importFile: async (file: File) => {
    const base = getApiBase()
    const fd = new FormData()
    fd.append('file', file)
    const t = localStorage.getItem('refex_token')
    const res = await fetch(`${base}/employees/import`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = Array.isArray(data.messages) ? data.messages.join(', ') : (data.messages || res.statusText)
      throw new Error(String(msg))
    }
    return data as {
      status: string
      messages: string[]
      payload: {
        total: number
        created: number
        updated: number
        skipped: number
        errors: { row: number; message: string }[]
      }
    }
  },
  syncFromHrms: (body: {
    page_size?: number
    created_on_and_after?: string
    modified_on_and_after?: string
  } = {}) =>
    api<{
      status: string
      messages: string[]
      payload: {
        source: string
        fetched: number
        total: number
        created: number
        updated: number
        skipped: number
        durationMs: number
        errors: { row: number; message: string }[]
        masters: {
          companies: { created: number; existing: number; total: number }
          locations: { created: number; existing: number; total: number }
          departments: { created: number; existing: number; total: number }
        }
      }
    }>('/employees/sync', { method: 'POST', json: body }),
  syncStatus: () =>
    api<{ configured: boolean; interval_minutes: number | null }>('/employees/sync/status'),
  syncMasters: () =>
    api<{
      status: string
      messages: string[]
      payload: {
        companies: { created: number; existing: number; total: number }
        locations: { created: number; existing: number; total: number }
        departments: { created: number; existing: number; total: number }
      }
    }>('/employees/sync-masters', { method: 'POST', json: {} }),
}
