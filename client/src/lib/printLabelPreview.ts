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

/** Brother PT-P900W page from tasks/test.html. */
function labelHtml(labels: LabelPrintSheet[]) {
  const sheets = labels.map((label) => {
    const src = `data:image/png;base64,${label.qr_base64}`
    const rows = label.lines
      .filter((line) => String(line || '').trim())
      .map((line, index) => `<div class="text-row${index === 0 ? ' is-model' : ''}">${esc(line)}</div>`)
      .join('')
    return `<div class="label">
      <div class="label-content">
        <div class="qr-section">
          <img src="${src}" alt="Asset QR Code" />
        </div>
        <div class="text-section">${rows}</div>
      </div>
    </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Brother PT-P900W Asset Tag</title>
  <style>
    @page {
      size: 22mm 36mm;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 22mm;
      height: 36mm;
      overflow: hidden;
      font-family: Arial, sans-serif;
    }
    .label {
      position: relative;
      width: 22mm;
      height: 36mm;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    .label-content {
      position: absolute;
      top: 0;
      width: 36mm;
      height: 22mm;
      transform-origin: top left;
      transform: translateY(36mm) rotate(-90deg);
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 1mm;
      padding: 1mm;
    }
    .qr-section {
      width: 12mm;
      height: 12mm;
      flex: 0 0 12mm;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qr-section img {
      display: block;
      width: 12mm;
      height: 12mm;
      object-fit: contain;
    }
    .text-section {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: 1.2mm;
      overflow: hidden;
    }
    .text-row {
      width: 100%;
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
      font-size: 7pt;
      font-weight: bold;
      line-height: 1.1;
      color: #000;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: clip;
    }
    .text-row.is-model {
      white-space: normal;
      overflow-wrap: break-word;
      text-overflow: unset;
    }
    @media print {
      html, body, .label {
        margin: 0;
        padding: 0;
      }
    }
  </style>
</head>
<body>${sheets}</body>
</html>`
}

/** Print the Brother label document. It stays until the print dialog closes. */
export function printAssetLabels(labels: LabelPrintSheet[]) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:22mm;height:36mm;border:0;left:0;top:0;'
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

  const cleanup = () => {
    frame.remove()
    window.focus()
  }
  const go = () => {
    win.addEventListener('afterprint', cleanup, { once: true })
    win.focus()
    win.print()
  }
  const img = doc.querySelector('img')
  if (!img || img.complete) go()
  else img.addEventListener('load', go, { once: true })
}
