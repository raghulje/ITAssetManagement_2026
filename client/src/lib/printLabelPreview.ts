export type LabelPrintSheet = {
  qr_base64: string
  lines: string[]
}

/** ~600 dpi. One sheet is 22mm wide. The picture is 33mm tall so it stays inside a 36mm page. */
const PX_PER_MM = 24
const LABEL_WIDTH_MM = 22
const LABEL_HEIGHT_MM = 33

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
  const width = mm(LABEL_WIDTH_MM)
  const height = mm(LABEL_HEIGHT_MM)
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

const PRINT_STYLE = `
@page { size: 22mm 36mm; margin: 0 !important; }
@media screen {
  #qr-label-print { display: none !important; }
}
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    height: auto !important;
    overflow: hidden !important;
  }
  body > *:not(#qr-label-print) { display: none !important; }
  #qr-label-print {
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
    width: ${LABEL_WIDTH_MM}mm !important;
    overflow: hidden !important;
  }
  #qr-label-print img {
    display: block !important;
    width: ${LABEL_WIDTH_MM}mm !important;
    height: ${LABEL_HEIGHT_MM}mm !important;
    margin: 0 !important;
    padding: 0 !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    break-after: avoid !important;
    page-break-after: avoid !important;
  }
}
`

/** Print one label from this page. The picture is shorter than the sheet, so no blank page is added. */
export async function printAssetLabels(labels: LabelPrintSheet[]) {
  const imageUrls = await Promise.all(labels.map(renderLabel))
  const host = document.createElement('div')
  host.id = 'qr-label-print'
  host.innerHTML = imageUrls.map((src) => `<img alt="" src="${src}" />`).join('')
  const style = document.createElement('style')
  style.textContent = PRINT_STYLE
  document.head.appendChild(style)
  document.body.appendChild(host)

  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      host.remove()
      style.remove()
      resolve()
    }
    window.addEventListener('afterprint', finish, { once: true })
    window.print()
    finish()
  })
}
