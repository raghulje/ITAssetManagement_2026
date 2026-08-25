import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState, type FormEvent } from 'react'
import AppLayout from '../../layout/AppLayout'
import { AppSelect, Box, DataTable, EmployeeSelect, Field, PageForm } from '../../components/ui'
// import { ModuleInsights } from '../../components/ModuleInsights' // restore with insight cards when needed
import { DetailLayout } from '../../components/DetailLayout'
import { MasterSelect, masterPayloadId } from '../../components/MasterSelect'
import { CompanyEntityFields } from '../../components/CompanyEntityFields'
import {
  accessoriesApi,
  componentsApi,
  consumablesApi,
  // dashboardApi, // restore with insight cards when needed
  hardwareApi,
  kitsApi,
  mastersApi,
  usersApi,
  type SelectOption,
} from '../../api/client'
import { formatINR } from '../../utils/money'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'
import { DomainSelect } from '../../components/DomainSelect'
import { defaultDomainCode } from '../../lib/domainScope'

type QtyApi = typeof accessoriesApi
type CategoryType = 'accessory' | 'consumable' | 'component'

function nestId(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'object' && v && 'id' in v) return String((v as { id: number }).id ?? '')
  return String(v)
}

function nestName(v: unknown): string {
  if (v && typeof v === 'object' && 'name' in v) return String((v as { name?: string }).name || '—')
  return v != null && v !== '' ? String(v) : '—'
}

type FormState = {
  name: string
  category_id: string
  company_id: string
  legal_entity_id: string
  location_id: string
  model_number: string
  qty: string
  min_amt: string
  purchase_cost: string
  notes: string
  domain: string
}

const emptyForm: FormState = {
  name: '',
  category_id: '',
  company_id: '',
  legal_entity_id: '',
  location_id: '',
  model_number: '',
  qty: '1',
  min_amt: '0',
  purchase_cost: '',
  notes: '',
  domain: 'it',
}

