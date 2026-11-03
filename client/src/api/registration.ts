import { api, type ApiList } from './client'
import { getApiBase } from './baseUrl'

function qs(params: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v))
  })
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const registrationApi = {
  nextTag: () => api<{ asset_tag: string }>('/hardware/registration/next-tag'),
  specSchema: (categoryId?: number, category?: string) =>
    api<{ category: string; fields: { key: string; label: string }[] }>(
      `/hardware/registration/spec-schema${qs({ category_id: categoryId, category })}`,
    ),
  register: (body: unknown) =>
    api<{ status: string; messages: string[]; payload: Record<string, unknown> }>('/hardware/register', {
      method: 'POST',
      json: body,
    }),
  clone: (id: number | string, body: unknown) =>
    api(`/hardware/${id}/clone`, { method: 'POST', json: body }),
  get360: (id: number | string) => api<Record<string, unknown>>(`/hardware/${id}/360`),
  history: (params: Record<string, string | number | undefined> = {}) =>
    api<ApiList<Record<string, unknown>>>(`/hardware/registration/history${qs(params)}`),
  rollback: (id: number | string) =>
    api(`/hardware/registration/history/${id}/rollback`, { method: 'POST' }),
  previewBulk: async (file: File) => {
    const base = getApiBase()
    const fd = new FormData()
    fd.append('file', file)
    const t = localStorage.getItem('refex_token')
    const res = await fetch(`${base}/hardware/registration/preview`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(Array.isArray(data.messages) ? data.messages.join(', ') : data.messages || res.statusText)
    return data as Record<string, unknown>
  },
  importBulk: async (file: File, extra: Record<string, string> = {}) => {
    const base = getApiBase()
    const fd = new FormData()
    fd.append('file', file)
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v))
    const t = localStorage.getItem('refex_token')
    const res = await fetch(`${base}/hardware/registration/import`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(Array.isArray(data.messages) ? data.messages.join(', ') : data.messages || res.statusText)
    return data as Record<string, unknown>
  },
}

export const templatesApi = {
  list: (params: Record<string, string | number | undefined> = {}) =>
    api<ApiList<Record<string, unknown>>>(`/asset-templates${qs(params)}`),
  get: (id: number | string) => api<Record<string, unknown>>(`/asset-templates/${id}`),
  create: (body: unknown) => api('/asset-templates', { method: 'POST', json: body }),
  update: (id: number | string, body: unknown) => api(`/asset-templates/${id}`, { method: 'PUT', json: body }),
  remove: (id: number | string) => api(`/asset-templates/${id}`, { method: 'DELETE' }),
}

export async function selectlist(path: string, search = '') {
  return api<{ results: { id: number; text: string }[] }>(`${path}/selectlist${qs({ search })}`)
}
