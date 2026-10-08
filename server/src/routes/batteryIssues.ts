import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { all, get, run, now, limitSql } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { logAction } from '../services/actionLog.js'
import { makeUploader, makeMultiUploader, storageRoot, absolutePath } from '../services/uploads.js'
import {
  elloCreateCall,
  elloGetConversation,
  elloGetTranscripts,
  mapElloTranscript,
  type ElloConversation,
} from '../services/ello.js'
import { sendBatteryCallEndedEmail } from '../services/batteryCallEmail.js'
import {
  classifyCallResult,
  callResultLabel,
  canonicalCallResult,
  settleStoredCallResult,
} from '../services/batteryCallStatus.js'
import {
  classifyCallSurvey,
  isBothNo,
  isNoIssueComments,
  NO_ISSUE_COMMENTS,
  OTHER_ISSUE_TYPES,
  otherIssueTypeLabel,
} from '../services/batteryIssueResponse.js'
import { applyAttendedCallOutcome, isNoIssueClose, userDisplayName } from '../services/batteryTechnicianAssign.js'
import { isTruthyPerm } from '../services/permissions.js'
import { ensureLocalCallRecording } from '../services/batteryRecordings.js'
import { translateTranscriptToEnglish } from '../services/batteryTranscriptEnglish.js'

export const batteryIssuesRouter = Router()

export type TranscriptLine = { speaker: 'bot' | 'user'; text: string }
export type TrackerStep = {
  key: string
  label: string
  status: 'completed' | 'in_progress' | 'skipped' | 'not_started'
  source?: string
  at?: string
  call_status?: string
  duration?: string
  assignee?: string
}

export function defaultTracker(createdAt: string): TrackerStep[] {
  return [
    { key: 'start', label: 'Start', status: 'completed', source: 'Battery Degradation Issue', at: createdAt },
    { key: 'voice', label: 'Voice Bot Conversation', status: 'not_started', source: 'Refex IT' },
    { key: 'assign', label: 'Assign technician', status: 'not_started', source: 'UserTask' },
    { key: 'summary', label: 'Enter issue summary', status: 'not_started' },
    { key: 'completed', label: 'Completed', status: 'not_started', source: 'Battery Degradation Issue' },
  ]
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback
  if (typeof raw === 'object') return raw as T
  try {
    return JSON.parse(String(raw)) as T
  } catch {
    return fallback
  }
}

/** Latest call_result on the issue. Used so Attended / Rejected / Ignored do not overlap. */
const LATEST_CALL_RESULT_SQL = `(
  SELECT c.call_result
  FROM battery_degradation_calls c
  WHERE c.issue_id = battery_degradation_issues.id
  ORDER BY c.sequence DESC, c.id DESC
  LIMIT 1
)`

const LATEST_OUTCOME_SQL = `CASE
  WHEN ${LATEST_CALL_RESULT_SQL} IN ('completed', 'attended', 'ended', 'success') THEN 'completed'
  WHEN ${LATEST_CALL_RESULT_SQL} = 'rejected' THEN 'rejected'
  WHEN ${LATEST_CALL_RESULT_SQL} = 'ignored' THEN 'ignored'
  WHEN EXISTS (SELECT 1 FROM battery_degradation_calls c WHERE c.issue_id = battery_degradation_issues.id) THEN 'calling'
  ELSE 'yet_to_call'
END`

