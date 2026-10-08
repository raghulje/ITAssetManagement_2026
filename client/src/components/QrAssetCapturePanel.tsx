import { useCallback, useEffect, useRef, useState } from 'react'
import { getApiBase } from '../api/baseUrl'
import { api, ApiError } from '../api/client'
import AssetVideoCapture from './AssetVideoCapture'
import AssetWebcamCapture from './AssetWebcamCapture'
import { readGpsFromImageFile } from '../lib/imageGps'
import { requestLocationAccess, type PrecisePosition } from '../lib/preciseLocation'
import { fetchGpsStaticMapUrl, stampGpsOnImage } from '../lib/stampGpsOnImage'

export type CaptureKind = 'photo' | 'serial' | 'video'

export type CaptureRow = {
  id: number
  kind: CaptureKind
  original_name?: string | null
  mime_type?: string | null
  captured_at?: string | null
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  url: string
}

export type StagedCapture = {
  localId: string
  kind: CaptureKind
  file: File
  previewUrl: string
  latitude?: number | null
  longitude?: number | null
  accuracyM?: number | null
  address?: string | null
  locality?: string | null
  capturedAt?: string | null
}

export const MIN_SIDE_PHOTOS = 4

export function firstPackStatus(items: Array<{ kind: string }>) {
  const sides = items.filter((i) => i.kind === 'photo').length
  const serial = items.filter((i) => i.kind === 'serial').length
  const videos = items.filter((i) => i.kind === 'video').length
  return {
    sides,
    serial,
    videos,
    sidesOk: sides >= MIN_SIDE_PHOTOS,
    serialOk: serial >= 1,
    videoOk: videos >= 1,
    complete: sides >= MIN_SIDE_PHOTOS && serial >= 1 && videos >= 1,
  }
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('refex_token')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function reverseGeocode(lat: number, lng: number) {
  try {
    return await api<{ address?: string; locality_header?: string; formatted_address?: string }>(
      `/geo/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
    )
  } catch {
    return null
  }
}

export async function stampCapturePhoto(file: File, pos: PrecisePosition | null, assetTag: string) {
  let usePos = pos
  if (!usePos) usePos = await readGpsFromImageFile(file)
  let address: string | null = null
  let locality: string | null = null
  let mapImageUrl: string | null = null
  if (usePos) {
    const geo = await reverseGeocode(usePos.latitude, usePos.longitude)
    address = geo?.address || geo?.formatted_address || null
    locality = geo?.locality_header || null
    mapImageUrl = await fetchGpsStaticMapUrl(usePos.latitude, usePos.longitude, 400)
  }
  const stamped = await stampGpsOnImage(file, {
    capturedAt: usePos?.capturedAt || new Date(),
    latitude: usePos?.latitude ?? null,
    longitude: usePos?.longitude ?? null,
    address,
    localityHeader: locality,
    accuracyM: usePos?.accuracyM,
    assetTag,
    mapImageUrl,
  })
  if (mapImageUrl) URL.revokeObjectURL(mapImageUrl)
  return { file: stamped, pos: usePos, address, locality }
}

export async function uploadQrCapture(
  token: string,
  file: File,
  kind: CaptureKind,
  meta?: {
    pos?: PrecisePosition | null
    address?: string | null
    locality?: string | null
    capturedAt?: string | null
  },
) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  const pos = meta?.pos
  if (pos) {
    fd.append('latitude', String(pos.latitude))
    fd.append('longitude', String(pos.longitude))
    fd.append('accuracy_m', String(pos.accuracyM))
    fd.append('captured_at', pos.capturedAt.toISOString().slice(0, 19).replace('T', ' '))
  } else if (meta?.capturedAt) {
    fd.append('captured_at', meta.capturedAt)
  }
  if (meta?.address) fd.append('address', meta.address)
  if (meta?.locality) fd.append('locality_header', meta.locality)
  const res = await fetch(`${getApiBase()}/public/assets/${encodeURIComponent(token)}/captures`, {
    method: 'POST',
    headers: authHeaders(),
    body: fd,
  })
  const data = await res.json().catch(() => ({})) as { messages?: string[] }
  if (!res.ok) throw new Error((data.messages || []).join(', ') || 'Upload failed')
}

type PhotoBucket = 'photo' | 'serial'

type Props = {
  token: string
  assetTag: string
  /** Stage files locally until the parent submits (blank-label first registration). */
  staged?: boolean
  stagedItems?: StagedCapture[]
  onStagedChange?: (items: StagedCapture[]) => void
}

export default function QrAssetCapturePanel({
  token,
  assetTag,
  staged = false,
  stagedItems = [],
  onStagedChange,
}: Props) {
  const [rows, setRows] = useState<CaptureRow[]>([])
  const [previews, setPreviews] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [webcamOpen, setWebcamOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [photoBucket, setPhotoBucket] = useState<PhotoBucket>('photo')
  const [gps, setGps] = useState<PrecisePosition | null>(null)
  const blobUrls = useRef<string[]>([])

  const liveItems = rows.map((r) => ({ kind: r.kind }))
  const pack = firstPackStatus(staged ? stagedItems : liveItems)
  const sideItems = staged ? stagedItems.filter((i) => i.kind === 'photo') : rows.filter((r) => r.kind === 'photo')
  const serialItems = staged ? stagedItems.filter((i) => i.kind === 'serial') : rows.filter((r) => r.kind === 'serial')
  const videoItems = staged ? stagedItems.filter((i) => i.kind === 'video') : rows.filter((r) => r.kind === 'video')

  const loadList = useCallback(async () => {
    if (staged) return
    const data = await api<{ rows: CaptureRow[] }>(`/public/assets/${encodeURIComponent(token)}/captures`)
    setRows((data.rows || []).map((r) => ({
      ...r,
      kind: r.kind === 'serial' || r.kind === 'video' ? r.kind : 'photo',
    })))
  }, [token, staged])

  useEffect(() => {
    void loadList().catch((e: Error) => setError(e.message || 'Could not load captures'))
  }, [loadList])

  useEffect(() => {
    if (staged) return
    let cancelled = false
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u))
    blobUrls.current = []
    const next: Record<number, string> = {}
    void (async () => {
      for (const row of rows) {
        try {
          const res = await fetch(`${getApiBase()}${row.url}`, { headers: authHeaders() })
          if (!res.ok) continue
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          blobUrls.current.push(url)
          if (cancelled) {
            URL.revokeObjectURL(url)
            continue
          }
          next[row.id] = url
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setPreviews(next)
    })()
    return () => {
      cancelled = true
    }
  }, [rows, staged])

  useEffect(() => () => {
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  function addStaged(item: StagedCapture) {
    onStagedChange?.([...stagedItems, item])
  }

  async function handlePhoto(file: File, pos: PrecisePosition | null, kind: PhotoBucket) {
    setBusy(true)
    setError('')
    try {
      const stamped = await stampCapturePhoto(file, pos, assetTag)
      if (staged) {
        addStaged({
          localId: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind,
          file: stamped.file,
          previewUrl: URL.createObjectURL(stamped.file),
          latitude: stamped.pos?.latitude ?? null,
          longitude: stamped.pos?.longitude ?? null,
          accuracyM: stamped.pos?.accuracyM ?? null,
          address: stamped.address,
          locality: stamped.locality,
          capturedAt: stamped.pos?.capturedAt.toISOString().slice(0, 19).replace('T', ' ') || null,
        })
        return
      }
      await uploadQrCapture(token, stamped.file, kind, {
        pos: stamped.pos,
        address: stamped.address,
        locality: stamped.locality,
      })
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save photo')
    } finally {
      setBusy(false)
    }
  }

  async function handleVideo(file: File) {
    setBusy(true)
    setError('')
    try {
      if (staged) {
        addStaged({
          localId: `video-${Date.now()}`,
          kind: 'video',
          file,
          previewUrl: URL.createObjectURL(file),
          latitude: gps?.latitude ?? null,
          longitude: gps?.longitude ?? null,
          accuracyM: gps?.accuracyM ?? null,
          capturedAt: gps?.capturedAt.toISOString().slice(0, 19).replace('T', ' ') || null,
        })
        return
      }
      await uploadQrCapture(token, file, 'video', { pos: gps })
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save video')
    } finally {
      setBusy(false)
    }
  }

  async function openCamera(bucket: PhotoBucket) {
    setError('')
    setPhotoBucket(bucket)
    const loc = await requestLocationAccess()
    if (loc.position) setGps(loc.position)
    else if (loc.message) setError(loc.message)
    setWebcamOpen(true)
  }

  async function openVideo() {
    setError('')
    const loc = await requestLocationAccess()
    if (loc.position) setGps(loc.position)
    setVideoOpen(true)
  }

  async function removeLive(id: number) {
    if (!window.confirm('Delete this capture?')) return
    setBusy(true)
    try {
      await api(`/public/assets/${encodeURIComponent(token)}/captures/${id}`, { method: 'DELETE' })
      await loadList()
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  function removeStaged(localId: string) {
    const gone = stagedItems.find((i) => i.localId === localId)
    if (gone) URL.revokeObjectURL(gone.previewUrl)
    onStagedChange?.(stagedItems.filter((i) => i.localId !== localId))
  }

  const cameraLabel = photoBucket === 'serial'
    ? `${assetTag} · serial number`
    : `${assetTag} · all sides`

  return (
    <section className="qr-capture-panel">
      <header className="qr-capture-panel__head">
        <div>
          <h2>First-time field capture</h2>
          <p>Capture all sides of the asset, photograph the serial number, and record a 30-second video. These are required to finish registration.</p>
        </div>
      </header>

      <ul className="qr-capture-req">
        <li className={pack.sidesOk ? 'is-done' : ''}>
          All sides — {pack.sides}/{MIN_SIDE_PHOTOS} photos
        </li>
        <li className={pack.serialOk ? 'is-done' : ''}>
          Serial number photo — {pack.serialOk ? 'captured' : 'required'}
        </li>
        <li className={pack.videoOk ? 'is-done' : ''}>
          30-second video — {pack.videoOk ? 'captured' : 'required'}
        </li>
      </ul>
      {error ? <p className="text-danger">{error}</p> : null}
      {busy ? <p className="help-block">Saving…</p> : null}

      <div className="qr-capture-block">
        <div className="qr-capture-block__head">
          <h3 className="qr-capture-panel__sub">All sides ({pack.sides}/{MIN_SIDE_PHOTOS})</h3>
          <button type="button" className="btn btn-theme btn-sm" disabled={busy} onClick={() => { void openCamera('photo') }}>
            <i className="fas fa-camera" /> Capture all sides
          </button>
        </div>
        <p className="help-block">Walk around the asset and take at least 4 GPS-stamped photos (front, back, and both sides).</p>
        <Gallery
          staged={staged}
          items={sideItems}
          previews={previews}
          busy={busy}
          empty="No side photos yet."
          onRemoveStaged={removeStaged}
          onRemoveLive={removeLive}
        />
      </div>

      <div className="qr-capture-block">
        <div className="qr-capture-block__head">
          <h3 className="qr-capture-panel__sub">Serial number ({pack.serialOk ? '1/1' : '0/1'})</h3>
          <button type="button" className="btn btn-theme btn-sm" disabled={busy} onClick={() => { void openCamera('serial') }}>
            <i className="fas fa-barcode" /> Capture serial no.
          </button>
        </div>
        <p className="help-block">Photograph the serial number sticker / label so it is readable. This is mandatory.</p>
        <Gallery
          staged={staged}
          items={serialItems}
          previews={previews}
          busy={busy}
          empty="No serial number photo yet."
          onRemoveStaged={removeStaged}
          onRemoveLive={removeLive}
        />
      </div>

      <div className="qr-capture-block">
        <div className="qr-capture-block__head">
          <h3 className="qr-capture-panel__sub">Video ({pack.videos}/1)</h3>
          <button type="button" className="btn btn-default btn-sm" disabled={busy} onClick={() => { void openVideo() }}>
            <i className="fas fa-video" /> Record 30s video
          </button>
        </div>
        <p className="help-block">A 30-second walk-around video is mandatory for first-time registration.</p>
        <Gallery
          staged={staged}
          items={videoItems}
          previews={previews}
          busy={busy}
          empty="No video yet."
          video
          onRemoveStaged={removeStaged}
          onRemoveLive={removeLive}
        />
      </div>

      <AssetWebcamCapture
        open={webcamOpen}
        assetLabel={cameraLabel}
        initialPos={gps}
        confirmShot
        onClose={() => setWebcamOpen(false)}
        onCapture={(file, pos) => { void handlePhoto(file, pos, photoBucket) }}
      />
      <AssetVideoCapture
        open={videoOpen}
        assetLabel={assetTag}
        onClose={() => setVideoOpen(false)}
        onCapture={(file) => { void handleVideo(file) }}
      />
    </section>
  )
}

function Gallery({
  staged,
  items,
  previews,
  busy,
  empty,
  video,
  onRemoveStaged,
  onRemoveLive,
}: {
  staged: boolean
  items: Array<StagedCapture | CaptureRow>
  previews: Record<number, string>
  busy: boolean
  empty: string
  video?: boolean
  onRemoveStaged: (id: string) => void
  onRemoveLive: (id: number) => void
}) {
  if (!items.length) return <p className="text-muted">{empty}</p>
  return (
    <div className={`qr-capture-gallery${video ? ' qr-capture-gallery--video' : ''}`}>
      {items.map((item) => {
        const stagedItem = 'localId' in item ? item as StagedCapture : null
        const live = !stagedItem ? item as CaptureRow : null
        const src = stagedItem ? stagedItem.previewUrl : (live ? previews[live.id] : '')
        const caption = stagedItem
          ? (stagedItem.address || (stagedItem.latitude != null ? `${Number(stagedItem.latitude).toFixed(5)}, ${Number(stagedItem.longitude).toFixed(5)}` : 'Ready to submit'))
          : (live?.address || live?.captured_at || 'Saved')
        return (
          <figure key={stagedItem?.localId || live?.id} className={`qr-capture-card${video ? ' qr-capture-card--video' : ''}`}>
            {src ? (
              video ? <video src={src} controls playsInline preload="metadata" /> : <img src={src} alt="" />
            ) : (
              <div className="qr-capture-card__ph">Loading…</div>
            )}
            <figcaption>
              {caption}
              <button
                type="button"
                className="btn btn-link btn-sm"
                disabled={busy}
                onClick={() => {
                  if (stagedItem) onRemoveStaged(stagedItem.localId)
                  else if (live) void onRemoveLive(live.id)
                }}
              >
                Delete
              </button>
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}
