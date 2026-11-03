const SCAN_KEY = 'asset-scan-session'

export function markAssetScanSession() {
  try { sessionStorage.setItem(SCAN_KEY, '1') } catch { /* private mode */ }
}

export function assetScanSessionActive() {
  try { return sessionStorage.getItem(SCAN_KEY) === '1' } catch { return false }
}

/** Pull the asset or blank-label token out of a scanned QR. */
export function tokenFromQrText(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const embedded = text.match(/\/asset\/([^/?#\s]+)/i)
  if (embedded?.[1]) {
    try { return decodeURIComponent(embedded[1]) } catch { return embedded[1] }
  }
  if (/^https?:\/\//i.test(text)) return null
  if (text.length < 4 || text.length > 191) return null
  if (/[\s<>]/.test(text)) return null
  return text
}