async function backfillStaleCallResults(limit = 400) {
  let liveId = 0
  try {
    const { getCallQueueStatus } = await import('../services/batteryCallQueue.js')
    const queue = getCallQueueStatus()
    if (queue.running) liveId = Number(queue.current_id || 0)
  } catch {
    liveId = 0
  }
  const rows = await all<Record<string, unknown>>(`
    SELECT id, issue_id, call_result, ello_call_status, connected_at, ended_at, duration,
           disconnect_reason, transcript, created_at, updated_at
    FROM battery_degradation_calls
    WHERE IFNULL(call_result, '') NOT IN ('completed', 'rejected', 'ignored')
    ORDER BY id DESC
    LIMIT ?
  `, [Math.max(1, Number(limit) || 400)])
  const touched = new Set<number>()
  const ts = now()
  for (const row of rows) {
    const next = settleStoredCallResult({
      stored: String(row.call_result || ''),
      live: liveId > 0 && Number(row.issue_id) === liveId,
      updatedAt: row.updated_at ? String(row.updated_at) : null,
      createdAt: row.created_at ? String(row.created_at) : null,
      elloStatus: String(row.ello_call_status || ''),
      endedAt: row.ended_at ? String(row.ended_at) : null,
      connectedAt: row.connected_at ? String(row.connected_at) : null,
      duration: row.duration ? String(row.duration) : null,
      disconnectReason: row.disconnect_reason ? String(row.disconnect_reason) : null,
      transcriptCount: parseJson<TranscriptLine[]>(row.transcript, []).length,
    })
    const prev = canonicalCallResult(String(row.call_result || '')) || String(row.call_result || '')
    if (next === prev) continue
    await run(
      `UPDATE battery_degradation_calls SET call_result = ?, updated_at = ? WHERE id = ?`,
      [next, ts, Number(row.id)],
    )
    touched.add(Number(row.issue_id))
  }
  for (const issueId of touched) {
    const latest = await get<{ call_result: string | null }>(
      `SELECT call_result FROM battery_degradation_calls WHERE issue_id = ? ORDER BY sequence DESC, id DESC LIMIT 1`,
      [issueId],
    )
    if (!latest) continue
    await run(
      `UPDATE battery_degradation_issues SET call_result = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [latest.call_result, ts, issueId],
    )
  }
  return touched.size
}

function transformCall(row: Record<string, unknown>) {
  const sequence = Number(row.sequence || 1)
  const callResult = settleStoredCallResult({
    stored: String(row.call_result || ''),
    elloStatus: String(row.ello_call_status || ''),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    connectedAt: row.connected_at ? String(row.connected_at) : null,
    duration: row.duration ? String(row.duration) : null,
    disconnectReason: row.disconnect_reason ? String(row.disconnect_reason) : null,
    transcriptCount: parseJson<TranscriptLine[]>(row.transcript, []).length,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
  })
  return {
    id: Number(row.id),
    sequence,
    label: `Conversation ${sequence}`,
    conversation_id: row.ello_conversation_id ? String(row.ello_conversation_id) : '',
    call_status: row.ello_call_status ? String(row.ello_call_status) : '',
    call_result: callResult,
    disconnect_reason: row.disconnect_reason ? String(row.disconnect_reason) : '',
    siptrunk_id: row.ello_siptrunk_id ? String(row.ello_siptrunk_id) : '',
    agent_id: row.ello_agent_id ? String(row.ello_agent_id) : '',
    bot_summary: row.bot_summary ? String(row.bot_summary) : '',
    recording_url: row.recording_url ? String(row.recording_url) : '',
    recording_stream: Number(row.issue_id) && Number(row.id) && row.recording_path
      ? `/battery-issues/${Number(row.issue_id)}/calls/${Number(row.id)}/recording`
      : '',
    transcript: parseJson<TranscriptLine[]>(row.transcript, []),
    transcript_en: parseJson<TranscriptLine[]>(row.transcript_en, []),
    duration: row.duration ? String(row.duration) : '',
    connected_at: row.connected_at ? String(row.connected_at) : '',
    ended_at: row.ended_at ? String(row.ended_at) : '',
    callback_queued_at: row.callback_queued_at ? String(row.callback_queued_at) : '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

type IssueCall = ReturnType<typeof transformCall>

function transform(row: Record<string, unknown>, conversations: IssueCall[] = [], callCount?: number) {
  const id = Number(row.id)
  const latest = conversations.length ? conversations[conversations.length - 1] : null
  const count = callCount ?? conversations.length
  return {
    id,
    name: String(row.name || ''),
    phone: row.phone ? String(row.phone) : '',
    email: row.email ? String(row.email) : '',
    company: row.company ? String(row.company) : '',
    message: row.message ? String(row.message) : '',
    bot_summary: latest ? latest.bot_summary : (row.bot_summary ? String(row.bot_summary) : ''),
    recording_url: latest ? latest.recording_url : (row.recording_url ? String(row.recording_url) : ''),
    recording_original_name: row.recording_original_name ? String(row.recording_original_name) : '',
    has_recording: Boolean((latest && (latest.recording_url || latest.recording_stream)) || row.recording_path || row.recording_url),
    recording_stream: latest?.recording_stream
      || (row.recording_path ? `/battery-issues/${id}/recording` : ''),
    transcript: latest ? latest.transcript : parseJson<TranscriptLine[]>(row.transcript, []),
    conversations,
    call_count: count,
    tracker: applyWorkflowTracker(row, conversations),
    status: String(row.status || 'in_progress'),
    assigned_to: row.assigned_to ? Number(row.assigned_to) : null,
    assigned_name: String(row.assigned_name || ''),
    assigned_at: row.assigned_at ? String(row.assigned_at) : '',
    close_comments: row.close_comments ? String(row.close_comments) : '',
    close_attachments: parseJson<Array<{ original_name?: string; mime?: string; path?: string }>>(row.close_attachments, [])
      .map((file, index) => ({
        index,
        original_name: String(file.original_name || 'attachment'),
        mime: String(file.mime || ''),
        url: `/api/v1/battery-issues/${id}/close-proof/${index}`,
      })),
    closed_at: row.closed_at ? String(row.closed_at) : '',
    closed_by: row.closed_by ? Number(row.closed_by) : null,
    closed_by_name: String(row.closed_by_name || ''),
    preferred_language: row.preferred_language ? String(row.preferred_language) : '',
    battery_issue_confirmed: row.battery_issue_confirmed ? String(row.battery_issue_confirmed) : '',
    other_issue_reported: row.other_issue_reported ? String(row.other_issue_reported) : '',
    other_issue_description: row.other_issue_description ? String(row.other_issue_description) : '',
    other_issue_types: parseJson<string[]>(row.other_issue_types, [])
      .map((key) => String(key || '').trim())
      .filter(Boolean)
      .map((key) => ({ key, label: otherIssueTypeLabel(key) })),
    webhook_sent_at: row.webhook_sent_at ? String(row.webhook_sent_at) : '',
    conversation_id: latest?.conversation_id || (row.ello_conversation_id ? String(row.ello_conversation_id) : ''),
    call_status: latest?.call_status || (row.ello_call_status ? String(row.ello_call_status) : ''),
    call_result: latest?.call_result || String(row.call_result || '') || (count ? 'queued' : 'yet_to_call'),
    siptrunk_id: latest?.siptrunk_id || (row.ello_siptrunk_id ? String(row.ello_siptrunk_id) : ''),
    agent_id: latest?.agent_id || (row.ello_agent_id ? String(row.ello_agent_id) : ''),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function patchTracker(tracker: TrackerStep[], key: string, patch: Partial<TrackerStep>): TrackerStep[] {
  const next = tracker.length ? tracker.map((step) => ({ ...step })) : defaultTracker(now())
  const idx = next.findIndex((step) => step.key === key)
  if (idx >= 0) next[idx] = { ...next[idx], ...patch }
  else next.push({ key, label: key, status: 'in_progress', ...patch })
  return next
}

async function loadIssue(id: number) {
  return get<Record<string, unknown>>(
    `SELECT * FROM battery_degradation_issues WHERE id = ? AND deleted_at IS NULL`,
    [id],
  )
}

async function loadCalls(issueId: number): Promise<IssueCall[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT * FROM battery_degradation_calls WHERE issue_id = ? ORDER BY sequence ASC, id ASC`,
    [issueId],
  )
  return rows.map(transformCall)
}

async function loadIssuePayload(id: number) {
  const row = await loadIssue(id)
  if (!row) return null
  await hydrateAssignees([row])
  const conversations = await loadCalls(id)
  return transform(row, conversations)
}

async function callCounts(issueIds: number[]) {
  const map = new Map<number, number>()
  if (!issueIds.length) return map
  const placeholders = issueIds.map(() => '?').join(',')
  const rows = await all<{ issue_id: number; c: number }>(
    `SELECT issue_id, COUNT(*) AS c FROM battery_degradation_calls WHERE issue_id IN (${placeholders}) GROUP BY issue_id`,
    issueIds,
  )
  for (const r of rows) map.set(Number(r.issue_id), Number(r.c))
  return map
}

async function latestCallResults(issueIds: number[]) {
  const map = new Map<number, string>()
  if (!issueIds.length) return map
  const placeholders = issueIds.map(() => '?').join(',')
  const rows = await all<{
    issue_id: number
    call_result: string | null
    ello_call_status: string | null
    connected_at: string | null
    ended_at: string | null
    duration: string | null
    disconnect_reason: string | null
  }>(
    `SELECT c.issue_id, c.call_result, c.ello_call_status, c.connected_at, c.ended_at, c.duration, c.disconnect_reason
     FROM battery_degradation_calls c
     INNER JOIN (
       SELECT issue_id, MAX(sequence) AS seq
       FROM battery_degradation_calls
       WHERE issue_id IN (${placeholders})
       GROUP BY issue_id
     ) t ON t.issue_id = c.issue_id AND t.seq = c.sequence`,
    issueIds,
  )
  for (const r of rows) {
    const result = settleStoredCallResult({
      stored: r.call_result,
      elloStatus: r.ello_call_status,
      endedAt: r.ended_at,
      connectedAt: r.connected_at,
      duration: r.duration,
      disconnectReason: r.disconnect_reason,
    })
    map.set(Number(r.issue_id), result)
  }
  return map
}

function metaString(meta: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!meta) return ''
  for (const key of keys) {
    const v = meta[key]
    if (v != null && String(v).trim() && String(v) !== 'null') return String(v).trim()
  }
  return ''
}

function applyConversationToCall(call: Record<string, unknown>, conv: ElloConversation, transcriptCount = 0) {
  const ts = now()
  const meta = conv.metadata && typeof conv.metadata === 'object' ? conv.metadata : {}
  const summary = metaString(meta, 'summary') || String(call.bot_summary || '')
  const recordingUrl = conv.recording?.url || String(call.recording_url || '') || null
  const rawStatus = String(conv.status || call.ello_call_status || '')
  const callStatus = conv.ended_at ? 'ended' : (rawStatus || 'in_queue')
  const duration = conv.duration || (conv.duration_sec ? `${conv.duration_sec}s` : '') || String(call.duration || '')
  const disconnectReason = metaString(meta, 'disconnect_reason', 'hangup_cause')
    || conv.disconnect_reason
    || conv.hangup_cause
    || String(call.disconnect_reason || '')
    || null
  const callResult = classifyCallResult({
    elloStatus: conv.ended_at ? (rawStatus === 'connected' ? 'ended' : rawStatus) : rawStatus,
    endedAt: conv.ended_at || null,
    connectedAt: conv.connected_at || null,
    duration,
    durationSec: conv.duration_sec,
    disconnectReason,
    hangupCause: conv.hangup_cause || metaString(meta, 'hangup_cause') || null,
    disconnectedBy: conv.disconnected_by || metaString(meta, 'disconnected_by') || null,
    outcome: conv.out_come || metaString(meta, 'outcome', 'call_outcome') || null,
    transcriptCount,
  })
  return {
    bot_summary: summary || null,
    recording_url: recordingUrl,
    ello_call_status: callStatus || 'in_queue',
    call_result: callResult,
    disconnect_reason: disconnectReason,
    duration: duration || null,
    connected_at: conv.connected_at || call.connected_at || null,
    ended_at: conv.ended_at || call.ended_at || null,
    ts,
  }
}

