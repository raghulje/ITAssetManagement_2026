import fs from 'node:fs'
import path from 'node:path'
import { get, all } from '../db/index.js'
import { ensureAssetQr, markLabelPrinted } from './assetQr.js'
import { storageRoot, recordUpload } from './uploads.js'
import { now } from '../db/index.js'
import { allowedDomainCodes, canAccessDomainId, loadAssetDomains, tableHasColumn } from './domainAuth.js'

/** Brother PT-P900W page. Content is drawn 36mm × 22mm, then rotated −90° onto this page. */
export const LABEL_WIDTH_MM = 22
export const LABEL_HEIGHT_MM = 36

type AssetLabel = {
  id: number
  asset_tag: string
  serial?: string | null
  asset_name?: string | null
  model_name?: string | null
  domain_id?: number | null
}

export type PrintedLabel = {
  asset_tag: string
  qr_base64: string
  lines: string[]
}

async function loadAssets(idsOrTags: (string | number)[]) {
  if (!idsOrTags.length) return []
  const tags = idsOrTags.map(String)
  const placeholders = tags.map(() => '?').join(',')
  const ready = await tableHasColumn('assets', 'domain_id')
  const rows = await all<AssetLabel>(`
    SELECT a.id, a.asset_tag, a.serial, a.name as asset_name,
      m.name as model_name,
      ${ready ? 'a.domain_id' : 'CAST(NULL AS UNSIGNED) as domain_id'}
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    WHERE a.deleted_at IS NULL AND (a.asset_tag IN (${placeholders}) OR CAST(a.id AS CHAR) IN (${placeholders}))
  `, [...tags, ...tags])
  const map = new Map<number, AssetLabel>()
  for (const r of rows) map.set(Number(r.id), r)
  return [...map.values()]
}

function productLine(asset: AssetLabel) {
  return String(asset.model_name || '').trim() || String(asset.asset_name || '').trim()
}

function labelLines(asset: AssetLabel): string[] {
  const serial = String(asset.serial || '').trim()
  return [
    productLine(asset) || '—',
    serial || asset.asset_tag,
  ]
}

function safeFilePart(tag: string) {
  return tag.replace(/[^\w.-]+/g, '_') || 'asset'
}

/** Brother PT-P900W sticker data: QR, model, and serial. */
export async function generateLabels(
  assetTagsOrIds: (string | number)[],
  opts?: { userId?: number; persist?: boolean; permissions?: Record<string, unknown> },
) {
  let assets = await loadAssets(assetTagsOrIds)
  if (opts?.permissions) {
    const allowed = allowedDomainCodes(opts.permissions)
    const domains = await loadAssetDomains()
    assets = assets.filter((a) => canAccessDomainId(allowed, a.domain_id, domains))
  }
  if (!assets.length) throw new Error('No assets found for labels')

  const qrMeta: Array<{ asset_tag: string; public_url: string; qr_token: string }> = []
  const labels: PrintedLabel[] = []

  for (const a of assets) {
    const qr = await ensureAssetQr(a.id, { refreshImage: true })
    qrMeta.push({ asset_tag: a.asset_tag, public_url: qr.public_url, qr_token: qr.qr_token })
    const pngPath = path.join(storageRoot, qr.qr_image_path)
    if (!fs.existsSync(pngPath)) throw new Error(`QR image missing for ${a.asset_tag}`)
    const qrPng = fs.readFileSync(pngPath)
    labels.push({
      asset_tag: a.asset_tag,
      qr_base64: qrPng.toString('base64'),
      lines: labelLines(a),
    })
    await markLabelPrinted(a.id)

    if (opts?.persist !== false && assets.length === 1) {
      const dir = path.join(storageRoot, 'private_uploads/assets')
      fs.mkdirSync(dir, { recursive: true })
      const stored = `label-${safeFilePart(a.asset_tag)}-${Date.now()}.png`
      const diskPath = path.join(dir, stored)
      fs.writeFileSync(diskPath, qrPng)
      await recordUpload({
        type: 'asset',
        id: a.id,
        filename: stored,
        original: `Print-Label-${a.asset_tag}.png`,
        mime: 'image/png',
        size: qrPng.length,
        diskPath,
        kind: 'label',
        userId: opts?.userId,
      }).catch(() => undefined)
    }
  }

  const filename = assets.length === 1
    ? `print-label-${safeFilePart(assets[0].asset_tag)}.png`
    : `print-labels-${assets.length}.png`

  return {
    image_base64: labels[0].qr_base64,
    mime: 'image/png',
    filename,
    width_mm: LABEL_WIDTH_MM,
    height_mm: LABEL_HEIGHT_MM,
    labels,
    count: assets.length,
    assets: assets.map((a) => a.asset_tag),
    qr: qrMeta,
    generated_at: now(),
  }
}

export async function generateSingleLabel(assetId: number, opts?: { userId?: number }) {
  const a = await get<{ asset_tag: string }>(`SELECT asset_tag FROM assets WHERE id=? AND deleted_at IS NULL`, [assetId])
  if (!a) throw new Error('Asset not found')
  return generateLabels([a.asset_tag], opts)
}
