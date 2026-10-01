export type CallResult = 'yet_to_call' | 'queued' | 'in_progress' | 'completed' | 'rejected' | 'ignored'

export function callResultLabel(result: string | null | undefined) {
  switch (String(result || '').toLowerCase()) {
    case 'yet_to_call': return 'Yet to call'
    case 'queued':
    case 'in_progress': return 'Calling'
    case 'completed':
    case 'ended': return 'Call completed'
    case 'rejected': return 'Rejected'
    case 'ignored': return 'Ignored'
    default: return result ? String(result) : 'Yet to call'
  }
}

export function durationSeconds(duration: string | number | null | undefined, durationSec?: number | null) {
  if (durationSec != null && Number.isFinite(Number(durationSec))) return Number(durationSec)
  if (duration == null || duration === '') return 0
  if (typeof duration === 'number') return duration
  const raw = String(duration).trim()
  const secOnly = raw.match(/^(\d+(?:\.\d+)?)s$/i)
  if (secOnly) return Number(secOnly[1])
  const clock = raw.match(/^(\d+):(\d+)(?::(\d+))?$/)
  if (clock) {
    const a = Number(clock[1])
    const b = Number(clock[2])
    const c = clock[3] != null ? Number(clock[3]) : null
    if (c == null) return a * 60 + b
    return a * 3600 + b * 60 + c
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function blobOf(...parts: Array<string | null | undefined>) {
  return parts.map((p) => String(p || '').toLowerCase().replace(/[_-]+/g, ' ')).join(' ')
}

export function classifyCallResult(input: {
  elloStatus?: string | null
  endedAt?: string | null
  connectedAt?: string | null
  duration?: string | number | null
  durationSec?: number | null
  disconnectReason?: string | null
  hangupCause?: string | null
  disconnectedBy?: string | null
  outcome?: string | null
  transcriptCount?: number
}): CallResult {
  const status = String(input.elloStatus || '').toLowerCase()
  const text = blobOf(
    status,
    input.disconnectReason,
    input.hangupCause,
    input.disconnectedBy,
    input.outcome,
  )
  const secs = durationSeconds(input.duration, input.durationSec)
  const connected = Boolean(input.connectedAt) || status === 'connected'
  const finished = Boolean(input.endedAt)
    || ['ended', 'completed', 'failed', 'disconnected', 'no_answer', 'rejected', 'busy', 'cancelled', 'canceled', 'ignored'].includes(status)

  if (!finished) {
    if (['in_queue', 'queued', 'ringing', 'dialing'].includes(status)) return 'queued'
    if (status === 'connected' || status === 'in_progress') return 'in_progress'
    if (!status) return 'queued'
    return 'in_progress'
  }

  if (/(reject|declin|user busy|call rejected|busy here)/.test(text)) return 'rejected'
  if (/\bbusy\b/.test(text) && !connected) return 'rejected'

  if (/(no answer|no user response|unanswer|ignored|missed|not answered|originator cancel|originator_cancel|call cancel)/.test(text)) {
    return 'ignored'
  }

  const talked = connected || secs >= 8 || Number(input.transcriptCount || 0) >= 2
  if (talked && !/(no answer|ignored|reject|declin)/.test(text)) return 'completed'
  if (status === 'ended' && talked) return 'completed'
  if (status === 'completed' || status === 'success') return 'completed'

  return 'ignored'
}