function voiceTrackerFromCalls(issue: Record<string, unknown>, conversations: IssueCall[]): TrackerStep[] {
  const ts = now()
  let tracker = parseJson<TrackerStep[]>(issue.tracker, defaultTracker(String(issue.created_at || ts)))
  const latest = conversations[conversations.length - 1]
  if (!latest) return tracker
  const result = latest.call_result
  const ended = result === 'completed' || result === 'ignored' || result === 'rejected' || latest.call_status === 'ended' || Boolean(latest.ended_at)
  const n = conversations.length
  tracker = patchTracker(tracker, 'voice', {
    status: result === 'completed' ? 'completed' : (result === 'ignored' || result === 'rejected') ? 'skipped' : ended ? 'completed' : 'in_progress',
    source: 'Ello.AI',
    call_status: callResultLabel(result || latest.call_status),
    duration: latest.duration || undefined,
    at: latest.connected_at || latest.ended_at || String(latest.created_at || ts),
    label: n > 1 ? `Voice Bot Conversation (${n})` : 'Voice Bot Conversation',
  })
  if (latest.bot_summary) {
    tracker = patchTracker(tracker, 'summary', {
      status: ended ? 'completed' : 'in_progress',
      source: 'Ello.AI',
    })
  }
  return tracker
}

function conversationsSayNoIssue(conversations: IssueCall[]) {
  for (const call of [...conversations].reverse()) {
    if (call.call_result !== 'completed') continue
    if (isBothNo(classifyCallSurvey(call.transcript, null, call.bot_summary))) return true
  }
  return false
}

function workflowFlags(issue: Record<string, unknown>, conversations: IssueCall[]) {
  const attended = conversations.some((c) => c.call_result === 'completed')
    || (!conversations.length && String(issue.call_result || '') === 'completed')
  const rejectedWithoutAttend = !attended && (
    conversations.some((c) => c.call_result === 'rejected')
    || (!conversations.length && String(issue.call_result || '') === 'rejected')
  )
  const storedHasIssue = String(issue.battery_issue_confirmed || '') === 'yes'
    || String(issue.other_issue_reported || '') === 'yes'
  const storedBothNo = String(issue.battery_issue_confirmed || '') === 'no'
    && String(issue.other_issue_reported || '') === 'no'
  const noIssue = !storedHasIssue && (
    isNoIssueClose(issue)
    || isNoIssueComments(issue.close_comments)
    || storedBothNo
    || (!Number(issue.assigned_to || 0) && conversationsSayNoIssue(conversations))
  )
  return { attended, rejectedWithoutAttend, noIssue }
}

function applyWorkflowTracker(issue: Record<string, unknown>, conversations: IssueCall[]): TrackerStep[] {
  let tracker = voiceTrackerFromCalls(issue, conversations)
  const { attended, rejectedWithoutAttend, noIssue } = workflowFlags(issue, conversations)
  const assignedName = String(issue.assigned_name || '').trim()
  const assignedTo = Number(issue.assigned_to || 0)
  const closed = String(issue.status || '') === 'closed' || Boolean(issue.closed_at)

  if (noIssue) {
    tracker = patchTracker(tracker, 'assign', {
      status: 'skipped',
      label: 'Assign technician',
      source: 'No issue confirmed',
      assignee: undefined,
    })
    tracker = patchTracker(tracker, 'summary', {
      status: 'skipped',
      source: NO_ISSUE_COMMENTS,
    })
  } else if (assignedTo || assignedName) {
    tracker = patchTracker(tracker, 'assign', {
      status: 'completed',
      label: 'Assign technician',
      assignee: assignedName || 'Technician',
      source: 'Round robin',
      at: issue.assigned_at ? String(issue.assigned_at) : undefined,
    })
  } else if (rejectedWithoutAttend) {
    tracker = patchTracker(tracker, 'assign', {
      status: 'skipped',
      label: 'Assign technician',
      source: 'Call rejected',
      assignee: undefined,
    })
  } else {
    tracker = patchTracker(tracker, 'assign', {
      status: attended ? 'in_progress' : 'not_started',
      label: 'Assign technician',
      source: 'UserTask',
    })
  }

  if (closed) {
    tracker = patchTracker(tracker, 'completed', {
      status: 'completed',
      source: noIssue ? NO_ISSUE_COMMENTS : String(issue.closed_by_name || 'Battery Degradation Issue'),
      at: issue.closed_at ? String(issue.closed_at) : undefined,
    })
  } else {
    tracker = patchTracker(tracker, 'completed', {
      status: 'not_started',
      source: 'Battery Degradation Issue',
    })
  }
  return tracker
}

async function hydrateAssignees(rows: Record<string, unknown>[]) {
  const ids = [...new Set(rows.flatMap((r) => [Number(r.assigned_to || 0), Number(r.closed_by || 0)].filter(Boolean)))]
  if (!ids.length) return
  const placeholders = ids.map(() => '?').join(',')
  const users = await all<{ id: number; first_name: string | null; last_name: string | null; username: string | null; email: string | null }>(
    `SELECT id, first_name, last_name, username, email FROM users WHERE id IN (${placeholders})`,
    ids,
  )
  const names = new Map<number, string>()
  for (const u of users) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || String(u.username || u.email || '').trim()
    names.set(Number(u.id), name)
  }
  for (const row of rows) {
    const assigned = Number(row.assigned_to || 0)
    const closer = Number(row.closed_by || 0)
    if (assigned) row.assigned_name = names.get(assigned) || row.assigned_name || ''
    if (closer) row.closed_by_name = names.get(closer) || row.closed_by_name || ''
  }
}

