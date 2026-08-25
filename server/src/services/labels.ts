import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { get, all } from '../db/index.js'
import { ensureAssetQr, markLabelPrinted } from './assetQr.js'
import { storageRoot, recordUpload } from './uploads.js'
import { now } from '../db/index.js'
import { allowedDomainCodes, canAccessDomainId, loadAssetDomains, tableHasColumn } from './domainAuth.js'

/** Compact sticker with boxed safe zone. Slightly wider so long company names fit. */
const LABEL_W = 148
const LABEL_H = 65
/** Empty ring outside the border — printers often clip this zone. */
const OUTER = 5
/** Gap between border stroke and content. */
const INNER = 5
/** Extra left inset (left edge clips most often). */
const LEFT_EXTRA = 4

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

/** Draw one line that never wraps (shrink font, then truncate). */
function drawFitLine(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  maxW: number,
  opts: { font: string; size: number; minSize?: number; color?: string },
) {
  const raw = String(text || '').trim()
  if (!raw) return
  const minSize = opts.minSize ?? 5
  let size = opts.size
  doc.font(opts.font).fillColor(opts.color || '#000')
  while (size > minSize) {
    doc.fontSize(size)
    if (doc.widthOfString(raw) <= maxW) break
    size -= 0.5
  }
  doc.fontSize(size)
  let out = raw
  if (doc.widthOfString(out) > maxW) {
    while (out.length > 1 && doc.widthOfString(`${out}…`) > maxW) {
      out = out.slice(0, -1)
    }
    out = `${out}…`
  }
  doc.text(out, x, y, { width: maxW, height: size + 2, lineBreak: false, ellipsis: true })
}

/** Company name: wrap up to maxLines so full name is visible. */
function drawWrappedText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  opts: { font: string; size: number; minSize?: number; color?: string; maxLines?: number },
) {
  const raw = String(text || '').trim()
  if (!raw) return
  const maxLines = opts.maxLines ?? 3
  const minSize = opts.minSize ?? 4.5
  let size = opts.size
  doc.font(opts.font).fillColor(opts.color || '#111')

  const fits = (s: number) => {
    doc.fontSize(s)
    const h = doc.heightOfString(raw, { width: maxW, lineGap: 0 })
    return h <= Math.min(maxH, s * 1.2 * maxLines + 1)
  }

  while (size > minSize && !fits(size)) size -= 0.5
  doc.fontSize(size)
  doc.text(raw, x, y, {
    width: maxW,
    height: Math.min(maxH, size * 1.25 * maxLines + 2),
    lineGap: 0.5,
    ellipsis: true,
  })
}

/** Compact QR + asset tag + company only. */
export async function generateLabelsPdf(
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

  const pageSize: [number, number] = [LABEL_W, LABEL_H]
  const doc = new PDFDocument({ size: pageSize, margin: 0 })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  const qrMeta: Array<{ asset_tag: string; public_url: string; qr_token: string }> = []

  for (let i = 0; i < assets.length; i++) {
    const a = assets[i]
    if (i > 0) doc.addPage({ size: pageSize, margin: 0 })

    const qr = await ensureAssetQr(a.id, { refreshImage: true })
    qrMeta.push({ asset_tag: a.asset_tag, public_url: qr.public_url, qr_token: qr.qr_token })

    // Full boxed border — cut/print outside this box; content stays inside
    const boxX = OUTER
    const boxY = OUTER
    const boxW = LABEL_W - OUTER * 2
    const boxH = LABEL_H - OUTER * 2
    doc.save()
    doc.lineWidth(0.75).strokeColor('#000')
      .rect(boxX, boxY, boxW, boxH)
      .stroke()
    doc.restore()

    const contentLeft = boxX + INNER + LEFT_EXTRA
    const contentRight = boxX + boxW - INNER
    const contentTop = boxY + INNER
    const contentBottom = boxY + boxH - INNER
    const contentH = contentBottom - contentTop

    // Slightly smaller QR → wider text column for full company names
    const qrSize = Math.min(32, contentH)
    const qrX = contentLeft
    const qrY = contentTop + (contentH - qrSize) / 2
    const gap = 4
    const textX = qrX + qrSize + gap
    const textW = Math.max(40, contentRight - textX)
    const tagH = 10
    let textY = contentTop + 4

    try {
      const pngPath = path.join(storageRoot, qr.qr_image_path)
      if (fs.existsSync(pngPath)) {
        doc.image(pngPath, qrX, qrY, { width: qrSize, height: qrSize })
      }
    } catch { /* ignore */ }

    drawFitLine(doc, a.asset_tag, textX, textY, textW, {
      font: 'Helvetica-Bold',
      size: 6.5,
      minSize: 4.5,
    })
    textY += tagH

    const companyMaxH = contentBottom - textY
    drawWrappedText(doc, a.company_name ? String(a.company_name) : '—', textX, textY, textW, companyMaxH, {
      font: 'Helvetica',
      size: 5.5,
      minSize: 4.5,
      color: '#111',
      maxLines: 3,
    })

    await markLabelPrinted(a.id)
  }

  doc.end()
  const pdf = await done

  if (opts?.persist !== false && assets.length === 1) {
    const a = assets[0]
    const dir = path.join(storageRoot, 'private_uploads/assets')
    fs.mkdirSync(dir, { recursive: true })
    const filename = `label-${a.asset_tag}-${Date.now()}.pdf`
    const diskPath = path.join(dir, filename)
    fs.writeFileSync(diskPath, pdf)
    await recordUpload({
      type: 'asset',
      id: a.id,
      filename,
      original: `Print-Label-${a.asset_tag}.pdf`,
      mime: 'application/pdf',
      diskPath,
      kind: 'label',
      userId: opts?.userId,
    }).catch(() => undefined)
  }

  return {
    pdf_base64: pdf.toString('base64'),
    count: assets.length,
    assets: assets.map((a) => a.asset_tag),
    qr: qrMeta,
    generated_at: now(),
  }
}

export async function generateSingleLabel(assetId: number, opts?: { userId?: number }) {
  const a = await get<{ asset_tag: string }>(`SELECT asset_tag FROM assets WHERE id=? AND deleted_at IS NULL`, [assetId])
  if (!a) throw new Error('Asset not found')
  return generateLabelsPdf([a.asset_tag], opts)
}
