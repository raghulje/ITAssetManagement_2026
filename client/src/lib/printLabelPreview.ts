export function openBlankLabelPreview() {
  const preview = window.open('', 'qr-label-print', 'popup,width=560,height=720')
  if (!preview) return null
  preview.document.open()
  preview.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Preparing label…</p>')
  preview.document.close()
  return preview
}

/** Fills the preview and opens the browser print dialog (printer, or Save as PDF). */
export function showLabelPrintPreview(preview: Window, base64: string, mime = 'image/png') {
  const src = `data:${mime};base64,${base64}`
  preview.document.open()
  preview.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Print QR label</title>
  <style>
    @page { size: 36mm 30mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #e8eef5; color: #0f172a; font-family: Arial, sans-serif; }
    .toolbar { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 18px 16px 8px; }
    .toolbar p { margin: 0; font-size: 13px; color: #475569; text-align: center; max-width: 420px; }
    button { min-height: 40px; padding: 8px 18px; border: 0; border-radius: 8px; background: #0f766e; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
    .sheet { width: 36mm; height: 30mm; margin: 12px auto 24px; background: #fff; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12); }
    .sheet img { width: 36mm; height: 30mm; display: block; }
    @media print {
      html, body { background: #fff; }
      .toolbar { display: none !important; }
      .sheet { margin: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <p>36 × 30 mm label. Choose the printer in the print window. Use Actual size if the dialog offers it.</p>
    <button type="button" onclick="window.print()">Print</button>
  </div>
  <div class="sheet">
    <img id="label" alt="QR label" src="${src}" />
  </div>
  <script>
    const img = document.getElementById('label');
    function openPrint() { window.focus(); window.print(); }
    if (img.complete) openPrint();
    else img.onload = openPrint;
  </script>
</body>
</html>`)
  preview.document.close()
  preview.focus()
}