async function persistWorkflow(issueId: number) {
  const row = await loadIssue(issueId)
  if (!row) return null
  await hydrateAssignees([row])
  const conversations = await loadCalls(issueId)
  const tracker = applyWorkflowTracker(row, conversations)
  const latest = conversations[conversations.length - 1]
  await run(
    `UPDATE battery_degradation_issues SET tracker = ?, call_result = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(tracker), latest?.call_result || row.call_result || null, now(), issueId],
  )
  return loadIssuePayload(issueId)
}

async function maybeAssignTechnician(issueId: number, extraMeta?: Record<string, unknown> | null) {
  return applyAttendedCallOutcome(issueId, extraMeta)
}

batteryIssuesRouter.get('/', async (req, res) => {
  const search = String(req.query.search || '').trim()
  const status = String(req.query.status || '').trim()
  const limit = Number(req.query.limit || 50)
  const offset = Number(req.query.offset || 0)
  const callResult = String(req.query.call_result || '').trim()
  const report = String(req.query.report || '').trim()
  const otherType = String(req.query.other_type || '').trim()
  const where = ['deleted_at IS NULL']
  const params: unknown[] = []
  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  if (report === 'battery_yes') {
    where.push(`battery_issue_confirmed = 'yes' AND other_issue_reported = 'no'`)
  } else if (report === 'battery_no') {
    where.push(`battery_issue_confirmed = 'no' AND IFNULL(other_issue_reported, '') NOT IN ('yes', 'no')`)
  } else if (report === 'other_only') {
    where.push(`battery_issue_confirmed = 'no' AND other_issue_reported = 'yes'`)
  } else if (report === 'no_issues') {
    where.push(`battery_issue_confirmed = 'no' AND other_issue_reported = 'no'`)
  } else if (report === 'both') {
    where.push(`battery_issue_confirmed = 'yes' AND other_issue_reported = 'yes'`)
  } else if (report === 'answered_both') {
    where.push(`battery_issue_confirmed IN ('yes', 'no') AND other_issue_reported IN ('yes', 'no')`)
  } else if (report === 'incomplete' || report === 'not_answered') {
    where.push(`${LATEST_OUTCOME_SQL} = 'completed'`)
    where.push(`(IFNULL(battery_issue_confirmed, '') NOT IN ('yes', 'no') OR IFNULL(other_issue_reported, '') NOT IN ('yes', 'no'))`)
  }
  if (otherType) {
    where.push(`other_issue_reported = 'yes' AND CAST(other_issue_types AS CHAR) LIKE ?`)
    params.push(`%${otherType}%`)
  }
  if (callResult === 'yet_to_call') {
    where.push(`NOT EXISTS (SELECT 1 FROM battery_degradation_calls c WHERE c.issue_id = battery_degradation_issues.id)`)
  } else if (callResult === 'called') {
    where.push(`EXISTS (SELECT 1 FROM battery_degradation_calls c WHERE c.issue_id = battery_degradation_issues.id)`)
  } else if (callResult === 'completed' || callResult === 'attended') {
    where.push(`${LATEST_OUTCOME_SQL} = 'completed'`)
  } else if (callResult === 'calling' || callResult === 'queued' || callResult === 'in_progress') {
    where.push(`${LATEST_OUTCOME_SQL} = 'calling'`)
  } else if (callResult === 'rejected' || callResult === 'ignored') {
    where.push(`${LATEST_OUTCOME_SQL} = ?`)
    params.push(callResult)
  } else if (callResult) {
    where.push(`${LATEST_OUTCOME_SQL} = ?`)
    params.push(callResult)
  }
  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ? OR IFNULL(other_issue_description, \'\') LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like, like)
  }
  const sql = `SELECT * FROM battery_degradation_issues WHERE ${where.join(' AND ')} ORDER BY id DESC`
  let totalRow: { c: number } | undefined
  let rows: Record<string, unknown>[] = []
  try {
    totalRow = await get<{ c: number }>(
      `SELECT COUNT(*) as c FROM battery_degradation_issues WHERE ${where.join(' AND ')}`,
      params,
    )
    rows = await all<Record<string, unknown>>(`${sql} ${limitSql(limit, offset)}`, params)
  } catch (e) {
    if (!report && !otherType) throw e
    const fallbackWhere = where.filter((w) => !w.includes('battery_issue_confirmed') && !w.includes('other_issue_reported') && !w.includes('other_issue_types'))
    totalRow = await get<{ c: number }>(
      `SELECT COUNT(*) as c FROM battery_degradation_issues WHERE ${fallbackWhere.join(' AND ')}`,
      params,
    )
    rows = await all<Record<string, unknown>>(
      `SELECT * FROM battery_degradation_issues WHERE ${fallbackWhere.join(' AND ')} ORDER BY id DESC ${limitSql(limit, offset)}`,
      params,
    )
  }
  await hydrateAssignees(rows)
  const ids = rows.map((r) => Number(r.id))
  const counts = await callCounts(ids)
  const results = await latestCallResults(ids)
  return okList(res, rows.map((r) => {
    const id = Number(r.id)
    const payload = transform(r, [], counts.get(id) || 0)
    return { ...payload, call_result: results.get(id) || payload.call_result || 'yet_to_call' }
  }), Number(totalRow?.c || 0))
})

batteryIssuesRouter.get('/stats', async (_req, res) => {
  try {
    await backfillStaleCallResults(500)
  } catch (e) {
    console.warn('[battery-stats] call-result backfill', e instanceof Error ? e.message : e)
  }
  try {
    const { backfillMissingSurveys } = await import('../services/batteryTechnicianAssign.js')
    await backfillMissingSurveys(400)
  } catch (e) {
    console.warn('[battery-stats] survey backfill', e instanceof Error ? e.message : e)
  }
  const zeros = {
    total: 0, with_phone: 0, yet_to_call: 0, called: 0, attended: 0,
    rejected: 0, ignored: 0, calling: 0, battery_yes: 0, battery_no: 0,
    other_only: 0, no_issues: 0, both_issues: 0, answered_both: 0, incomplete: 0,
  }
  const latestJoin = `
    FROM battery_degradation_issues i
    LEFT JOIN (
      SELECT c.issue_id,
        CASE
          WHEN c.call_result IN ('completed', 'attended', 'ended', 'success') THEN 'completed'
          WHEN c.call_result = 'rejected' THEN 'rejected'
          WHEN c.call_result = 'ignored' THEN 'ignored'
          ELSE 'calling'
        END AS outcome
      FROM battery_degradation_calls c
      INNER JOIN (
        SELECT issue_id, MAX(id) AS max_id
        FROM battery_degradation_calls
        GROUP BY issue_id
      ) t ON t.max_id = c.id
    ) latest ON latest.issue_id = i.id
    WHERE i.deleted_at IS NULL`
  let row: Record<string, number> | undefined
  try {
  row = await get<Record<string, number>>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN i.phone IS NOT NULL AND TRIM(i.phone) != '' AND i.phone != '-' THEN 1 ELSE 0 END) AS with_phone,
      SUM(CASE WHEN latest.issue_id IS NULL THEN 1 ELSE 0 END) AS yet_to_call,
      SUM(CASE WHEN latest.issue_id IS NOT NULL THEN 1 ELSE 0 END) AS called,
      SUM(CASE WHEN latest.outcome = 'completed' THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN latest.outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN latest.outcome = 'ignored' THEN 1 ELSE 0 END) AS ignored,
      SUM(CASE WHEN latest.outcome = 'calling' THEN 1 ELSE 0 END) AS calling,
      SUM(CASE WHEN i.battery_issue_confirmed = 'yes' AND i.other_issue_reported = 'no' THEN 1 ELSE 0 END) AS battery_yes,
      SUM(CASE WHEN i.battery_issue_confirmed = 'no' AND IFNULL(i.other_issue_reported, '') NOT IN ('yes', 'no') THEN 1 ELSE 0 END) AS battery_no,
      SUM(CASE WHEN i.battery_issue_confirmed = 'no' AND i.other_issue_reported = 'yes' THEN 1 ELSE 0 END) AS other_only,
      SUM(CASE WHEN i.battery_issue_confirmed = 'no' AND i.other_issue_reported = 'no' THEN 1 ELSE 0 END) AS no_issues,
      SUM(CASE WHEN i.battery_issue_confirmed = 'yes' AND i.other_issue_reported = 'yes' THEN 1 ELSE 0 END) AS both_issues,
      SUM(CASE WHEN i.battery_issue_confirmed IN ('yes', 'no') AND i.other_issue_reported IN ('yes', 'no') THEN 1 ELSE 0 END) AS answered_both,
      SUM(CASE WHEN latest.outcome = 'completed' AND (
        IFNULL(i.battery_issue_confirmed, '') NOT IN ('yes', 'no')
        OR IFNULL(i.other_issue_reported, '') NOT IN ('yes', 'no')
      ) THEN 1 ELSE 0 END) AS incomplete
    ${latestJoin}
  `)
  } catch {
    row = await get<Record<string, number>>(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN i.phone IS NOT NULL AND TRIM(i.phone) != '' AND i.phone != '-' THEN 1 ELSE 0 END) AS with_phone,
        SUM(CASE WHEN latest.issue_id IS NULL THEN 1 ELSE 0 END) AS yet_to_call,
        SUM(CASE WHEN latest.issue_id IS NOT NULL THEN 1 ELSE 0 END) AS called,
        SUM(CASE WHEN latest.outcome = 'completed' THEN 1 ELSE 0 END) AS attended,
        SUM(CASE WHEN latest.outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN latest.outcome = 'ignored' THEN 1 ELSE 0 END) AS ignored,
        SUM(CASE WHEN latest.outcome = 'calling' THEN 1 ELSE 0 END) AS calling
      ${latestJoin}
    `)
  }
  return okItem(res, {
    total: Number(row?.total || 0),
    with_phone: Number(row?.with_phone || 0),
    yet_to_call: Number(row?.yet_to_call || 0),
    called: Number(row?.called || 0),
    attended: Number(row?.attended || 0),
    rejected: Number(row?.rejected || 0),
    ignored: Number(row?.ignored || 0),
    calling: Number(row?.calling || 0),
    battery_yes: Number(row?.battery_yes || 0),
    battery_no: Number(row?.battery_no || 0),
    other_only: Number(row?.other_only || 0),
    no_issues: Number(row?.no_issues || 0),
    both_issues: Number(row?.both_issues || zeros.both_issues),
    answered_both: Number(row?.answered_both || zeros.answered_both),
    incomplete: Number(row?.incomplete || zeros.incomplete),
    other_type_counts: await loadOtherTypeCounts(),
  })
})

async function loadOtherTypeCounts() {
  const counts = Object.fromEntries(OTHER_ISSUE_TYPES.map((item) => [item.key, 0])) as Record<string, number>
  try {
    const rows = await all<{ other_issue_types: unknown }>(
      `SELECT other_issue_types FROM battery_degradation_issues
       WHERE deleted_at IS NULL AND other_issue_reported = 'yes'`,
    )
    for (const row of rows) {
      const keys = parseJson<string[]>(row.other_issue_types, [])
      const unique = [...new Set(keys.map((key) => String(key || '').trim()).filter(Boolean))]
      if (!unique.length) counts.other += 1
      for (const key of unique) {
        if (counts[key] == null) counts.other += 1
        else counts[key] += 1
      }
    }
  } catch {
    return OTHER_ISSUE_TYPES.map((item) => ({ key: item.key, label: item.label, icon: item.icon, count: 0 }))
  }
  return OTHER_ISSUE_TYPES.map((item) => ({
    key: item.key,
    label: item.label,
    icon: item.icon,
    count: counts[item.key] || 0,
  }))
}

batteryIssuesRouter.get('/call-queue', async (_req, res) => {
  const { getCallQueueStatus } = await import('../services/batteryCallQueue.js')
  return okItem(res, getCallQueueStatus())
})

batteryIssuesRouter.post('/call-queue', async (req, res) => {
  try {
    const { startPendingCallQueue } = await import('../services/batteryCallQueue.js')
    const status = await startPendingCallQueue({
      userId: req.user?.id ?? null,
      limit: (req.body as { limit?: unknown } | undefined)?.limit,
    })
    return okMessage(res, status.message || 'Call queue started', status)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Failed to start call queue', 409)
  }
})

batteryIssuesRouter.post('/call-queue/pause', async (_req, res) => {
  try {
    const { pauseCallQueue } = await import('../services/batteryCallQueue.js')
    const status = pauseCallQueue()
    return okMessage(res, status.message || 'Call queue paused', status)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Could not pause the call queue', 409)
  }
})

batteryIssuesRouter.post('/call-queue/resume', async (_req, res) => {
  try {
    const { resumeCallQueue } = await import('../services/batteryCallQueue.js')
    const status = resumeCallQueue()
    return okMessage(res, status.message || 'Call queue continued', status)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Could not continue the call queue', 409)
  }
})

batteryIssuesRouter.post('/call-queue/stop', async (_req, res) => {
  try {
    const { stopCallQueue } = await import('../services/batteryCallQueue.js')
    const status = stopCallQueue()
    return okMessage(res, status.message || 'Call queue stopped', status)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Could not stop the call queue', 409)
  }
})

type SyncAllStatus = {
  running: boolean
  total: number
  done: number
  failed: number
  recordings: number
  message: string
}

const syncAllJob: SyncAllStatus = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  recordings: 0,
  message: '',
}

function getSyncAllStatus(): SyncAllStatus {
  return { ...syncAllJob }
}

async function persistCallRecordingFields(
  callId: number,
  fields: { recording_path: string; recording_mime: string; recording_original_name: string },
) {
  try {
    await run(
      `UPDATE battery_degradation_calls
       SET recording_path = ?, recording_mime = ?, recording_original_name = ?, updated_at = ?
       WHERE id = ?`,
      [fields.recording_path, fields.recording_mime, fields.recording_original_name, now(), callId],
    )
    return true
  } catch {
    return false
  }
}

async function syncIssueConversations(id: number) {
  const row = await loadIssue(id)
  if (!row) throw new Error('Issue not found')
  const calls = await all<Record<string, unknown>>(
    `SELECT * FROM battery_degradation_calls WHERE issue_id = ? ORDER BY sequence ASC, id ASC`,
    [id],
  )
  if (!calls.length) throw new Error('No Ello.AI conversation on this issue yet')
  let latestMeta: Record<string, unknown> | null = null
  let recordings = 0
  for (const call of calls) {
    const conversationId = String(call.ello_conversation_id || '').trim()
    if (!conversationId) continue
    let conv: ElloConversation | null = null
    try {
      conv = await elloGetConversation(conversationId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (!/not found/i.test(msg)) throw e
    }
    let transcript = parseJson<TranscriptLine[]>(call.transcript, [])
    try {
      const fetched = mapElloTranscript(await elloGetTranscripts(conversationId))
      if (fetched.length) transcript = fetched
    } catch {
      // transcripts often arrive after the call ends
    }
    if (conv?.metadata && typeof conv.metadata === 'object') latestMeta = conv.metadata
    const applied = conv ? applyConversationToCall(call, conv, transcript.length) : null
    const ts = applied?.ts || now()
    const nextStatus = String(applied?.ello_call_status ?? call.ello_call_status ?? '')
    const nextEndedAt = String(applied?.ended_at ?? call.ended_at ?? '') || null
    const nextSummary = String(applied?.bot_summary ?? call.bot_summary ?? '')
    const nextDuration = String(applied?.duration ?? call.duration ?? '')
    const nextRecordingUrl = String(applied?.recording_url ?? call.recording_url ?? '') || null
    const nextResult = applied?.call_result || String(call.call_result || '') || classifyCallResult({
      elloStatus: nextStatus,
      endedAt: nextEndedAt,
      connectedAt: String(applied?.connected_at ?? call.connected_at ?? '') || null,
      duration: nextDuration,
      disconnectReason: applied?.disconnect_reason || String(call.disconnect_reason || '') || null,
      transcriptCount: transcript.length,
    })
    await run(`
      UPDATE battery_degradation_calls
      SET bot_summary = ?, recording_url = ?, transcript = ?, ello_call_status = ?, call_result = ?,
          disconnect_reason = ?, duration = ?, connected_at = ?, ended_at = ?, updated_at = ?
      WHERE id = ?
    `, [
      applied?.bot_summary ?? call.bot_summary ?? null,
      nextRecordingUrl,
      JSON.stringify(transcript),
      applied?.ello_call_status ?? call.ello_call_status ?? null,
      nextResult,
      applied?.disconnect_reason ?? call.disconnect_reason ?? null,
      applied?.duration ?? call.duration ?? null,
      applied?.connected_at ?? call.connected_at ?? null,
      applied?.ended_at ?? call.ended_at ?? null,
      ts,
      Number(call.id),
    ])
    try {
      const stored = await ensureLocalCallRecording({
        issueId: id,
        callId: Number(call.id),
        conversationId,
        recordingUrl: nextRecordingUrl,
        existingPath: call.recording_path ? String(call.recording_path) : null,
      })
      if (stored && await persistCallRecordingFields(Number(call.id), {
        recording_path: stored.path,
        recording_mime: stored.mime,
        recording_original_name: stored.original_name,
      })) {
        recordings += 1
        const issuePath = String(row.recording_path || '')
        if (!issuePath || issuePath.includes('battery_recordings')) {
          try {
            await run(
              `UPDATE battery_degradation_issues
               SET recording_path = ?, recording_mime = ?, recording_original_name = ?, updated_at = ?
               WHERE id = ?`,
              [stored.path, stored.mime, stored.original_name, ts, id],
            )
            row.recording_path = stored.path
          } catch {
            // issue-level recording columns already exist from 044; ignore if a host is mid-migration
          }
        }
      }
    } catch (e) {
      console.warn('[battery-recording] download failed', id, e instanceof Error ? e.message : e)
    }
    const alreadyMailed = Boolean(call.email_sent_at)
    if (!alreadyMailed && nextResult === 'completed') {
      try {
        const mailed = await sendBatteryCallEndedEmail({
          issueId: id,
          sequence: Number(call.sequence || 1),
          name: String(row.name || ''),
          phone: String(row.phone || ''),
          email: String(row.email || ''),
          company: String(row.company || ''),
          botSummary: nextSummary,
          transcript,
          callStatus: nextStatus || 'ended',
          duration: nextDuration,
          at: nextEndedAt || String(applied?.connected_at || call.connected_at || ts),
        })
        if (mailed.sent) {
          await run(`UPDATE battery_degradation_calls SET email_sent_at = ? WHERE id = ?`, [ts, Number(call.id)])
        }
      } catch (e) {
        console.warn('[battery-call-email] send failed', e instanceof Error ? e.message : e)
      }
    }
  }
  const conversations = await loadCalls(id)
  const latest = conversations[conversations.length - 1]
  await maybeAssignTechnician(id, latestMeta)
  const assignedRow = await loadIssue(id)
  if (assignedRow) await hydrateAssignees([assignedRow])
  const tracker = applyWorkflowTracker(assignedRow || row, conversations)
  const ts = now()
  await run(`
    UPDATE battery_degradation_issues
    SET bot_summary = ?, recording_url = ?, transcript = ?, tracker = ?,
        ello_call_status = ?, ello_conversation_id = ?, ello_siptrunk_id = ?, call_result = ?, updated_at = ?
    WHERE id = ?
  `, [
    latest?.bot_summary || row.bot_summary || null,
    latest?.recording_url || row.recording_url || null,
    JSON.stringify(latest?.transcript || parseJson(row.transcript, [])),
    JSON.stringify(tracker),
    latest?.call_status || row.ello_call_status || null,
    latest?.conversation_id || row.ello_conversation_id || null,
    latest?.siptrunk_id || row.ello_siptrunk_id || null,
    latest?.call_result || row.call_result || null,
    ts,
    id,
  ])
  return { payload: await loadIssuePayload(id), recordings }
}

async function runSyncAllConversations(issueIds: number[]) {
  syncAllJob.running = true
  syncAllJob.total = issueIds.length
  syncAllJob.done = 0
  syncAllJob.failed = 0
  syncAllJob.recordings = 0
  syncAllJob.message = issueIds.length
    ? `Refreshing ${issueIds.length} conversation${issueIds.length === 1 ? '' : 's'}…`
    : 'No conversations to refresh'
  try {
    for (const issueId of issueIds) {
      try {
        const result = await syncIssueConversations(issueId)
        syncAllJob.recordings += result.recordings
      } catch (e) {
        syncAllJob.failed += 1
        console.warn('[battery-sync-all]', issueId, e instanceof Error ? e.message : e)
      }
      syncAllJob.done += 1
      syncAllJob.message = `Refreshing conversations (${syncAllJob.done} / ${syncAllJob.total})`
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    syncAllJob.message = syncAllJob.failed
      ? `Refreshed ${syncAllJob.done - syncAllJob.failed} of ${syncAllJob.total} conversations`
      : `Refreshed ${syncAllJob.done} conversation${syncAllJob.done === 1 ? '' : 's'}`
  } finally {
    syncAllJob.running = false
  }
}

batteryIssuesRouter.get('/sync-all', async (_req, res) => {
  return okItem(res, getSyncAllStatus())
})

batteryIssuesRouter.post('/sync-all', async (_req, res) => {
  if (syncAllJob.running) {
    return okMessage(res, syncAllJob.message || 'Refresh already running', getSyncAllStatus())
  }
  const rows = await all<{ id: number }>(`
    SELECT DISTINCT i.id
    FROM battery_degradation_issues i
    INNER JOIN battery_degradation_calls c ON c.issue_id = i.id
    WHERE i.deleted_at IS NULL
      AND c.ello_conversation_id IS NOT NULL
      AND TRIM(c.ello_conversation_id) != ''
    ORDER BY i.id DESC
  `)
  const ids = rows.map((r) => Number(r.id)).filter(Boolean)
  if (!ids.length) {
    syncAllJob.total = 0
    syncAllJob.done = 0
    syncAllJob.failed = 0
    syncAllJob.recordings = 0
    syncAllJob.message = 'No conversations to refresh'
    return okMessage(res, 'No conversations to refresh', getSyncAllStatus())
  }
  syncAllJob.running = true
  syncAllJob.total = ids.length
  syncAllJob.done = 0
  syncAllJob.failed = 0
  syncAllJob.recordings = 0
  syncAllJob.message = `Refreshing ${ids.length} conversation${ids.length === 1 ? '' : 's'}…`
  void runSyncAllConversations(ids)
  return okMessage(res, `Refreshing ${ids.length} conversations`, getSyncAllStatus())
})

batteryIssuesRouter.get('/:id/recording', async (req, res) => {
  const row = await get<{ recording_path: string | null; recording_mime: string | null; recording_original_name: string | null }>(
    `SELECT recording_path, recording_mime, recording_original_name FROM battery_degradation_issues WHERE id = ? AND deleted_at IS NULL`,
    [Number(req.params.id)],
  )
  if (!row?.recording_path) return fail(res, 'No recording on this issue', 404)
  const abs = absolutePath(row.recording_path)
  if (!fs.existsSync(abs)) return fail(res, 'Recording file missing on disk', 404)
  res.setHeader('Content-Type', row.recording_mime || 'audio/mpeg')
  res.setHeader('Content-Disposition', `inline; filename="${row.recording_original_name || 'recording'}"`)
  return res.sendFile(abs)
})

batteryIssuesRouter.get('/:id/calls/:callId/english', async (req, res) => {
  const issueId = Number(req.params.id)
  const callId = Number(req.params.callId)
  const issue = await loadIssue(issueId)
  if (!issue) return fail(res, 'Issue not found', 404)
  const call = await get<Record<string, unknown>>(
    `SELECT * FROM battery_degradation_calls WHERE id = ? AND issue_id = ?`,
    [callId, issueId],
  )
  if (!call) return fail(res, 'Conversation not found', 404)
  const original = parseJson<TranscriptLine[]>(call.transcript, [])
  const cached = parseJson<TranscriptLine[]>(call.transcript_en, [])
  const cacheOk = cached.length === original.length
    && cached.length > 0
    && cached.every((line) => !/[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(String(line.text || '')))
  if (cacheOk) return okItem(res, { transcript_en: cached })
  try {
    const english = await translateTranscriptToEnglish(original)
    try {
      await run(
        `UPDATE battery_degradation_calls SET transcript_en = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(english), now(), callId],
      )
    } catch {
      // column arrives with migration 055
    }
    return okItem(res, { transcript_en: english })
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Could not translate this conversation', 502)
  }
})

