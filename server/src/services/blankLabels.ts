import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import QRCode from 'qrcode'
import bwipjs from 'bwip-js'
import { all, get, run, now } from '../db/index.js'
import { storageRoot } from './uploads.js'
import { publicAssetPageUrl } from './assetQr.js'

export type LabelKind = 'qr' | 'barcode' | 'both'

const LABEL_DIR = path.join(storageRoot, 'public/labels')

export function labelImageUrl(relPath: string | null | undefined) {
  if (!relPath) return null
  return `/storage/${String(relPath).replace(/\\/g, '/').replace(/^public\//, '')}`
}

async function ensureDirs() {
  await fs.promises.mkdir(path.join(LABEL_DIR, 'qr'), { recursive: true })
  await fs.promises.mkdir(path.join(LABEL_DIR, 'barcode'), { recursive: true })
}

async function nextSequence(): Promise<number> {
  const row = await get<{ n: number | null }>(`
    SELECT MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)) AS n
    FROM label_codes
    WHERE code LIKE 'AM-%'
  `)
  return Number(row?.n || 0) + 1
}

function formatCode(seq: number) {
  return `AM-${String(seq).padStart(6, '0')}`
}

async function writeQrPng(token: string, pageUrl: string) {
  const disk = path.join(LABEL_DIR, 'qr', `${token}.png`)
  await QRCode.toFile(disk, pageUrl, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
    color: { dark: '#000000', light: '#FFFFFF' },
  })
  return `public/labels/qr/${token}.png`
}

async function writeBarcodePng(token: string, code: string) {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text: code,
    scale: 3,
    height: 14,
    includetext: true,
    textsize: 11,
    textxalign: 'center',
    backgroundcolor: 'FFFFFF',
    paddingwidth: 8,
    paddingheight: 6,
  })
  const disk = path.join(LABEL_DIR, 'barcode', `${token}.png`)
  await fs.promises.writeFile(disk, png)
  return `public/labels/barcode/${token}.png`
}

export type LabelRow = {
  id: number
  batch_id: number
  token: string
  code: string
  kind: string
  status: string
  asset_id: number | null
  qr_image_path: string | null
  barcode_image_path: string | null
  public_url: string | null
  created_at: string | null
  registered_at: string | null
}

export function presentLabel(row: LabelRow) {
  return {
    id: row.id,
    batch_id: row.batch_id,
    token: row.token,
    code: row.code,
    kind: row.kind,
    status: row.status,
    asset_id: row.asset_id,
    public_url: row.public_url || publicAssetPageUrl(row.token),
    qr_image_url: labelImageUrl(row.qr_image_path),
    barcode_image_url: labelImageUrl(row.barcode_image_path),
    created_at: row.created_at,
    registered_at: row.registered_at,
  }
}

export async function generateBlankLabels(opts: {
  count: number
  kind: LabelKind
  userId?: number | null
}) {
  const count = Math.min(Math.max(Math.floor(opts.count), 1), 200)
  const kind = opts.kind
  if (kind !== 'qr' && kind !== 'barcode' && kind !== 'both') {
    throw new Error('kind must be qr, barcode, or both')
  }
  await ensureDirs()
  const ts = now()
  const batch = await run(
    `INSERT INTO label_batches (kind, count, created_by, created_at) VALUES (?, ?, ?, ?)`,
    [kind, count, opts.userId || null, ts],
  )
  const batchId = batch.insertId
  let seq = await nextSequence()
  const created: ReturnType<typeof presentLabel>[] = []

  for (let i = 0; i < count; i += 1) {
    const token = crypto.randomUUID().replace(/-/g, '')
    const code = formatCode(seq)
    seq += 1
    const pageUrl = publicAssetPageUrl(token)
    let qrPath: string | null = null
    let barcodePath: string | null = null
    if (kind === 'qr' || kind === 'both') qrPath = await writeQrPng(token, pageUrl)
    if (kind === 'barcode' || kind === 'both') barcodePath = await writeBarcodePng(token, code)

    const info = await run(
      `INSERT INTO label_codes (
        batch_id, token, code, kind, status, qr_image_path, barcode_image_path, public_url, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'blank', ?, ?, ?, ?, ?)`,
      [batchId, token, code, kind, qrPath, barcodePath, pageUrl, opts.userId || null, ts],
    )
    created.push(presentLabel({
      id: info.insertId,
      batch_id: batchId,
      token,
      code,
      kind,
      status: 'blank',
      asset_id: null,
      qr_image_path: qrPath,
      barcode_image_path: barcodePath,
      public_url: pageUrl,
      created_at: ts,
      registered_at: null,
    }))
  }

  return { batch_id: batchId, count: created.length, kind, rows: created }
}

export async function findLabelByTokenOrCode(value: string) {
  const v = String(value || '').trim()
  if (!v) return null
  return get<LabelRow>(`
    SELECT id, batch_id, token, code, kind, status, asset_id, qr_image_path, barcode_image_path, public_url,
      created_at, registered_at
    FROM label_codes
    WHERE token = ? OR code = ?
    LIMIT 1
  `, [v, v])
}

export async function listLabelCodes(opts: {
  status?: string
  search?: string
  limit?: number
  offset?: number
}) {
  let sql = `
    SELECT id, batch_id, token, code, kind, status, asset_id, qr_image_path, barcode_image_path, public_url,
      created_at, registered_at
    FROM label_codes
    WHERE 1=1
  `
  const params: unknown[] = []
  if (opts.status === 'blank' || opts.status === 'registered') {
    sql += ' AND status = ?'
    params.push(opts.status)
  }
  if (opts.search) {
    sql += ' AND (code LIKE ? OR token LIKE ?)'
    const like = `%${opts.search.trim()}%`
    params.push(like, like)
  }
  sql += ' ORDER BY id DESC'
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500)
  const offset = Math.max(Number(opts.offset) || 0, 0)
  const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _q`, params)
  const rows = await all<LabelRow>(`${sql} LIMIT ${limit} OFFSET ${offset}`, params)
  return { total: Number(totalRow?.c || 0), rows: rows.map(presentLabel) }
}

export async function listBatches(limit = 30) {
  const rows = await all<{
    id: number
    kind: string
    count: number
    created_at: string | null
    blank: number
    registered: number
  }>(`
    SELECT b.id, b.kind, b.count, b.created_at,
      SUM(CASE WHEN c.status = 'blank' THEN 1 ELSE 0 END) AS blank,
      SUM(CASE WHEN c.status = 'registered' THEN 1 ELSE 0 END) AS registered
    FROM label_batches b
    LEFT JOIN label_codes c ON c.batch_id = b.id
    GROUP BY b.id, b.kind, b.count, b.created_at
    ORDER BY b.id DESC
    LIMIT ${Math.min(Math.max(limit, 1), 100)}
  `)
  return rows
}

export async function labelsInBatch(batchId: number) {
  const rows = await all<LabelRow>(`
    SELECT id, batch_id, token, code, kind, status, asset_id, qr_image_path, barcode_image_path, public_url,
      created_at, registered_at
    FROM label_codes
    WHERE batch_id = ?
    ORDER BY id ASC
  `, [batchId])
  return rows.map(presentLabel)
}

export async function markLabelRegistered(opts: {
  labelId: number
  assetId: number
  userId?: number | null
}) {
  const result = await run(
    `UPDATE label_codes
     SET status = 'registered', asset_id = ?, registered_at = ?, registered_by = ?
     WHERE id = ? AND status = 'blank'`,
    [opts.assetId, now(), opts.userId || null, opts.labelId],
  )
  return result.affectedRows > 0
}
