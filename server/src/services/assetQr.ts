import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import QRCode from 'qrcode'
import { get, run, now } from '../db/index.js'
import { storageRoot } from './uploads.js'

const QR_DIR = path.join(storageRoot, 'public/assets/qr')

/** Hosts where the Node listen port is the real public port (no TLS reverse proxy). */
function isDirectListenHost(hostname: string) {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  return false
}

/**
 * Browser-facing origin for QR / email links.
 * Production: proxied HTTPS domain without container PORT (https://asset.refexone.com).
 * Local / LAN: keep the listen port (http://localhost:3053) so /asset/:token actually opens.
 */
export function clientBase() {
  const fromEnv = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').trim()
  let base = fromEnv
    || String(process.env.CLIENT_ORIGIN || 'http://localhost:3001').split(',')[0].trim()
  base = base.replace(/\/$/, '')

  const listenPort = String(process.env.PORT || '').trim()
  try {
    const u = new URL(base)
    if (isDirectListenHost(u.hostname)) {
      if (listenPort && !u.port) u.port = listenPort
    } else if (listenPort && u.port === listenPort) {
      // Drop mistaken ":3053" on a proxied hostname — TLS proxy serves on 443 / default
      u.port = ''
    }
    // Prefer https public links when FORCE_HTTPS is on (not for local http)
    if (process.env.FORCE_HTTPS === 'true' && u.protocol === 'http:' && !isDirectListenHost(u.hostname)) {
      u.protocol = 'https:'
    }
    base = u.toString().replace(/\/$/, '')
  } catch {
    /* keep as-is */
  }
  return base
}

export function publicAssetPageUrl(token: string) {
  return `${clientBase()}/asset/${encodeURIComponent(token)}`
}

function qrDiskPath(token: string) {
  return path.join(QR_DIR, `${token}.png`)
}

function qrPublicPath(token: string) {
  // Served via app.use('/storage', static(storage/public)) → /storage/assets/qr/<token>.png
  return `/storage/assets/qr/${token}.png`
}

async function ensureDir() {
  await fs.promises.mkdir(QR_DIR, { recursive: true })
}

/**
 * Ensure an asset has a permanent QR token + PNG.
 * Never rotates the token (reassign / upgrade keep the same QR).
 * Regenerates the PNG file only if missing on disk (same URL payload).
 */
export async function ensureAssetQr(assetId: number, opts?: { refreshImage?: boolean }) {
  const asset = await get<{
    id: number
    asset_tag: string
    qr_token: string | null
    qr_url: string | null
    qr_image_path: string | null
  }>(`
    SELECT id, asset_tag, qr_token, qr_url, qr_image_path
    FROM assets WHERE id = ? AND deleted_at IS NULL
  `, [assetId])

  if (!asset) throw new Error('Asset not found')

  let token = asset.qr_token ? String(asset.qr_token) : ''
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, '')
    const pageUrl = publicAssetPageUrl(token)
    const rel = `public/assets/qr/${token}.png`
    await run(`
      UPDATE assets SET qr_token = ?, qr_url = ?, qr_image_path = ?, updated_at = ?
      WHERE id = ?
    `, [token, pageUrl, rel, now(), assetId])
  }

  const pageUrl = publicAssetPageUrl(token)
  const disk = qrDiskPath(token)
  const urlSidecar = `${disk}.url`
  await ensureDir()

  let previousUrl = ''
  try {
    if (fs.existsSync(urlSidecar)) previousUrl = fs.readFileSync(urlSidecar, 'utf8').trim()
  } catch { /* ignore */ }

  const needsWrite = !fs.existsSync(disk)
    || opts?.refreshImage
    || previousUrl !== pageUrl

  if (needsWrite) {
    // Token stays permanent; image/URL base may change (e.g. LAN IP for phone scans)
    await QRCode.toFile(disk, pageUrl, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      color: { dark: '#000000', light: '#FFFFFF' },
    })
    fs.writeFileSync(urlSidecar, pageUrl, 'utf8')
  }

  // Always sync qr_url to current PUBLIC_APP_URL (fixes old …:3053/asset/… rows)
  if (asset.qr_url !== pageUrl || !asset.qr_image_path) {
    await run(`
      UPDATE assets SET qr_url = ?, qr_image_path = COALESCE(qr_image_path, ?), updated_at = ?
      WHERE id = ?
    `, [pageUrl, `public/assets/qr/${token}.png`, now(), assetId])
  }

  return {
    asset_id: assetId,
    asset_tag: asset.asset_tag,
    qr_token: token,
    public_url: pageUrl,
    qr_image_url: qrPublicPath(token),
    qr_image_path: `public/assets/qr/${token}.png`,
    created_png: needsWrite,
  }
}

export async function markLabelPrinted(assetId: number) {
  await run(`
    UPDATE assets SET
      label_printed_at = ?,
      label_print_count = COALESCE(label_print_count, 0) + 1,
      updated_at = ?
    WHERE id = ?
  `, [now(), now(), assetId])
}

/**
 * Clear all minted QR tokens/URLs/images so Print Label regenerates against current PUBLIC_APP_URL.
 * Also deletes PNG files under storage/public/assets/qr/.
 */
export async function resetAllAssetQr(): Promise<{ cleared: number; files_removed: number }> {
  const before = await get<{ c: number }>(`
    SELECT COUNT(*) AS c FROM assets
    WHERE deleted_at IS NULL AND (
      qr_token IS NOT NULL OR qr_url IS NOT NULL OR qr_image_path IS NOT NULL
      OR label_printed_at IS NOT NULL OR COALESCE(label_print_count, 0) > 0
    )
  `)
  const cleared = Number(before?.c || 0)

  await run(`
    UPDATE assets SET
      qr_token = NULL,
      qr_url = NULL,
      qr_image_path = NULL,
      label_printed_at = NULL,
      label_print_count = 0,
      updated_at = ?
    WHERE qr_token IS NOT NULL
       OR qr_url IS NOT NULL
       OR qr_image_path IS NOT NULL
       OR label_printed_at IS NOT NULL
       OR COALESCE(label_print_count, 0) > 0
  `, [now()])

  let files_removed = 0
  try {
    await ensureDir()
    const entries = await fs.promises.readdir(QR_DIR)
    for (const name of entries) {
      try {
        await fs.promises.unlink(path.join(QR_DIR, name))
        files_removed += 1
      } catch { /* ignore */ }
    }
  } catch { /* dir missing — fine */ }

  return { cleared, files_removed }
}