batteryIssuesRouter.get('/:id/calls/:callId/recording', async (req, res) => {
  const issueId = Number(req.params.id)
  const callId = Number(req.params.callId)
  const issue = await loadIssue(issueId)
  if (!issue) return fail(res, 'Issue not found', 404)
  let call: { recording_path?: string | null; recording_mime?: string | null; recording_original_name?: string | null } | undefined
  try {
    call = await get<{ recording_path?: string | null; recording_mime?: string | null; recording_original_name?: string | null }>(
      `SELECT recording_path, recording_mime, recording_original_name
       FROM battery_degradation_calls WHERE id = ? AND issue_id = ?`,
      [callId, issueId],
    )
  } catch {
    call = undefined
  }
  const diskPath = String(call?.recording_path || issue.recording_path || '')
  if (!diskPath) return fail(res, 'No local recording on this conversation', 404)
  const abs = absolutePath(diskPath)
  if (!fs.existsSync(abs)) return fail(res, 'Recording file missing on disk', 404)
  res.setHeader('Content-Type', String(call?.recording_mime || issue.recording_mime || 'audio/mpeg'))
  res.setHeader('Content-Disposition', `inline; filename="${String(call?.recording_original_name || issue.recording_original_name || 'recording')}"`)
  return res.sendFile(abs)
})

batteryIssuesRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  try {
    await maybeAssignTechnician(id)
    await persistWorkflow(id)
  } catch (e) {
    console.warn('[battery-issue] apply on get', id, e instanceof Error ? e.message : e)
  }
  const payload = await loadIssuePayload(id)
  if (!payload) return fail(res, 'Issue not found', 404)
  return okItem(res, payload)
})

export async function startOutboundCall(issueId: number, opts?: { userId?: number | null }) {
  const row = await loadIssue(issueId)
  if (!row) throw new Error('Issue not found')
  const phone = String(row.phone || '').trim()
  if (!phone) throw new Error('Phone number is required to start the voice call')
  const created = await elloCreateCall({
    name: String(row.name || ''),
    phone,
    email: String(row.email || ''),
    company: String(row.company || ''),
  })
  const ts = now()
  const seqRow = await get<{ n: number }>(
    `SELECT COALESCE(MAX(sequence), 0) AS n FROM battery_degradation_calls WHERE issue_id = ?`,
    [issueId],
  )
  const sequence = Number(seqRow?.n || 0) + 1
  await run(`
    INSERT INTO battery_degradation_calls
      (issue_id, sequence, ello_agent_id, ello_conversation_id, ello_siptrunk_id, ello_call_status, call_result,
       transcript, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
  `, [
    issueId,
    sequence,
    created.agent_id,
    created.conversation_id,
    created.siptrunk_id || null,
    created.call_status,
    JSON.stringify([]),
    ts,
    ts,
  ])
  const conversations = await loadCalls(issueId)
  await hydrateAssignees([row])
  const tracker = applyWorkflowTracker(row, conversations)
  await run(`
    UPDATE battery_degradation_issues
    SET ello_agent_id = ?, ello_conversation_id = ?, ello_siptrunk_id = ?, ello_call_status = ?,
        call_result = 'queued', tracker = ?, updated_at = ?
    WHERE id = ?
  `, [
    created.agent_id,
    created.conversation_id,
    created.siptrunk_id || null,
    created.call_status,
    JSON.stringify(tracker),
    ts,
    issueId,
  ])
  await logAction({
    userId: opts?.userId ?? null,
    actionType: 'update',
    itemType: 'battery_issue',
    itemId: issueId,
    note: `Started Ello.AI Conversation ${sequence} (${created.conversation_id})`,
  })
  return { sequence, payload: await loadIssuePayload(issueId) }
}

