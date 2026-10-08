import { all, get, run, now, limitSql } from '../db/index.js'

export type EmailLogStatus = 'queued' | 'sent' | 'failed' | 'skipped'

export type EmailLogRow = {
  id: number
  email_type: string
  status: EmailLogStatus
  related_type: string
  related_id: number | null
  to_addresses: string
  subject: string
  message_id: string
  error_message: string
  meta: Record<string, unknown> | null
  created_at: string
  sent_at: string
}

let tableReady = false

export async function ensureEmailLogsTable() {
  if (tableReady) return
  await run(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email_type VARCHAR(64) NOT NULL DEFAULT 'generic',
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      related_type VARCHAR(64) NULL,
      related_id INT UNSIGNED NULL,
      to_addresses TEXT NOT NULL,
      subject VARCHAR(500) NOT NULL,
      message_id VARCHAR(255) NULL,
      error_message TEXT NULL,
      meta_json JSON NULL,
      created_at DATETIME NOT NULL,
      sent_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_email_logs_created (created_at),
      KEY idx_email_logs_status (status),
      KEY idx_email_logs_type (email_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  tableReady = true
}

function joinEmails(list: string | string[] | null | undefined) {
  if (!list) return ''
  if (typeof list === 'string') return list
  return [...new Set(list.map((e) => String(e || '').trim()).filter(Boolean))].join(', ')
}

export async function insertEmailLog(input: {
  emailType?: string
  status?: EmailLogStatus
  relatedType?: string | null
  relatedId?: number | null
  toAddresses?: string | string[]
  subject?: string
  messageId?: string | null
  errorMessage?: string | null
  meta?: Record<string, unknown> | null
}) {
  try {
    await ensureEmailLogsTable()
    const status = input.status || 'queued'
    const ts = now()
    const result = await run(
      `INSERT INTO email_logs
       (email_type, status, related_type, related_id, to_addresses, subject, message_id, error_message, meta_json, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(input.emailType || 'generic').slice(0, 64),
        status,
        input.relatedType || null,
        input.relatedId || null,
        joinEmails(input.toAddresses) || '(none)',
        String(input.subject || '').slice(0, 500),
        input.messageId || null,
        input.errorMessage || null,
        input.meta ? JSON.stringify(input.meta) : null,
        ts,
        status === 'sent' ? ts : null,
      ],
    )
    return Number(result.insertId || 0) || null
  } catch (e) {
    console.warn('[email-log] insert failed', e instanceof Error ? e.message : e)
    return null
  }
}

function mapRow(row: Record<string, unknown>): EmailLogRow {
  let meta: Record<string, unknown> | null = null
  if (row.meta_json) {
    try {
      meta = typeof row.meta_json === 'string'
        ? JSON.parse(String(row.meta_json))
        : row.meta_json as Record<string, unknown>
    } catch {
      meta = null
    }
  }
  return {
    id: Number(row.id),
    email_type: String(row.email_type || ''),
    status: String(row.status || 'queued') as EmailLogStatus,
    related_type: String(row.related_type || ''),
    related_id: row.related_id != null ? Number(row.related_id) : null,
    to_addresses: String(row.to_addresses || ''),
    subject: String(row.subject || ''),
    message_id: String(row.message_id || ''),
    error_message: String(row.error_message || ''),
    meta,
    created_at: String(row.created_at || ''),
    sent_at: String(row.sent_at || ''),
  }
}

export const EMAIL_TYPE_LABELS: Record<string, string> = {
  custody: 'Assign / unassign',
  maintenance: 'Maintenance',
  inventory: 'Inventory added',
  crud: 'Asset created / deleted',
  eol_warranty: 'EOL / warranty reminder',
  license_renewal: 'License renewal',
  battery_calls: 'Battery call completed',
  battery_issue: 'Battery issue submitted',
  password_reset: 'Password reset',
  smtp_test: 'SMTP test',
  generic: 'Other',
}

export async function listEmailLogs(opts: {
  status?: string
  emailType?: string
  search?: string
  limit?: number
  offset?: number
}) {
  await ensureEmailLogsTable()
  const where = ['1=1']
  const params: unknown[] = []
  if (opts.status) {
    where.push('status = ?')
    params.push(opts.status)
  }
  if (opts.emailType) {
    where.push('email_type = ?')
    params.push(opts.emailType)
  }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`
    where.push('(subject LIKE ? OR to_addresses LIKE ? OR IFNULL(error_message, \'\') LIKE ? OR email_type LIKE ?)')
    params.push(q, q, q, q)
  }
  const whereSql = where.join(' AND ')
  const totalRow = await get<{ c: number }>(`SELECT COUNT(*) AS c FROM email_logs WHERE ${whereSql}`, params)
  const counts = await get<Record<string, number>>(`
    SELECT
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued
    FROM email_logs
  `)
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40))
  const offset = Math.max(0, Number(opts.offset) || 0)
  const rows = await all<Record<string, unknown>>(
    `SELECT * FROM email_logs WHERE ${whereSql} ORDER BY id DESC ${limitSql(limit, offset)}`,
    params,
  )
  return {
    total: Number(totalRow?.c || 0),
    rows: rows.map(mapRow),
    counts: {
      sent: Number(counts?.sent || 0),
      failed: Number(counts?.failed || 0),
      skipped: Number(counts?.skipped || 0),
      queued: Number(counts?.queued || 0),
    },
    types: EMAIL_TYPE_LABELS,
  }
}
