import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { facilitiesApi } from '../../api/client'
import { errMessages } from './hierarchyUx'

export default function FacilityAssetsTab({ locationId }: { locationId: number }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [placement, setPlacement] = useState(0)
  const [rtd, setRtd] = useState(0)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    facilitiesApi.getAssets(locationId, { limit: 100, offset: 0 })
      .then((res) => {
        if (cancelled) return
        setTotal(res.total)
        setPlacement(res.placement_count)
        setRtd(res.rtd_count)
        setRows(res.rows || [])
      })
      .catch((e) => { if (!cancelled) setError(errMessages(e).join(', ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [locationId])

  if (loading) return <p className="text-muted">Loading assets…</p>
  if (error) return <div className="callout callout-danger"><p>{error}</p></div>
  if (!rows.length) {
    return <p className="text-muted">No assets placed at this location (exact location / RTD match).</p>
  }

  return (
    <div>
      <p className="text-muted" style={{ marginBottom: 10 }}>
        {total} total · {placement} placement · {rtd} RTD — read-only; placement is not changed from Facility Management.
      </p>
      <div className="table-responsive">
        <table className="table table-striped table-hover table-condensed">
          <thead>
            <tr>
              <th>Asset tag</th>
              <th>Name</th>
              <th>location_id</th>
              <th>rtd_location_id</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  {r.id != null
                    ? <Link to={`/hardware/${r.id}`}>{String(r.asset_tag || r.id)}</Link>
                    : String(r.asset_tag || '—')}
                </td>
                <td>{String(r.name || '—')}</td>
                <td>{r.location_id == null ? '—' : String(r.location_id)}</td>
                <td>{r.rtd_location_id == null ? '—' : String(r.rtd_location_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
