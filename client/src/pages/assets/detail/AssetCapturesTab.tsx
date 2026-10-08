import { useEffect, useRef, useState } from 'react'
import { getApiBase } from '../../../api/baseUrl'
import { formatAppDateTime } from '../../../lib/datetime'
import type { CaptureKind, CaptureRow } from '../../../components/QrAssetCapturePanel'
import { MIN_SIDE_PHOTOS, firstPackStatus } from '../../../components/QrAssetCapturePanel'

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('refex_token')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

type Props = {
  assetId: number | string
  rows: CaptureRow[]
}

export default function AssetCapturesTab({ assetId, rows }: Props) {
  const [previews, setPreviews] = useState<Record<number, string>>({})
  const blobUrls = useRef<string[]>([])
  const pack = firstPackStatus(rows)
  const photos = rows.filter((r) => r.kind === 'photo')
  const serials = rows.filter((r) => r.kind === 'serial')
  const videos = rows.filter((r) => r.kind === 'video')

  useEffect(() => {
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
  }, [rows, assetId])

  useEffect(() => () => {
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  if (!rows.length) {
    return (
      <div className="vad-panel">
        <div className="vad-panel__bar">
          <h3>Captures</h3>
        </div>
        <div className="vad-empty">
          <strong>No field captures yet</strong>
          Scan this asset’s QR label as an IT Asset Manager, capture photos and a 30-second video, then tap Submit.
        </div>
      </div>
    )
  }

  return (
    <div className="vad-panel">
      <div className="vad-panel__bar">
        <h3>Captures</h3>
        <span className="text-muted">{rows.length} file{rows.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="qr-capture-req">
        <li className={pack.sidesOk ? 'is-done' : ''}>All sides — {pack.sides}/{MIN_SIDE_PHOTOS}</li>
        <li className={pack.serialOk ? 'is-done' : ''}>Serial number photo — {pack.serialOk ? 'yes' : 'missing'}</li>
        <li className={pack.videoOk ? 'is-done' : ''}>30-second video — {pack.videoOk ? 'yes' : 'missing'}</li>
      </ul>
      <CaptureGroup title={`All sides (${photos.length})`} items={photos} previews={previews} />
      <CaptureGroup title={`Serial number (${serials.length})`} items={serials} previews={previews} />
      <CaptureGroup title={`Video (${videos.length})`} items={videos} previews={previews} video />
    </div>
  )
}

function CaptureGroup({
  title,
  items,
  previews,
  video,
}: {
  title: string
  items: CaptureRow[]
  previews: Record<number, string>
  video?: boolean
}) {
  return (
    <div className="qr-capture-block">
      <h3 className="qr-capture-panel__sub">{title}</h3>
      {!items.length ? (
        <p className="text-muted">None yet.</p>
      ) : (
        <div className={`qr-capture-gallery${video ? ' qr-capture-gallery--video' : ''}`}>
          {items.map((row) => {
            const src = previews[row.id]
            const caption = row.address || formatAppDateTime(row.captured_at)
            return (
              <figure key={row.id} className={`qr-capture-card${video ? ' qr-capture-card--video' : ''}`}>
                {src ? (
                  video ? <video src={src} controls playsInline preload="metadata" /> : <img src={src} alt="" />
                ) : (
                  <div className="qr-capture-card__ph">Loading…</div>
                )}
                <figcaption>
                  <span>{caption}</span>
                  {row.latitude != null && row.longitude != null ? (
                    <span>{Number(row.latitude).toFixed(5)}, {Number(row.longitude).toFixed(5)}</span>
                  ) : null}
                </figcaption>
              </figure>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function normalizeCaptureRows(raw: Record<string, unknown>[]): CaptureRow[] {
  return raw.map((r) => {
    const kind = r.kind === 'serial' || r.kind === 'video' ? r.kind : 'photo'
    return {
      id: Number(r.id),
      kind: kind as CaptureKind,
      original_name: (r.original_name as string | null) ?? null,
      mime_type: (r.mime_type as string | null) ?? null,
      captured_at: (r.captured_at as string | null) ?? null,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      address: (r.address as string | null) ?? null,
      url: String(r.url || ''),
    }
  })
}
