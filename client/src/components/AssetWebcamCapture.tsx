import { useEffect, useRef, useState } from 'react'
import {
  locationHelpMessage,
  queryLocationPermission,
  readPrecisePosition,
  requestLocationAccess,
  type PrecisePosition,
} from '../lib/preciseLocation'

type Props = {
  open: boolean
  assetLabel?: string
  /** GPS acquired on the same user gesture that opened this dialog */
  initialPos?: PrecisePosition | null
  /** After shutter: show ✕ / ✓ / + review before committing */
  confirmShot?: boolean
  onClose: () => void
  onCapture: (file: File, position: PrecisePosition | null) => void
}

type PendingShot = {
  file: File
  previewUrl: string
  pos: PrecisePosition | null
}

function formatCoord(n: number, kind: 'lat' | 'lng') {
  const hemi = kind === 'lat' ? (n >= 0 ? 'N' : 'S') : (n >= 0 ? 'E' : 'W')
  return `${Math.abs(n).toFixed(7)}° ${hemi}`
}

export default function AssetWebcamCapture({
  open,
  assetLabel,
  initialPos = null,
  confirmShot = false,
  onClose,
  onCapture,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const posRef = useRef<PrecisePosition | null>(initialPos)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<PrecisePosition | null>(initialPos)
  const [locStatus, setLocStatus] = useState(initialPos ? `±${Math.round(initialPos.accuracyM)} m` : 'Acquiring GPS…')
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')
  const [pending, setPending] = useState<PendingShot | null>(null)
  const mirrored = facing === 'user'

  useEffect(() => {
    posRef.current = pos
  }, [pos])

  useEffect(() => {
    if (!open) {
      setPending((p) => {
        if (p) URL.revokeObjectURL(p.previewUrl)
        return null
      })
      return
    }
    let cancelled = false
    setError('')
    setReady(false)
    setPending(null)
    setPos(initialPos ?? null)
    posRef.current = initialPos ?? null
    setLocStatus(initialPos ? `±${Math.round(initialPos.accuracyM)} m` : 'Acquiring GPS…')

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API not available in this browser')
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
          streamRef.current = null
        }
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: facing },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          })
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          })
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.setAttribute('playsinline', 'true')
          video.setAttribute('webkit-playsinline', 'true')
          video.srcObject = stream
          await new Promise<void>((resolve) => {
            if (video.readyState >= 2 && video.videoWidth > 0) {
              resolve()
              return
            }
            const onMeta = () => {
              video.removeEventListener('loadedmetadata', onMeta)
              resolve()
            }
            video.addEventListener('loadedmetadata', onMeta)
          })
          await video.play()
        }
        setReady(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Camera permission denied')
        setReady(false)
      }
    }

    void startCamera()

    let watchId: number | null = null

    void (async () => {
      const perm = await queryLocationPermission()
      if (cancelled) return
      if (perm === 'denied' || perm === 'insecure' || perm === 'unsupported') {
        if (!posRef.current) setLocStatus(locationHelpMessage(perm))
        return
      }
      if (!posRef.current) {
        const p = await readPrecisePosition({ targetAccuracyM: 40, timeoutMs: 20000, maximumAgeMs: 15_000 })
        if (cancelled) return
        if (p) {
          setPos(p)
          posRef.current = p
          setLocStatus(`±${Math.round(p.accuracyM)} m`)
        } else {
          setLocStatus('Tap “Enable GPS” below, then take photo')
        }
      }
    })()

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (g) => {
          if (cancelled) return
          const next: PrecisePosition = {
            latitude: g.coords.latitude,
            longitude: g.coords.longitude,
            accuracyM: g.coords.accuracy,
            altitude: g.coords.altitude,
            capturedAt: new Date(g.timestamp || Date.now()),
            source: 'device',
          }
          setPos((prev) => {
            const better = !prev || next.accuracyM <= prev.accuracyM
            if (better) posRef.current = next
            return better ? next : prev
          })
          setLocStatus(`±${Math.round(g.coords.accuracy)} m`)
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 25000 },
      )
    }

    return () => {
      cancelled = true
      if (watchId != null) {
        try { navigator.geolocation.clearWatch(watchId) } catch { /* ignore */ }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facing])

  if (!open) return null

  async function enableGps() {
    setLocStatus('Requesting location…')
    const res = await requestLocationAccess()
    if (res.position) {
      setPos(res.position)
      posRef.current = res.position
      setLocStatus(res.message)
    } else {
      setLocStatus(res.message)
    }
  }

  async function snap() {
    const video = videoRef.current
    if (!video || !ready || busy || pending) return
    setBusy(true)
    try {
      let usePos = posRef.current
      if (!usePos) {
        setLocStatus('Getting GPS…')
        usePos = await readPrecisePosition({ targetAccuracyM: 80, timeoutMs: 12000, maximumAgeMs: 60_000 })
        if (usePos) {
          setPos(usePos)
          posRef.current = usePos
          setLocStatus(`±${Math.round(usePos.accuracyM)} m`)
        }
      }

      await new Promise((r) => requestAnimationFrame(() => r(undefined)))

      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) throw new Error('Camera not ready — try again')

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not capture frame')

      if (mirrored) {
        ctx.translate(w, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(video, 0, 0, w, h)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92))
      if (!blob) throw new Error('Could not encode photo')
      const file = new File([blob], `webcam-${Date.now()}.jpg`, { type: 'image/jpeg' })

      if (confirmShot) {
        setPending({
          file,
          previewUrl: URL.createObjectURL(blob),
          pos: usePos,
        })
      } else {
        onCapture(file, usePos)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed')
    } finally {
      setBusy(false)
    }
  }

  function discardPending() {
    setPending((p) => {
      if (p) URL.revokeObjectURL(p.previewUrl)
      return null
    })
  }

  function keepAndContinue() {
    if (!pending) return
    const shot = pending
    setPending(null)
    URL.revokeObjectURL(shot.previewUrl)
    onCapture(shot.file, shot.pos)
  }

  function keepAndDone() {
    if (!pending) return
    const shot = pending
    setPending(null)
    URL.revokeObjectURL(shot.previewUrl)
    onCapture(shot.file, shot.pos)
    onClose()
  }

  return (
    <div className="vc-webcam-overlay" role="dialog" aria-modal="true" aria-label="Webcam capture">
      <div className="vc-webcam-panel">
        <header className="vc-webcam-head">
          <div>
            <strong>GPS camera</strong>
            <span>{assetLabel || 'Refex ITAM GPS capture'}</span>
          </div>
          <button type="button" className="btn btn-default btn-sm" onClick={onClose} disabled={busy}>
            Done
          </button>
        </header>

        <div className="vc-webcam-stage">
          {error ? <div className="vc-webcam-error">{error}</div> : null}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`vc-webcam-video${mirrored ? ' is-mirrored' : ''}${pending ? ' is-hidden' : ''}`}
          />
          {pending ? (
            <img src={pending.previewUrl} alt="Captured" className="vc-webcam-preview" />
          ) : null}
          {!pending ? (
            <div className="vc-webcam-hud">
              <div className={`vc-webcam-gps${pos ? ' is-locked' : ' is-missing'}`}>
                <i className="fas fa-crosshairs" />
                {pos ? (
                  <>
                    <span>{formatCoord(pos.latitude, 'lat')}</span>
                    <span>{formatCoord(pos.longitude, 'lng')}</span>
                    <em>{locStatus}</em>
                  </>
                ) : (
                  <em>{locStatus}</em>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {pending ? (
          <footer className="vc-webcam-review">
            <button type="button" className="vc-review-btn vc-review-btn--discard" onClick={discardPending} aria-label="Discard">
              <i className="fas fa-times" />
            </button>
            <button type="button" className="vc-review-btn vc-review-btn--more" onClick={keepAndContinue} aria-label="Keep and take more">
              <i className="fas fa-plus" />
            </button>
            <button type="button" className="vc-review-btn vc-review-btn--keep" onClick={keepAndDone} aria-label="Keep photo">
              <i className="fas fa-check" />
            </button>
            <p className="vc-webcam-hint">✕ Discard · + Keep &amp; add more · ✓ Keep &amp; finish</p>
          </footer>
        ) : (
          <>
            <footer className="vc-webcam-foot">
              {!pos ? (
                <button type="button" className="btn btn-warning btn-sm" disabled={busy} onClick={() => void enableGps()}>
                  <i className="fas fa-map-marker-alt" /> Enable GPS
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-default btn-sm"
                disabled={busy}
                onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
              >
                <i className="fas fa-sync-alt" /> Flip
              </button>
              <button type="button" className="btn btn-primary vc-webcam-shutter" disabled={!ready || busy} onClick={() => void snap()}>
                {busy ? 'Capturing…' : 'Capture'}
              </button>
            </footer>
            <p className="vc-webcam-hint">
              {!pos
                ? 'Allow Location so photos are GPS-stamped.'
                : confirmShot
                  ? 'Capture a shot, then use + for more or ✓ when finished.'
                  : 'Each tap saves — camera stays open for more shots.'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
