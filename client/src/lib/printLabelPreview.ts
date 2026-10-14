export type LabelPrintSheet = {
  qr_base64: string
  lines: string[]
}

/** ~600 dpi. The printed page is 22mm × 36mm. */
const PX_PER_MM = 24

function mm(value: number) {
  return Math.round(value * PX_PER_MM)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not draw the QR code'))
    img.src = src
  })
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word
    if (current && ctx.measureText(trial).width > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = trial
    }
  }
  if (current) lines.push(current)
  return lines
}

async function renderLabel(label: LabelPrintSheet) {
  const width = mm(22)
  const height = mm(36)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not draw the label')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const qrSize = mm(10)
  const qrX = Math.round((width - qrSize) / 2)
  const qrY = height - mm(3.2) - qrSize
  const qr = await loadImage(`data:image/png;base64,${label.qr_base64}`)
  ctx.drawImage(qr, qrX, qrY, qrSize, qrSize)

  const lines = label.lines.map((line) => String(line || '').trim()).filter(Boolean)
  const fontPx = Math.round((7 / 72) * 25.4 * PX_PER_MM)
  ctx.fillStyle = '#000000'
  ctx.font = `700 ${fontPx}px Arial, sans-serif`
  ctx.textBaseline = 'top'

  const textTop = mm(2.4)
  const textBottom = qrY - mm(1.4)
  const textLeft = mm(3.2)
  const textSpan = Math.max(mm(8), textBottom - textTop)
  const lineGap = Math.round(fontPx * 1.28)

  ctx.save()
  ctx.translate(textLeft, textBottom)
  ctx.rotate(-Math.PI / 2)
  const drawn = lines.flatMap((line) => wrapLines(ctx, line, textSpan))
  const widest = drawn.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
  const x0 = Math.max(0, (textSpan - widest) / 2)
  drawn.forEach((line, index) => {
    ctx.fillText(line, x0, index * lineGap)
  })
  ctx.restore()

  return canvas.toDataURL('image/png')
}

function labelHtml(imageUrls: string[]) {
  const sheets = imageUrls.map((src) => `<div class="sheet"><img src="${src}" alt="" /></div>`).join('')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Brother PT-P900W Asset Tag</title>
  <style>
    @page { size: 22mm 36mm; margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      width: 22mm;
      height: 36mm;
      overflow: hidden;
      background: #fff;
    }
    .sheet {
      position: relative;
      width: 22mm;
      height: 35.6mm;
      overflow: hidden;
      margin: 0;
      padding: 0;
      break-after: avoid;
      page-break-after: avoid;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .sheet:not(:last-child) {
      height: 36mm;
      break-after: page;
      page-break-after: always;
    }
    .sheet img {
      position: absolute;
      left: 0;
      top: 0;
      width: 22mm;
      height: 36mm;
      display: block;
    }
  </style>
</head>
<body>${sheets}</body>
</html>`
}

/** Print Brother PT-P900W labels from the current page. The dialog closes back here. */
export async function printAssetLabels(labels: LabelPrintSheet[]) {
  const imageUrls = await Promise.all(labels.map(renderLabel))
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-120vw;top:0;width:22mm;height:36mm;border:0;'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    throw new Error('Could not open the print dialog')
  }
  doc.open()
  doc.write(labelHtml(imageUrls))
  doc.close()

  await new Promise<void>((resolve) => {
    const img = doc.querySelector('img')
    if (!img || img.complete) resolve()
    else img.addEventListener('load', () => resolve(), { once: true })
  })

  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.setTimeout(() => {
        frame.remove()
        window.focus()
        resolve()
      }, 250)
    }
    win.addEventListener('afterprint', finish, { once: true })
    win.focus()
    win.print()
    finish()
  })
}
