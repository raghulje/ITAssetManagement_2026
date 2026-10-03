/**
 * Ello.AI India voice API — Battery Degradation outbound calls.
 * Agent 6abe1d312713e05e957c8eb4. Create call → store conversation_id → GET conversation + transcripts.
 * Auth header: X-API-Key from ELLO_API_KEY.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvedBatteryAgentId } from './batteryConfig.js'

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
  override: true,
})

export const ELLO_BATTERY_AGENT_ID = '6abe1d312713e05e957c8eb4'

export type ElloConfig = {
  baseUrl: string
  apiKey: string
  agentId: string
  fromNumber: string
  greeting: string
}

export type ElloCreateCallResult = {
  conversation_id: string
  call_status: string
  siptrunk_id: string
}

export type ElloTranscriptLine = { role: string; content: string }

export type ElloConversation = {
  id?: string
  status?: string
  to_number?: string | null
  connected_at?: string | null
  ended_at?: string | null
  duration?: string | null
  duration_sec?: number | null
  disconnected_by?: string | null
  disconnect_reason?: string | null
  hangup_cause?: string | null
  out_come?: string | null
  ai_confidence_score?: number | null
  recording?: { url?: string | null; duration_seconds?: number | null; enabled?: boolean } | null
  metadata?: Record<string, unknown> | null
}

type ElloEnvelope<T> = {
  status?: number
  message?: string
  data?: T
}

export async function elloConfig(): Promise<ElloConfig> {
  const baseUrl = (process.env.ELLO_API_BASE || 'https://api-in.getello.ai').replace(/\/+$/, '')
  const apiKey = String(process.env.ELLO_API_KEY || '').trim()
  const storedAgent = await resolvedBatteryAgentId()
  const agentId = storedAgent || String(process.env.ELLO_AGENT_ID || ELLO_BATTERY_AGENT_ID).trim() || ELLO_BATTERY_AGENT_ID
  const fromNumber = String(process.env.ELLO_FROM_NUMBER || '9790738549').replace(/\D/g, '')
  const greeting = String(process.env.ELLO_GREETING || 'Hi, this is Refex One AI from the IT Helpdesk team.').trim()
  if (!apiKey) throw new Error('ELLO_API_KEY must be set in server .env')
  if (!agentId) throw new Error('ELLO_AGENT_ID is missing — set it in Settings → Battery Degradation')
  return { baseUrl, apiKey, agentId, fromNumber, greeting }
}

export function dialDigits(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.startsWith('91') && digits.length >= 12) return digits.slice(-10)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

async function elloFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = await elloConfig()
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': cfg.apiKey,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  const text = await res.text()
  let json: ElloEnvelope<T> = {}
  try {
    json = text ? JSON.parse(text) as ElloEnvelope<T> : {}
  } catch {
    throw new Error(`Ello.AI returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const msg = json.message || `Ello.AI HTTP ${res.status}`
    if (res.status === 402) throw new Error('Ello.AI: insufficient credits to start the call')
    if (res.status === 401) throw new Error('Ello.AI: API key missing or invalid')
    throw new Error(msg)
  }
  return (json.data ?? json) as T
}

export async function elloCreateCall(input: {
  name: string
  phone: string
  email?: string
  company?: string
}): Promise<ElloCreateCallResult & { agent_id: string }> {
  const cfg = await elloConfig()
  const toNumber = dialDigits(input.phone)
  if (!toNumber) throw new Error('A valid phone number is required to start the call')
  const data = await elloFetch<ElloCreateCallResult>(`/api/agents/${cfg.agentId}/calls`, {
    method: 'POST',
    body: JSON.stringify({
      message: cfg.greeting,
      agent_type: 'telephonic',
      from_number: cfg.fromNumber,
      to_number: toNumber,
      assistant_id: cfg.agentId,
      call_type: 'outbound',
      name: input.name,
      context_data: {
        customer_name: input.name,
        company_name: input.company || '',
        user_email: input.email || '',
      },
    }),
  })
  const conversation_id = String(data?.conversation_id || '').trim()
  if (!conversation_id) throw new Error('Ello.AI did not return a conversation_id')
  return {
    conversation_id,
    call_status: String(data?.call_status || 'in_queue'),
    siptrunk_id: String(data?.siptrunk_id || ''),
    agent_id: cfg.agentId,
  }
}

export async function elloGetConversation(conversationId: string): Promise<ElloConversation> {
  const cfg = await elloConfig()
  return elloFetch<ElloConversation>(`/api/agents/${cfg.agentId}/conversations/${conversationId}`)
}

export async function elloGetTranscripts(conversationId: string): Promise<ElloTranscriptLine[]> {
  const cfg = await elloConfig()
  const lines: ElloTranscriptLine[] = []
  let page = 1
  let hasNext = true
  while (hasNext && page <= 20) {
    const res = await fetch(`${cfg.baseUrl}/api/conversations/${conversationId}/transcripts?page=${page}&limit=50`, {
      headers: {
        Accept: 'application/json',
        'X-API-Key': cfg.apiKey,
      },
    })
    const text = await res.text()
    let json: ElloEnvelope<ElloTranscriptLine[]> & {
      pagination?: { hasNextPage?: boolean }
    } = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(`Ello.AI transcripts returned non-JSON (${res.status})`)
    }
    if (!res.ok) {
      if (res.status === 404 || res.status === 400) return lines
      throw new Error(json.message || `Ello.AI transcripts HTTP ${res.status}`)
    }
    const chunk = Array.isArray(json.data) ? json.data : []
    lines.push(...chunk)
    hasNext = Boolean(json.pagination?.hasNextPage)
    page += 1
  }
  return lines
}

export function mapElloTranscript(lines: ElloTranscriptLine[]): Array<{ speaker: 'bot' | 'user'; text: string }> {
  return lines
    .map((line) => ({
      speaker: String(line.role || '').toLowerCase() === 'user' ? 'user' as const : 'bot' as const,
      text: String(line.content || '').trim(),
    }))
    .filter((line) => line.text)
}
