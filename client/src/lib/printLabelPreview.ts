export type LabelPrintSheet = {
  qr_base64: string
  lines: string[]
}

/** 300 dpi. High enough for a sharp 12 mm QR, small enough to print quickly. */
const PX_PER_MM = 300 / 25.4

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

/** Open this from the print click, before any await, so the browser allows the window. */
export function openLabelPrintWindow() {
  const preview = window.open('', 'asset-label-print', 'width=420,height=260')
  if (!preview) return null
  preview.document.open()
  preview.document.write('<!DOCTYPE html><title>Asset label</title><p style="font-family:sans-serif">Preparing label…</p>')
  preview.document.close()
  return preview
}

function labelHtml(images: string[]) {
  const sheets = images.map((src) => `<img class="label" alt="" width="136" height="79" src="${src}">`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Asset label</title><style>
    @page { size: 36mm 22mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; line-height: 0; font-size: 0; }
    img.label {
      display: block;
      width: 36mm;
      height: 21mm;
      max-width: 36mm;
      max-height: 21mm;
      object-fit: fill;
      object-position: left top;
      break-inside: avoid;
      page-break-inside: avoid;
      break-after: avoid;
      page-break-after: avoid;
    }
    img.label + img.label { break-before: page; page-break-before: always; }
  </style></head><body>${sheets}</body></html>`
}

/**
 * A hidden frame always adds one blank sheet, and the Brother feeds that sheet out first.
 * This document is only the sticker, so the dialog has one sheet.
 */
function whenReady(preview: Window) {
  const imgs = Array.from(preview.document.images)
  return Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => resolve()
  })))).then(() => undefined)
}

function printInWindow(preview: Window, images: string[]) {
  const html = labelHtml(images)
  preview.document.open()
  preview.document.write(html)
  preview.document.close()

  const close = () => {
    if (!preview.closed) preview.close()
    window.focus()
  }
  preview.addEventListener('afterprint', close)

  return whenReady(preview).then(() => {
    preview.focus()
    preview.print()
    window.setTimeout(close, 120000)
  })
}

/** Print Brother PT-P900W labels, then leave the user on the asset page. */
export async function printAssetLabels(labels: LabelPrintSheet[], preview?: Window | null) {
  const canvases = await Promise.all(labels.map((label) => renderLabelCanvas(label)))
  const images = canvases.map((canvas) => canvas.toDataURL('image/png'))
  const target = preview && !preview.closed ? preview : openLabelPrintWindow()
  if (!target) throw new Error('Allow pop-ups to print the label')
  await printInWindow(target, images)
}
