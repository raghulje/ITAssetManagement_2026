import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import AppLayout from '../../layout/AppLayout'
import { Box, Field, PageForm, DataTable } from '../../components/ui'
import { api, mastersApi, type SelectOption } from '../../api/client'
import { useToast } from '../../components/Toast'

type Row = Record<string, string | number | boolean>
type MasterKind = 'companies' | 'departments' | 'locations'

const MASTER_META: Record<MasterKind, {
  title: string
  basePath: string
  columns: { key: string; label: string }[]
  subtitle: string
}> = {
  companies: {
    title: 'Companies',
    basePath: '/companies',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Company / entity code' },
      { key: 'notes', label: 'Notes' },
    ],
    subtitle: 'HRMS companies + LEGAL_ENTITY_CODE (sync masters after HRMS sync)',
  },
  departments: {
    title: 'Departments',
    basePath: '/departments',
    columns: [{ key: 'name', label: 'Name' }, { key: 'company', label: 'Company' }, { key: 'notes', label: 'Notes' }],
    subtitle: 'HRMS + manually added department masters',
  },
  locations: {
    title: 'Locations',
    basePath: '/locations',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'company', label: 'Company' },
      { key: 'office', label: 'Office' },
      { key: 'assets_count', label: 'Assets' },
      { key: 'notes', label: 'Notes' },
    ],
    subtitle: 'HRMS + manually added location masters',
  },
}

function cellValue(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  if (v == null) return '—'
  if (typeof v === 'object' && v && 'name' in v) return String((v as { name?: string }).name || '—')
  return String(v)
}

