export type LabelPrintSheet = {
  qr_base64: string
  lines: string[]
}

/** Match the Brother driver: 360 dpi, so the file is 36 mm by 22 mm at actual size. */
const LABEL_DPI = 360
const PX_PER_MM = LABEL_DPI / 25.4

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('QR image failed to load'))
    img.src = src
  })
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth) current = next
    else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 3)
}

/**
 * One Brother label: 36 mm across the tape, 22 mm along it.
 * QR on the left, model and serial on the right.
 */
async function renderLabelCanvas(label: LabelPrintSheet) {
  const ppm = PX_PER_MM
  const qr = await loadImage(`data:image/png;base64,${label.qr_base64}`)
  const stripW = Math.round(36 * ppm)
  const stripH = Math.round(22 * ppm)
  const strip = document.createElement('canvas')
  strip.width = stripW
  strip.height = stripH
  const sctx = strip.getContext('2d')
  if (!sctx) throw new Error('Could not draw the label')

  sctx.fillStyle = '#ffffff'
  sctx.fillRect(0, 0, stripW, stripH)

  const pad = Math.round(1 * ppm)
  const qrSize = Math.round(12 * ppm)
  const gap = Math.round(1 * ppm)
  sctx.imageSmoothingEnabled = false
  sctx.drawImage(qr, pad, Math.round((stripH - qrSize) / 2), qrSize, qrSize)

  const textX = pad + qrSize + gap
  const textMax = Math.max(10, stripW - textX - pad)
  const fontPx = Math.max(8, Math.round((7 * 25.4 / 72) * ppm))
  sctx.imageSmoothingEnabled = true
  sctx.fillStyle = '#000000'
  sctx.font = `700 ${fontPx}px Arial, sans-serif`
  sctx.textBaseline = 'top'

  const modelLines = wrapText(sctx, String(label.lines[0] || '').trim() || '—', textMax)
  const serial = String(label.lines[1] || '').trim()
  const lineH = Math.round(fontPx * 1.2)
  const serialGap = Math.round(0.7 * ppm)
  const blockH = modelLines.length * lineH + (serial ? serialGap + lineH : 0)
  let y = Math.max(pad, Math.round((stripH - blockH) / 2))
  for (const line of modelLines) {
    sctx.fillText(line, textX, y, textMax)
    y += lineH
  }
  if (serial) {
    y += serialGap
    sctx.fillText(serial, textX, y, textMax)
  }

  return strip
}

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const b of bytes) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type)
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  new DataView(out.buffer).setUint32(8 + data.length, crc32(crcInput))
  return out
}

/** Tell Windows the picture is 36 mm by 22 mm, which a browser print dialog ignores. */
function pngWithDpi(png: Uint8Array, dpi: number) {
  const perMeter = Math.round(dpi / 0.0254)
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  view.setUint32(0, perMeter)
  view.setUint32(4, perMeter)
  data[8] = 1
  const phys = pngChunk('pHYs', data)
  const ihdrEnd = 33
  const out = new Uint8Array(png.length + phys.length)
  out.set(png.subarray(0, ihdrEnd), 0)
  out.set(phys, ihdrEnd)
  out.set(png.subarray(ihdrEnd), ihdrEnd + phys.length)
  return out
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Could not create the label image'))
        return
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      resolve(new Blob([pngWithDpi(bytes, LABEL_DPI)], { type: 'image/png' }))
    }, 'image/png')
  })
}

function labelFileName(label: LabelPrintSheet, index: number) {
  const raw = String(label.lines[1] || label.lines[0] || `label-${index + 1}`).trim()
  const safe = raw.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(0, 60) || `label-${index + 1}`
  return `${safe}.png`
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/** Save each sticker as a picture. Photos prints that file at 3.6 cm by 2.2 cm. */
export async function printAssetLabels(labels: LabelPrintSheet[]) {
  const canvases = await Promise.all(labels.map((label) => renderLabelCanvas(label)))
  const files = await Promise.all(canvases.map((canvas) => canvasToPng(canvas)))
  files.forEach((file, index) => saveBlob(file, labelFileName(labels[index], index)))
}
