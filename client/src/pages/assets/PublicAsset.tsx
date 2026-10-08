import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getStorageBase } from '../../api/baseUrl'
import { api, ApiError, labelCodesApi, mastersApi, type SelectOption } from '../../api/client'
import { AppSelect, Field } from '../../components/ui'
import { DomainSelect } from '../../components/DomainSelect'
import { useAuth } from '../../api/AuthContext'
import { defaultDomainCode, type DomainCode } from '../../lib/domainScope'
import { useToast } from '../../components/Toast'
import { beginRefexOneSso } from '../../utils/loginNext'
import QrAssetCapturePanel, {
  firstPackStatus,
  MIN_SIDE_PHOTOS,
  stagedUploadMeta,
  uploadQrCapture,
  type StagedCapture,
} from '../../components/QrAssetCapturePanel'

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
  const [staged, setStaged] = useState<StagedCapture[]>([])

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
    if (!serial.trim()) {
      setError('Serial number is required')
      return
    }
    const pack = firstPackStatus(staged)
    if (!pack.sidesOk) {
      setError(`Capture all sides — at least ${MIN_SIDE_PHOTOS} photos are required`)
      return
    }
    if (!pack.serialOk) {
      setError('A photo of the serial number is required')
      return
    }
    if (!pack.videoOk) {
      setError('A 30-second video is required')
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
        serial: serial.trim(),
        name: name.trim() || null,
        notes: notes.trim() || null,
      })
      const failed: string[] = []
      for (const item of staged) {
        try {
          await uploadQrCapture(token, item.file, item.kind, stagedUploadMeta(item))
        } catch {
          failed.push(item.kind)
        }
      }
      staged.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      if (failed.length) {
        toast.success(`Registered ${code}`)
        setError(`Asset saved, but ${failed.length} capture(s) failed to upload. Add the remaining photos/video on this page.`)
        onDone()
        return
      }
      toast.success(`Registered ${code} with ${staged.length} capture(s)`)
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
      <p className="help-block">
        First-time registration: enter the serial number, capture all sides (min {MIN_SIDE_PHOTOS} photos), photograph the serial, and record a 30-second video. Submit stores everything on this asset.
      </p>
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
      <Field label="Serial" required>
        <input
          className="form-control"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          required
          placeholder="As printed on the asset"
        />
      </Field>
      <Field label="Name">
        <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Notes">
        <textarea className="form-control" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <QrAssetCapturePanel
        token={token}
        assetTag={code}
        staged
        stagedItems={staged}
        onStagedChange={setStaged}
        submitBusy={busy}
      />
      <div className="form-actions">
        <button type="submit" className="btn btn-theme" disabled={busy}>
          {busy ? 'Saving…' : 'Submit registration'}
        </button>
      </div>
    </form>
  )
}

function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="public-asset-page">
      <div className="public-asset-card">
        <header className="public-asset-header">
          <div>
            <p className="public-asset-brand">Refex · Asset Management</p>
            <h1>{title}</h1>
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}

export default function PublicAsset() {
  const { token } = useParams()
  const { user, can, loading: authLoading, isItAssetManager } = useAuth()
  const [asset, setAsset] = useState<PublicAsset | null>(null)
  const [blank, setBlank] = useState<PublicAsset | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  const load = () => {
    if (!token) return
    setLoading(true)
    setForbidden(false)
    api<PublicAsset>(`/public/assets/${encodeURIComponent(token)}`)
      .then((data) => {
        if (data?.registered === false) {
          setBlank(data)
          setAsset(null)
        } else {
          setAsset(data)
          setBlank(null)
        }
        setError('')
      })
      .catch((e: Error) => {
        setAsset(null)
        setBlank(null)
        if (e instanceof ApiError && e.status === 401) {
          setRedirecting(true)
          void beginRefexOneSso(`/asset/${token}`)
          return
        }
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true)
          setError('')
          return
        }
        setError(e.message || 'Asset not found')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!token || authLoading) return
    if (!user) {
      setRedirecting(true)
      void beginRefexOneSso(`/asset/${token}`)
      return
    }
    if (!isItAssetManager) {
      setForbidden(true)
      setLoading(false)
      return
    }
    load()
  }, [token, user, authLoading, isItAssetManager])

  if (authLoading || loading || redirecting) {
    return (
      <GateCard title={redirecting ? 'Signing in' : 'Loading'}>
        <p className="text-muted">
          {redirecting ? 'Redirecting to RefexOne to sign in…' : 'Loading…'}
        </p>
      </GateCard>
    )
  }

  if (forbidden) {
    return (
      <GateCard title="Access denied">
        <p className="public-asset-subtitle">Only IT Asset Managers can view scanned asset details.</p>
        <p className="text-muted">You are signed in, but this QR page is limited to the IT Asset Manager role.</p>
      </GateCard>
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
          ) : (
            <p className="text-muted">This sticker is unused. You need permission to create assets to register it.</p>
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

        {token ? (
          <>
            {asset.id ? (
              <p className="help-block">
                After submit, photos and video appear on the asset record.{' '}
                <Link to={`/hardware/${asset.id}?tab=captures`}>Open Captures tab</Link>
              </p>
            ) : null}
            <QrAssetCapturePanel
              token={token}
              assetTag={String(asset.asset_tag || token)}
              assetId={asset.id}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
