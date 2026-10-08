import { useEffect, useRef, useState, type ChangeEvent } from 'react'

const MAX_MS = 30_000
const MAX_DURATION_SEC = 45
const MIN_MS = 2_000
const MIN_BLOB_BYTES = 8_192
const TIMESLICE_MS = 1_000

type Props = {
  open: boolean
  assetLabel?: string
  onClose: () => void
  onCapture: (file: File) => void
}

type PendingVideo = {
  file: File
  previewUrl: string
  mimeType: string
}

function isAppleMobile() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  if (isAppleMobile()) return true
  return /Android/i.test(navigator.userAgent) && /Mobile/i.test(navigator.userAgent)
}

/** Phone browsers often produce MediaRecorder blobs that won't preview — use native camera instead. */
function preferNativeCapture() {
  return isMobileDevice()
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = isAppleMobile()
    ? ['video/mp4', 'video/webm;codecs=vp8', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function extForMime(mime: string) {
  const lower = mime.toLowerCase()
  if (lower.includes('mp4') || lower.includes('quicktime')) return '.mp4'
  if (lower.includes('webm')) return '.webm'
  return '.mp4'
}

function createRecorder(stream: MediaStream, preferredMime: string) {
  if (preferredMime) {
    try {
      return new MediaRecorder(stream, { mimeType: preferredMime })
    } catch {
      // fall through
    }
  }
  return new MediaRecorder(stream)
}

function probeVideoFile(file: File): Promise<{ ok: boolean; durationSec: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.playsInline = true
    video.muted = true

    const finish = (ok: boolean, durationSec = 0) => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      resolve({ ok, durationSec })
    }

    video.onloadedmetadata = () => {
      const durationSec = Number.isFinite(video.duration) ? video.duration : 0
      finish(durationSec > 0, durationSec)
    }
    video.onerror = () => finish(false)
    video.src = url
  })
}

async function validateVideoFile(file: File): Promise<string | null> {
  if (file.size < MIN_BLOB_BYTES) {
    return 'Video file is empty or too small — please record again'
  }
  const { ok, durationSec } = await probeVideoFile(file)
  if (!ok) {
    return 'This video cannot be played on this device — please record again'
  }
  if (durationSec < MIN_MS / 1000) {
    return 'Video is too short — record at least 2 seconds'
  }
  if (durationSec > MAX_DURATION_SEC) {
    return `Video is too long (${Math.round(durationSec)}s) — please keep it under 30 seconds`
  }
  return null
}

function normalizeVideoFile(file: File) {
  const mime = file.type || 'video/mp4'
  const ext = extForMime(mime)
  const name = file.name && /\.\w+$/.test(file.name)
    ? file.name
    : `walkaround-${Date.now()}${ext}`
  if (file.name === name && file.type === mime) return file
  return new File([file], name, { type: mime, lastModified: file.lastModified })
}

