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

export function openBlankLabelPreview() {
  const preview = window.open('', 'qr-label-print', 'popup,width=560,height=720')
  if (!preview) return null
  preview.document.open()
  preview.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Preparing label…</p>')
  preview.document.close()
  return preview
}

/** Brother PT-P900W page from tasks/test.html, then the browser print dialog. */
export function showLabelPrintPreview(preview: Window, labels: LabelPrintSheet[]) {
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
        <div class="text-section">
          ${rows}
        </div>
      </div>
    </div>`
  }).join('')

  preview.document.open()
  preview.document.write(`<!DOCTYPE html>
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
      left: 0;
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
      line-height: 1.15;
      color: #000;
      white-space: nowrap;
      overflow: hidden;
    }
    .text-row.is-model {
      white-space: normal;
      overflow: visible;
      overflow-wrap: break-word;
    }
    .toolbar {
      display: none;
    }
    @media screen {
      html, body {
        width: auto;
        height: auto;
        overflow: auto;
        background: #e8eef5;
      }
      .toolbar {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 18px 16px 0;
      }
      .toolbar p {
        margin: 0;
        font-size: 13px;
        font-weight: 400;
        color: #475569;
        text-align: center;
        max-width: 420px;
      }
      .toolbar button {
        min-height: 40px;
        padding: 8px 18px;
        border: 0;
        border-radius: 8px;
        background: #0f766e;
        color: #fff;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
      }
      .label {
        transform: scale(3);
        transform-origin: top center;
        margin: 28px auto 110mm;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
      }
    }
    @media print {
      .toolbar { display: none !important; }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff;
        width: 22mm !important;
        height: auto !important;
        overflow: hidden;
      }
      .sheets {
        width: 22mm;
      }
      .label {
        width: 22mm;
        height: 36mm;
        overflow: hidden !important;
        transform: none !important;
        margin: 0 !important;
        box-shadow: none !important;
        break-inside: avoid;
        page-break-inside: avoid;
        break-after: avoid;
        page-break-after: avoid;
      }
      .label:not(:last-child) {
        break-after: page;
        page-break-after: always;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <p>Brother PT-P900W label, 22 × 36 mm. Choose the printer, then print at actual size.</p>
    <button type="button" onclick="window.print()">Print</button>
  </div>
  <div class="sheets">${sheets}</div>
  <script>
    const img = document.querySelector('.qr-section img');
    function openPrint() { window.focus(); window.print(); }
    if (!img || img.complete) openPrint();
    else img.onload = openPrint;
  </script>
</body>
</html>`)
  preview.document.close()
  preview.focus()
}
