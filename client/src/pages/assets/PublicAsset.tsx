import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getApiBase, getStorageBase } from '../../api/baseUrl'
import { labelCodesApi, mastersApi, type SelectOption } from '../../api/client'
import { AppSelect, Field } from '../../components/ui'
import { DomainSelect } from '../../components/DomainSelect'
import { useAuth } from '../../api/AuthContext'
import { defaultDomainCode, type DomainCode } from '../../lib/domainScope'
import { useToast } from '../../components/Toast'

type PublicAsset = {
  registered?: boolean
  id?: number
  asset_tag?: string
  old_asset_tag?: string | null
  name?: string | null
  serial?: string | null
  model?: string | null
  model_number?: string | null
  manufacturer?: string | null
  status?: string | null
  company?: string | null
  department?: string | null
  location?: string | null
  map_latitude?: number | null
  map_longitude?: number | null
  map_address?: string | null
  supplier?: string | null
  purchase_date?: string | null
  purchase_cost?: number | string | null
  order_number?: string | null
  warranty_months?: number | null
  asset_eol_date?: string | null
  notes?: string | null
  assigned_to?: { name?: string; type?: string } | null
  last_checkout?: string | null
  last_checkin?: string | null
  last_audit_date?: string | null
  next_audit_date?: string | null
  label_printed_at?: string | null
  label_print_count?: number
  last_agent_sync_at?: string | null
  agent_hostname?: string | null
  public_url?: string
  qr_image_url?: string | null
  barcode_image_url?: string | null
  token?: string
  code?: string
  kind?: string
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  const text = value == null || value === '' ? '—' : String(value)
  return (
    <div className="public-asset-field">
      <span className="public-asset-field-label">{label}</span>
      <span className="public-asset-field-value" title={text}>{text}</span>
    </div>
  )
}

