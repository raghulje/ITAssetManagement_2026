import fs from 'node:fs'
import path from 'node:path'
import { all, get, run, now } from '../db/index.js'
import { absolutePath, storageRoot } from './uploads.js'

let tableReady = false

export async function ensureAssetCapturesTable() {
  if (tableReady) return
  await run(`
    CREATE TABLE IF NOT EXISTS asset_captures (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      asset_id INT UNSIGNED NOT NULL,
      captured_by INT UNSIGNED NULL,
      storage_path VARCHAR(500) NOT NULL,
      original_name VARCHAR(255) NULL,
      mime_type VARCHAR(128) NULL,
      file_size INT UNSIGNED NULL,
      capture_kind VARCHAR(16) NOT NULL DEFAULT 'photo',
      captured_at DATETIME NULL,
      latitude DECIMAL(10, 7) NULL,
      longitude DECIMAL(10, 7) NULL,
      accuracy_m DECIMAL(8, 2) NULL,
      address VARCHAR(500) NULL,
      locality_header VARCHAR(255) NULL,
      created_at DATETIME NULL,
      updated_at DATETIME NULL,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_asset_captures_asset (asset_id, deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  tableReady = true
}

export async function findAssetByQrToken(token: string) {
  const t = String(token || '').trim()
  if (!t) return null
  let row = await get<{ id: number; asset_tag: string }>(`
    SELECT id, asset_tag FROM assets WHERE deleted_at IS NULL AND qr_token = ? LIMIT 1
  `, [t])
  if (!row && /^\d+$/.test(t)) {
    row = await get<{ id: number; asset_tag: string }>(`
      SELECT id, asset_tag FROM assets WHERE deleted_at IS NULL AND id = ? LIMIT 1
    `, [Number(t)])
  }
  if (!row) {
    const { findLabelByTokenOrCode } = await import('./blankLabels.js')
    const label = await findLabelByTokenOrCode(t)
    if (label?.status === 'registered' && label.asset_id) {
      row = await get<{ id: number; asset_tag: string }>(`
        SELECT id, asset_tag FROM assets WHERE deleted_at IS NULL AND id = ? LIMIT 1
      `, [label.asset_id])
    }
  }
  return row || null
}

export type AssetCaptureRow = {
  id: number
  asset_id: number
  capture_kind: string
  original_name: string | null
  mime_type: string | null
  file_size: number | null
  captured_at: string | null
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  address: string | null
  locality_header: string | null
  created_at: string | null
}

export type CaptureKind = 'photo' | 'serial' | 'video'

export function normalizeCaptureKind(raw: string, mime = ''): CaptureKind {
  const kind = String(raw || '').toLowerCase()
  if (kind === 'serial') return 'serial'
  if (kind === 'video' || String(mime).startsWith('video/')) return 'video'
  return 'photo'
}

export function presentCapture(row: AssetCaptureRow, fileUrl: string) {
  return {
    id: row.id,
    kind: normalizeCaptureKind(row.capture_kind, row.mime_type || ''),
    original_name: row.original_name,
    mime_type: row.mime_type,
    file_size: row.file_size,
    captured_at: row.captured_at,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    accuracy_m: row.accuracy_m != null ? Number(row.accuracy_m) : null,
    address: row.address,
    locality_header: row.locality_header,
    created_at: row.created_at,
    url: fileUrl,
  }
}

export function publicCaptureUrl(token: string, id: number) {
  return `/public/assets/${encodeURIComponent(token)}/captures/${id}/file`
}

export function hardwareCaptureUrl(assetId: number, id: number) {
  return `/hardware/${assetId}/captures/${id}/file`
}

export async function listAssetCaptures(assetId: number) {
  await ensureAssetCapturesTable()
  return all<AssetCaptureRow>(`
    SELECT id, asset_id, capture_kind, original_name, mime_type, file_size,
      captured_at, latitude, longitude, accuracy_m, address, locality_header, created_at
    FROM asset_captures
    WHERE asset_id = ? AND deleted_at IS NULL
    ORDER BY id DESC
  `, [assetId])
}

export async function insertAssetCapture(opts: {
  assetId: number
  userId?: number
  storagePath: string
  originalName: string
  mime: string
  size: number
  kind: CaptureKind
  capturedAt?: string | null
  latitude?: number | null
  longitude?: number | null
  accuracyM?: number | null
  address?: string | null
  localityHeader?: string | null
}) {
  await ensureAssetCapturesTable()
  const ts = now()
  const info = await run(`
    INSERT INTO asset_captures (
      asset_id, captured_by, storage_path, original_name, mime_type, file_size,
      capture_kind, captured_at, latitude, longitude, accuracy_m, address, locality_header,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    opts.assetId,
    opts.userId || null,
    opts.storagePath,
    opts.originalName,
    opts.mime,
    opts.size,
    opts.kind,
    opts.capturedAt || ts,
    opts.latitude ?? null,
    opts.longitude ?? null,
    opts.accuracyM ?? null,
    opts.address || null,
    opts.localityHeader || null,
    ts,
    ts,
  ])
  return Number(info.insertId)
}

export async function getAssetCapture(id: number, assetId: number) {
  await ensureAssetCapturesTable()
  return get<AssetCaptureRow & { storage_path: string }>(`
    SELECT id, asset_id, capture_kind, original_name, mime_type, file_size, storage_path,
      captured_at, latitude, longitude, accuracy_m, address, locality_header, created_at
    FROM asset_captures
    WHERE id = ? AND asset_id = ? AND deleted_at IS NULL
  `, [id, assetId])
}

export async function softDeleteAssetCapture(id: number, assetId: number) {
  await ensureAssetCapturesTable()
  const row = await getAssetCapture(id, assetId)
  if (!row) return null
  await run(`UPDATE asset_captures SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
  return row
}

export function captureDiskPath(rel: string) {
  const abs = absolutePath(rel)
  if (!abs.startsWith(path.resolve(storageRoot))) {
    throw new Error('Invalid storage path')
  }
  if (!fs.existsSync(abs)) return null
  return abs
}
