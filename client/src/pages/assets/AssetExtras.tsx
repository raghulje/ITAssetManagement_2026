import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useState, type FormEvent } from 'react'
import AppLayout from '../../layout/AppLayout'
import { AppSelect, Box, DateField, EmployeeSelect, Field, PageBack, PageForm } from '../../components/ui'
import { api, hardwareApi, mastersApi, type SelectOption } from '../../api/client'
import { formatINR } from '../../utils/money'
import { useToast } from '../../components/Toast'

function nestName(v: unknown): string {
  if (v && typeof v === 'object' && 'name' in v) return String((v as { name?: string }).name || '—')
  return v != null && v !== '' ? String(v) : '—'
}

/** Audit feature — routes commented out in App.tsx; restore when needed. */
export function AssetAudit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [asset, setAsset] = useState<Record<string, unknown> | null>(null)
  const [nextAudit, setNextAudit] = useState('')
  const [locationId, setLocationId] = useState('')
  const [locations, setLocations] = useState<SelectOption[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    hardwareApi.get(id).then((a) => {
      setAsset(a)
      const next = a.next_audit_date
      if (next && typeof next === 'object' && next && 'date' in next) setNextAudit(String((next as { date: string }).date).slice(0, 10))
      else if (next) setNextAudit(String(next).slice(0, 10))
      const loc = a.location as { id?: number } | null
      if (loc?.id) setLocationId(String(loc.id))
    }).catch(() => setAsset(null))
    mastersApi.locations().then((r) => setLocations(r.results || [])).catch(() => undefined)
  }, [id])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!id) return
    setBusy(true)
    setError('')
    try {
      await hardwareApi.audit(id, {
        next_audit_date: nextAudit || null,
        location_id: locationId ? Number(locationId) : null,
        note: note || null,
      })
      toast.success('Asset audited')
      navigate(`/hardware/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed')
    } finally {
      setBusy(false)
    }
  }

  if (!asset) {
    return (
      <AppLayout title="Audit Asset">
        <Box title="Audit"><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Audit Asset" subtitle={String(asset.asset_tag || '')}>
      <div className="col-md-7" style={{ padding: 0 }}>
        <Box title={`Auditing ${String(asset.asset_tag)}`} type="primary">
          {error ? <p className="text-danger">{error}</p> : null}
          <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
            <p>Model: <strong>{nestName(asset.model)}</strong> · Location: <strong>{nestName(asset.location)}</strong></p>
            <Field label="Next Audit Date">
              <DateField value={nextAudit} onChange={setNextAudit} />
            </Field>
            <Field label="Location">
              <AppSelect
                value={locationId}
                onChange={setLocationId}
                options={[
                  { value: '', label: '—' },
                  ...locations.map((l) => ({ value: String(l.id), label: l.text })),
                ]}
                searchable
              />
            </Field>
            <Field label="Notes"><textarea className="form-control" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Audit notes" /></Field>
            <div className="form-actions">
              <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Saving…' : 'Audit'}</button>
              <Link to={`/hardware/${asset.id}`} className="btn btn-default">Cancel</Link>
            </div>
          </form>
        </Box>
      </div>
    </AppLayout>
  )
}

/** Audit feature — routes commented out in App.tsx; restore when needed. */
export function AuditDue() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ rows: Record<string, unknown>[] }>('/hardware/audit/due')
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <AppLayout title="Assets Due for Audit" subtitle={loading ? 'Loading…' : `${rows.length} assets`}>
      <Box title="Audit Due" tools={<PageBack fallback="/hardware" />}>
        <table className="table table-striped table-hover">
          <thead><tr><th>Asset Tag</th><th>Name</th><th>Location</th><th>Next Audit</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="text-muted">{loading ? 'Loading…' : 'No assets due for audit'}</td></tr>
            ) : rows.map((a) => (
              <tr key={String(a.id)}>
                <td><Link to={`/hardware/${a.id}`}>{String(a.asset_tag)}</Link></td>
                <td>{String(a.name || '')}</td>
                <td>{nestName(a.location)}</td>
                <td>{String((a.next_audit_date as { formatted?: string })?.formatted || a.next_audit_date || '')}</td>
                <td><Link to={`/hardware/${a.id}/audit`} className="btn btn-sm btn-default">Audit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}

export function EolDue() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ rows: Record<string, unknown>[] }>('/hardware/eol/due')
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const daysLabel = (d: unknown) => {
    if (d == null || d === '') return '—'
    const n = Number(d)
    if (Number.isNaN(n)) return '—'
    if (n < 0) return `${Math.abs(n)}d overdue`
    if (n === 0) return 'today'
    return `${n}d`
  }

  return (
    <AppLayout title="Assets Approaching EOL" subtitle={loading ? 'Loading…' : `${rows.length} assets`}>
      <Box
        title="EOL & Warranty Due (30 days)"
        tools={(
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <PageBack fallback="/" />
            <Link to="/hardware" className="btn btn-default btn-sm">Assets</Link>
          </div>
        )}
      >
        <div className="table-responsive">
        <table className="table table-striped table-hover">
          <thead>
            <tr>
              <th>Asset Tag</th>
              <th>Name</th>
              <th>Model</th>
              <th>EOL Date</th>
              <th>EOL</th>
              <th>Warranty End</th>
              <th>Warranty</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="text-muted">{loading ? 'Loading…' : 'No assets approaching EOL or warranty end'}</td></tr>
            ) : rows.map((a) => (
              <tr key={String(a.id)}>
                <td><Link to={`/hardware/${a.id}`}>{String(a.asset_tag)}</Link></td>
                <td>{String(a.name || '')}</td>
                <td>{String(a.model_name || '—')}</td>
                <td>{String(a.eol_date || '—')}</td>
                <td>{a.eol_due ? daysLabel(a.days_to_eol) : '—'}</td>
                <td>{String(a.warranty_end || '—')}</td>
                <td>{a.warranty_due ? daysLabel(a.days_to_warranty) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Box>
    </AppLayout>
  )
}

export function CheckinDue() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ rows: Record<string, unknown>[] }>('/hardware/checkins/due')
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <AppLayout title="Assets Due for Unassign" subtitle={loading ? 'Loading…' : `${rows.length} assets`}>
      <Box title="Due for Unassign" tools={<PageBack fallback="/hardware" />}>
        <table className="table table-striped table-hover">
          <thead><tr><th>Asset Tag</th><th>Assigned To</th><th>Expected Return</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="text-muted">{loading ? 'Loading…' : 'No assets due for unassign'}</td></tr>
            ) : rows.map((a) => (
              <tr key={String(a.id)}>
                <td><Link to={`/hardware/${a.id}`}>{String(a.asset_tag)}</Link></td>
                <td>{String((a.assigned_to as { name?: string })?.name || a.assigned_name || '—')}</td>
                <td>{String(a.expected_checkin || '')}</td>
                <td><Link to={`/hardware/${a.id}/checkin`} className="btn btn-sm btn-primary">Unassign</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}

export function QuickscanCheckin() {
  const navigate = useNavigate()
  const [tag, setTag] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = tag.trim()
    if (!t) return
    setBusy(true)
    setError('')
    try {
      const row = await api<{ id: number }>(`/hardware/bytag/${encodeURIComponent(t)}`)
      navigate(`/hardware/${row.id}/checkin`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Asset not found')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout title="Quickscan Unassign">
      <Box title="Scan Asset Tag" type="primary">
        {error ? <p className="text-danger">{error}</p> : null}
        <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
          <Field label="Asset Tag" required>
            <input className="form-control" autoFocus value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Scan or type asset tag" required />
          </Field>
          <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Looking up…' : 'Continue to Unassign'}</button>
        </form>
      </Box>
    </AppLayout>
  )
}

export function BulkCheckout() {
  const navigate = useNavigate()
  const [assets, setAssets] = useState<Record<string, unknown>[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    hardwareApi.list({ status_type: 'RTD', limit: 200 })
      .then((r) => setAssets((r.rows || []).filter((a) => !a.assigned_to)))
      .catch(() => setAssets([]))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selected.length || !employeeId) {
      setError('Select assets and an employee')
      return
    }
    setBusy(true)
    setError('')
    try {
      for (const id of selected) {
        const row = assets.find((a) => Number(a.id) === id)
        if (row?.assigned_to) {
          throw new Error(`Asset ${String(row.asset_tag || id)} is already assigned`)
        }
        await hardwareApi.checkout(id, {
          checkout_to_type: 'employee',
          assigned_employee: Number(employeeId),
          note: note || null,
        })
      }
      navigate('/hardware?status_type=Assigned')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk assign failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout title="Bulk Assign">
      <Box title="Assign Multiple Assets" type="primary">
        {error ? <p className="text-danger">{error}</p> : null}
        <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
          <Field label="In-stock assets" required>
            <select
              className="form-control"
              multiple
              size={8}
              style={{ height: 'auto' }}
              value={selected.map(String)}
              onChange={(e) => {
                setSelected(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))
              }}
            >
              {assets.map((a) => (
                <option key={String(a.id)} value={String(a.id)}>
                  {String(a.asset_tag)} — {nestName(a.model) || String(a.name || '')}
                </option>
              ))}
            </select>
            {assets.length === 0 ? <p className="help-block">No in-stock assets available</p> : null}
          </Field>
          <Field label="Assign to employee" required>
            <EmployeeSelect value={employeeId} onChange={setEmployeeId} required />
          </Field>
          <Field label="Notes"><textarea className="form-control" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Assigning…' : 'Assign'}</button>
          </div>
        </form>
      </Box>
    </AppLayout>
  )
}

/** Audit feature — routes commented out in App.tsx; restore when needed. */
export function BulkAudit() {
  const navigate = useNavigate()
  const [tag, setTag] = useState('')
  const [nextAudit, setNextAudit] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMsg('')
    try {
      await api('/hardware/audit', {
        method: 'POST',
        json: { asset_tag: tag.trim(), next_audit_date: nextAudit || null, note: note || null },
      })
      setMsg(`Audited ${tag.trim()}`)
      setTag('')
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout title="Bulk Audit">
      <Box title="Audit Assets" type="primary">
        {msg ? <p className="text-success">{msg}</p> : null}
        {error ? <p className="text-danger">{error}</p> : null}
        <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
          <Field label="Asset Tag" required>
            <input className="form-control" autoFocus value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Scan asset tag to audit" required />
          </Field>
          <Field label="Next Audit Date"><DateField value={nextAudit} onChange={setNextAudit} /></Field>
          <Field label="Notes"><textarea className="form-control" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Saving…' : 'Audit'}</button>
            <button type="button" className="btn btn-default" onClick={() => navigate('/hardware')}>Done</button>
          </div>
        </form>
      </Box>
    </AppLayout>
  )
}

export function RequestedAssets() {
  return (
    <AppLayout title="Requested Assets">
      <Box title="Pending Requests" tools={<PageBack fallback="/hardware" />}>
        <p className="text-muted">No pending asset requests.</p>
      </Box>
    </AppLayout>
  )
}

export function Maintenances() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api<{ rows: Record<string, unknown>[] }>('/maintenances')
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <AppLayout title="Asset Maintenances" subtitle={loading ? 'Loading…' : `${rows.length} records`}>
      <Box
        title="Maintenances"
        tools={<Link to="/maintenances/create" className="btn btn-primary btn-sm"><i className="fas fa-plus" /> Create</Link>}
      >
        <table className="table table-striped table-hover">
          <thead>
            <tr><th>Asset</th><th>Supplier</th><th>Type</th><th>Start</th><th>Completion</th><th>Cost</th><th>Title</th><th /></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="text-muted">{loading ? 'Loading…' : 'No maintenances yet'}</td></tr>
            ) : rows.map((m) => (
              <tr key={String(m.id)}>
                <td>
                  {m.asset_id
                    ? <Link to={`/hardware/${m.asset_id}`}>{String(m.asset_tag || m.asset_id)}</Link>
                    : '—'}
                </td>
                <td>{String(m.supplier_name || '—')}</td>
                <td>{String(m.asset_maintenance_type || '—')}</td>
                <td>{String(m.start_date || '—')}</td>
                <td>{String(m.completion_date || '—')}</td>
                <td>{formatINR(m.cost)}</td>
                <td>{String(m.title || '')}</td>
                <td>
                  <Link to={`/maintenances/${m.id}/edit`} className="btn btn-sm btn-warning"><i className="fas fa-pencil-alt" /></Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}

const MAINTENANCE_TYPES = [
  { value: 'Maintenance', label: 'Maintenance' },
  { value: 'Repair', label: 'Repair' },
  { value: 'Upgrade', label: 'Upgrade' },
  { value: 'Software Support', label: 'Software Support' },
  { value: 'Hardware Support', label: 'Hardware Support' },
] as const

function reasonHint(type: string) {
  if (type === 'Repair') return 'Describe the fault / why this repair is needed.'
  if (type === 'Upgrade') return 'Describe what is being upgraded and why.'
  if (type === 'Software Support') return 'Describe the software issue or support needed.'
  if (type === 'Hardware Support') return 'Describe the hardware issue or support needed.'
  return 'Describe why this maintenance is needed.'
}

function assetLabel(a: Record<string, unknown>): string {
  const tag = String(a.asset_tag || a.id || '')
  const name = a.name ? String(a.name) : ''
  return name ? `${tag} — ${name}` : tag
}

export function MaintenanceForm() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)
  const prefAssetId = searchParams.get('asset_id') || ''
  const assetLocked = Boolean(prefAssetId) && !isEdit
  const [assetId, setAssetId] = useState(() => prefAssetId)
  const [assetDisplay, setAssetDisplay] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState('Maintenance')
  const [startDate, setStartDate] = useState('')
  const [completionDate, setCompletionDate] = useState('')
  const [cost, setCost] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [note, setNote] = useState('')
  const [isWarranty, setIsWarranty] = useState(false)
  const [assets, setAssets] = useState<SelectOption[]>([])
  const [suppliers, setSuppliers] = useState<SelectOption[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit || Boolean(prefAssetId))

  useEffect(() => {
    hardwareApi.list({ limit: 500 }).then((r) => {
      setAssets((r.rows || []).map((a) => ({
        id: Number(a.id),
        text: assetLabel(a),
      })))
    }).catch(() => undefined)
    mastersApi.suppliers().then((r) => setSuppliers(r.results || [])).catch(() => undefined)
  }, [])

  // Prefill + lock asset when opened from asset view (?asset_id=)
  useEffect(() => {
    if (isEdit || !prefAssetId) return
    setAssetId(prefAssetId)
    setLoading(true)
    hardwareApi.get(prefAssetId)
      .then((a) => {
        const label = assetLabel(a)
        setAssetDisplay(label)
        setAssets((prev) => {
          const idNum = Number(a.id)
          if (prev.some((x) => x.id === idNum)) return prev
          return [{ id: idNum, text: label }, ...prev]
        })
        const tag = String(a.asset_tag || a.id || '')
        if (tag) setTitle((prev) => prev || `Maintenance — ${tag}`)
      })
      .catch(() => setAssetDisplay(`Asset #${prefAssetId}`))
      .finally(() => setLoading(false))
  }, [prefAssetId, isEdit])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api<Record<string, unknown>>(`/maintenances/${id}`)
      .then((m) => {
        setAssetId(String(m.asset_id || ''))
        setTitle(String(m.title || ''))
        const t = String(m.asset_maintenance_type || 'Maintenance')
        setType(MAINTENANCE_TYPES.some((x) => x.value === t) ? t : 'Maintenance')
        setStartDate(String(m.start_date || '').slice(0, 10))
        setCompletionDate(String(m.completion_date || '').slice(0, 10))
        setCost(m.cost != null ? String(m.cost) : '')
        setSupplierId(m.supplier_id != null ? String(m.supplier_id) : '')
        setNote(String(m.note || ''))
        setIsWarranty(Boolean(m.is_warranty))
        if (m.asset_id) {
          hardwareApi.get(String(m.asset_id))
            .then((a) => setAssetDisplay(assetLabel(a)))
            .catch(() => undefined)
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const submit = async () => {
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    if (!isEdit && !assetId) {
      setError('Asset is required')
      return
    }
    if (!note.trim()) {
      setError('Reason / description is required')
      return
    }
    setBusy(true)
    setError('')
    try {
      const body = {
        title: title.trim(),
        asset_maintenance_type: type,
        start_date: startDate || null,
        completion_date: completionDate || null,
        cost: cost === '' ? 0 : Number(cost),
        supplier_id: supplierId ? Number(supplierId) : null,
        note: note.trim(),
        is_warranty: isWarranty ? 1 : 0,
        ...(!isEdit ? { asset_id: Number(assetId) } : {}),
      }
      if (isEdit && id) await api(`/maintenances/${id}`, { method: 'PUT', json: body })
      else await api('/maintenances', { method: 'POST', json: body })
      toast.success(isEdit ? 'Maintenance updated' : 'Maintenance created')
      navigate(assetId ? `/hardware/${assetId}` : '/maintenances')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const cancelTo = assetId ? `/hardware/${assetId}` : '/maintenances'

  if (loading) {
    return <AppLayout title="Maintenance"><p className="text-muted">Loading…</p></AppLayout>
  }

  return (
    <AppLayout title={isEdit ? 'Edit Maintenance' : 'Create Maintenance'}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm
        cancelTo={cancelTo}
        onSubmit={() => { void submit() }}
        submitLabel={busy ? 'Saving…' : 'Save'}
        submitDisabled={busy}
      >
        {!isEdit && (
          <Field label="Asset" required>
            {assetLocked ? (
              <>
                <input className="form-control" value={assetDisplay || `Asset #${assetId}`} readOnly />
                <input type="hidden" name="asset_id" value={assetId} />
                <span className="help-block">Prefilled from the asset you opened. Cancel returns to that asset.</span>
              </>
            ) : (
              <AppSelect
                value={assetId}
                onChange={setAssetId}
                required
                searchable
                options={[
                  { value: '', label: '—' },
                  ...assets.map((a) => ({ value: String(a.id), label: a.text })),
                ]}
              />
            )}
          </Field>
        )}
        {isEdit && assetDisplay ? (
          <Field label="Asset">
            <input className="form-control" value={assetDisplay} readOnly />
          </Field>
        ) : null}
        <Field label="Title" required>
          <input className="form-control" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="Type" required>
          <AppSelect
            value={type}
            onChange={setType}
            options={MAINTENANCE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </Field>
        <Field label="Reason / description" required>
          <textarea
            className="form-control"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            required
            placeholder={reasonHint(type)}
          />
          <span className="help-block">{reasonHint(type)} This is saved on the asset maintenance log.</span>
        </Field>
        <Field label="Start Date">
          <DateField value={startDate} onChange={setStartDate} />
        </Field>
        <Field label="Completion Date">
          <DateField value={completionDate} onChange={setCompletionDate} />
        </Field>
        <Field label="Cost (INR)">
          <input type="number" className="form-control" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field label="Supplier">
          <AppSelect
            value={supplierId}
            onChange={setSupplierId}
            searchable
            options={[
              { value: '', label: '—' },
              ...suppliers.map((s) => ({ value: String(s.id), label: s.text })),
            ]}
          />
        </Field>
        <Field label="Warranty">
          <label className="checkbox-inline" style={{ paddingTop: 7 }}>
            <input type="checkbox" checked={isWarranty} onChange={(e) => setIsWarranty(e.target.checked)} /> Under warranty
          </label>
        </Field>
      </PageForm>
    </AppLayout>
  )
}

export function ImportHistory() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ rows: Record<string, unknown>[] }>('/imports')
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <AppLayout title="Import History" subtitle={loading ? 'Loading…' : `${rows.length} imports`}>
      <Box title="Recent Imports">
        <table className="table table-striped">
          <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Date</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="text-muted">{loading ? 'Loading…' : 'No imports yet'}</td></tr>
            ) : rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{String(r.name || '')}</td>
                <td>{String(r.import_type || r.type || '')}</td>
                <td>{r.filesize ? `${Math.round(Number(r.filesize) / 1024)} KB` : '—'}</td>
                <td>{String(r.created_at || '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}
