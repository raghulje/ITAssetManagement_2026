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
 * QR on the left, model and serial on the right. No second page.
 */
async function renderLabelPng(label: LabelPrintSheet) {
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

  return strip.toDataURL('image/png')
}

function printDocument(images: string[]) {
  const sheets = images.map((src) => `<img class="label" alt="" src="${src}" />`).join('')
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Asset label</title>
  <style>
    @page { size: 36mm 22mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 36mm;
      height: 22mm;
      overflow: hidden;
      background: #fff;
    }
    img.label {
      position: fixed;
      left: 0;
      top: 0;
      width: 36mm;
      height: 22mm;
      border: 0;
      page-break-before: avoid;
      page-break-after: avoid;
      break-before: avoid;
      break-after: avoid;
    }
    img.label:not(:only-child) {
      position: static;
      display: block;
    }
    img.label:not(:last-child) {
      break-after: page;
      page-break-after: always;
    }
  </style>
</head>
<body>${sheets}</body>
</html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'Asset label print')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:0;top:0;width:36mm;height:22mm;border:0;z-index:-1;'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  const frame = iframe.contentWindow
  if (!doc || !frame) {
    iframe.remove()
    throw new Error('Could not open the print dialog')
  }

  doc.open()
  doc.write(html)
  doc.close()

  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    window.setTimeout(() => iframe.remove(), 400)
    window.focus()
  }
  frame.addEventListener('afterprint', finish)

  const start = () => {
    frame.focus()
    frame.print()
    window.setTimeout(finish, 120000)
  }

  const imgs = [...doc.querySelectorAll('img')]
  if (!imgs.length) {
    start()
    return
  }
  let pending = imgs.length
  const done = () => {
    pending -= 1
    if (pending <= 0) window.setTimeout(start, 30)
  }
  for (const img of imgs) {
    if (img.complete && img.naturalWidth > 0) done()
    else {
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
    }
  }
}

/** Print Brother PT-P900W labels from the current page, then leave the user there. */
export async function printAssetLabels(labels: LabelPrintSheet[]) {
  const images = await Promise.all(labels.map((label) => renderLabelPng(label)))
  printDocument(images)
}