function QtyList({
  title,
  basePath,
  api,
  createLabel = 'Create New',
}: {
  title: string
  basePath: string
  api: QtyApi
  createLabel?: string
}) {
  const { activeDomain } = useAuth()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState('')
  const [companies, setCompanies] = useState<SelectOption[]>([])
  // const [dash, setDash] = useState<Record<string, number>>({}) // restore with insight cards when needed

  useEffect(() => {
    mastersApi.companies().then((c) => setCompanies(c.results || [])).catch(() => undefined)
  }, [])

  // restore with insight cards when needed
  // useEffect(() => {
  //   let cancelled = false
  //   dashboardApi
  //     .counts({ company_id: companyId || undefined, search: q || undefined })
  //     .then((c) => {
  //       if (!cancelled) setDash(c as Record<string, number>)
  //     })
  //     .catch(() => undefined)
  //   return () => { cancelled = true }
  // }, [companyId, q])

  const load = () => {
    setLoading(true)
    api
      .list({ search: q || undefined, company_id: companyId || undefined, limit: 200 })
      .then((r) => {
        setRows(r.rows || [])
        setTotal(r.total || 0)
      })
      .catch(() => {
        setRows([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [q, companyId, api, activeDomain])

  // restore with insight cards when needed
  // const kindKey = basePath.replace(/^\//, '') as 'accessories' | 'consumables' | 'components'
  // const kindIcon = ...
  // const insightCards = [...]

  return (
    <AppLayout title={title} subtitle={loading ? 'Loading…' : `${total} items`}>
      {/* Module insight cards — restore when needed (kept on Dashboard / Assets / People only)
      <ModuleInsights title={`${title} insights`} cards={insightCards} />
      */}
      <Box
        title={title}
        tools={<Link to={`${basePath}/create`} className="btn btn-primary btn-sm"><i className="fas fa-plus icon-white" /> {createLabel}</Link>}
      >
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', maxWidth: 280 }}>
          <AppSelect
            value={companyId}
            onChange={setCompanyId}
            searchable
            options={[
              { value: '', label: 'All companies' },
              ...companies.map((c) => ({ value: String(c.id), label: c.text })),
            ]}
          />
        </div>
        <DataTable
          search={q}
          onSearch={setQ}
          rows={rows}
          exportName={title.toLowerCase().replace(/\s+/g, '-')}
          storageKey={`${basePath.replace(/\//g, '')}_columns`}
          onRefresh={load}
          onBulkDelete={async (ids) => {
            for (const id of ids) await api.remove(id)
          }}
          columns={[
            { key: 'name', label: 'Name', render: (r) => <Link to={`${basePath}/${r.id}`}>{String(r.name)}</Link> },
            { key: 'category', label: 'Category', exportValue: (r) => nestName(r.category), render: (r) => nestName(r.category) },
            { key: 'model_number', label: 'Model No.' },
            { key: 'qty', label: 'Qty' },
            {
              key: 'assigned',
              label: 'Assigned',
              render: (r) => String(r.assigned ?? Math.max(0, Number(r.qty) - Number(r.remaining))),
            },
            {
              key: 'remaining',
              label: 'Available',
              render: (r) => (
                <span className={Number(r.remaining) <= Number(r.min_amt) ? 'text-danger' : 'text-success'}>
                  {String(r.available ?? r.remaining)}
                </span>
              ),
            },
            { key: 'min_amt', label: 'Min' },
            { key: 'company', label: 'Company', exportValue: (r) => nestName(r.company), render: (r) => nestName(r.company) },
            { key: 'location', label: 'Location', exportValue: (r) => nestName(r.location), render: (r) => nestName(r.location) },
            {
              key: 'purchase_cost',
              label: 'Cost (INR)',
              exportValue: (r) => String(r.purchase_cost ?? ''),
              render: (r) => formatINR(r.purchase_cost),
            },
            {
              key: 'actions',
              label: 'Actions',
              exportable: false,
              render: (r) => (
                <span className="actions">
                  <Link to={`${basePath}/${r.id}/checkout`} className="btn btn-sm btn-info"><i className="fas fa-user-plus" /></Link>
                  <Link to={`${basePath}/${r.id}/edit`} className="btn btn-sm btn-warning"><i className="fas fa-pencil-alt" /></Link>
                </span>
              ),
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

function QtyDetail({
  basePath,
  api,
  kind,
}: {
  basePath: string
  api: QtyApi
  kind: string
}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [item, setItem] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => {
    if (!id) return
    api.get(id).then(setItem).catch(() => setItem(null))
  }

  useEffect(load, [id, api])

  const remove = async () => {
    if (!id || !confirm(`Delete this ${kind.toLowerCase()}?`)) return
    setBusy(true)
    try {
      await api.remove(id)
      toast.success(`${kind} deleted`)
      navigate(basePath)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  if (!item) {
    return (
      <AppLayout title={kind}>
        <Box title={kind}><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={String(item.name)}>
      {msg ? <div className="callout callout-danger"><p>{msg}</p></div> : null}
      <DetailLayout
        title={String(item.name)}
        backTo={basePath}
        status={`${String(item.available ?? item.remaining)} available`}
        meta={[
          { label: 'Qty', value: String(item.qty) },
          { label: 'Assigned', value: String(item.assigned ?? Math.max(0, Number(item.qty) - Number(item.remaining))) },
          { label: 'Location', value: nestName(item.location) },
        ]}
        actions={(
          <>
            <Link to={`${basePath}/${item.id}/checkout`} className="btn btn-info btn-sm"><i className="fas fa-user-plus" /> Assign</Link>
            <Link to={`${basePath}/${item.id}/edit`} className="btn btn-warning btn-sm"><i className="fas fa-pencil-alt" /> Edit</Link>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => { void remove() }}>
              <i className="fas fa-trash" /> Delete
            </button>
          </>
        )}
        panelTitle={`${kind} Details`}
        fields={[
          { label: 'Name', value: String(item.name) },
          { label: 'Category', value: nestName(item.category) },
          { label: 'Model Number', value: String(item.model_number || '—') },
          { label: 'Qty', value: String(item.qty) },
          { label: 'Assigned', value: String(item.assigned ?? Math.max(0, Number(item.qty) - Number(item.remaining))) },
          { label: 'Available', value: String(item.available ?? item.remaining) },
          { label: 'Min Qty', value: String(item.min_amt ?? 0) },
          { label: 'Company', value: nestName(item.company) },
          { label: 'Location', value: nestName(item.location) },
          { label: 'Purchase Cost', value: formatINR(item.purchase_cost) },
          { label: 'Notes', value: String(item.notes || '—'), full: true },
        ]}
      />
    </AppLayout>
  )
}

function QtyForm({
  basePath,
  api,
  kind,
  categoryType,
}: {
  basePath: string
  api: QtyApi
  kind: string
  categoryType: CategoryType
}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { domainScope, activeDomain } = useAuth()
  const isEdit = Boolean(id)
  const [form, setForm] = useState<FormState>({ ...emptyForm, domain: activeDomain || defaultDomainCode(domainScope) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [locations, setLocations] = useState<SelectOption[]>([])
  const [categories, setCategories] = useState<SelectOption[]>([])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    Promise.all([mastersApi.companies(), mastersApi.locations()])
      .then(([c, l]) => {
        setCompanies(c.results || [])
        setLocations(l.results || [])
        if (!isEdit) {
          setForm((f) => ({
            ...f,
            company_id: f.company_id || (c.results?.[0] ? String(c.results[0].id) : ''),
            location_id: f.location_id || (l.results?.[0] ? String(l.results[0].id) : ''),
          }))
        }
      })
      .catch(() => undefined)
  }, [isEdit])

  useEffect(() => {
    mastersApi
      .categories(undefined, categoryType, form.domain || defaultDomainCode(domainScope))
      .then((cat) => setCategories(cat.results || []))
      .catch(() => setCategories([]))
  }, [categoryType, form.domain, domainScope])

  useEffect(() => {
    if (!isEdit || !id) return
    api
      .get(id)
      .then((item) => {
        setForm({
          name: String(item.name || ''),
          category_id: nestId(item.category),
          company_id: nestId(item.company),
          legal_entity_id: nestId(item.legal_entity),
          location_id: nestId(item.location),
          model_number: String(item.model_number || ''),
          qty: String(item.qty ?? 1),
          min_amt: String(item.min_amt ?? 0),
          purchase_cost: item.purchase_cost != null ? String(item.purchase_cost) : '',
          notes: String(item.notes || ''),
          domain: String((item.domain as { code?: string } | null)?.code || defaultDomainCode(domainScope)),
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id, isEdit, api])

  const submit = async () => {
    setBusy(true)
    setError('')
    const body = {
      name: form.name.trim(),
      category_id: form.category_id ? Number(form.category_id) : null,
      company_id: form.company_id ? Number(form.company_id) : null,
      legal_entity_id: form.legal_entity_id ? Number(form.legal_entity_id) : null,
      location_id: form.location_id ? Number(form.location_id) : null,
      model_number: form.model_number || null,
      qty: Number(form.qty) || 1,
      min_amt: Number(form.min_amt) || 0,
      purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
      notes: form.notes || null,
      domain: form.domain,
    }
    try {
      if (isEdit && id) {
        await api.update(id, body)
        toast.success(`${kind} updated`)
        navigate(`${basePath}/${id}`)
      } else {
        const res = await api.create(body)
        const newId = res.payload?.id
        toast.success(`${kind} created`)
        navigate(newId != null ? `${basePath}/${newId}` : basePath)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <AppLayout title={kind}>
        <Box title={kind}><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={isEdit ? `Update ${kind}` : `Create ${kind}`}>
      {error ? <p className="text-danger">{error}</p> : null}
      <PageForm
        cancelTo={isEdit ? `${basePath}/${id}` : basePath}
        onSubmit={() => { void submit() }}
        submitLabel={busy ? 'Saving…' : isEdit ? 'Update' : 'Create'}
        submitDisabled={busy}
      >
        <DomainSelect
          value={form.domain}
          allowed={domainScope.codes}
          onChange={(code) => set('domain', code)}
          required
        />
        <Field label="Name" required>
          <input className="form-control" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>

        <MasterSelect
          label="Category"
          value={form.category_id}
          options={categories}
          onChange={(v) => set('category_id', v)}
          onOptionsChange={setCategories}
          emptyLabel="— Select category —"
          create={async (name) => {
            const res = await mastersApi.createCategory({
              name,
              category_type: categoryType,
              domain: form.domain || defaultDomainCode(domainScope),
            })
            return masterPayloadId(res, name)
          }}
        />

        <Field label="Model Number">
          <input className="form-control" value={form.model_number} onChange={(e) => set('model_number', e.target.value)} />
        </Field>
        <Field label="Quantity" required>
          <input type="number" min={0} className="form-control" value={form.qty} onChange={(e) => set('qty', e.target.value)} required />
        </Field>
        <Field label="Min Qty">
          <input type="number" min={0} className="form-control" value={form.min_amt} onChange={(e) => set('min_amt', e.target.value)} />
        </Field>

        <CompanyEntityFields
          required
          companyId={form.company_id}
          legalEntityId={form.legal_entity_id}
          companies={companies}
          onCompaniesChange={setCompanies}
          onCompanyChange={(v) => set('company_id', v)}
          onLegalEntityChange={(v) => set('legal_entity_id', v)}
        />

        <MasterSelect
          label="Location"
          value={form.location_id}
          options={locations}
          onChange={(v) => set('location_id', v)}
          onOptionsChange={setLocations}
          emptyLabel="— Select location —"
          create={async (name) => {
            const res = await mastersApi.createLocation({
              name,
              company_id: form.company_id ? Number(form.company_id) : null,
            })
            return masterPayloadId(res, name)
          }}
        />

        <Field label="Purchase Cost (INR)">
          <input
            type="number"
            className="form-control"
            value={form.purchase_cost}
            onChange={(e) => set('purchase_cost', e.target.value)}
            placeholder="e.g. 2500"
          />
        </Field>
        <Field label="Notes">
          <textarea className="form-control" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </PageForm>
    </AppLayout>
  )
}

function QtyCheckout({
  basePath,
  api,
  assignMode,
}: {
  basePath: string
  api: QtyApi
  assignMode: 'user' | 'asset' | 'employee'
}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [item, setItem] = useState<Record<string, unknown> | null>(null)
  const [qty, setQty] = useState('1')
  const [targetId, setTargetId] = useState('')
  const [note, setNote] = useState('')
  const [options, setOptions] = useState<SelectOption[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    api.get(id).then(setItem).catch(() => setItem(null))
    if (assignMode === 'user') {
      usersApi.list({ limit: 200 }).then((r) => {
        setOptions((r.rows || []).map((u) => ({
          id: Number(u.id),
          text: String(u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim()),
        })))
      }).catch(() => undefined)
    } else if (assignMode === 'asset') {
      hardwareApi.list({ limit: 200 }).then((r) => {
        setOptions((r.rows || []).map((a) => ({
          id: Number(a.id),
          text: `${a.asset_tag || ''} ${a.name || ''}`.trim(),
        })))
      }).catch(() => undefined)
    }
  }, [id, api, assignMode])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!id) return
    setBusy(true)
    setError('')
    try {
      await api.checkout(id, {
        assigned_qty: Number(qty) || 1,
        checkout_to_type: assignMode,
        assigned_to: assignMode === 'employee' ? undefined : Number(targetId),
        assigned_employee_id: assignMode === 'employee' ? Number(targetId) : undefined,
        asset_id: assignMode === 'asset' ? Number(targetId) : undefined,
        note: note || null,
      })
      toast.success('Assigned successfully')
      navigate(`${basePath}/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assign failed')
    } finally {
      setBusy(false)
    }
  }

  if (!item) {
    return (
      <AppLayout title="Assign">
        <Box title="Assign"><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={`Assign ${String(item.name)}`}>
      <Box title="Assign" type="primary">
        {error ? <p className="text-danger">{error}</p> : null}
        <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
          <Field label="Qty" required>
            <input
              type="number"
              className="form-control"
              value={qty}
              min={1}
              max={Number(item.remaining) || undefined}
              onChange={(e) => setQty(e.target.value)}
              required
            />
            <p className="help-block">Available: {String(item.remaining)}</p>
          </Field>
          <Field label={assignMode === 'employee' ? 'Assign to Employee' : assignMode === 'user' ? 'Assign to App User' : 'Assign to Asset'} required>
            {assignMode === 'employee' ? (
              <EmployeeSelect value={targetId} onChange={setTargetId} required />
            ) : (
              <select className="form-control" value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                <option value="">{assignMode === 'user' ? 'Select user…' : 'Select asset…'}</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
              </select>
            )}
          </Field>
          <Field label="Notes"><textarea className="form-control" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Assigning…' : 'Assign'}</button>
            <Link to={`${basePath}/${item.id}`} className="btn btn-default">Cancel</Link>
          </div>
        </form>
      </Box>
    </AppLayout>
  )
}

export const AccessoriesList = () => <QtyList title="Accessories" basePath="/accessories" api={accessoriesApi} />
export const AccessoryDetail = () => <QtyDetail basePath="/accessories" api={accessoriesApi} kind="Accessory" />
export const AccessoryForm = () => (
  <QtyForm basePath="/accessories" api={accessoriesApi} kind="Accessory" categoryType="accessory" />
)
export const AccessoryCheckout = () => (
  <QtyCheckout basePath="/accessories" api={accessoriesApi} assignMode="employee" />
)

export const ConsumablesList = () => <QtyList title="Consumables" basePath="/consumables" api={consumablesApi} />
export const ConsumableDetail = () => <QtyDetail basePath="/consumables" api={consumablesApi} kind="Consumable" />
export const ConsumableForm = () => (
  <QtyForm basePath="/consumables" api={consumablesApi} kind="Consumable" categoryType="consumable" />
)
export const ConsumableCheckout = () => (
  <QtyCheckout basePath="/consumables" api={consumablesApi} assignMode="employee" />
)

export const ComponentsList = () => <QtyList title="Components" basePath="/components" api={componentsApi} />
export const ComponentDetail = () => <QtyDetail basePath="/components" api={componentsApi} kind="Component" />
export const ComponentForm = () => (
  <QtyForm basePath="/components" api={componentsApi} kind="Component" categoryType="component" />
)
export const ComponentCheckout = () => (
  <QtyCheckout basePath="/components" api={componentsApi} assignMode="asset" />
)

export function KitsList() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    kitsApi
      .list()
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <AppLayout title="Predefined Kits" subtitle={loading ? 'Loading…' : `${rows.length} kits`}>
      <Box title="Kits" tools={<Link to="/kits/create" className="btn btn-primary btn-sm"><i className="fas fa-plus" /> Create</Link>}>
        <table className="table table-striped table-hover">
          <thead><tr><th>Name</th><th>Models</th><th>Licenses</th><th>Accessories</th><th>Consumables</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="text-muted">{loading ? 'Loading…' : 'No kits yet'}</td></tr>
            ) : rows.map((k) => (
              <tr key={String(k.id)}>
                <td><Link to={`/kits/${k.id}`}>{String(k.name)}</Link></td>
                <td>{String(k.models ?? 0)}</td>
                <td>{String(k.licenses ?? 0)}</td>
                <td>{String(k.accessories ?? 0)}</td>
                <td>{String(k.consumables ?? 0)}</td>
                <td><Link to={`/kits/${k.id}/checkout`} className="btn btn-sm btn-info">Assign</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}

export function KitDetail() {
  const { id } = useParams()
  const [kit, setKit] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!id) return
    kitsApi.get(id).then(setKit).catch(() => setKit(null))
  }, [id])

  if (!kit) {
    return (
      <AppLayout title="Kit">
        <Box title="Kit"><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  const models = (kit.models as unknown[]) || []
  const licenses = (kit.licenses as unknown[]) || []
  const accessories = (kit.accessories as unknown[]) || []
  const consumables = (kit.consumables as unknown[]) || []

  return (
    <AppLayout title={String(kit.name)}>
      <div className="toolbar mb-15">
        <Link to="/kits" className="btn btn-default"><i className="fas fa-arrow-left" /> Back</Link>
        <Link to={`/kits/${kit.id}/checkout`} className="btn btn-info">Assign Kit</Link>
        <Link to={`/kits/${kit.id}/edit`} className="btn btn-warning">Edit</Link>
      </div>
      <Box title="Kit Contents" type="primary">
        <ul>
          <li>{Array.isArray(models) ? models.length : Number(models)} asset model(s)</li>
          <li>{Array.isArray(licenses) ? licenses.length : Number(licenses)} license(s)</li>
          <li>{Array.isArray(accessories) ? accessories.length : Number(accessories)} accessory type(s)</li>
          <li>{Array.isArray(consumables) ? consumables.length : Number(consumables)} consumable type(s)</li>
        </ul>
        {kit.notes ? <p>{String(kit.notes)}</p> : null}
      </Box>
    </AppLayout>
  )
}

export function KitForm() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await kitsApi.create({ name: name.trim(), notes: notes || null })
      const newId = res.payload?.id
      navigate(newId != null ? `/kits/${newId}` : '/kits')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout title="Create Kit">
      {error ? <p className="text-danger">{error}</p> : null}
      <PageForm
        cancelTo="/kits"
        onSubmit={() => { void submit() }}
        submitLabel={busy ? 'Saving…' : 'Create'}
        submitDisabled={busy}
      >
        <Field label="Name" required>
          <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Notes">
          <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </PageForm>
    </AppLayout>
  )
}

export function KitCheckout() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [kit, setKit] = useState<Record<string, unknown> | null>(null)
  const [users, setUsers] = useState<SelectOption[]>([])
  const [userId, setUserId] = useState('')
  const [msg, setMsg] = useState('Kit assign will be available once kit contents are configured.')

  useEffect(() => {
    if (!id) return
    kitsApi.get(id).then(setKit).catch(() => setKit(null))
    usersApi.list({ limit: 200 }).then((r) => {
      setUsers((r.rows || []).map((u) => ({
        id: Number(u.id),
        text: String(u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim()),
      })))
    }).catch(() => undefined)
  }, [id])

  if (!kit) {
    return (
      <AppLayout title="Assign Kit">
        <Box title="Assign"><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={`Assign ${String(kit.name)}`}>
      <Box title="Assign Kit" type="primary">
        <p className="help-block">{msg}</p>
        <form
          className="form-horizontal"
          onSubmit={(e) => {
            e.preventDefault()
            setMsg('Configure kit contents first, then assign from Accessories / Licenses individually.')
            navigate('/kits')
          }}
        >
          <Field label="App User" required>
            <select className="form-control" value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Select user…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.text}</option>)}
            </select>
          </Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-theme">Continue</button>
            <Link to="/kits" className="btn btn-default">Cancel</Link>
          </div>
        </form>
      </Box>
    </AppLayout>
  )
}
