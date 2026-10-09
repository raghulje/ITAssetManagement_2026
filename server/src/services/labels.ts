import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { get, all } from '../db/index.js'
import { ensureAssetQr, markLabelPrinted } from './assetQr.js'
import { storageRoot, recordUpload } from './uploads.js'
import { now } from '../db/index.js'
import { allowedDomainCodes, canAccessDomainId, loadAssetDomains, tableHasColumn } from './domainAuth.js'

/** Printer sticker. PNG is 600 DPI so the file prints at this physical size. */
export const LABEL_WIDTH_MM = 36
export const LABEL_HEIGHT_MM = 30
const LABEL_DPI = 600

function mmToPx(mm: number) {
  return (mm / 25.4) * LABEL_DPI
}

type AssetLabel = {
  id: number
  asset_tag: string
  company_name?: string | null
  domain_id?: number | null
}

async function loadAssets(idsOrTags: (string | number)[]) {
  if (!idsOrTags.length) return []
  const tags = idsOrTags.map(String)
  const placeholders = tags.map(() => '?').join(',')
  const ready = await tableHasColumn('assets', 'domain_id')
  const rows = await all<AssetLabel>(`
    SELECT a.id, a.asset_tag, c.name as company_name, ${ready ? 'a.domain_id' : 'CAST(NULL AS UNSIGNED) as domain_id'}
    FROM assets a
    LEFT JOIN companies c ON c.id = a.company_id
    WHERE a.deleted_at IS NULL AND (a.asset_tag IN (${placeholders}) OR CAST(a.id AS CHAR) IN (${placeholders}))
  `, [...tags, ...tags])
  const map = new Map<number, AssetLabel>()
  for (const r of rows) map.set(Number(r.id), r)
  return [...map.values()]
}

let fontsReady = false

function ensureLabelFonts() {
  if (fontsReady) return
  const candidates: Array<[string, string]> = [
    ['C:\\Windows\\Fonts\\arialbd.ttf', 'LabelSansBold'],
    ['C:\\Windows\\Fonts\\arial.ttf', 'LabelSans'],
    ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'LabelSansBold'],
    ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 'LabelSans'],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'LabelSansBold'],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'LabelSans'],
  ]
  for (const [file, family] of candidates) {
    if (!fs.existsSync(file) || GlobalFonts.has(family)) continue
    GlobalFonts.registerFromPath(file, family)
  }
  fontsReady = true
}

function fontFamily(bold: boolean) {
  if (bold && GlobalFonts.has('LabelSansBold')) return 'LabelSansBold'
  if (GlobalFonts.has('LabelSans')) return 'LabelSans'
  return 'Arial'
}

function ellipsize(ctx: SKRSContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1)
  return `${out}…`
}

function wrapLines(ctx: SKRSContext2D, text: string, maxW: number, maxLines: number) {
  const words = String(text || '—').trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  let i = 0
  while (i < words.length && lines.length < maxLines) {
    const next = cur ? `${cur} ${words[i]}` : words[i]
    if (ctx.measureText(next).width <= maxW) {
      cur = next
      i += 1
      continue
    }
    if (cur) {
      lines.push(cur)
      cur = ''
      continue
    }
    lines.push(ellipsize(ctx, words[i], maxW))
    i += 1
    cur = ''
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  if (i < words.length && lines.length) {
    lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1].replace(/…$/, ''), maxW)
  }
  return lines
}

/** PNG pHYs chunk so viewers that honor DPI print this at the sticker size. */
function withPngDpi(png: Buffer, dpi: number) {
  const ppm = Math.round(dpi / 0.0254)
  const data = Buffer.alloc(9)
  data.writeUInt32BE(ppm, 0)
  data.writeUInt32BE(ppm, 4)
  data.writeUInt8(1, 8)
  const type = Buffer.from('pHYs')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([type, data])), 0)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(9, 0)
  const ihdrLen = png.readUInt32BE(8)
  const insertAt = 8 + 8 + ihdrLen + 4
  return Buffer.concat([png.subarray(0, insertAt), len, type, data, crcBuf, png.subarray(insertAt)])
}

function pngCrc32(buf: Buffer) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

