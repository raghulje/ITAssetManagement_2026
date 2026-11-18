import { all, get, run, now } from '../db/index.js'
import { isTruthyPerm } from './permissions.js'

let ready: Promise<void> | null = null

export function ensureAssetDrafts(): Promise<void> {
  if (!ready) {
    ready = run(`
      CREATE TABLE IF NOT EXISTS asset_drafts (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        created_by INT UNSIGNED NULL,
        domain_code VARCHAR(32) NOT NULL DEFAULT 'it',
        payload JSON NOT NULL,
        created_at DATETIME NULL,
        updated_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_asset_drafts_owner (created_by, domain_code),
        KEY idx_asset_drafts_updated (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).catch((err) => {
      ready = null
      throw err
    })
  }
  return ready
}

export function draftViewerSeesAll(perms: Record<string, unknown> | null | undefined) {
  const p = perms || {}
  return isTruthyPerm(p.superuser) || isTruthyPerm(p.admin)
}

function domainCode(value: unknown) {
  const code = String(value || 'it').trim().toLowerCase()
  return code === 'admin' ? 'admin' : 'it'
}

function asPayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch { /* ignore */ }
  }
  return {}
}

function summary(id: number, payload: Record<string, unknown>, row: {
  created_by: number | null
  created_by_name: string | null
  updated_at: string | null
  created_at: string | null
}) {
  const serial = String(payload.serial || '').trim()
  const orderNumber = String(payload.order_number || '').trim()
  return {
    id,
    label: serial || orderNumber || 'Untitled draft',
    serial,
    order_number: orderNumber,
    created_by: row.created_by,
    created_by_name: String(row.created_by_name || '').trim(),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

type DraftRow = {
  id: number
  created_by: number | null
  domain_code: string
  payload: unknown
  created_at: string | null
  updated_at: string | null
  created_by_name: string | null
}

export async function listAssetDrafts(opts: {
  userId: number
  seeAll: boolean
  domain: unknown
}) {
  await ensureAssetDrafts()
  const domain = domainCode(opts.domain)
  const params: unknown[] = [domain]
  let owner = ''
  if (!opts.seeAll) {
    owner = ' AND d.created_by = ?'
    params.push(opts.userId)
  }
  const rows = await all<DraftRow>(`
    SELECT d.id, d.created_by, d.domain_code, d.payload, d.created_at, d.updated_at,
      TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS created_by_name
    FROM asset_drafts d
    LEFT JOIN users u ON u.id = d.created_by
    WHERE d.domain_code = ?${owner}
    ORDER BY d.updated_at DESC, d.id DESC
    LIMIT 200
  `, params)
  return rows.map((row) => summary(Number(row.id), asPayload(row.payload), row))
}

async function loadDraft(id: number) {
  return get<DraftRow>(`
    SELECT d.id, d.created_by, d.domain_code, d.payload, d.created_at, d.updated_at,
      TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS created_by_name
    FROM asset_drafts d
    LEFT JOIN users u ON u.id = d.created_by
    WHERE d.id = ?
  `, [id])
}

function canTouch(row: { created_by: number | null }, userId: number, seeAll: boolean) {
  return seeAll || Number(row.created_by) === userId
}

export async function getAssetDraft(id: number, userId: number, seeAll: boolean) {
  await ensureAssetDrafts()
  const row = await loadDraft(id)
  if (!row || !canTouch(row, userId, seeAll)) return null
  return {
    id: Number(row.id),
    domain: row.domain_code,
    payload: asPayload(row.payload),
    created_by: row.created_by,
    created_by_name: String(row.created_by_name || '').trim(),
    updated_at: row.updated_at,
  }
}

export async function saveAssetDraft(opts: {
  id?: number | null
  userId: number
  seeAll: boolean
  domain: unknown
  payload: unknown
}) {
  await ensureAssetDrafts()
  const payload = asPayload(opts.payload)
  const domain = domainCode(opts.domain || payload.domain)
  const ts = now()
  const body = JSON.stringify(payload)
  const existingId = Number(opts.id || 0)
  if (existingId) {
    const row = await loadDraft(existingId)
    if (!row || !canTouch(row, opts.userId, opts.seeAll)) return null
    await run(`
      UPDATE asset_drafts
      SET domain_code = ?, payload = ?, updated_at = ?
      WHERE id = ?
    `, [domain, body, ts, existingId])
    return { id: existingId, updated_at: ts }
  }
  const info = await run(`
    INSERT INTO asset_drafts (created_by, domain_code, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `, [opts.userId, domain, body, ts, ts])
  return { id: Number(info.insertId), updated_at: ts }
}

export async function discardAssetDraft(id: number, userId: number, seeAll: boolean) {
  await ensureAssetDrafts()
  const row = await loadDraft(id)
  if (!row || !canTouch(row, userId, seeAll)) return false
  await run(`DELETE FROM asset_drafts WHERE id = ?`, [id])
  return true
}