batteryIssuesRouter.post('/:id/call', async (req, res) => {
  const id = Number(req.params.id)
  const row = await loadIssue(id)
  if (!row) return fail(res, 'Issue not found', 404)
  const phone = String(row.phone || '').trim()
  if (!phone) return fail(res, 'Phone number is required to start the voice call')
  try {
    const { clearElloOutboundBlock } = await import('../services/ello.js')
    clearElloOutboundBlock()
    const { sequence, payload } = await startOutboundCall(id, { userId: req.user?.id ?? null })
    return okMessage(res, `Conversation ${sequence} queued`, payload)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Failed to start call', 502)
  }
})

batteryIssuesRouter.post('/:id/sync-call', async (req, res) => {
  const id = Number(req.params.id)
  try {
    const { payload } = await syncIssueConversations(id)
    return okMessage(res, 'Conversations refreshed', payload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to refresh conversation'
    const status = msg === 'Issue not found' ? 404 : 502
    return fail(res, msg, status)
  }
})

batteryIssuesRouter.post('/', async (req, res) => {
  const b = req.body || {}
  const name = String(b.name || '').trim()
  if (!name) return fail(res, 'Name is required')
  const ts = now()
  const transcript = Array.isArray(b.transcript) ? b.transcript : []
  const tracker = Array.isArray(b.tracker) ? b.tracker : defaultTracker(ts)
  const result = await run(`
    INSERT INTO battery_degradation_issues
      (name, phone, email, company, message, bot_summary, recording_url, transcript, tracker, status, call_result, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'yet_to_call', ?, ?, ?)
  `, [
    name,
    String(b.phone || '').trim() || null,
    String(b.email || '').trim() || null,
    String(b.company || '').trim() || null,
    String(b.message || '').trim() || null,
    String(b.bot_summary || '').trim() || null,
    String(b.recording_url || '').trim() || null,
    JSON.stringify(transcript),
    JSON.stringify(tracker),
    String(b.status || 'in_progress'),
    req.user?.id ?? null,
    ts,
    ts,
  ])
  await logAction({
    userId: req.user?.id,
    actionType: 'create',
    itemType: 'battery_issue',
    itemId: result.insertId,
    note: `Created battery degradation issue for ${name}`,
  })
  const payload = await loadIssuePayload(result.insertId)
  void (async () => {
    try {
      const { isEmailCategoryEnabled } = await import('../services/notificationConfig.js')
      if (!(await isEmailCategoryEnabled('battery_calls'))) return
      const { batteryNotifyEmails } = await import('../services/batteryConfig.js')
      const { mailConfigured, sendMail } = await import('../services/mail.js')
      const to = (await batteryNotifyEmails()).join(', ')
      if (!to || !mailConfigured()) return
      const { appSignedInUrl } = await import('../services/appLinks.js')
      const view = appSignedInUrl(`/battery-issues/${result.insertId}`)
      await sendMail({
        to,
        subject: `Battery degradation issue submitted — ${name}`,
        text: `A Battery Degradation issue was submitted.\n\nName: ${name}\nPhone: ${String(b.phone || '')}\nEmail: ${String(b.email || '')}\nCompany: ${String(b.company || '')}\n\nView: ${view}`,
        emailType: 'battery_issue',
        relatedType: 'battery_issue',
        relatedId: result.insertId,
      })
    } catch (e) {
      console.warn('[battery-submit-email]', e instanceof Error ? e.message : e)
    }
  })()
  return okMessage(res, 'Issue created', payload, 201)
})

batteryIssuesRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await loadIssue(id)
  if (!existing) return fail(res, 'Issue not found', 404)
  const b = req.body || {}
  const name = String(b.name || '').trim()
  if (!name) return fail(res, 'Name is required')
  const transcript = Array.isArray(b.transcript) ? b.transcript : parseJson(existing.transcript, [])
  const existingStatus = String(existing.status || 'in_progress')
  const requested = String(b.status || existingStatus)
  const status = existingStatus === 'closed' || requested === 'closed' ? existingStatus : requested
  const fields = [
    'name = ?', 'phone = ?', 'email = ?', 'company = ?', 'message = ?', 'bot_summary = ?',
    'transcript = ?', 'status = ?', 'updated_at = ?',
  ]
  const vals: unknown[] = [
    name,
    String(b.phone || '').trim() || null,
    String(b.email || '').trim() || null,
    String(b.company || '').trim() || null,
    String(b.message || '').trim() || null,
    String(b.bot_summary || '').trim() || null,
    JSON.stringify(transcript),
    status,
    now(),
  ]
  if (b.recording_url !== undefined) {
    fields.splice(6, 0, 'recording_url = ?')
    vals.splice(6, 0, String(b.recording_url || '').trim() || null)
  }
  vals.push(id)
  await run(`UPDATE battery_degradation_issues SET ${fields.join(', ')} WHERE id = ?`, vals)
  await persistWorkflow(id)
  await logAction({
    userId: req.user?.id,
    actionType: 'update',
    itemType: 'battery_issue',
    itemId: id,
    note: `Updated battery degradation issue for ${name}`,
  })
  return okMessage(res, 'Issue updated', await loadIssuePayload(id))
})