export async function renderAssetLabelPng(asset: AssetLabel, qrPngPath: string | null) {
  ensureLabelFonts()
  const w = Math.round(mmToPx(LABEL_WIDTH_MM))
  const h = Math.round(mmToPx(LABEL_HEIGHT_MM))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  const stroke = Math.max(2, mmToPx(0.22))
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = stroke
  const edge = stroke / 2 + 1
  ctx.strokeRect(edge, edge, w - edge * 2, h - edge * 2)

  const pad = mmToPx(1.15)
  const inner = edge + pad
  const innerW = w - inner * 2
  const innerH = h - inner * 2
  const tagPx = Math.round(mmToPx(2.15))
  const companyPx = Math.round(mmToPx(1.6))
  const textH = tagPx * 1.2 + companyPx * 1.15 * 2
  const gap = mmToPx(0.55)
  const qrSize = Math.floor(Math.min(innerW, Math.max(mmToPx(14), innerH - textH - gap)))
  const blockH = qrSize + gap + textH
  const qrX = inner + (innerW - qrSize) / 2
  const qrY = inner + Math.max(0, (innerH - blockH) / 2)

  if (qrPngPath && fs.existsSync(qrPngPath)) {
    const img = await loadImage(qrPngPath)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, qrX, qrY, qrSize, qrSize)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#000000'
  let y = qrY + qrSize + gap
  ctx.font = `${tagPx}px ${fontFamily(true)}`
  ctx.fillText(ellipsize(ctx, asset.asset_tag, innerW), w / 2, y)
  y += tagPx * 1.15

  ctx.fillStyle = '#111111'
  ctx.font = `${companyPx}px ${fontFamily(false)}`
  for (const line of wrapLines(ctx, asset.company_name ? String(asset.company_name) : '—', innerW, 2)) {
    ctx.fillText(line, w / 2, y)
    y += companyPx * 1.15
  }

  return withPngDpi(canvas.toBuffer('image/png'), LABEL_DPI)
}

function safeFilePart(tag: string) {
  return tag.replace(/[^\w.-]+/g, '_') || 'asset'
}

/** High-resolution PNG sticker: QR, asset tag, and company. One label is 36 × 30 mm. */
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
  const tiles: Buffer[] = []

  for (const a of assets) {
    const qr = await ensureAssetQr(a.id, { refreshImage: true })
    qrMeta.push({ asset_tag: a.asset_tag, public_url: qr.public_url, qr_token: qr.qr_token })
    const pngPath = path.join(storageRoot, qr.qr_image_path)
    tiles.push(await renderAssetLabelPng(a, pngPath))
    await markLabelPrinted(a.id)
  }

  const tileW = Math.round(mmToPx(LABEL_WIDTH_MM))
  const tileH = Math.round(mmToPx(LABEL_HEIGHT_MM))
  let png = tiles[0]
  if (tiles.length > 1) {
    const sheet = createCanvas(tileW, tileH * tiles.length)
    const ctx = sheet.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    for (let i = 0; i < tiles.length; i++) {
      const img = await loadImage(tiles[i])
      ctx.drawImage(img, 0, i * tileH, tileW, tileH)
    }
    png = withPngDpi(sheet.toBuffer('image/png'), LABEL_DPI)
  }

  const filename = assets.length === 1
    ? `print-label-${safeFilePart(assets[0].asset_tag)}.png`
    : `print-labels-${assets.length}.png`

  if (opts?.persist !== false && assets.length === 1) {
    const a = assets[0]
    const dir = path.join(storageRoot, 'private_uploads/assets')
    fs.mkdirSync(dir, { recursive: true })
    const stored = `label-${safeFilePart(a.asset_tag)}-${Date.now()}.png`
    const diskPath = path.join(dir, stored)
    fs.writeFileSync(diskPath, png)
    await recordUpload({
      type: 'asset',
      id: a.id,
      filename: stored,
      original: filename,
      mime: 'image/png',
      size: png.length,
      diskPath,
      kind: 'label',
      userId: opts?.userId,
    }).catch(() => undefined)
  }

  return {
    image_base64: png.toString('base64'),
    mime: 'image/png',
    filename,
    width_mm: LABEL_WIDTH_MM,
    height_mm: LABEL_HEIGHT_MM * assets.length,
    dpi: LABEL_DPI,
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
