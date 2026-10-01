import { all, get, run, now } from '../db/index.js'
import { classifyCallResult } from './batteryCallStatus.js'
import { elloGetConversation } from './ello.js'
import { startOutboundCall } from '../routes/batteryIssues.js'
import { assignEligibleIssues } from './batteryTechnicianAssign.js'

function callbackMinutes() {
  const n = Number(process.env.ELLO_IGNORE_CALLBACK_MINUTES ?? 30)
  return Number.isFinite(n) && n > 0 ? n : 30
}

function minutesAgo(mins: number) {
  return new Date(Date.now() - mins * 60_000).toISOString().slice(0, 19).replace('T', ' ')
}

export async function runIgnoredCallCallbacks() {
  const cutoff = minutesAgo(callbackMinutes())
  const due = await all<Record<string, unknown>>(`
    SELECT c.id, c.issue_id, c.ello_conversation_id, c.ello_call_status, c.call_result,
           c.connected_at, c.ended_at, c.duration, c.disconnect_reason
    FROM battery_degradation_calls c
    INNER JOIN battery_degradation_issues i ON i.id = c.issue_id AND i.deleted_at IS NULL
    WHERE c.sequence = 1
      AND c.callback_queued_at IS NULL
      AND c.created_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM battery_degradation_calls later
        WHERE later.issue_id = c.issue_id AND later.sequence > 1
      )
  `, [cutoff])

  let attempted = 0
  let queued = 0
  for (const row of due) {
    attempted += 1
    const callId = Number(row.id)
    const issueId = Number(row.issue_id)
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
      }
    }
    if (result !== 'ignored' && result !== 'rejected') continue
    const claim = await run(
      `UPDATE battery_degradation_calls SET callback_queued_at = ? WHERE id = ? AND callback_queued_at IS NULL`,
      [now(), callId],
    )
    if (!claim.affectedRows) continue
    try {
      await startOutboundCall(issueId)
      queued += 1
      console.log(`[battery-callback] queued Conversation 2 for issue ${issueId} after ${result} first call`)
    } catch (e) {
      await run(`UPDATE battery_degradation_calls SET callback_queued_at = NULL WHERE id = ?`, [callId])
      console.warn('[battery-callback] place call failed', issueId, e instanceof Error ? e.message : e)
    }
  }
  return { due: due.length, attempted, queued }
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export function startIgnoredCallScheduler() {
  const minutes = callbackMinutes()
  console.log(`Ignored-call callback scheduler enabled (retry ${minutes} minutes after first ignored or rejected call)`)
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