batteryIssuesRouter.post('/:id/close', (req, res) => {
  const upload = makeMultiUploader('private_uploads/battery_close_proofs', 'files', 8)
  upload(req, res, async (err) => {
    if (err) return fail(res, err.message)
    try {
      const id = Number(req.params.id)
      const comments = String(req.body?.comments ?? req.body?.close_comments ?? '').trim()
      if (!comments) return fail(res, 'Comments are required to close this issue')
      const files = Array.isArray(req.files) ? req.files : []
      if (!files.length) return fail(res, 'At least one proof attachment is required to close this issue')
      const row = await loadIssue(id)
      if (!row) return fail(res, 'Issue not found', 404)
      if (String(row.status || '') === 'closed') return fail(res, 'Issue is already closed', 409)
      const assignedTo = Number(row.assigned_to || 0)
      if (!assignedTo) return fail(res, 'This issue is not assigned to a technician', 422)
      const uid = req.user?.id ?? 0
      const privileged = isTruthyPerm(req.user?.permissions?.superuser) || isTruthyPerm(req.user?.permissions?.admin)
      if (!privileged && uid !== assignedTo) {
        return fail(res, 'Only the assigned technician can close this issue', 403)
      }
      const attachments = files.map((file) => ({
        path: path.relative(storageRoot, file.path).replace(/\\/g, '/'),
        mime: file.mimetype,
        original_name: file.originalname,
        size: file.size,
      }))
      const ts = now()
      await run(
        `UPDATE battery_degradation_issues
         SET close_comments = ?, close_attachments = ?, closed_at = ?, closed_by = ?, status = 'closed', updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [comments, JSON.stringify(attachments), ts, uid || null, ts, id],
      )
      const closerName = await userDisplayName(uid)
      await persistWorkflow(id)
      await logAction({
        userId: uid || null,
        actionType: 'update',
        itemType: 'battery_issue',
        itemId: id,
        note: `Closed battery degradation issue${closerName ? ` by ${closerName}` : ''} with ${attachments.length} proof file(s)`,
      })
      return okMessage(res, 'Issue closed', await loadIssuePayload(id))
    } catch (error) {
      return fail(res, error instanceof Error ? error.message : 'Could not close this issue', 500)
    }
  })
})

batteryIssuesRouter.get('/:id/close-proof/:index', async (req, res) => {
  const id = Number(req.params.id)
  const index = Number(req.params.index)
  const row = await loadIssue(id)
  if (!row) return fail(res, 'Issue not found', 404)
  const files = parseJson<Array<{ path?: string; mime?: string; original_name?: string }>>(row.close_attachments, [])
  const file = files[index]
  if (!file?.path) return fail(res, 'Attachment not found', 404)
  const abs = absolutePath(file.path)
  if (!abs || !fs.existsSync(abs)) return fail(res, 'Attachment file missing', 404)
  res.setHeader('Content-Type', file.mime || 'application/octet-stream')
  const safeName = String(file.original_name || 'proof').replace(/[\r\n"]/g, '_')
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)
  fs.createReadStream(abs).pipe(res)
})

batteryIssuesRouter.post('/:id/recording', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get(`SELECT id FROM battery_degradation_issues WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!existing) return fail(res, 'Issue not found', 404)
  const upload = makeUploader('private_uploads/battery_issues', 'file')
  upload(req, res, async (err) => {
    if (err) return fail(res, err.message)
    if (!req.file) return fail(res, 'file required')
    const rel = path.relative(storageRoot, req.file.path).replace(/\\/g, '/')
    await run(`
      UPDATE battery_degradation_issues
      SET recording_path = ?, recording_mime = ?, recording_original_name = ?, updated_at = ?
      WHERE id = ?
    `, [rel, req.file.mimetype, req.file.originalname, now(), id])
    return okMessage(res, 'Recording uploaded', await loadIssuePayload(id), 201)
  })
})

batteryIssuesRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get(`SELECT id FROM battery_degradation_issues WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!existing) return fail(res, 'Issue not found', 404)
  await run(`UPDATE battery_degradation_issues SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
  await logAction({
    userId: req.user?.id,
    actionType: 'delete',
    itemType: 'battery_issue',
    itemId: id,
    note: 'Soft-deleted battery degradation issue',
  })
  return okMessage(res, 'Issue deleted')
})
