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
    return `<section class="label">
      <div class="copy">${rows}</div>
      <div class="qr"><img src="${src}" alt="" /></div>
    </section>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Asset label</title>
  <style>
    @page { size: 22mm 36mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 22mm;
      background: #fff;
    }
    body.single {
      height: 36mm;
      overflow: hidden;
    }
    .label {
      width: 22mm;
      height: 36mm;
      max-width: 22mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      gap: 0.8mm;
      padding: 1mm;
      background: #fff;
      break-inside: avoid;
      page-break-inside: avoid;
      break-after: avoid;
      page-break-after: avoid;
    }
    .label:not(:last-of-type) {
      break-after: page;
      page-break-after: always;
    }
    .copy {
      flex: 1 1 auto;
      min-height: 0;
      width: 20mm;
      max-width: 20mm;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: 0.7mm;
      writing-mode: sideways-lr;
      overflow: hidden;
    }
    .text-row {
      margin: 0;
      max-width: 100%;
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
    }
    .qr {
      width: 12mm;
      height: 12mm;
      flex: 0 0 12mm;
    }
    .qr img {
      display: block;
      width: 12mm;
      height: 12mm;
    }
  </style>
</head>
<body class="${labels.length === 1 ? 'single' : ''}">${sheets}</body>
</html>`
}

/** Print Brother PT-P900W labels from the current page, then leave the user there. */
export function printAssetLabels(labels: LabelPrintSheet[]) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'Asset label print')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:-240mm;top:0;width:22mm;height:36mm;border:0;opacity:1;'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  const frame = iframe.contentWindow
  if (!doc || !frame) {
    iframe.remove()
    throw new Error('Could not open the print dialog')
  }

  doc.open()
  doc.write(labelHtml(labels))
  doc.close()

  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    window.setTimeout(() => iframe.remove(), 250)
    window.focus()
  }

  frame.addEventListener('afterprint', finish)

  const start = () => {
    frame.focus()
    frame.print()
    window.setTimeout(finish, 120000)
  }

  const img = doc.querySelector('img')
  if (img && !img.complete) img.addEventListener('load', start, { once: true })
  else window.setTimeout(start, 50)
}
