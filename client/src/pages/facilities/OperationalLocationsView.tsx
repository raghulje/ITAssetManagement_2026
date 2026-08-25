import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { mastersApi } from '../../api/client'
import { Box, DataTable } from '../../components/ui'
import { useAuth } from '../../api/AuthContext'
import { errMessages } from './hierarchyUx'

function cellValue(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  if (v == null) return '—'
  if (typeof v === 'object' && v && 'name' in v) return String((v as { name?: string }).name || '—')
  return String(v)
}

export default function OperationalLocationsView() {
  const { can } = useAuth()
  const canEdit = can('settings.edit')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    mastersApi.listLocations({ search: search || undefined, limit: 500 })
      .then((res) => {
        setRows(res.rows || [])
        setTotal(res.total || res.rows?.length || 0)
        setError('')
      })
      .catch((e) => {
        setError(errMessages(e).join(', '))
        setRows([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [search])

  return (
    <div className="facility-operational">
      <div className="callout callout-info">
        <p>
          These are <strong>operational / HRMS</strong> locations (typically Unspecified). They are used for asset
          placement, RTD, inventory, imports, and checkout — for example{' '}
          <strong>Refex Tower-Nungambakkam</strong> remains the operational home for most IT assets.
        </p>
        <p>
          They are <strong>not</strong> part of the physical facility tree. Physical Sites / Buildings / Floors /
          Spaces are managed under <Link to="/facilities">Physical Hierarchy</Link>. Do not retype or reparent
          these rows to “fit” the tree without an approved migration. Full create/edit remains in Masters → Locations.
        </p>
      </div>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <Box
        title="Operational Locations"
        type="primary"
        tools={(
          <>
            <Link to="/locations" className="btn btn-default btn-sm">
              <i className="fas fa-database" /> Manage in Masters
            </Link>
            {canEdit ? (
              <Link to="/locations/create" className="btn btn-theme btn-sm">
                <i className="fas fa-plus" /> Create
              </Link>
            ) : null}
          </>
        )}
      >
        <DataTable
          search={search}
          onSearch={setSearch}
          rows={rows}
          exportName="operational_locations"
          storageKey="facility_operational_locations"
          onRefresh={load}
          selectable={false}
          columns={[
            {
              key: 'name',
              label: 'Name',
              render: (r) => <Link to={`/locations/${r.id}`}>{cellValue(r, 'name')}</Link>,
            },
            { key: 'company', label: 'Company', render: (r) => cellValue(r, 'company') },
            { key: 'assets_count', label: 'Assets', render: (r) => cellValue(r, 'assets_count') },
            { key: 'notes', label: 'Notes', render: (r) => cellValue(r, 'notes') },
          ]}
        />
        {loading ? <p className="text-muted">Loading…</p> : (
          <p className="text-muted" style={{ marginTop: 8 }}>{total} records</p>
        )}
      </Box>
    </div>
  )
}
