import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { Box } from '../../components/ui'
import { hardwareApi } from '../../api/client'

type Asset = Record<string, unknown>
type Group = { serial: string; count: number; assets: Asset[] }

function text(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'object') {
    const o = value as { name?: string | null; code?: string | null; formatted?: string; date?: string; type?: string }
    const name = String(o.name || o.code || o.formatted || o.date || '').trim()
    const type = o.type ? String(o.type) : ''
    return [name, type && name ? `(${type})` : type].filter(Boolean).join(' ')
  }
  return String(value)
}

const FIELDS: Array<{ label: string; pick: (a: Asset) => string }> = [
  { label: 'Asset tag', pick: (a) => text(a.asset_tag) },
  { label: 'Old asset tag', pick: (a) => text(a.old_asset_tag) },
  { label: 'Name', pick: (a) => text(a.name) },
  { label: 'Serial', pick: (a) => text(a.serial) },
  { label: 'Manufacturer', pick: (a) => text(a.manufacturer) },
  { label: 'Model', pick: (a) => text(a.model) },
  { label: 'Model number', pick: (a) => text(a.model_number) },
  { label: 'Status', pick: (a) => text(a.status) },
  { label: 'Assigned to', pick: (a) => text(a.assigned_to) },
  { label: 'Company', pick: (a) => text(a.company) },
  { label: 'Entity', pick: (a) => text(a.legal_entity) },
  { label: 'Department', pick: (a) => text(a.department) },
  { label: 'Location', pick: (a) => text(a.location) },
  { label: 'Supplier', pick: (a) => text(a.supplier) },
  { label: 'Purchase date', pick: (a) => text(a.purchase_date) },
  { label: 'Purchase cost', pick: (a) => text(a.purchase_cost) },
  { label: 'PO number', pick: (a) => text(a.po_number || a.order_number) },
  { label: 'GRN', pick: (a) => text(a.grn_number) },
  { label: 'Invoice', pick: (a) => text(a.invoice_number) },
  { label: 'Invoice date', pick: (a) => text(a.invoice_date) },
  { label: 'Warranty (months)', pick: (a) => text(a.warranty_months) },
  { label: 'EOL date', pick: (a) => text(a.asset_eol_date) },
  { label: 'Registered by', pick: (a) => text(a.registered_by) },
  { label: 'Registered at', pick: (a) => text(a.registered_at) },
  { label: 'Notes', pick: (a) => text(a.notes) },
]

export default function SerialDuplicates() {
  const [groups, setGroups] = useState<Group[]>([])
  const [assetCount, setAssetCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())

  const load = () => {
    setLoading(true)
    setError('')
    hardwareApi.serialDuplicates()
      .then((data) => {
        setGroups(data.groups || [])
        setAssetCount(data.duplicate_assets || 0)
        setSelected(new Set())
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const selectedCount = selected.size
  const differing = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const group of groups) {
      for (const field of FIELDS) {
        const values = new Set(group.assets.map((a) => field.pick(a)))
        map.set(`${group.serial}:${field.label}`, values)
      }
    }
    return map
  }, [groups])

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const removeSelected = async () => {
    const ids = [...selected]
    if (!ids.length || busy) return
    const ok = window.confirm(
      `Delete ${ids.length} selected asset${ids.length === 1 ? '' : 's'}? The ones you leave unticked stay in the inventory.`,
    )
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      for (const id of ids) {
        await hardwareApi.remove(id)
      }
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout
      title={`Duplicates ${groups.length}`}
      subtitle={loading ? 'Loading…' : `${groups.length} serial${groups.length === 1 ? '' : 's'} shared by ${assetCount} IT assets`}
    >
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <Box type="primary">
        <div className="serial-dup-head">
          <p className="help-block" style={{ margin: 0 }}>
            Assets with the same serial sit side by side. Highlighted rows differ. Tick the copies to remove, then delete. Edit opens the full record if you want to correct one and keep it.
          </p>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={!selectedCount || busy}
            onClick={() => { void removeSelected() }}
          >
            {busy ? 'Deleting…' : `Delete selected${selectedCount ? ` (${selectedCount})` : ''}`}
          </button>
        </div>
        {loading ? <p className="help-block">Loading duplicate serials…</p> : null}
        {!loading && !groups.length ? (
          <p className="help-block">No IT assets share a serial number.</p>
        ) : null}
        <div className="serial-dup-groups">
          {groups.map((group) => (
            <section key={group.serial} className="serial-dup-group">
              <h3 className="serial-dup-group-title">
                <span className="count-badge">Duplicates {group.count}</span>
                <span>{group.serial}</span>
              </h3>
              <div className="serial-dup-row">
                {group.assets.map((asset) => {
                  const id = Number(asset.id)
                  const on = selected.has(id)
                  return (
                    <article key={id} className={`serial-dup-card${on ? ' is-selected' : ''}`}>
                      <div className="serial-dup-card-top">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                          <input type="checkbox" checked={on} onChange={() => toggle(id)} />
                          Select
                        </label>
                        <Link to={`/hardware/${id}/edit`} className="btn btn-default btn-sm">Edit</Link>
                      </div>
                      <dl className="serial-dup-fields">
                        {FIELDS.map((field) => {
                          const values = differing.get(`${group.serial}:${field.label}`)
                          const diff = (values?.size || 0) > 1
                          const value = field.pick(asset)
                          return (
                            <div key={field.label} className={diff ? 'is-diff' : ''} style={{ display: 'contents' }}>
                              <dt>{field.label}</dt>
                              <dd>{value || '—'}</dd>
                            </div>
                          )
                        })}
                      </dl>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </Box>
    </AppLayout>
  )
}
