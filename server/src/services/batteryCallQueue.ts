import { all, now } from '../db/index.js'
import { startOutboundCall } from '../routes/batteryIssues.js'

export const CALL_QUEUE_LIMITS = [15, 30, 50] as const

export type CallQueueLimit = typeof CALL_QUEUE_LIMITS[number] | 'all'

export type CallQueueStatus = {
  running: boolean
  total: number
  done: number
  failed: number
  current_id: number | null
  current_name: string
  started_at: string | null
  finished_at: string | null
  message: string
  limit: CallQueueLimit | null
}

const idle: CallQueueStatus = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  current_id: null,
  current_name: '',
  started_at: null,
  finished_at: null,
  message: '',
  limit: null,
}

export function parseCallQueueLimit(raw: unknown): CallQueueLimit {
  if (raw == null || raw === '' || raw === 'all') return 'all'
  const n = Number(raw)
  if ((CALL_QUEUE_LIMITS as readonly number[]).includes(n)) return n as CallQueueLimit
  throw new Error('Choose first 15, 30, 50, or call all')
}

let state: CallQueueStatus = { ...idle }
let loop: Promise<void> | null = null

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getCallQueueStatus(): CallQueueStatus {
  return { ...state }
}

export async function startPendingCallQueue(opts?: {
  userId?: number | null
  gapMs?: number
  limit?: unknown
}) {
  if (state.running) {
    throw new Error('A call queue is already running')
  }
  const limit = parseCallQueueLimit(opts?.limit)
  const pending = await all<{ id: number; name: string; phone: string }>(`
    SELECT i.id, i.name, i.phone
    FROM battery_degradation_issues i
    WHERE i.deleted_at IS NULL
      AND i.phone IS NOT NULL AND TRIM(i.phone) != '' AND i.phone != '-'
      AND NOT EXISTS (
        SELECT 1 FROM battery_degradation_calls c WHERE c.issue_id = i.id
      )
    ORDER BY i.id ASC
    ${limit === 'all' ? '' : 'LIMIT ?'}
  `, limit === 'all' ? [] : [limit])
  if (!pending.length) {
    state = { ...idle, message: 'No pending contacts with a phone number' }
    return getCallQueueStatus()
  }

  const ts = now()
  const batchLabel = limit === 'all'
    ? `all ${pending.length} pending contact${pending.length === 1 ? '' : 's'}`
    : `the first ${pending.length} pending contact${pending.length === 1 ? '' : 's'}`
  state = {
    running: true,
    total: pending.length,
    done: 0,
    failed: 0,
    current_id: null,
    current_name: '',
    started_at: ts,
    finished_at: null,
    message: `Calling ${batchLabel}. Ignored or rejected in this batch retry after 30 minutes, up to 3 calls.`,
    limit,
  }

  const gap = Math.max(3000, Number(opts?.gapMs || 6000))
  loop = (async () => {
    for (const row of pending) {
      if (!state.running) break
      state = {
        ...state,
        current_id: Number(row.id),
        current_name: String(row.name || ''),
        message: `Calling ${row.name}`,
      }
      try {
        await startOutboundCall(Number(row.id), { userId: opts?.userId ?? null })
        state = { ...state, done: state.done + 1 }
      } catch (e) {
        state = {
          ...state,
          failed: state.failed + 1,
          message: e instanceof Error ? e.message : 'Call failed',
        }
        console.warn('[battery-call-queue] failed', row.id, e instanceof Error ? e.message : e)
      }
      if (state.done + state.failed < pending.length) await pause(gap)
    }
    state = {
      ...state,
      running: false,
      current_id: null,
      current_name: '',
      finished_at: now(),
      message: `Finished: ${state.done} queued, ${state.failed} failed`,
    }
  })()

  void loop.catch((e) => {
    state = {
      ...state,
      running: false,
      finished_at: now(),
      message: e instanceof Error ? e.message : 'Call queue stopped',
    }
  })

  return getCallQueueStatus()
}