export default function AssetVideoCapture({ open, assetLabel, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef('')
  const startedAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const nativeMode = preferNativeCapture()

  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [pending, setPending] = useState<PendingVideo | null>(null)
  const [facing, setFacing] = useState<'user' | 'environment'>('environment')
  const mirrored = facing === 'user'

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
    setRecording(false)
    setBusy(false)
    setElapsedMs(0)
    setPending(null)

    if (nativeMode) {
      setReady(true)
      return () => {
        cancelled = true
      }
    }

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
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          })
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
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
          video.muted = true
          await video.play()
        }
        setReady(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Camera permission denied')
        setReady(false)
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      if (timerRef.current) window.clearInterval(timerRef.current)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop() } catch { /* ignore */ }
      }
      recorderRef.current = null
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [open, facing, nativeMode])

  if (!open) return null

  async function acceptFile(raw: File) {
    setBusy(true)
    setError('')
    const file = normalizeVideoFile(raw)
    const validationError = await validateVideoFile(file)
    if (validationError) {
      setBusy(false)
      setError(validationError)
      setPending(null)
      return
    }
    const previewUrl = URL.createObjectURL(file)
    setPending({
      file,
      previewUrl,
      mimeType: file.type || 'video/mp4',
    })
    setBusy(false)
    setError('')
  }

  async function finalizeRecording(recorder: MediaRecorder) {
    const mimeType = recorder.mimeType || mimeRef.current || 'video/webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    if (blob.size < MIN_BLOB_BYTES) {
      setError('Recording failed or was too short. Hold Record for at least 2 seconds, then Stop.')
      setPending(null)
      setBusy(false)
      return
    }
    const file = new File(
      [blob],
      `walkaround-${Date.now()}${extForMime(mimeType)}`,
      { type: mimeType },
    )
    await acceptFile(file)
  }

  function stopRecording() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      setRecording(false)
      return
    }

    const recordedMs = Date.now() - startedAtRef.current
    if (recordedMs < MIN_MS) {
      setError('Please record for at least 2 seconds before stopping.')
      return
    }

    setRecording(false)
    setBusy(true)
    try {
      if (typeof recorder.requestData === 'function') recorder.requestData()
    } catch { /* ignore */ }
    recorder.stop()
  }

  function startRecording() {
    const stream = streamRef.current
    if (!stream || recording || pending || busy) return
    const preferredMime = pickMime()
    if (!preferredMime && typeof MediaRecorder === 'undefined') {
      setError('Video recording is not supported in this browser')
      return
    }
    setError('')
    chunksRef.current = []
    mimeRef.current = preferredMime

    let recorder: MediaRecorder
    try {
      recorder = createRecorder(stream, preferredMime)
    } catch {
      setError('Could not start video recorder on this device')
      return
    }

    mimeRef.current = recorder.mimeType || preferredMime || 'video/webm'
    recorderRef.current = recorder
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onerror = () => {
      setError('Recording error — please try again')
      setRecording(false)
      setBusy(false)
    }
    recorder.onstop = () => {
      void finalizeRecording(recorder)
      recorderRef.current = null
    }

    try {
      recorder.start(TIMESLICE_MS)
    } catch {
      setError('Could not start recording')
      recorderRef.current = null
      return
    }

    startedAtRef.current = Date.now()
    setRecording(true)
    setElapsedMs(0)
    timerRef.current = window.setInterval(() => {
      setElapsedMs((ms) => {
        const next = ms + 250
        if (next >= MAX_MS) stopRecording()
        return Math.min(next, MAX_MS)
      })
    }, 250)
  }

  function openNativePicker() {
    setError('')
    fileInputRef.current?.click()
  }

  async function onNativeFileChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0]
    e.target.value = ''
    if (!raw) return
    await acceptFile(raw)
  }

  const secondsLeft = Math.max(0, Math.ceil((MAX_MS - elapsedMs) / 1000))

  return (
    <div className="vc-webcam-overlay" role="dialog" aria-modal="true" aria-label="Walkaround video capture">
      <div className="vc-webcam-panel">
        <header className="vc-webcam-head">
          <div>
            <strong>30s asset video</strong>
            <span>{assetLabel || 'Record a slow walk-around of the asset (up to 30 seconds)'}</span>
          </div>
          <button type="button" className="btn btn-default btn-sm" onClick={onClose} disabled={recording || busy}>
            Done
          </button>
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="vc-native-video-input"
          onChange={(e) => { void onNativeFileChange(e) }}
        />

        <div className="vc-webcam-stage">
          {error ? <div className="vc-webcam-error">{error}</div> : null}
          {pending ? (
            <video
              key={pending.previewUrl}
              src={pending.previewUrl}
              className="vc-webcam-preview vc-webcam-preview--playback"
              controls
              playsInline
              preload="auto"
              onError={() => setError('Could not play preview — tap Discard and record again')}
            />
          ) : nativeMode ? (
            <div className="vc-native-video-prompt">
              <i className="fas fa-video vc-native-video-prompt__icon" aria-hidden />
              <p>Use your phone camera to record up to <strong>30 seconds</strong>.</p>
              <p className="vc-native-video-prompt__sub">
                Walk slowly around the asset and capture all sides.
              </p>
              {busy ? <div className="vc-native-video-prompt__busy">Checking video…</div> : null}
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`vc-webcam-video${mirrored ? ' is-mirrored' : ''}${recording ? ' is-recording' : ''}`}
              />
              {recording ? (
                <div className="vc-video-timer" aria-live="polite">
                  <span className="vc-video-timer__dot" aria-hidden />
                  Recording · {secondsLeft}s left
                </div>
              ) : null}
            </>
          )}
        </div>

        {pending ? (
          <footer className="vc-webcam-review">
            <button
              type="button"
              className="vc-review-btn vc-review-btn--discard"
              onClick={() => {
                setPending((p) => {
                  if (p) URL.revokeObjectURL(p.previewUrl)
                  return null
                })
                setError('')
              }}
              aria-label="Discard video"
            >
              <i className="fas fa-times" />
            </button>
            <button
              type="button"
              className="vc-review-btn vc-review-btn--keep"
              disabled={busy}
              onClick={() => {
                if (!pending || pending.file.size < MIN_BLOB_BYTES) {
                  setError('Video file is empty — please record again')
                  return
                }
                onCapture(pending.file)
                URL.revokeObjectURL(pending.previewUrl)
                setPending(null)
                onClose()
              }}
              aria-label="Use this video"
            >
              <i className="fas fa-check" />
            </button>
            <p className="vc-webcam-hint">✕ Discard · ✓ Use this video</p>
          </footer>
        ) : nativeMode ? (
          <footer className="vc-webcam-foot">
            <button
              type="button"
              className="btn btn-primary vc-webcam-shutter"
              disabled={!ready || busy}
              onClick={openNativePicker}
            >
              {busy ? 'Checking video…' : 'Open camera & record'}
            </button>
            <p className="vc-webcam-hint">
              Your phone&apos;s camera app opens for recording. When finished, confirm the video here before submitting.
            </p>
          </footer>
        ) : (
          <footer className="vc-webcam-foot">
            <button
              type="button"
              className="btn btn-default btn-sm"
              disabled={recording || busy}
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            >
              <i className="fas fa-sync-alt" /> Flip
            </button>
            {recording ? (
              <button type="button" className="btn btn-danger vc-webcam-shutter" onClick={stopRecording}>
                Stop ({secondsLeft}s)
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary vc-webcam-shutter"
                disabled={!ready || busy}
                onClick={startRecording}
              >
                Record 30s video
              </button>
            )}
            <button
              type="button"
              className="btn btn-default btn-sm"
              disabled={recording || busy}
              onClick={openNativePicker}
            >
              Upload / phone camera
            </button>
            <p className="vc-webcam-hint">
              Walk slowly around the asset. Record at least 2 seconds (up to 30s), then tap Stop and ✓ Use this video.
            </p>
          </footer>
        )}
      </div>
    </div>
  )
}