function ApiMasterList({ kind }: { kind: MasterKind }) {
  const meta = MASTER_META[kind]
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    const loader =
      kind === 'companies' ? mastersApi.listCompanies
        : kind === 'departments' ? mastersApi.listDepartments
          : mastersApi.listLocations
    loader({ search: search || undefined, limit: 500 })
      .then((res) => {
        setRows(res.rows || [])
        setTotal(res.total || res.rows?.length || 0)
        setError('')
      })
      .catch((e: Error) => {
        setError(e.message)
        setRows([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [search, kind])

  const remover =
    kind === 'companies' ? mastersApi.removeCompany
      : kind === 'departments' ? mastersApi.removeDepartment
        : mastersApi.removeLocation

  return (
    <AppLayout title={meta.title} subtitle={loading ? 'Loading…' : `${total} records · ${meta.subtitle}`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <Box
        title={meta.title}
        type="primary"
        tools={(
          <Link to={`${meta.basePath}/create`} className="btn btn-theme btn-sm">
            <i className="fas fa-plus" /> Create New
          </Link>
        )}
      >
        <DataTable
          search={search}
          onSearch={setSearch}
          rows={rows}
          exportName={kind}
          storageKey={`${kind}_columns`}
          onRefresh={load}
          onBulkDelete={async (ids) => {
            for (const id of ids) await remover(id)
          }}
          columns={[
            ...meta.columns.map((c) => ({
              key: c.key,
              label: c.label,
              render: (r: Record<string, unknown>) => (
                c.key === 'name'
                  ? <Link to={`${meta.basePath}/${r.id}`}>{cellValue(r, 'name')}</Link>
                  : cellValue(r, c.key)
              ),
              exportValue: (r: Record<string, unknown>) => cellValue(r, c.key),
            })),
            {
              key: 'actions',
              label: 'Actions',
              exportable: false as const,
              render: (r: Record<string, unknown>) => (
                <Link to={`${meta.basePath}/${r.id}/edit`} className="btn btn-sm btn-warning" title="Edit">
                  <i className="fas fa-pencil-alt" />
                </Link>
              ),
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

function ApiMasterForm({ kind }: { kind: MasterKind }) {
  const meta = MASTER_META[kind]
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const [address, setAddress] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [isOffice, setIsOffice] = useState(false)
  const [floorCounts, setFloorCounts] = useState({ total: 0, active: 0, inactive: 0 })
  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    if (kind === 'departments' || kind === 'locations') {
      mastersApi.companies().then((r) => setCompanies(r.results || [])).catch(() => undefined)
    }
  }, [kind])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    const path =
      kind === 'companies' ? `/companies/${id}`
        : kind === 'departments' ? `/departments/${id}`
          : `/locations/${id}`
    api<Record<string, unknown>>(path)
      .then((row) => {
        setName(String(row.name || ''))
        setCode(String(row.code || ''))
        setNotes(String(row.notes || ''))
        setAddress(String(row.address || ''))
        const co = row.company
        if (co && typeof co === 'object' && 'id' in co) setCompanyId(String((co as { id: number }).id))
        else if (row.company_id) setCompanyId(String(row.company_id))
        setIsOffice(Boolean(row.is_office))
        setFloorCounts({
          total: Number(row.floors_total || 0),
          active: Number(row.floors_active || 0),
          inactive: Number(row.floors_inactive || 0),
        })
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, kind])

  const submit = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (kind === 'companies') {
        const body = { name: name.trim(), code: code.trim() || null, notes: notes || null }
        if (isEdit && id) await mastersApi.updateCompany(id, body)
        else await mastersApi.createCompany(body)
      } else if (kind === 'departments') {
        const body = {
          name: name.trim(),
          notes: notes || null,
          company_id: companyId ? Number(companyId) : null,
        }
        if (isEdit && id) await mastersApi.updateDepartment(id, body)
        else await mastersApi.createDepartment(body)
      } else {
        const body = {
          name: name.trim(),
          notes: notes || null,
          address: address || null,
          company_id: companyId ? Number(companyId) : null,
          is_office: isOffice,
        }
        if (isEdit && id) await mastersApi.updateLocation(id, body)
        else await mastersApi.createLocation(body)
      }
      toast.success(isEdit ? 'Updated' : 'Created')
      navigate(meta.basePath)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <AppLayout title={meta.title}><p className="text-muted">Loading…</p></AppLayout>
  }

  const singular = meta.title.endsWith('ies')
    ? `${meta.title.slice(0, -3)}y`
    : meta.title.slice(0, -1)

  return (
    <AppLayout title={isEdit ? `Edit ${singular}` : `Create ${singular}`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm
        cancelTo={meta.basePath}
        onSubmit={() => { void submit() }}
        submitLabel={busy ? 'Saving…' : 'Save'}
        submitDisabled={busy}
      >
        <Field label="Name" required>
          <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        {kind === 'companies' && (
          <Field label="Company / entity code">
            <input className="form-control" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. Refex" />
            <p className="help-block">Primary HRMS LEGAL_ENTITY_CODE for this company</p>
          </Field>
        )}
        {(kind === 'departments' || kind === 'locations') && (
          <Field label="Company">
            <select className="form-control" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">—</option>
              {companies.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
            </select>
          </Field>
        )}
        {kind === 'locations' && (
          <>
            <Field label="Address">
              <textarea className="form-control" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <Field label="Office location">
              <label className="checkbox-inline" style={{ fontWeight: 400 }}>
                <input type="checkbox" checked={isOffice} onChange={(e) => setIsOffice(e.target.checked)} />
                {' '}This is an office location
              </label>
              <p className="help-block">
                Office locations can have floors, cabins, meeting rooms and workstations under Space Management.
              </p>
              {isOffice && isEdit ? (
                <p className="help-block mb-0">
                  Floors: {floorCounts.total} total · {floorCounts.active} active · {floorCounts.inactive} inactive
                  {' · '}
                  <Link to={`/spaces?office=${id}`}>Open Space Management</Link>
                </p>
              ) : null}
            </Field>
          </>
        )}
        <Field label="Notes">
          <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </PageForm>
    </AppLayout>
  )
}

function ApiMasterDetail({ kind }: { kind: MasterKind }) {
  const meta = MASTER_META[kind]
  const { id } = useParams()
  const [row, setRow] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    const path =
      kind === 'companies' ? `/companies/${id}`
        : kind === 'departments' ? `/departments/${id}`
          : `/locations/${id}`
    api<Record<string, unknown>>(path)
      .then(setRow)
      .catch((e: Error) => setError(e.message))
  }, [id, kind])

  if (!row) {
    return (
      <AppLayout title={meta.title}>
        {error ? <div className="callout callout-danger"><p>{error}</p></div> : <p className="text-muted">Loading…</p>}
      </AppLayout>
    )
  }

  return (
    <AppLayout title={String(row.name || meta.title)}>
      <div className="toolbar mb-15">
        <Link to={meta.basePath} className="btn btn-default"><i className="fas fa-arrow-left" /> Back</Link>
        <Link to={`${meta.basePath}/${row.id}/edit`} className="btn btn-warning">Edit</Link>
      </div>
      <Box title="Details" type="primary">
        <dl className="detail-dl">
          <dt>Name</dt><dd>{String(row.name || '—')}</dd>
          {row.company != null && (
            <>
              <dt>Company</dt>
              <dd>{cellValue(row, 'company')}</dd>
            </>
          )}
          {row.address != null && row.address !== '' && (
            <>
              <dt>Address</dt>
              <dd>{String(row.address)}</dd>
            </>
          )}
          {kind === 'locations' ? (
            <>
              <dt>Office location</dt>
              <dd>{row.is_office ? 'Yes' : 'No'}</dd>
              {row.is_office ? (
                <>
                  <dt>Floors</dt>
                  <dd>
                    {Number(row.floors_total || 0)} total · {Number(row.floors_active || 0)} active · {Number(row.floors_inactive || 0)} inactive
                    {' · '}
                    <Link to={`/spaces?office=${row.id}`}>Space Management</Link>
                  </dd>
                </>
              ) : null}
            </>
          ) : null}
          <dt>Notes</dt><dd>{String(row.notes || '—')}</dd>
        </dl>
      </Box>
    </AppLayout>
  )
}

function MasterList({
  title, basePath, columns, rows, createLabel = 'Create New',
}: {
  title: string
  basePath: string
  columns: { key: string; label: string }[]
  rows: Row[]
  createLabel?: string
}) {
  return (
    <AppLayout title={title}>
      <Box
        title={title}
        tools={<Link to={`${basePath}/create`} className="btn btn-primary btn-sm"><i className="fas fa-plus icon-white" /> {createLabel}</Link>}
      >
        <table className="table table-striped table-hover">
          <thead>
            <tr>
              {columns.map((c) => <th key={c.key}>{c.label}</th>)}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.key === 'name'
                      ? <Link to={`${basePath}/${r.id}`}>{String(r[c.key])}</Link>
                      : String(r[c.key] ?? '')}
                  </td>
                ))}
                <td>
                  <Link to={`${basePath}/${r.id}/edit`} className="btn btn-sm btn-warning"><i className="fas fa-pencil-alt" /></Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}

type CrudField =
  | { key: string; label: string; type?: 'text' | 'number' | 'textarea' | 'color'; required?: boolean; placeholder?: string }
  | { key: string; label: string; type: 'select'; required?: boolean; options: { value: string; label: string }[] }
  | { key: string; label: string; type: 'checkbox' }

function CrudResourceForm({
  title,
  basePath,
  apiPath,
  fields,
  toPayload,
  fromRow,
}: {
  title: string
  basePath: string
  apiPath: string
  fields: CrudField[]
  toPayload?: (values: Record<string, string | boolean>) => Record<string, unknown>
  fromRow?: (row: Record<string, unknown>) => Record<string, string | boolean>
}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    const initial: Record<string, string | boolean> = {}
    for (const f of fields) {
      initial[f.key] = f.type === 'checkbox' ? false : ''
    }
    setValues(initial)
  }, [apiPath])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api<Record<string, unknown>>(`${apiPath}/${id}`)
      .then((row) => {
        const mapped = fromRow
          ? fromRow(row)
          : Object.fromEntries(fields.map((f) => {
            const v = row[f.key]
            if (f.type === 'checkbox') return [f.key, Boolean(v)]
            return [f.key, v == null ? '' : String(v)]
          }))
        setValues((prev) => ({ ...prev, ...mapped }))
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, apiPath])

  const set = (key: string, v: string | boolean) => setValues((prev) => ({ ...prev, [key]: v }))

  const submit = async () => {
    const nameField = fields.find((f) => f.key === 'name' && f.type !== 'checkbox')
    if (nameField && !String(values.name || '').trim()) {
      setError('Name is required')
      return
    }
    setBusy(true)
    setError('')
    try {
      const body = toPayload
        ? toPayload(values)
        : Object.fromEntries(fields.map((f) => {
          if (f.type === 'checkbox') return [f.key, values[f.key] ? 1 : 0]
          if (f.type === 'number') {
            const n = String(values[f.key] ?? '').trim()
            return [f.key, n === '' ? null : Number(n)]
          }
          const s = String(values[f.key] ?? '').trim()
          return [f.key, s === '' ? null : s]
        }))
      if (isEdit && id) await api(`${apiPath}/${id}`, { method: 'PUT', json: body })
      else await api(apiPath, { method: 'POST', json: body })
      toast.success(isEdit ? `${title} updated` : `${title} created`)
      navigate(basePath)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <AppLayout title={title}><p className="text-muted">Loading…</p></AppLayout>
  }

  return (
    <AppLayout title={isEdit ? `Edit ${title}` : `Create ${title}`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm
        cancelTo={basePath}
        onSubmit={() => { void submit() }}
        submitLabel={busy ? 'Saving…' : 'Save'}
        submitDisabled={busy}
      >
        {fields.map((f) => {
          if (f.type === 'checkbox') {
            return (
              <Field key={f.key} label={f.label}>
                <label className="checkbox-inline" style={{ paddingTop: 7 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(values[f.key])}
                    onChange={(e) => set(f.key, e.target.checked)}
                  />{' '}
                  Yes
                </label>
              </Field>
            )
          }
          if (f.type === 'select') {
            return (
              <Field key={f.key} label={f.label} required={f.required}>
                <select
                  className="form-control"
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => set(f.key, e.target.value)}
                  required={f.required}
                >
                  <option value="">—</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            )
          }
          if (f.type === 'textarea') {
            return (
              <Field key={f.key} label={f.label}>
                <textarea
                  className="form-control"
                  value={String(values[f.key] ?? '')}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              </Field>
            )
          }
          return (
            <Field key={f.key} label={f.label} required={f.required}>
              <input
                className="form-control"
                type={f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'}
                value={String(values[f.key] ?? (f.type === 'color' ? '#03989e' : ''))}
                onChange={(e) => set(f.key, e.target.value)}
                required={f.required}
                placeholder={f.placeholder}
              />
            </Field>
          )
        })}
      </PageForm>
    </AppLayout>
  )
}

function CrudResourceDetail({
  title,
  basePath,
  apiPath,
  fields,
}: {
  title: string
  basePath: string
  apiPath: string
  fields: { key: string; label: string; format?: (v: unknown, row: Record<string, unknown>) => string }[]
}) {
  const { id } = useParams()
  const [row, setRow] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api<Record<string, unknown>>(`${apiPath}/${id}`)
      .then((r) => { setRow(r); setError('') })
      .catch((e: Error) => { setError(e.message); setRow(null) })
      .finally(() => setLoading(false))
  }, [id, apiPath])

  if (loading) return <AppLayout title={title}><p className="text-muted">Loading…</p></AppLayout>
  if (error || !row) {
    return (
      <AppLayout title={title}>
        <div className="callout callout-danger"><p>{error || 'Not found'}</p></div>
        <Link to={basePath} className="btn btn-default">Back</Link>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={String(row.name || title)}>
      <div className="toolbar mb-15">
        <Link to={basePath} className="btn btn-default"><i className="fas fa-arrow-left" /> Back</Link>
        <Link to={`${basePath}/${id}/edit`} className="btn btn-warning">Edit</Link>
      </div>
      <Box title="Details" type="primary">
        <dl className="detail-dl">
          {fields.map((f) => (
            <span key={f.key} style={{ display: 'contents' }}>
              <dt>{f.label}</dt>
              <dd>{f.format ? f.format(row[f.key], row) : String(row[f.key] ?? '—')}</dd>
            </span>
          ))}
        </dl>
      </Box>
    </AppLayout>
  )
}

function ApiCrudList({
  title,
  basePath,
  apiPath,
  columns,
  mapRow,
  nameLink = 'edit',
}: {
  title: string
  basePath: string
  apiPath: string
  columns: { key: string; label: string }[]
  mapRow?: (r: Record<string, unknown>) => Row
  nameLink?: 'detail' | 'edit'
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = () => {
    setLoading(true)
    api<{ rows: Record<string, unknown>[] }>(`${apiPath}?limit=500${search ? `&search=${encodeURIComponent(search)}` : ''}`)
      .then((r) => setRows((r.rows || []).map((row) => (mapRow ? mapRow(row) : row as Row))))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [apiPath, search])

  return (
    <AppLayout title={title} subtitle={loading ? 'Loading…' : `${rows.length} records`}>
      <Box
        title={title}
        tools={<Link to={`${basePath}/create`} className="btn btn-primary btn-sm"><i className="fas fa-plus icon-white" /> Create New</Link>}
      >
        <DataTable
          search={search}
          onSearch={setSearch}
          rows={rows as Record<string, unknown>[]}
          exportName={title.toLowerCase().replace(/\s+/g, '-')}
          storageKey={`${basePath.replace(/\//g, '')}_columns`}
          onRefresh={load}
          onBulkDelete={async (ids) => {
            for (const id of ids) await api(`${apiPath}/${id}`, { method: 'DELETE' })
          }}
          columns={[
            ...columns.map((c) => ({
              key: c.key,
              label: c.label,
              render: (r: Record<string, unknown>) => (
                c.key === 'name'
                  ? <Link to={nameLink === 'detail' ? `${basePath}/${r.id}` : `${basePath}/${r.id}/edit`}>{String(r[c.key])}</Link>
                  : String(r[c.key] ?? '')
              ),
            })),
            {
              key: 'actions',
              label: 'Actions',
              exportable: false as const,
              render: (r: Record<string, unknown>) => (
                <Link to={`${basePath}/${r.id}/edit`} className="btn btn-sm btn-warning"><i className="fas fa-pencil-alt" /></Link>
              ),
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

export const ModelsList = () => <ModelsApiList />
export const ModelDetail = () => <ModelApiDetail />
export const ModelForm = () => <ModelApiForm />

export const CategoriesList = () => (
  <ApiCrudList
    title="Categories"
    basePath="/categories"
    apiPath="/categories"
    nameLink="detail"
    columns={[
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'require_acceptance', label: 'Require Acceptance' },
    ]}
    mapRow={(c) => ({
      id: Number(c.id),
      name: String(c.name || ''),
      type: String(c.category_type || c.type || ''),
      require_acceptance: c.require_acceptance ? 'Yes' : 'No',
    })}
  />
)
export const CategoryDetail = () => (
  <CrudResourceDetail
    title="Category"
    basePath="/categories"
    apiPath="/categories"
    fields={[
      { key: 'name', label: 'Name' },
      { key: 'category_type', label: 'Type', format: (v, row) => String(v || row.type || '—') },
      { key: 'require_acceptance', label: 'Require Acceptance', format: (v) => (v ? 'Yes' : 'No') },
    ]}
  />
)
export const CategoryForm = () => (
  <CrudResourceForm
    title="Category"
    basePath="/categories"
    apiPath="/categories"
    fields={[
      { key: 'name', label: 'Name', required: true },
      {
        key: 'category_type',
        label: 'Type',
        type: 'select',
        required: true,
        options: [
          { value: 'asset', label: 'Asset' },
          { value: 'accessory', label: 'Accessory' },
          { value: 'consumable', label: 'Consumable' },
          { value: 'component', label: 'Component' },
          { value: 'license', label: 'License' },
        ],
      },
      { key: 'require_acceptance', label: 'Require Acceptance', type: 'checkbox' },
    ]}
    fromRow={(row) => ({
      name: String(row.name || ''),
      category_type: String(row.category_type || row.type || ''),
      require_acceptance: Boolean(row.require_acceptance),
    })}
    toPayload={(v) => ({
      name: String(v.name || '').trim(),
      category_type: String(v.category_type || 'asset'),
      require_acceptance: v.require_acceptance ? 1 : 0,
    })}
  />
)

export const StatusLabelsList = () => (
  <ApiCrudList
    title="Status Labels"
    basePath="/statuslabels"
    apiPath="/statuslabels"
    columns={[
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'color', label: 'Colour' },
    ]}
  />
)
export const StatusLabelForm = () => (
  <CrudResourceForm
    title="Status Label"
    basePath="/statuslabels"
    apiPath="/statuslabels"
    fields={[
      { key: 'name', label: 'Name', required: true },
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        required: true,
        options: [
          { value: 'deployable', label: 'Deployable' },
          { value: 'pending', label: 'Pending' },
          { value: 'archived', label: 'Archived' },
          { value: 'undeployable', label: 'Undeployable' },
        ],
      },
      { key: 'color', label: 'Colour', type: 'color' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ]}
  />
)

export const LocationsList = () => <ApiMasterList kind="locations" />
export const LocationDetail = () => <ApiMasterDetail kind="locations" />
export const LocationForm = () => <ApiMasterForm kind="locations" />

export const CompaniesList = () => <ApiMasterList kind="companies" />
export const CompanyDetail = () => <ApiMasterDetail kind="companies" />
export const CompanyForm = () => <ApiMasterForm kind="companies" />

export const DepartmentsList = () => <ApiMasterList kind="departments" />
export const DepartmentDetail = () => <ApiMasterDetail kind="departments" />
export const DepartmentForm = () => <ApiMasterForm kind="departments" />

export const ManufacturersList = () => (
  <ApiCrudList
    title="Manufacturers"
    basePath="/manufacturers"
    apiPath="/manufacturers"
    columns={[{ key: 'name', label: 'Name' }, { key: 'url', label: 'URL' }]}
  />
)
export const ManufacturerForm = () => (
  <CrudResourceForm
    title="Manufacturer"
    basePath="/manufacturers"
    apiPath="/manufacturers"
    fields={[
      { key: 'name', label: 'Name', required: true },
      { key: 'url', label: 'URL', placeholder: 'https://' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ]}
  />
)

export const SuppliersList = () => <SuppliersApiList />
export const SupplierForm = () => <SupplierApiForm />

export const DepreciationsList = () => (
  <ApiCrudList
    title="Depreciation"
    basePath="/depreciations"
    apiPath="/depreciations"
    columns={[{ key: 'name', label: 'Name' }, { key: 'months', label: 'Term (months)' }]}
  />
)
export const DepreciationForm = () => (
  <CrudResourceForm
    title="Depreciation"
    basePath="/depreciations"
    apiPath="/depreciations"
    fields={[
      { key: 'name', label: 'Name', required: true },
      { key: 'months', label: 'Term (months)', type: 'number', required: true },
    ]}
  />
)

export const FieldsList = () => (
  <ApiCrudList
    title="Custom Fields"
    basePath="/fields"
    apiPath="/fields"
    columns={[{ key: 'name', label: 'Name' }, { key: 'format', label: 'Format' }]}
  />
)
export const FieldForm = () => (
  <CrudResourceForm
    title="Custom Field"
    basePath="/fields"
    apiPath="/fields"
    fields={[
      { key: 'name', label: 'Name', required: true },
      { key: 'db_column', label: 'DB Column', required: true, placeholder: 'e.g. _snipeit_serial_1' },
      {
        key: 'format',
        label: 'Format',
        type: 'select',
        required: true,
        options: [
          { value: 'ANY', label: 'Any' },
          { value: 'ALPHA', label: 'Alpha' },
          { value: 'NUMERIC', label: 'Numeric' },
          { value: 'ALPHA_DASH', label: 'Alpha Dash' },
          { value: 'EMAIL', label: 'Email' },
          { value: 'DATE', label: 'Date' },
          { value: 'URL', label: 'URL' },
          { value: 'IP', label: 'IP' },
          { value: 'BOOLEAN', label: 'Boolean' },
        ],
      },
      {
        key: 'element',
        label: 'Element',
        type: 'select',
        options: [
          { value: 'text', label: 'Text' },
          { value: 'textarea', label: 'Textarea' },
          { value: 'listbox', label: 'Listbox' },
          { value: 'checkbox', label: 'Checkbox' },
          { value: 'radio', label: 'Radio' },
        ],
      },
      { key: 'field_values', label: 'List Values (comma-separated)', type: 'textarea' },
    ]}
    toPayload={(v) => ({
      name: String(v.name || '').trim(),
      db_column: String(v.db_column || '').trim(),
      format: String(v.format || 'ANY'),
      element: String(v.element || 'text'),
      field_values: String(v.field_values || '').trim() || null,
    })}
  />
)

function ModelsApiList() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    mastersApi.listModels({ search: search || undefined })
      .then((r) => { setRows(r.rows || []); setError('') })
      .catch((e: Error) => { setError(e.message); setRows([]) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [search])

  return (
    <AppLayout title="Asset Models" subtitle={loading ? 'Loading…' : `${rows.length} models`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <Box
        title="Asset Models"
        type="primary"
        tools={(
          <>
            <Link to="/import?type=model" className="btn btn-default btn-sm"><i className="fas fa-file-import" /> Import</Link>
            {' '}
            <Link to="/models/create" className="btn btn-theme btn-sm"><i className="fas fa-plus" /> Create New</Link>
          </>
        )}
      >
        <DataTable
          search={search}
          onSearch={setSearch}
          rows={rows}
          exportName="models"
          storageKey="models_columns"
          onRefresh={load}
          onBulkDelete={async (ids) => {
            for (const id of ids) await mastersApi.removeModel(id)
          }}
          columns={[
            { key: 'name', label: 'Name', render: (r) => <Link to={`/models/${r.id}`}>{String(r.name)}</Link> },
            { key: 'model_number', label: 'Model No.' },
            { key: 'category', label: 'Category', exportValue: (r) => cellValue(r, 'category'), render: (r) => cellValue(r, 'category') },
            { key: 'manufacturer', label: 'Manufacturer', exportValue: (r) => cellValue(r, 'manufacturer'), render: (r) => cellValue(r, 'manufacturer') },
            { key: 'assets_count', label: 'Assets' },
            {
              key: 'actions',
              label: 'Actions',
              exportable: false,
              render: (r) => <Link to={`/models/${r.id}/edit`} className="btn btn-sm btn-warning"><i className="fas fa-pencil-alt" /></Link>,
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

function ModelApiForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)
  const [name, setName] = useState('')
  const [modelNumber, setModelNumber] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [manufacturerId, setManufacturerId] = useState('')
  const [notes, setNotes] = useState('')
  const [categories, setCategories] = useState<SelectOption[]>([])
  const [manufacturers, setManufacturers] = useState<SelectOption[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    Promise.all([mastersApi.categories(), mastersApi.manufacturers()])
      .then(([c, m]) => {
        setCategories(c.results || [])
        setManufacturers(m.results || [])
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    mastersApi.getModel(id)
      .then((row) => {
        setName(String(row.name || ''))
        setModelNumber(String(row.model_number || ''))
        setCategoryId(row.category_id != null ? String(row.category_id) : '')
        setManufacturerId(row.manufacturer_id != null ? String(row.manufacturer_id) : '')
        setNotes(String(row.notes || ''))
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const submit = async () => {
    if (!name.trim()) return setError('Name is required')
    setBusy(true)
    setError('')
    try {
      const body = {
        name: name.trim(),
        model_number: modelNumber || null,
        category_id: categoryId ? Number(categoryId) : null,
        manufacturer_id: manufacturerId ? Number(manufacturerId) : null,
        notes: notes || null,
      }
      if (isEdit && id) await mastersApi.updateModel(id, body)
      else await mastersApi.createModel(body)
      toast.success(isEdit ? 'Model updated' : 'Model created')
      navigate('/models')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <AppLayout title="Asset Model"><p className="text-muted">Loading…</p></AppLayout>

  return (
    <AppLayout title={isEdit ? 'Edit Asset Model' : 'Create Asset Model'}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm cancelTo="/models" onSubmit={() => { void submit() }} submitLabel={busy ? 'Saving…' : 'Save'} submitDisabled={busy}>
        <Field label="Name" required>
          <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Model Number">
          <input className="form-control" value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
        </Field>
        <Field label="Category">
          <select className="form-control" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">—</option>
            {categories.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
          </select>
        </Field>
        <Field label="Manufacturer">
          <select className="form-control" value={manufacturerId} onChange={(e) => setManufacturerId(e.target.value)}>
            <option value="">—</option>
            {manufacturers.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
          </select>
        </Field>
        <Field label="Notes">
          <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </PageForm>
    </AppLayout>
  )
}

function ModelApiDetail() {
  const { id } = useParams()
  const [row, setRow] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    mastersApi.getModel(id).then(setRow).catch((e: Error) => setError(e.message))
  }, [id])

  if (!row) {
    return (
      <AppLayout title="Asset Model">
        {error ? <div className="callout callout-danger"><p>{error}</p></div> : <p className="text-muted">Loading…</p>}
      </AppLayout>
    )
  }

  return (
    <AppLayout title={String(row.name || 'Asset Model')}>
      <div className="toolbar mb-15">
        <Link to="/models" className="btn btn-default"><i className="fas fa-arrow-left" /> Back</Link>
        <Link to={`/models/${row.id}/edit`} className="btn btn-warning">Edit</Link>
      </div>
      <Box title="Details" type="primary">
        <dl className="detail-dl">
          <dt>Name</dt><dd>{String(row.name || '—')}</dd>
          <dt>Model Number</dt><dd>{String(row.model_number || '—')}</dd>
          <dt>Notes</dt><dd>{String(row.notes || '—')}</dd>
        </dl>
      </Box>
    </AppLayout>
  )
}

function SuppliersApiList() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    mastersApi.listSuppliers({ search: search || undefined, limit: 500 })
      .then((r) => { setRows(r.rows || []); setError('') })
      .catch((e: Error) => { setError(e.message); setRows([]) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [search])

  return (
    <AppLayout title="Suppliers / Vendors" subtitle={loading ? 'Loading…' : `${rows.length} suppliers`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <Box
        title="Suppliers / Vendors"
        type="primary"
        tools={(
          <>
            <Link to="/import?type=supplier" className="btn btn-default btn-sm"><i className="fas fa-file-import" /> Import</Link>
            {' '}
            <Link to="/suppliers/create" className="btn btn-theme btn-sm"><i className="fas fa-plus" /> Create New</Link>
          </>
        )}
      >
        <DataTable
          search={search}
          onSearch={setSearch}
          rows={rows}
          exportName="suppliers"
          storageKey="suppliers_columns"
          onRefresh={load}
          onBulkDelete={async (ids) => {
            for (const id of ids) await mastersApi.removeSupplier(id)
          }}
          columns={[
            { key: 'name', label: 'Name', render: (r) => <Link to={`/suppliers/${r.id}/edit`}>{String(r.name)}</Link> },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone' },
            { key: 'url', label: 'URL' },
            {
              key: 'actions',
              label: 'Actions',
              exportable: false,
              render: (r) => <Link to={`/suppliers/${r.id}/edit`} className="btn btn-sm btn-warning"><i className="fas fa-pencil-alt" /></Link>,
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

function SupplierApiForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)
  const [form, setForm] = useState({ name: '', url: '', email: '', phone: '', contact: '', address: '', notes: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!id) return
    setLoading(true)
    mastersApi.getSupplier(id)
      .then((row) => setForm({
        name: String(row.name || ''),
        url: String(row.url || ''),
        email: String(row.email || ''),
        phone: String(row.phone || ''),
        contact: String(row.contact || ''),
        address: String(row.address || ''),
        notes: String(row.notes || ''),
      }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const submit = async () => {
    if (!form.name.trim()) return setError('Name is required')
    setBusy(true)
    setError('')
    try {
      const body = {
        name: form.name.trim(),
        url: form.url || null,
        email: form.email || null,
        phone: form.phone || null,
        contact: form.contact || null,
        address: form.address || null,
        notes: form.notes || null,
      }
      if (isEdit && id) await mastersApi.updateSupplier(id, body)
      else await mastersApi.createSupplier(body)
      toast.success(isEdit ? 'Supplier updated' : 'Supplier created')
      navigate('/suppliers')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <AppLayout title="Supplier"><p className="text-muted">Loading…</p></AppLayout>

  return (
    <AppLayout title={isEdit ? 'Edit Supplier / Vendor' : 'Create Supplier / Vendor'}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm cancelTo="/suppliers" onSubmit={() => { void submit() }} submitLabel={busy ? 'Saving…' : 'Save'} submitDisabled={busy}>
        <Field label="Name" required>
          <input className="form-control" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="URL"><input className="form-control" value={form.url} onChange={(e) => set('url', e.target.value)} /></Field>
        <Field label="Email"><input className="form-control" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone"><input className="form-control" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Contact"><input className="form-control" value={form.contact} onChange={(e) => set('contact', e.target.value)} /></Field>
        <Field label="Address"><textarea className="form-control" value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Notes"><textarea className="form-control" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </PageForm>
    </AppLayout>
  )
}