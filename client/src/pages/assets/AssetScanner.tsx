import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { markAssetScanSession, tokenFromQrText } from '../../lib/assetScan'

export default function AssetScanner() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const [starting, setStarting] = useState(true)
  const opened = useRef(false)

  const openToken = (raw: string) => {
    if (opened.current) return
    const token = tokenFromQrText(raw)
    if (!token) {
      setError('That code is not an asset label. Point the camera at the asset QR.')
      return
    }
    opened.current = true
    markAssetScanSession()
    navigate(`/asset/${encodeURIComponent(token)}?scan=1`)
  }

  useEffect(() => {
    markAssetScanSession()
    let cancelled = false
    let reader: { isScanning: boolean; stop: () => Promise<void> } | null = null

    const boot = (async () => {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (cancelled) return
      const cameras = await Html5Qrcode.getCameras()
      if (cancelled) return
      if (!cameras.length) {
        setError('No camera was found. Paste the QR link below.')
        setStarting(false)
        return
      }
      const preferred = cameras.find((c) => /back|rear|environment/i.test(c.label)) || cameras[0]
      const next = new Html5Qrcode('asset-qr-reader')
      reader = next
      await next.start(
        preferred.id,
        { fps: 8, qrbox: { width: 240, height: 240 } },
        (text) => { openToken(text) },
        () => undefined,
      )
      if (cancelled) {
        if (next.isScanning) await next.stop().catch(() => undefined)
        return
      }
      setStarting(false)
    })()

    boot.catch((e: unknown) => {
      if (cancelled) return
      const message = e instanceof Error ? e.message : 'Could not start the camera'
      setError(`${message}. Allow camera access, or paste the QR link below.`)
      setStarting(false)
    })

    return () => {
      cancelled = true
      void boot.finally(() => {
        if (reader?.isScanning) reader.stop().catch(() => undefined)
      })
    }
    // Camera starts once per visit. Next remounts this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitManual = (e: FormEvent) => {
    e.preventDefault()
    openToken(manual)
  }

  return (
    <AppLayout title="Scan asset" subtitle="Register or capture the next asset" backTo="/hardware">
      <div className="asset-scan-card">
        <p className="help-block" style={{ marginTop: 0 }}>
          Point the camera at the label. After this asset is submitted, Next opens the scanner again.
        </p>
        {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
        {starting ? <p className="text-muted">Starting camera…</p> : null}
        <div id="asset-qr-reader" className="asset-scan-reader" />
        <form onSubmit={submitManual} className="asset-scan-manual">
          <label htmlFor="asset-scan-manual">Or paste the QR link</label>
          <div className="label-lookup-row">
            <input
              id="asset-scan-manual"
              className="form-control"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="https://asset.refexone.com/asset/…"
            />
            <button type="submit" className="btn btn-theme">Open</button>
          </div>
        </form>
      </div>
    </AppLayout>
  )
}
