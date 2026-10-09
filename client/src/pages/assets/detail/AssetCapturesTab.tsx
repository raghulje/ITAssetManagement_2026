import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { hardwareApi } from '../../../api/client'
import { formatAppDateTime } from '../../../lib/datetime'
import { authorizedMediaUrl } from '../../../lib/authorizedMedia'
import type { CaptureKind, CaptureRow } from '../../../components/QrAssetCapturePanel'
import {
  DEREGISTER_CONFIRM,
  MIN_SIDE_PHOTOS,
  firstPackStatus,
} from '../../../components/QrAssetCapturePanel'
import {
  CaptureLightbox,
  CaptureThumb,
  type CaptureMediaItem,
} from '../../../components/CaptureMediaPreview'

type Props = {
  assetId: number | string
  rows: CaptureRow[]
  qrToken?: string | null
  canDeregister?: boolean
  onDeregistered?: () => void
}

export default function AssetCapturesTab({
  assetId,
  rows,
  qrToken,
  canDeregister,
  onDeregistered,
}: Props) {
  const [archived, setArchived] = useState<CaptureRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [viewer, setViewer] = useState<{ items: CaptureMediaItem[]; index: number } | null>(null)
  const pack = firstPackStatus(rows)
  const photos = rows.filter((r) => r.kind === 'photo')
  const serials = rows.filter((r) => r.kind === 'serial')
  const videos = rows.filter((r) => r.kind === 'video')
  const historyGroups = groupArchived(archived)

  useEffect(() => {
    hardwareApi.captures(assetId, { archived: true })
      .then((r) => setArchived(normalizeCaptureRows(r.rows || [])))
      .catch(() => setArchived([]))
  }, [assetId, rows])

  async function deregister() {
    if (!window.confirm(DEREGISTER_CONFIRM)) return
    setBusy(true)
    setError('')
    try {
      await hardwareApi.deregisterCaptures(assetId)
      onDeregistered?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deregister failed')
    } finally {
      setBusy(false)
    }
  }

  const recaptureHint = qrToken
    ? `/asset/${encodeURIComponent(qrToken)}`
    : null

  return (
    <div className="vad-panel">
      <div className="vad-panel__bar">
        <h3>Captures</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="text-muted">{rows.length} current file{rows.length === 1 ? '' : 's'}</span>
          {canDeregister && rows.length > 0 ? (
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => { void deregister() }}>
              {busy ? 'Working…' : 'Re-capture latest location'}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-danger">{error}</p> : null}
      <p className="help-block">
        After an employee is relieved or the asset moves to another site, tap
        <strong> Re-capture latest location</strong> and submit a new GPS-stamped pack.
        {recaptureHint ? (
          <>
            {' '}Scan the QR label or open{' '}
            <Link to={recaptureHint}>the capture page</Link>.
          </>
        ) : null}
      </p>

      {!rows.length ? (
        <div className="vad-empty">
          <strong>No current field captures</strong>
          Recapture all sides, the serial number, and a 30-second video, then Submit.
        </div>
      ) : (
        <>
          <ul className="qr-capture-req">
            <li className={pack.sidesOk ? 'is-done' : ''}>All sides — {pack.sides}/{MIN_SIDE_PHOTOS}</li>
            <li className={pack.serialOk ? 'is-done' : ''}>Serial number photo — {pack.serialOk ? 'yes' : 'missing'}</li>
            <li className={pack.videoOk ? 'is-done' : ''}>30-second video — {pack.videoOk ? 'yes' : 'missing'}</li>
          </ul>
          <CaptureGroup title={`All sides (${photos.length})`} items={photos} onOpen={setViewer} />
          <CaptureGroup title={`Serial number (${serials.length})`} items={serials} onOpen={setViewer} />
          <CaptureGroup title={`Video (${videos.length})`} items={videos} onOpen={setViewer} video />
        </>
      )}

      {historyGroups.length > 0 ? (
        <div className="qr-capture-history">
          <h3 className="qr-capture-panel__sub">Previous locations</h3>
          {historyGroups.map((group) => (
            <section key={group.key} className="qr-capture-block">
              <p className="help-block" style={{ marginBottom: 8 }}>
                Deregistered {formatAppDateTime(group.at)}
                {group.address ? ` · ${group.address}` : ''}
              </p>
              <CaptureGroup title={`Pack (${group.rows.length})`} items={group.rows} onOpen={setViewer} />
            </section>
          ))}
        </div>
      ) : null}

      {viewer ? (
        <CaptureLightbox
          items={viewer.items}
          index={viewer.index}
          onClose={() => setViewer(null)}
          onIndex={(index) => setViewer({ ...viewer, index })}
        />
      ) : null}
    </div>
  )
}

function toMediaItems(items: CaptureRow[]): CaptureMediaItem[] {
  return items.map((row) => ({
    key: String(row.id),
    src: authorizedMediaUrl(row.url),
    isVideo: row.kind === 'video' || String(row.mime_type || '').startsWith('video/'),
    caption: row.address || formatAppDateTime(row.captured_at),
    coords: row.latitude != null && row.longitude != null
      ? `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`
      : null,
  }))
}

function CaptureGroup({
  title,
  items,
  video,
  onOpen,
}: {
  title: string
  items: CaptureRow[]
  video?: boolean
  onOpen: (next: { items: CaptureMediaItem[]; index: number }) => void
}) {
  const media = useMemo(() => toMediaItems(items), [items])
  return (
    <div className="qr-capture-block">
      <h3 className="qr-capture-panel__sub">{title}</h3>
      {!items.length ? (
        <p className="text-muted">None yet.</p>
      ) : (
        <div className={`qr-capture-gallery${video ? ' qr-capture-gallery--video' : ''}`}>
          {media.map((item, index) => (
            <figure key={item.key} className={`qr-capture-card${item.isVideo ? ' qr-capture-card--video' : ''}`}>
              <CaptureThumb item={item} onOpen={() => onOpen({ items: media, index })} />
              <figcaption>
                <span>{item.caption}</span>
                {item.coords ? <span>{item.coords}</span> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

function groupArchived(rows: CaptureRow[]) {
  const map = new Map<string, CaptureRow[]>()
  for (const row of rows) {
    const key = String(row.deleted_at || 'unknown')
    const list = map.get(key) || []
    list.push(row)
    map.set(key, list)
  }
  return [...map.entries()].map(([key, groupRows]) => ({
    key,
    at: groupRows[0]?.deleted_at || null,
    address: groupRows.find((r) => r.address)?.address || null,
    rows: groupRows,
  }))
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
      deleted_at: (r.deleted_at as string | null) ?? null,
      url: String(r.url || ''),
    }
  })
}
