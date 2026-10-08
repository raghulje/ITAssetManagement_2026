/** GPS Map Camera–style overlay: satellite map tile + black details panel. */

import { getApiBase } from '../api/baseUrl'

export type GpsStampMeta = {
  capturedAt: Date
  latitude: number | null
  longitude: number | null
  address: string | null
  localityHeader?: string | null
  accuracyM?: number | null
  assetTag?: string | null
  label?: string | null
  /** Absolute or same-origin URL to a satellite static map image */
  mapImageUrl?: string | null
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** Tuesday, 18/08/2026 06:43 PM GMT +05:30 */
function formatGpsMapCameraTime(d: Date) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const day = days[d.getDay()]
  const dd = pad2(d.getDate())
  const mm = pad2(d.getMonth() + 1)
  const yyyy = d.getFullYear()
  let h = d.getHours()
  const min = pad2(d.getMinutes())
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  const hh = pad2(h)
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const oh = pad2(Math.floor(abs / 60))
  const om = pad2(abs % 60)
  return `${day}, ${dd}/${mm}/${yyyy} ${hh}:${min} ${ampm} GMT ${sign}${oh}:${om}`
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = url
  })
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read photo'))
    }
    img.src = url
  })
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const lines: string[] = []
  let line = words[0]
  for (let i = 1; i < words.length; i++) {
    const next = `${line} ${words[i]}`
    if (ctx.measureText(next).width <= maxWidth) line = next
    else {
      lines.push(line)
      line = words[i]
      if (lines.length >= maxLines) return lines
    }
  }
  lines.push(line)
  return lines.slice(0, maxLines)
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'image/*' }
  const t = localStorage.getItem('refex_token')
  if (t) headers.Authorization = `Bearer ${t}`
  return headers
}

/** Fetch satellite pin map via server proxy (keeps API key server-side). */
export async function fetchGpsStaticMapUrl(
  lat: number,
  lng: number,
  size = 400,
  opts?: { publicAccess?: boolean },
): Promise<string | null> {
  try {
    const path = opts?.publicAccess ? '/public/geo/static-map' : '/geo/static-map'
    const url = `${getApiBase()}${path}?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}&size=${size}`
    const res = await fetch(url, { headers: opts?.publicAccess ? undefined : authHeaders() })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

function drawFovCone(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const r = size * 0.28
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-35 * Math.PI) / 180)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, r, (-55 * Math.PI) / 180, (55 * Math.PI) / 180)
  ctx.closePath()
  ctx.fillStyle = 'rgba(33, 150, 243, 0.38)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(33, 150, 243, 0.75)'
  ctx.lineWidth = Math.max(1.5, size * 0.01)
  ctx.stroke()
  ctx.restore()
}

function drawPin(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = Math.max(10, size * 0.08)
  ctx.save()
  ctx.translate(cx, cy - s * 0.15)
  ctx.beginPath()
  ctx.moveTo(0, s * 1.15)
  ctx.bezierCurveTo(-s * 0.95, s * 0.2, -s * 0.95, -s * 0.85, 0, -s * 0.85)
  ctx.bezierCurveTo(s * 0.95, -s * 0.85, s * 0.95, s * 0.2, 0, s * 1.15)
  ctx.closePath()
  ctx.fillStyle = '#E53935'
  ctx.fill()
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = Math.max(1.5, s * 0.12)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, -s * 0.35, s * 0.28, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.restore()
}

function drawFallbackMap(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const g = ctx.createLinearGradient(x, y, x + size, y + size)
  g.addColorStop(0, '#1B4332')
  g.addColorStop(1, '#081C15')
  ctx.fillStyle = g
  ctx.fillRect(x, y, size, size)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
  drawFovCone(ctx, x + size / 2, y + size / 2, size)
  drawPin(ctx, x + size / 2, y + size / 2, size)
}

/**
 * Burns a GPS Map Camera–style bar onto the photo:
 * [ satellite map + pin ] [ city · address · lat/lng · timestamp ]
 */
