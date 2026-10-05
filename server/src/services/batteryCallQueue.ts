import { all, now } from '../db/index.js'
import { startOutboundCall } from '../routes/batteryIssues.js'
import {
  blockElloOutbound,
  clearElloOutboundBlock,
  elloOutboundBlockedReason,
  isElloCreditError,
} from './ello.js'

export const CALL_QUEUE_LIMITS = [15, 30, 50] as const

export type CallQueueLimit = typeof CALL_QUEUE_LIMITS[number] | 'all'

export type CallQueueStatus = {
  running: boolean
  paused: boolean
  credit_blocked: boolean
  total: number
  done: number
  failed: number
  remaining: number
  current_id: number | null
  current_name: string
  started_at: string | null
  finished_at: string | null
  message: string
  limit: CallQueueLimit | null
}

const idle: CallQueueStatus = {
  running: false,
  paused: false,
  credit_blocked: false,
  total: 0,
  done: 0,
  failed: 0,
  remaining: 0,
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
let stopRequested = false
let pauseRequested = false

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getCallQueueStatus(): CallQueueStatus {
  return {
    ...state,
    credit_blocked: Boolean(elloOutboundBlockedReason() || state.credit_blocked),
    remaining: Math.max(0, state.total - state.done - state.failed),
  }
}

export function isCallQueuePaused() {
  return Boolean(state.running && (state.paused || pauseRequested))
}

async function waitWhilePaused() {
  while (pauseRequested && !stopRequested) {
    if (!state.paused) {
      state = {
        ...state,
        paused: true,
        message: `Paused at ${state.done + state.failed} / ${state.total}. Click Continue to keep calling.`,
      }
    }
    await sleep(400)
  }
}

function haltForCredits(err: unknown) {
  const msg = err instanceof Error ? err.message : 'Ello.AI credits or subscription ran out'
  blockElloOutbound(msg)
  stopRequested = true
  pauseRequested = false
  state = {
    ...state,
    running: false,
    paused: false,
    credit_blocked: true,
    current_id: null,
    current_name: '',
    finished_at: now(),
    message: `${msg}. Call queue stopped so we do not keep hitting Ello. Top up the agent, then start Call pending again.`,
  }
}

export async function startPendingCallQueue(opts?: {
  userId?: number | null
  gapMs?: number
  limit?: unknown
}) {
  if (state.running) {
    throw new Error(state.paused
      ? 'Call queue is paused. Click Continue or Stop first.'
      : 'A call queue is already running')
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

  clearElloOutboundBlock()
  stopRequested = false
  pauseRequested = false
  const ts = now()
  const batchLabel = limit === 'all'
    ? `all ${pending.length} pending contact${pending.length === 1 ? '' : 's'}`
    : `the first ${pending.length} pending contact${pending.length === 1 ? '' : 's'}`
  state = {
    running: true,
    paused: false,
    credit_blocked: false,
    total: pending.length,
    done: 0,
    failed: 0,
    remaining: pending.length,
    current_id: null,
    current_name: '',
    started_at: ts,
    finished_at: null,
    message: `Calling ${batchLabel}. Use Pause, Continue, or Stop at any time.`,
    limit,
  }

  const gap = Math.max(3000, Number(opts?.gapMs || 6000))
  loop = (async () => {
    for (const row of pending) {
      await waitWhilePaused()
      if (stopRequested) break
      const blocked = elloOutboundBlockedReason()
      if (blocked) {
        haltForCredits(new Error(blocked))
        return
      }
      state = {
        ...state,
        paused: false,
        current_id: Number(row.id),
        current_name: String(row.name || ''),
        message: `Calling ${row.name}`,
        remaining: Math.max(0, pending.length - state.done - state.failed),
      }
      try {
        await startOutboundCall(Number(row.id), { userId: opts?.userId ?? null })
        state = { ...state, done: state.done + 1 }
      } catch (e) {
        if (isElloCreditError(e)) {
          haltForCredits(e)
          return
        }
        state = {
          ...state,
          failed: state.failed + 1,
          message: e instanceof Error ? e.message : 'Call failed',
        }
        console.warn('[battery-call-queue] failed', row.id, e instanceof Error ? e.message : e)
      }
      if (stopRequested) break
      if (state.done + state.failed < pending.length) {
        await sleep(gap)
        await waitWhilePaused()
      }
    }
    if (state.credit_blocked) return
    const stopped = stopRequested
    stopRequested = false
    pauseRequested = false
    state = {
      ...state,
      running: false,
      paused: false,
      current_id: null,
      current_name: '',
      finished_at: now(),
      remaining: 0,
      message: stopped
        ? `Stopped: ${state.done} queued, ${state.failed} failed, ${Math.max(0, pending.length - state.done - state.failed)} not called`
        : `Finished: ${state.done} queued, ${state.failed} failed`,
    }
  })()

  void loop.catch((e) => {
    if (isElloCreditError(e)) {
      haltForCredits(e)
      return
    }
    state = {
      ...state,
      running: false,
      paused: false,
      finished_at: now(),
      message: e instanceof Error ? e.message : 'Call queue stopped',
    }
  })

  return getCallQueueStatus()
}

export function pauseCallQueue() {
  if (!state.running) throw new Error('No call queue is running')
  if (pauseRequested || state.paused) return getCallQueueStatus()
  pauseRequested = true
  state = {
    ...state,
    paused: true,
    message: `Pausing after the current call… (${state.done + state.failed} / ${state.total})`,
  }
  return getCallQueueStatus()
}

export function resumeCallQueue() {
  if (!state.running) throw new Error('No call queue is running')
  if (elloOutboundBlockedReason()) {
    throw new Error(`${elloOutboundBlockedReason()}. Top up the agent, then start Call pending again.`)
  }
  pauseRequested = false
  state = {
    ...state,
    paused: false,
    message: `Continuing call queue (${state.done + state.failed} / ${state.total})`,
  }
  return getCallQueueStatus()
}

export function stopCallQueue() {
  if (!state.running) {
    state = { ...state, message: state.message || 'Call queue is not running' }
    return getCallQueueStatus()
  }
  stopRequested = true
  pauseRequested = false
  state = {
    ...state,
    paused: false,
    message: `Stopping call queue… (${state.done + state.failed} / ${state.total} already placed)`,
  }
  return getCallQueueStatus()
}
