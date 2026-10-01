import { all, get, run, now } from '../db/index.js'

export const BATTERY_RR_EXCLUDE_EMAIL = 'srivaths.varadharajan@refex.co.in'

export type BatteryTechnician = {
  id: number
  name: string
  email: string
}

function displayName(row: { first_name?: string | null; last_name?: string | null; username?: string | null; email?: string | null }) {
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  return name || String(row.username || '').trim() || String(row.email || '').trim() || 'Technician'
}

export async function listBatteryTechnicians(): Promise<BatteryTechnician[]> {
  const rows = await all<{
    id: number
    first_name: string | null
    last_name: string | null
    username: string | null
    email: string | null
  }>(`
    SELECT DISTINCT u.id, u.first_name, u.last_name, u.username, u.email
    FROM users u
    INNER JOIN users_groups ug ON ug.user_id = u.id
    INNER JOIN permission_groups g ON g.id = ug.group_id AND g.name = 'IT Asset Manager'
    WHERE u.deleted_at IS NULL AND u.activated = 1
      AND LOWER(TRIM(IFNULL(u.email, ''))) != ?
    ORDER BY u.id ASC
  `, [BATTERY_RR_EXCLUDE_EMAIL])
  return rows.map((r) => ({
    id: Number(r.id),
    name: displayName(r),
    email: String(r.email || ''),
  }))
}

export async function userDisplayName(userId: number | null | undefined): Promise<string> {
  const id = Number(userId || 0)
  if (!id) return ''
  const row = await get<{ first_name: string | null; last_name: string | null; username: string | null; email: string | null }>(
    `SELECT first_name, last_name, username, email FROM users WHERE id = ?`,
    [id],
  )
  return row ? displayName(row) : ''
}

async function withRrLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = await get<{ got: number }>(`SELECT GET_LOCK('battery_technician_rr', 10) AS got`)
  if (!Number(lock?.got)) throw new Error('Could not lock technician assignment')
  try {
    return await fn()
  } finally {
    await get(`SELECT RELEASE_LOCK('battery_technician_rr') AS r`)
  }
}

async function nextTechnician(): Promise<BatteryTechnician | null> {
  const techs = await listBatteryTechnicians()
  if (!techs.length) return null
  const cursor = await get<{ last_user_id: number | null }>(`SELECT last_user_id FROM battery_technician_rr WHERE id = 1`)
  const lastId = Number(cursor?.last_user_id || 0)
  const idx = techs.findIndex((t) => t.id === lastId)
  const next = techs[(idx + 1) % techs.length]
  const ts = now()
  await run(
    `INSERT INTO battery_technician_rr (id, last_user_id, updated_at) VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE last_user_id = VALUES(last_user_id), updated_at = VALUES(updated_at)`,
    [next.id, ts],
  )
  return next
}

function parseTracker(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw.map((s) => ({ ...(s as Record<string, unknown>) }))
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map((s) => ({ ...s })) : []
    } catch {
      return []
    }
  }
  return []
}

function persistAssignOnTracker(trackerRaw: unknown, tech: BatteryTechnician, at: string) {
  const tracker = parseTracker(trackerRaw)
  const idx = tracker.findIndex((s) => String(s.key) === 'assign')
  const step = {
    key: 'assign',
    label: 'Assign technician',
    status: 'completed',
    source: 'Round robin',
    assignee: tech.name,
    at,
  }
  if (idx >= 0) tracker[idx] = { ...tracker[idx], ...step }
  else tracker.push(step)
  return tracker
}

export async function issueHasAttendedCall(issueId: number): Promise<boolean> {
  const row = await get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM battery_degradation_calls WHERE issue_id = ? AND call_result = 'completed'`,
    [issueId],
  )
  return Number(row?.c || 0) > 0
}

/** Assign the next IT Asset Manager when the contact attended a call. Rejected-only issues stay unassigned. */
export async function assignNextTechnician(issueId: number): Promise<BatteryTechnician | null> {
  return withRrLock(async () => {
    const issue = await get<Record<string, unknown>>(
      `SELECT id, assigned_to, tracker, status FROM battery_degradation_issues WHERE id = ? AND deleted_at IS NULL`,
      [issueId],
    )
    if (!issue) return null
    const existingId = Number(issue.assigned_to || 0)
    if (existingId) {
      const name = await userDisplayName(existingId)
      return { id: existingId, name, email: '' }
    }
    if (String(issue.status || '') === 'closed') return null
    if (!(await issueHasAttendedCall(issueId))) return null
    const tech = await nextTechnician()
    if (!tech) {
      console.warn('[battery-assign] no IT Asset Manager technicians available (after exclusions)')
      return null
    }
    const ts = now()
    const tracker = persistAssignOnTracker(issue.tracker, tech, ts)
    const claimed = await run(
      `UPDATE battery_degradation_issues
       SET assigned_to = ?, assigned_at = ?, tracker = ?, status = IF(status = 'open', 'in_progress', status), updated_at = ?
       WHERE id = ? AND assigned_to IS NULL AND deleted_at IS NULL`,
      [tech.id, ts, JSON.stringify(tracker), ts, issueId],
    )
    if (!claimed.affectedRows) return null
    console.log(`[battery-assign] issue ${issueId} → ${tech.name} (#${tech.id})`)
    return tech
  })
}

export async function assignEligibleIssues(): Promise<{ assigned: number; skipped: number }> {
  const rows = await all<{ id: number }>(`
    SELECT i.id
    FROM battery_degradation_issues i
    WHERE i.deleted_at IS NULL
      AND i.assigned_to IS NULL
      AND IFNULL(i.status, '') != 'closed'
      AND EXISTS (
        SELECT 1 FROM battery_degradation_calls c
        WHERE c.issue_id = i.id AND c.call_result = 'completed'
      )
    ORDER BY i.id ASC
  `)
  let assigned = 0
  let skipped = 0
  for (const row of rows) {
    try {
      const tech = await assignNextTechnician(Number(row.id))
      if (tech) assigned += 1
      else skipped += 1
    } catch (e) {
      skipped += 1
      console.warn('[battery-assign] backfill failed', row.id, e instanceof Error ? e.message : e)
    }
  }
  return { assigned, skipped }
}
