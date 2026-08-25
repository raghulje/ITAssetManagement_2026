import { useEffect, useState } from 'react'
import { facilitiesApi } from '../../api/client'
import { errMessages } from './hierarchyUx'

function Group({
  title,
  total,
  rows,
}: {
  title: string
  total: number
  rows: Record<string, unknown>[]
}) {
  return (
    <div className="facility-inv-group">
      <h4>{title} <span className="text-muted">({total})</span></h4>
      {!rows.length ? (
        <p className="text-muted">None</p>
      ) : (
        <ul className="facility-inv-list">
          {rows.map((r) => (
            <li key={String(r.id)}>
              <strong>{String(r.name || '—')}</strong>
              {r.qty != null ? <span className="text-muted"> · qty {String(r.qty)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function FacilityInventoryTab({ locationId }: { locationId: number }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<Awaited<ReturnType<typeof facilitiesApi.getInventory>> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    facilitiesApi.getInventory(locationId)
      .then((res) => { if (!cancelled) setData(res) })
      .catch((e) => { if (!cancelled) setError(errMessages(e).join(', ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [locationId])

  if (loading) return <p className="text-muted">Loading inventory…</p>
  if (error) return <div className="callout callout-danger"><p>{error}</p></div>
  if (!data || data.total === 0) {
    return <p className="text-muted">No inventory at this location (exact location_id match).</p>
  }

  return (
    <div>
      <p className="text-muted" style={{ marginBottom: 10 }}>
        {data.total} catalog rows — read-only; quantities and placements are not changed here.
      </p>
      <Group title="Consumables" total={data.consumables.total} rows={data.consumables.rows} />
      <Group title="Accessories" total={data.accessories.total} rows={data.accessories.rows} />
      <Group title="Components" total={data.components.total} rows={data.components.rows} />
    </div>
  )
}