function LabelRegisterForm({ token, code, onDone }: { token: string; code: string; onDone: () => void }) {
  const toast = useToast()
  const { domainScope, activeDomain } = useAuth()
  const [domain, setDomain] = useState<DomainCode>(activeDomain || defaultDomainCode(domainScope))
  const [companyId, setCompanyId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [modelId, setModelId] = useState('')
  const [statusId, setStatusId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [serial, setSerial] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [types, setTypes] = useState<SelectOption[]>([])
  const [models, setModels] = useState<SelectOption[]>([])
  const [statuses, setStatuses] = useState<SelectOption[]>([])
  const [locations, setLocations] = useState<SelectOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      mastersApi.companies(),
      mastersApi.assetTypes(undefined, domain),
      mastersApi.statuslabels(),
      mastersApi.locations(),
    ]).then(([c, t, s, l]) => {
      setCompanies(c.results || [])
      setTypes(t.results || [])
      setStatuses(s.results || [])
      setLocations(l.results || [])
      if (!companyId && c.results?.[0]) setCompanyId(String(c.results[0].id))
      if (!statusId && s.results?.[0]) setStatusId(String(s.results[0].id))
      if (!categoryId) {
        const laptop = t.results?.find((x) => /laptop/i.test(x.text)) || t.results?.[0]
        if (laptop) setCategoryId(String(laptop.id))
      }
    }).catch(() => undefined)
  }, [domain])

  useEffect(() => {
    if (!categoryId) {
      setModels([])
      return
    }
    mastersApi.models(undefined, categoryId)
      .then((m) => {
        const rows = m.results || []
        setModels(rows)
        setModelId((prev) => (prev && rows.some((r) => String(r.id) === prev) ? prev : ''))
      })
      .catch(() => setModels([]))
  }, [categoryId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!modelId || !statusId || !companyId) {
      setError('Company, asset type/model, and status are required')
      return
    }
    setBusy(true)
    setError('')
    try {
      await labelCodesApi.register(token, {
        domain,
        company_id: Number(companyId),
        category_id: Number(categoryId) || undefined,
        model_id: Number(modelId),
        status_id: Number(statusId),
        rtd_location_id: locationId ? Number(locationId) : null,
        location_id: locationId ? Number(locationId) : null,
        serial: serial.trim() || null,
        name: name.trim() || null,
        notes: notes.trim() || null,
      })
      toast.success(`Registered ${code}`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Register failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <p className="help-block">This is the only time this sticker can be registered. After submit, scans show asset details only.</p>
      <DomainSelect value={domain} onChange={setDomain} allowed={domainScope.codes} required />
      <Field label="Company" required>
        <AppSelect
          value={companyId}
          onChange={setCompanyId}
          required
          searchable
          options={companies.map((o) => ({ value: String(o.id), label: o.text }))}
        />
      </Field>
      <Field label="Asset type" required>
        <AppSelect
          value={categoryId}
          onChange={(v) => { setCategoryId(v); setModelId('') }}
          required
          searchable
          options={types.map((o) => ({ value: String(o.id), label: o.text }))}
        />
      </Field>
      <Field label="Model" required>
        <AppSelect
          value={modelId}
          onChange={setModelId}
          required
          searchable
          placeholder="Select model…"
          options={models.map((o) => ({ value: String(o.id), label: o.text }))}
        />
      </Field>
      <Field label="Status" required>
        <AppSelect
          value={statusId}
          onChange={setStatusId}
          required
          options={statuses.map((o) => ({ value: String(o.id), label: o.text }))}
        />
      </Field>
      <Field label="Location">
        <AppSelect
          value={locationId}
          onChange={setLocationId}
          searchable
          placeholder="Optional"
          options={[{ value: '', label: '— None —' }, ...locations.map((o) => ({ value: String(o.id), label: o.text }))]}
        />
      </Field>
      <Field label="Serial">
        <input className="form-control" value={serial} onChange={(e) => setSerial(e.target.value)} />
      </Field>
      <Field label="Name">
        <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea className="form-control" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="form-actions">
        <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Saving…' : 'Register asset'}</button>
      </div>
    </form>
  )
}

export default function PublicAsset() {
  const { token } = useParams()
  const { user, can, loading: authLoading } = useAuth()
  const [asset, setAsset] = useState<PublicAsset | null>(null)
  const [blank, setBlank] = useState<PublicAsset | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    if (!token) return
    setLoading(true)
    fetch(`${getApiBase()}/public/assets/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data?.messages?.[0] || data?.message || 'Not found')
        if (data?.registered === false) {
          setBlank(data as PublicAsset)
          setAsset(null)
        } else {
          setAsset(data as PublicAsset)
          setBlank(null)
        }
        setError('')
      })
      .catch((e: Error) => {
        setAsset(null)
        setBlank(null)
        const msg = e.message || 'Asset not found'
        setError(
          /failed to fetch|networkerror|load failed/i.test(msg)
            ? `${msg}. Open this page on the same Wi‑Fi as the server (${window.location.origin}) and ensure the API is reachable at ${getApiBase()}.`
            : msg,
        )
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [token])

  if (loading || authLoading) {
    return (
      <div className="public-asset-page">
        <div className="public-asset-card"><p className="text-muted">Loading…</p></div>
      </div>
    )
  }

  if (blank) {
    const qrSrc = blank.qr_image_url
      ? (blank.qr_image_url.startsWith('http') ? blank.qr_image_url : `${getStorageBase()}${blank.qr_image_url}`)
      : null
    const canRegister = Boolean(user && can('assets.create'))
    return (
      <div className="public-asset-page">
        <div className="public-asset-card">
          <header className="public-asset-header">
            <div>
              <p className="public-asset-brand">Refex · Asset Management</p>
              <h1>{blank.code}</h1>
              <p className="public-asset-subtitle">Blank label — not registered yet</p>
            </div>
            {qrSrc ? <img className="public-asset-qr" src={qrSrc} alt={blank.code} /> : null}
          </header>
          {canRegister ? (
            <LabelRegisterForm token={String(blank.token || token)} code={String(blank.code)} onDone={load} />
          ) : user ? (
            <p className="text-muted">This sticker is unused. You need permission to create assets to register it.</p>
          ) : (
            <p>
              This sticker has no asset yet.{' '}
              <Link
                to="/login"
                onClick={() => {
                  try { sessionStorage.setItem('refex_login_next', `/asset/${token}`) } catch { /* ignore */ }
                }}
              >
                Sign in
              </Link>
              {' '}to register it once.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="public-asset-page">
        <div className="public-asset-card">
          <h1>Asset not found</h1>
          <p className="text-muted">Token: {token}</p>
          {error ? <p className="text-danger">{error}</p> : null}
        </div>
      </div>
    )
  }

  const qrSrc = asset.qr_image_url
    ? (asset.qr_image_url.startsWith('http') ? asset.qr_image_url : `${getStorageBase()}${asset.qr_image_url}`)
    : null

  return (
    <div className="public-asset-page">
      <div className="public-asset-card">
        <header className="public-asset-header">
          <div>
            <p className="public-asset-brand">Refex · Asset Management</p>
            <h1>{asset.asset_tag}</h1>
            <p className="public-asset-subtitle">{asset.name || asset.model || 'Asset details'}</p>
          </div>
          {qrSrc ? (
            <img className="public-asset-qr" src={qrSrc} alt={`QR for ${asset.asset_tag}`} />
          ) : null}
        </header>

        <div className="public-asset-grid">
          <DetailField label="Asset Tag" value={asset.asset_tag} />
          <DetailField label="Old Asset Tag" value={asset.old_asset_tag} />
          <DetailField label="Name" value={asset.name} />
          <DetailField label="Serial" value={asset.serial} />
          <DetailField label="Model" value={[asset.model, asset.model_number].filter(Boolean).join(' · ')} />
          <DetailField label="Manufacturer" value={asset.manufacturer} />
          <DetailField label="Status" value={asset.status} />
          <DetailField label="Assigned To" value={asset.assigned_to?.name || 'Unassigned'} />
          <DetailField label="Company" value={asset.company} />
          <DetailField label="Department" value={asset.department} />
          <DetailField label="Location" value={asset.location} />
          {asset.map_latitude != null && asset.map_longitude != null ? (
            <DetailField
              label="Map pin"
              value={`${asset.map_address || ''} · Lat ${Number(asset.map_latitude).toFixed(6)}, Lng ${Number(asset.map_longitude).toFixed(6)}`}
            />
          ) : null}
          <DetailField label="Supplier" value={asset.supplier} />
          <DetailField label="Purchase Order Number" value={asset.order_number} />
          <DetailField label="Purchase Date" value={asset.purchase_date} />
          <DetailField label="Purchase Cost" value={asset.purchase_cost} />
          <DetailField label="Warranty (months)" value={asset.warranty_months} />
          <DetailField label="EOL Date" value={asset.asset_eol_date} />
          <DetailField label="Last Checkout" value={asset.last_checkout} />
          <DetailField label="Last Checkin" value={asset.last_checkin} />
          <DetailField label="Label Printed" value={asset.label_printed_at} />
          <DetailField label="Print Count" value={asset.label_print_count} />
          <DetailField label="Agent Hostname" value={asset.agent_hostname} />
          <DetailField label="Last Agent Sync" value={asset.last_agent_sync_at} />
        </div>

        {asset.notes ? (
          <div className="public-asset-notes">
            <strong>Notes</strong>
            <p>{asset.notes}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
