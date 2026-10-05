import { api, type ApiList } from './client'
import { getApiBase } from './baseUrl'

function qs(params: Record<string, string | number | boolean | undefined> = {}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v))
  })
  const s = q.toString()
  return s ? `?${s}` : ''
}

export type BatteryTranscriptLine = { speaker: 'bot' | 'user'; text: string }

export type BatteryTrackerStep = {
  key: string
  label: string
  status: 'completed' | 'in_progress' | 'skipped' | 'not_started'
  source?: string
  at?: string
  call_status?: string
  duration?: string
  assignee?: string
}

export type BatteryCall = {
  id: number
  sequence: number
  label: string
  conversation_id: string
  call_status: string
  call_result: string
  disconnect_reason: string
  siptrunk_id: string
  agent_id: string
  bot_summary: string
  recording_url: string
  recording_stream: string
  transcript: BatteryTranscriptLine[]
  transcript_en: BatteryTranscriptLine[]
  duration: string
  connected_at: string
  ended_at: string
  callback_queued_at: string
  created_at: string
  updated_at: string
}

export type BatteryIssue = {
  id: number
  name: string
  phone: string
  email: string
  company: string
  message: string
  bot_summary: string
  recording_url: string
  recording_original_name: string
  has_recording: boolean
  recording_stream: string
  transcript: BatteryTranscriptLine[]
  conversations: BatteryCall[]
  call_count: number
  tracker: BatteryTrackerStep[]
  status: string
  assigned_to: number | null
  assigned_name: string
  assigned_at: string
  close_comments: string
  close_attachments: Array<{ index: number; original_name: string; mime: string; url: string }>
  closed_at: string
  closed_by: number | null
  closed_by_name: string
  preferred_language: string
  battery_issue_confirmed: string
  other_issue_reported: string
  other_issue_description: string
  other_issue_types: Array<{ key: string; label: string }>
  webhook_sent_at: string
  conversation_id: string
  call_status: string
  call_result: string
  siptrunk_id: string
  agent_id: string
  created_at: string
  updated_at: string
}

export type BatteryCallStats = {
  total: number
  with_phone: number
  yet_to_call: number
  called: number
  attended: number
  rejected: number
  ignored: number
  calling: number
  battery_yes: number
  battery_no: number
  other_only: number
  no_issues: number
  both_issues: number
  answered_both: number
  incomplete: number
  other_type_counts: Array<{ key: string; label: string; icon: string; count: number }>
}

export type BatterySyncAll = {
  running: boolean
  total: number
  done: number
  failed: number
  recordings: number
  message: string
}

export type BatteryCallQueueLimit = 15 | 30 | 50 | 'all'

export type BatteryCallQueue = {
  running: boolean
  paused?: boolean
  credit_blocked?: boolean
  total: number
  done: number
  failed: number
  remaining?: number
  current_id: number | null
  current_name: string
  started_at: string | null
  finished_at: string | null
  message: string
  limit?: BatteryCallQueueLimit | null
}

export const batteryIssuesApi = {
  list: (params: Record<string, string | number | boolean | undefined> = {}) =>
    api<ApiList<BatteryIssue>>(`/battery-issues${qs(params)}`),
  stats: () => api<BatteryCallStats>('/battery-issues/stats'),
  queueStatus: () => api<BatteryCallQueue>('/battery-issues/call-queue'),
  startQueue: (limit: BatteryCallQueueLimit = 'all') =>
    api<{ status: string; messages: string[]; payload: BatteryCallQueue }>('/battery-issues/call-queue', {
      method: 'POST',
      json: { limit },
    }),
  pauseQueue: () =>
    api<{ status: string; messages: string[]; payload: BatteryCallQueue }>('/battery-issues/call-queue/pause', {
      method: 'POST',
    }),
  resumeQueue: () =>
    api<{ status: string; messages: string[]; payload: BatteryCallQueue }>('/battery-issues/call-queue/resume', {
      method: 'POST',
    }),
  stopQueue: () =>
    api<{ status: string; messages: string[]; payload: BatteryCallQueue }>('/battery-issues/call-queue/stop', {
      method: 'POST',
    }),
  get: (id: number | string) => api<BatteryIssue>(`/battery-issues/${id}`),
  create: (body: unknown) =>
    api<{ status: string; messages: string[]; payload: BatteryIssue }>('/battery-issues', {
      method: 'POST',
      json: body,
    }),
  update: (id: number | string, body: unknown) =>
    api<{ status: string; messages: string[]; payload: BatteryIssue }>(`/battery-issues/${id}`, {
      method: 'PUT',
      json: body,
    }),
  remove: (id: number | string) =>
    api<{ status: string; messages: string[] }>(`/battery-issues/${id}`, { method: 'DELETE' }),
  startCall: (id: number | string) =>
    api<{ status: string; messages: string[]; payload: BatteryIssue }>(`/battery-issues/${id}/call`, {
      method: 'POST',
    }),
  syncCall: (id: number | string) =>
    api<{ status: string; messages: string[]; payload: BatteryIssue }>(`/battery-issues/${id}/sync-call`, {
      method: 'POST',
    }),
  syncAllStatus: () => api<BatterySyncAll>('/battery-issues/sync-all'),
  syncAll: () =>
    api<{ status: string; messages: string[]; payload: BatterySyncAll }>('/battery-issues/sync-all', {
      method: 'POST',
    }),
  translateCall: (issueId: number | string, callId: number | string) =>
    api<{ transcript_en: BatteryTranscriptLine[] }>(`/battery-issues/${issueId}/calls/${callId}/english`),
  recordingBlobUrl: async (streamPath: string) => {
    const token = localStorage.getItem('refex_token')
    const path = streamPath.startsWith('/api/v1/')
      ? streamPath.slice('/api/v1'.length)
      : streamPath.startsWith('/')
        ? streamPath
        : `/${streamPath}`
    const res = await fetch(`${getApiBase()}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) throw new Error('Could not load recording')
    return URL.createObjectURL(await res.blob())
  },
  close: (id: number | string, comments: string, files: File[]) => {
    const form = new FormData()
    form.append('comments', comments)
    files.forEach((file) => form.append('files', file))
    return api<{ status: string; messages: string[]; payload: BatteryIssue }>(`/battery-issues/${id}/close`, {
      method: 'POST',
      body: form,
    })
  },
  openCloseProof: async (id: number | string, index: number, filename: string) => {
    const token = localStorage.getItem('refex_token')
    const res = await fetch(`${getApiBase()}/battery-issues/${id}/close-proof/${index}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) throw new Error('Could not open attachment')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'proof'
    a.target = '_blank'
    a.rel = 'noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  },
  uploadRecording: async (id: number | string, file: File) => {
    const token = localStorage.getItem('refex_token')
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${getApiBase()}/battery-issues/${id}/recording`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    })
    const data = await res.json().catch(() => ({})) as { messages?: string | string[]; payload?: BatteryIssue }
    if (!res.ok) {
      const messages = Array.isArray(data.messages) ? data.messages : [String(data.messages || res.statusText)]
      throw new Error(messages.join(', '))
    }
    return data
  },
}