export async function stampGpsOnImage(file: File, meta: GpsStampMeta): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  const img = await loadImageFromFile(file)
  const maxEdge = 2400
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file

  ctx.drawImage(img, 0, 0, w, h)

  const hasGps = meta.latitude != null && meta.longitude != null
    && Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude)

  // Bottom strip height ≈ GPS Map Camera proportions
  const mapSize = Math.round(Math.min(w * 0.32, h * 0.34, 420))
  const stripH = mapSize
  const stripY = h - stripH
  const pad = Math.max(10, Math.round(mapSize * 0.06))
  const textX = mapSize + pad
  const textW = w - mapSize - pad * 2

  // Black details panel (right)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.92)'
  ctx.fillRect(mapSize, stripY, w - mapSize, stripH)

  // Satellite map (left)
  let mapDrawn = false
  if (meta.mapImageUrl) {
    try {
      const mapImg = await loadImageFromUrl(meta.mapImageUrl)
      ctx.drawImage(mapImg, 0, stripY, mapSize, mapSize)
      mapDrawn = true
    } catch {
      mapDrawn = false
    }
  }
  if (!mapDrawn) drawFallbackMap(ctx, 0, stripY, mapSize)
  else {
    drawFovCone(ctx, mapSize / 2, stripY + mapSize / 2, mapSize)
    // Pin already on static map; soft FOV only. Extra pin if static marker missing:
    // drawPin(ctx, mapSize / 2, stripY + mapSize / 2, mapSize)
  }

  // Thin divider
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(mapSize, stripY, 1, stripH)

  // App label top-right of panel
  const appLabel = meta.label || 'Refex ITAM'
  const labelSize = Math.max(10, Math.round(mapSize * 0.055))
  ctx.font = `600 ${labelSize}px "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  const labelY = stripY + Math.max(8, pad * 0.55)
  ctx.fillText(appLabel, w - pad, labelY)
  // small camera glyph
  ctx.textAlign = 'left'
  const labelWidth = ctx.measureText(appLabel).width
  ctx.font = `${labelSize}px "Segoe UI Symbol", sans-serif`
  ctx.fillText('📷', w - pad - labelWidth - labelSize - 6, labelY - 1)

  let y = stripY + pad + labelSize + Math.max(8, pad * 0.5)

  // City header + India flag
  const citySize = Math.max(16, Math.round(mapSize * 0.105))
  const locality = (meta.localityHeader || '').trim()
    || (meta.address ? meta.address.split(',').slice(-3).join(',').trim() : '')
    || (hasGps ? 'Location' : 'Location unavailable')
  ctx.font = `700 ${citySize}px "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'top'
  const flag = '🇮🇳'
  const header = `${locality} ${flag}`
  const headerLines = wrapText(ctx, header, textW, 2)
  for (const line of headerLines) {
    ctx.fillText(line, textX, y)
    y += citySize + 3
  }
  y += 4

  // Full address
  if (meta.address) {
    const addrSize = Math.max(11, Math.round(mapSize * 0.062))
    ctx.font = `400 ${addrSize}px "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    for (const line of wrapText(ctx, meta.address.replace(/\s+/g, ' ').trim(), textW, 3)) {
      ctx.fillText(line, textX, y)
      y += addrSize + 3
    }
    y += 6
  }

  // Lat / Long
  const coordSize = Math.max(11, Math.round(mapSize * 0.06))
  ctx.font = `600 ${coordSize}px "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = '#FFFFFF'
  if (hasGps) {
    ctx.fillText(
      `Lat ${meta.latitude!.toFixed(6)}° Long ${meta.longitude!.toFixed(6)}°`,
      textX,
      y,
    )
  } else {
    ctx.fillStyle = '#FCD34D'
    ctx.fillText('Lat — Long —', textX, y)
  }
  y += coordSize + 6

  // Timestamp
  const timeSize = Math.max(10, Math.round(mapSize * 0.055))
  ctx.font = `500 ${timeSize}px "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fillText(formatGpsMapCameraTime(meta.capturedAt), textX, y)

  if (meta.assetTag) {
    ctx.font = `600 ${Math.max(9, timeSize - 1)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = '#FB923C'
    ctx.fillText(`Refex ITAM · ${meta.assetTag}`, textX, stripY + stripH - pad - timeSize)
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.93)
  })
  if (!blob) return file

  const name = (file.name || 'capture.jpg').replace(/\.\w+$/, '') + '-gps.jpg'
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
}
