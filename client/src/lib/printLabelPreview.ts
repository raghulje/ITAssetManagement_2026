export type LabelPrintSheet = {
  qr_base64: string
  lines: string[]
}

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function labelHtml(labels: LabelPrintSheet[]) {
  const sheets = labels.map((label) => {
    const src = `data:image/png;base64,${label.qr_base64}`
    const rows = label.lines
      .filter((line) => String(line || '').trim())
      .map((line, index) => `<div class="text-row${index === 0 ? ' is-model' : ''}">${esc(line)}</div>`)
      .join('')
    return `<div class="label">
      <div class="text-section">${rows}</div>
      <div class="qr-section"><img src="${src}" alt="" /></div>
    </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Brother PT-P900W Asset Tag</title>
  <style>
    @page { size: 22mm 36mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 22mm;
      background: #fff;
    }
    .label {
      position: relative;
      width: 22mm;
      height: 35.8mm;
      overflow: hidden;
      margin: 0;
      padding: 0;
      break-inside: avoid;
      page-break-inside: avoid;
      break-after: avoid;
      page-break-after: avoid;
    }
    .label:not(:last-child) {
      break-after: page;
      page-break-after: always;
    }
    .text-section {
      position: absolute;
      top: 1mm;
      left: 0.6mm;
      right: 0.6mm;
      bottom: 15mm;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 1.1mm;
      overflow: hidden;
    }
    .text-row {
      margin: 0;
      padding: 0;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      font-family: Arial, sans-serif;
      font-size: 7pt;
      font-weight: 700;
      line-height: 1.15;
      color: #000;
      white-space: nowrap;
    }
    .text-row.is-model {
      white-space: normal;
      overflow-wrap: break-word;
      max-height: 18mm;
    }
    .qr-section {
      position: absolute;
      left: 5mm;
      bottom: 1.4mm;
      width: 12mm;
      height: 12mm;
    }
    .qr-section img {
      display: block;
      width: 12mm;
      height: 12mm;
      transform: rotate(-90deg);
    }
  </style>
</head>
<body>${sheets}</body>
</html>`
}

/** Print Brother PT-P900W labels from the current page. The dialog closes back here. */
export function printAssetLabels(labels: LabelPrintSheet[]) {
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
  doc.write(labelHtml(labels))
  doc.close()

  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    window.setTimeout(() => {
      frame.remove()
      window.focus()
    }, 150)
  }
  win.addEventListener('afterprint', finish)
  window.addEventListener('afterprint', finish)

  const go = () => {
    win.focus()
    win.print()
    finish()
  }
  const img = doc.querySelector('img')
  if (!img || img.complete) go()
  else img.addEventListener('load', go, { once: true })
}
