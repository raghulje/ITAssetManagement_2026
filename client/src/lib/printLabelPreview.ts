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

const MM_TO_PT = 72 / 25.4
const PAGE_W_PT = 36 * MM_TO_PT
const PAGE_H_PT = 22 * MM_TO_PT

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

function concatBytes(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function deflateBytes(data: Uint8Array) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** One PDF page per label. The page box is the sticker, so the printer cannot add a blank sheet. */
async function buildLabelsPdf(canvases: HTMLCanvasElement[]) {
  const enc = new TextEncoder()
  const images = await Promise.all(canvases.map(async (canvas) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not read the label')
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const rgb = new Uint8Array(canvas.width * canvas.height * 3)
    for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
      rgb[j] = pixels[i]
      rgb[j + 1] = pixels[i + 1]
      rgb[j + 2] = pixels[i + 2]
    }
    return { w: canvas.width, h: canvas.height, bytes: await deflateBytes(rgb) }
  }))

  const count = images.length
  const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')
  const pieces: Uint8Array[] = []
  const objectOffsets: number[] = []
  let cursor = 0
  const add = (text: string, binary?: Uint8Array) => {
    if (/^\d+ 0 obj/.test(text)) objectOffsets.push(cursor)
    const encoded = enc.encode(text)
    pieces.push(encoded)
    cursor += encoded.length
    if (binary) {
      pieces.push(binary)
      cursor += binary.length
    }
  }

  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  add(`2 0 obj\n<< /Type /Pages /Count ${count} /Kids [${kids}] >>\nendobj\n`)

  images.forEach((image, i) => {
    const pageId = 3 + i * 3
    const contentId = pageId + 1
    const imageId = pageId + 2
    const commands = `q ${PAGE_W_PT.toFixed(2)} 0 0 ${(-PAGE_H_PT).toFixed(2)} 0 ${PAGE_H_PT.toFixed(2)} cm /Im${i} Do Q\n`
    add(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W_PT.toFixed(2)} ${PAGE_H_PT.toFixed(2)}] /CropBox [0 0 ${PAGE_W_PT.toFixed(2)} ${PAGE_H_PT.toFixed(2)}] /Contents ${contentId} 0 R /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> >>\nendobj\n`,
    )
    add(`${contentId} 0 obj\n<< /Length ${commands.length} >>\nstream\n${commands}endstream\nendobj\n`)
    add(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.bytes.length} >>\nstream\n`,
      image.bytes,
    )
    add('\nendstream\nendobj\n')
  })

  const header = enc.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')
  const offsets = objectOffsets.map((offset) => offset + header.length)
  const startxref = header.length + cursor
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`
  return new Blob([header, concatBytes(pieces), enc.encode(xref)], { type: 'application/pdf' })
}

function printPdf(pdf: Blob) {
  const url = URL.createObjectURL(pdf)
  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'Asset label print')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:0;top:0;width:36mm;height:22mm;border:0;z-index:-1;'
  iframe.src = url
  document.body.appendChild(iframe)

  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    window.setTimeout(() => {
      iframe.remove()
      URL.revokeObjectURL(url)
    }, 400)
    window.focus()
  }

  iframe.onload = () => {
    const frame = iframe.contentWindow
    if (!frame) {
      iframe.remove()
      URL.revokeObjectURL(url)
      return
    }
    frame.addEventListener('afterprint', finish)
    window.setTimeout(() => {
      frame.focus()
      frame.print()
      window.setTimeout(finish, 120000)
    }, 200)
  }
}

/** Print Brother PT-P900W labels from the current page, then leave the user there. */
export async function printAssetLabels(labels: LabelPrintSheet[]) {
  const canvases = await Promise.all(labels.map((label) => renderLabelCanvas(label)))
  printPdf(await buildLabelsPdf(canvases))
}
