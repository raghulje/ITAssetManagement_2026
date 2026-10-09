import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
  deleted_at?: string | null
  url: string
}

export const DEREGISTER_CONFIRM =
  'Re-capture this asset at its latest location?\n\nCurrent photos and video move to history. Capture all sides, the serial number, and a 30-second video at the new site, then Submit.'

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

export function stagedUploadMeta(item: StagedCapture) {
  return {
    pos: item.latitude != null && item.longitude != null
      ? {
        latitude: item.latitude,
        longitude: item.longitude,
        accuracyM: item.accuracyM || 0,
        altitude: null as number | null,
        capturedAt: item.capturedAt ? new Date(item.capturedAt) : new Date(),
        source: 'cached' as const,
      }
      : null,
    address: item.address,
    locality: item.locality,
    capturedAt: item.capturedAt,
  }
}

type PhotoBucket = 'photo' | 'serial'

type Props = {
  token: string
  assetTag: string
  assetId?: number
  /** Stage files locally until the parent form submits (blank-label first registration). */
  staged?: boolean
  stagedItems?: StagedCapture[]
  onStagedChange?: (items: StagedCapture[]) => void
  submitBusy?: boolean
}

export default function QrAssetCapturePanel({
  token,
  assetTag,
  assetId,
  staged = false,
  stagedItems = [],
  onStagedChange,
  submitBusy = false,
}: Props) {
  const [rows, setRows] = useState<CaptureRow[]>([])
  const [previews, setPreviews] = useState<Record<number, string>>({})
  const [localStaged, setLocalStaged] = useState<StagedCapture[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [webcamOpen, setWebcamOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [photoBucket, setPhotoBucket] = useState<PhotoBucket>('photo')
  const [gps, setGps] = useState<PrecisePosition | null>(null)
  const blobUrls = useRef<string[]>([])

  const pending = staged ? stagedItems : localStaged
  const combined = [...rows.map((r) => ({ kind: r.kind })), ...pending.map((p) => ({ kind: p.kind }))]
  const pack = firstPackStatus(combined)
  const sideItems = [...rows.filter((r) => r.kind === 'photo'), ...pending.filter((i) => i.kind === 'photo')]
  const serialItems = [...rows.filter((r) => r.kind === 'serial'), ...pending.filter((i) => i.kind === 'serial')]
  const videoItems = [...rows.filter((r) => r.kind === 'video'), ...pending.filter((i) => i.kind === 'video')]
  const working = busy || submitBusy
  const canUploadSubmit = pack.complete && pending.length > 0

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

  function setPending(items: StagedCapture[]) {
    if (staged) onStagedChange?.(items)
    else setLocalStaged(items)
  }

  function addStaged(item: StagedCapture) {
    setNotice('')
    setPending([...pending, item])
  }

  async function handlePhoto(file: File, pos: PrecisePosition | null, kind: PhotoBucket) {
    setBusy(true)
    setError('')
    try {
      const stamped = await stampCapturePhoto(file, pos, assetTag)
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
    const gone = pending.find((i) => i.localId === localId)
    if (gone) URL.revokeObjectURL(gone.previewUrl)
    setPending(pending.filter((i) => i.localId !== localId))
  }

  async function submitPending() {
    if (!pack.complete) {
      setError(`Capture all sides (min ${MIN_SIDE_PHOTOS} photos), the serial number, and a 30-second video before submitting.`)
      return
    }
    if (!pending.length) {
      setError('Capture photos or video first, then tap Submit capture.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    const failedIds: string[] = []
    for (const item of pending) {
      try {
        await uploadQrCapture(token, item.file, item.kind, stagedUploadMeta(item))
      } catch {
        failedIds.push(item.localId)
      }
    }
    if (!failedIds.length) {
      pending.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      setLocalStaged([])
      setNotice('Submitted. Photos and video are stored on this asset.')
    } else {
      pending.filter((item) => !failedIds.includes(item.localId)).forEach((item) => URL.revokeObjectURL(item.previewUrl))
      setLocalStaged(pending.filter((item) => failedIds.includes(item.localId)))
      setError(`${failedIds.length} capture(s) failed to upload. Try Submit again.`)
    }
    try {
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submitted, but could not refresh the gallery')
    } finally {
      setBusy(false)
    }
  }

  async function deregisterCaptures() {
    if (!rows.length) return
    if (!window.confirm(DEREGISTER_CONFIRM)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(`/public/assets/${encodeURIComponent(token)}/captures`, { method: 'DELETE' })
      pending.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      setLocalStaged([])
      await loadList()
      setNotice('Ready to re-capture. Take new photos and video at this location, then tap Submit.')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Deregister failed')
    } finally {
      setBusy(false)
    }
  }

  const cameraLabel = photoBucket === 'serial'
    ? `${assetTag} · serial number`
    : `${assetTag} · all sides`

  const savedOnAsset = !staged && rows.length > 0 && pending.length === 0
  const showSubmit = staged
    ? pack.complete
    : canUploadSubmit
  const submitHint = savedOnAsset
    ? 'Current photos and video are saved for this location.'
    : !pack.complete
      ? `Finish the checklist (${MIN_SIDE_PHOTOS} sides + serial photo + 30s video), then submit.`
      : `${pending.length} capture(s) ready — tap Submit to store them on this asset.`

  return (
    <section className="qr-capture-panel">
      <header className="qr-capture-panel__head">
        <div>
          <h2>{staged ? 'First-time field capture' : 'Asset captures'}</h2>
          <p>
            Capture all sides, the serial number, and a 30-second video. Nothing is stored until you tap{' '}
            <strong>Submit</strong>. If the asset later moves, use <strong>Re-capture latest location</strong>.
          </p>
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
      {notice ? (
        <div className="callout callout-success qr-capture-notice">
          <p>
            {notice}
            {assetId ? (
              <>
                {' '}
                <Link to={`/hardware/${assetId}?tab=captures`}>Open asset → Captures</Link>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      {working ? <p className="help-block">{staged ? 'Saving…' : 'Submitting captures…'}</p> : null}

      <div className="qr-capture-block">
        <div className="qr-capture-block__head">
          <h3 className="qr-capture-panel__sub">All sides ({pack.sides}/{MIN_SIDE_PHOTOS})</h3>
          {savedOnAsset ? null : (
            <button type="button" className="btn btn-theme btn-sm" disabled={working} onClick={() => { void openCamera('photo') }}>
              <i className="fas fa-camera" /> Capture all sides
            </button>
          )}
        </div>
        <p className="help-block">Walk around the asset and take at least 4 GPS-stamped photos (front, back, and both sides).</p>
        <Gallery
          items={sideItems}
          previews={previews}
          busy={working}
          empty="No side photos yet."
          hideRemove={savedOnAsset}
          onRemoveStaged={removeStaged}
          onRemoveLive={removeLive}
        />
      </div>

      <div className="qr-capture-block">
        <div className="qr-capture-block__head">
          <h3 className="qr-capture-panel__sub">Serial number ({pack.serialOk ? '1/1' : '0/1'})</h3>
          {savedOnAsset ? null : (
            <button type="button" className="btn btn-theme btn-sm" disabled={working} onClick={() => { void openCamera('serial') }}>
              <i className="fas fa-barcode" /> Capture serial no.
            </button>
          )}
        </div>
        <p className="help-block">Photograph the serial number sticker / label so it is readable. This is mandatory.</p>
        <Gallery
          items={serialItems}
          previews={previews}
          busy={working}
          empty="No serial number photo yet."
          hideRemove={savedOnAsset}
          onRemoveStaged={removeStaged}
          onRemoveLive={removeLive}
        />
      </div>

      <div className="qr-capture-block">
        <div className="qr-capture-block__head">
          <h3 className="qr-capture-panel__sub">Video ({pack.videos}/1)</h3>
          {savedOnAsset ? null : (
            <button type="button" className="btn btn-default btn-sm" disabled={working} onClick={() => { void openVideo() }}>
              <i className="fas fa-video" /> Record 30s video
            </button>
          )}
        </div>
        <p className="help-block">A 30-second walk-around video is mandatory for first-time registration.</p>
        <Gallery
          items={videoItems}
          previews={previews}
          busy={working}
          empty="No video yet."
          video
          hideRemove={savedOnAsset}
          onRemoveStaged={removeStaged}
          onRemoveLive={removeLive}
        />
      </div>

      {savedOnAsset ? (
        <div className="qr-capture-saved-bar">
          <p>{submitHint} If the asset moved, start a new pack at the latest site.</p>
          <button
            type="button"
            className="qr-capture-recapture-btn"
            disabled={working}
            onClick={() => { void deregisterCaptures() }}
          >
            {working ? 'Working…' : 'Re-capture latest location'}
          </button>
        </div>
      ) : showSubmit ? (
        <div className="qr-capture-submit-bar">
          <p>{submitHint}</p>
          {staged ? (
            <button type="submit" className="qr-capture-submit-btn" disabled={working}>
              {working ? 'Saving…' : 'Submit registration'}
            </button>
          ) : (
            <button
              type="button"
              className="qr-capture-submit-btn"
              disabled={working}
              onClick={() => { void submitPending() }}
            >
              {working ? 'Submitting…' : 'Submit capture'}
            </button>
          )}
        </div>
      ) : (
        <p className="qr-capture-submit-wait">{submitHint}</p>
      )}

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
  items,
  previews,
  busy,
  empty,
  video,
  hideRemove,
  onRemoveStaged,
  onRemoveLive,
}: {
  items: Array<StagedCapture | CaptureRow>
  previews: Record<number, string>
  busy: boolean
  empty: string
  video?: boolean
  hideRemove?: boolean
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
          ? `Pending · ${stagedItem.address || (stagedItem.latitude != null ? `${Number(stagedItem.latitude).toFixed(5)}, ${Number(stagedItem.longitude).toFixed(5)}` : 'ready to submit')}`
          : (live?.address || live?.captured_at || 'Saved')
        return (
          <figure key={stagedItem?.localId || live?.id} className={`qr-capture-card${video ? ' qr-capture-card--video' : ''}`}>
            {src ? (
              video ? <video src={src} controls playsInline preload="metadata" /> : <img src={src} alt="" />
            ) : (
              <div className="qr-capture-card__ph">Loading…</div>
            )}
            <figcaption>
              <span>{caption}</span>
              {hideRemove ? null : (
                <button
                  type="button"
                  className="btn btn-link btn-sm"
                  disabled={busy}
                  onClick={() => {
                    if (stagedItem) onRemoveStaged(stagedItem.localId)
                    else if (live) void onRemoveLive(live.id)
                  }}
                >
                  Remove
                </button>
              )}
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}
