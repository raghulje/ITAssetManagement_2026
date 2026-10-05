import { all, run, now } from '../db/index.js'
import { classifyCallResult } from './batteryCallStatus.js'
import { elloGetConversation, elloOutboundBlockedReason, isElloCreditError, blockElloOutbound } from './ello.js'
import { startOutboundCall } from '../routes/batteryIssues.js'
import { assignEligibleIssues } from './batteryTechnicianAssign.js'

/** First attempt + two automatic retries for ignored / rejected calls. */
export const BATTERY_MAX_CALL_ATTEMPTS = 3

function callbackMinutes() {
  const n = Number(process.env.ELLO_IGNORE_CALLBACK_MINUTES ?? 30)
  return Number.isFinite(n) && n > 0 ? n : 30
}

function minutesAgo(mins: number) {
  return new Date(Date.now() - mins * 60_000).toISOString().slice(0, 19).replace('T', ' ')
}

export async function runIgnoredCallCallbacks() {
  if (elloOutboundBlockedReason()) {
    console.warn('[battery-callback] skipped new calls —', elloOutboundBlockedReason())
    return { due: 0, attempted: 0, queued: 0, skipped: 'credits' as const }
  }
  const { isCallQueuePaused } = await import('./batteryCallQueue.js')
  if (isCallQueuePaused()) {
    return { due: 0, attempted: 0, queued: 0, skipped: 'paused' as const }
  }
  const cutoff = minutesAgo(callbackMinutes())
  const due = await all<Record<string, unknown>>(`
    SELECT c.id, c.issue_id, c.sequence, c.ello_conversation_id, c.ello_call_status, c.call_result,
           c.connected_at, c.ended_at, c.duration, c.disconnect_reason
    FROM battery_degradation_calls c
    INNER JOIN battery_degradation_issues i ON i.id = c.issue_id AND i.deleted_at IS NULL
    INNER JOIN (
      SELECT issue_id, MAX(sequence) AS seq
      FROM battery_degradation_calls
      GROUP BY issue_id
    ) latest ON latest.issue_id = c.issue_id AND latest.seq = c.sequence
    WHERE c.sequence < ?
      AND c.callback_queued_at IS NULL
      AND c.created_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM battery_degradation_calls done
        WHERE done.issue_id = c.issue_id AND done.call_result = 'completed'
      )
  `, [BATTERY_MAX_CALL_ATTEMPTS, cutoff])

  let attempted = 0
  let queued = 0
  for (const row of due) {
    attempted += 1
    const callId = Number(row.id)
    const issueId = Number(row.issue_id)
    const sequence = Number(row.sequence || 1)
    let result = String(row.call_result || '')
    const conversationId = String(row.ello_conversation_id || '').trim()
    if (conversationId) {
      try {
        const conv = await elloGetConversation(conversationId)
        result = classifyCallResult({
          elloStatus: conv.ended_at ? String(conv.status || 'ended') : String(conv.status || row.ello_call_status || ''),
          endedAt: conv.ended_at || (row.ended_at ? String(row.ended_at) : null),
          connectedAt: conv.connected_at || (row.connected_at ? String(row.connected_at) : null),
          duration: conv.duration || (row.duration ? String(row.duration) : null),
          durationSec: conv.duration_sec,
          disconnectReason: String(conv.disconnect_reason || (conv.metadata as Record<string, unknown> | null)?.disconnect_reason || row.disconnect_reason || ''),
          hangupCause: conv.hangup_cause || null,
          disconnectedBy: conv.disconnected_by || null,
          outcome: conv.out_come || null,
        })
        await run(
          `UPDATE battery_degradation_calls SET call_result = ?, ello_call_status = ?, ended_at = ?, connected_at = ?, duration = ?, updated_at = ? WHERE id = ?`,
          [
            result,
            conv.ended_at ? 'ended' : String(conv.status || row.ello_call_status || ''),
            conv.ended_at || row.ended_at || null,
            conv.connected_at || row.connected_at || null,
            conv.duration || row.duration || null,
            now(),
            callId,
          ],
        )
      } catch (e) {
        console.warn('[battery-callback] refresh failed', issueId, e instanceof Error ? e.message : e)
        if (isElloCreditError(e)) {
          blockElloOutbound(e instanceof Error ? e.message : 'Ello.AI: insufficient credits to start the call')
          break
        }
      }
    }
    if (result !== 'ignored' && result !== 'rejected') continue
    const claim = await run(
      `UPDATE battery_degradation_calls SET callback_queued_at = ? WHERE id = ? AND callback_queued_at IS NULL`,
      [now(), callId],
    )
    if (!claim.affectedRows) continue
    if (elloOutboundBlockedReason() || isCallQueuePaused()) {
      await run(`UPDATE battery_degradation_calls SET callback_queued_at = NULL WHERE id = ?`, [callId])
      break
    }
    try {
      const next = await startOutboundCall(issueId)
      queued += 1
      console.log(`[battery-callback] queued Conversation ${next.sequence} for issue ${issueId} after ${result} attempt ${sequence}`)
    } catch (e) {
      await run(`UPDATE battery_degradation_calls SET callback_queued_at = NULL WHERE id = ?`, [callId])
      console.warn('[battery-callback] place call failed', issueId, e instanceof Error ? e.message : e)
      if (isElloCreditError(e)) {
        blockElloOutbound(e instanceof Error ? e.message : 'Ello.AI: insufficient credits to start the call')
        break
      }
    }
  }
  return { due: due.length, attempted, queued }
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export function startIgnoredCallScheduler() {
  const minutes = callbackMinutes()
  console.log(`Ignored-call callback scheduler enabled (retry ${minutes} minutes after ignored or rejected calls, up to ${BATTERY_MAX_CALL_ATTEMPTS} attempts)`)
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runIgnoredCallCallbacks()
      await assignEligibleIssues()
    } catch (e) {
      console.error('[battery-callback] scheduler failed', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }
  setTimeout(() => { void tick() }, 25_000)
  timer = setInterval(() => { void tick() }, 60_000)
}

export function stopIgnoredCallScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}
