import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import AppLayout from '../../layout/AppLayout'
import { Box, DataTable, Field, PageForm } from '../../components/ui'
import { DetailLayout, DetailPanel } from '../../components/DetailLayout'
import { useToast } from '../../components/Toast'
import { MasterSelect, masterPayloadId } from '../../components/MasterSelect'
import { groupsApi, mastersApi, usersApi, type SelectOption } from '../../api/client'

type Row = Record<string, unknown>
type Nest = { id?: number; name?: string | null } | null

function nestName(v: unknown) {
  if (!v || typeof v !== 'object') return ''
  return String((v as Nest)?.name || '')
}

function nestId(v: unknown): string {
  if (!v || typeof v !== 'object') return ''
  const id = (v as Nest)?.id
  return id != null ? String(id) : ''
}

function isAdminPerms(perms: unknown) {
  if (!perms || typeof perms !== 'object') return false
  const p = perms as Record<string, unknown>
  return p.admin === '1' || p.admin === 1 || p.superuser === '1' || p.superuser === 1
}

function isSuperPerms(perms: unknown) {
  if (!perms || typeof perms !== 'object') return false
  const p = perms as Record<string, unknown>
  return p.superuser === '1' || p.superuser === 1
}

function flattenUser(u: Row): Row {
  return {
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    name: u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim(),
    username: u.username,
    email: u.email,
    employee_num: u.employee_num,
    jobtitle: u.jobtitle,
    phone: u.phone,
    notes: u.notes,
    department: nestName(u.department),
    location: nestName(u.location),
    company: nestName(u.company),
    company_id: nestId(u.company),
    department_id: nestId(u.department),
    location_id: nestId(u.location),
    assets_count: u.assets_count ?? 0,
    activated: Boolean(u.activated),
    deleted: Boolean(u.deleted),
    is_admin: isAdminPerms(u.permissions),
    is_superuser: isSuperPerms(u.permissions),
    permissions: u.permissions,
    available_actions: u.available_actions,
  }
}

export function UsersList() {
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const superadmins = params.get('superadmins')
  const admins = params.get('admins')
  const activated = params.get('activated')
  const status = params.get('status')
  const deleted = params.get('deleted')

  const load = () => {
    setLoading(true)
    usersApi
      .list({
        search: search || undefined,
        superadmins: superadmins === 'true' ? 'true' : undefined,
        admins: admins === 'true' ? 'true' : undefined,
        activated: activated === '1' || activated === '0' ? activated : undefined,
        status: status === 'deleted' ? 'deleted' : undefined,
        deleted: deleted === 'true' ? 'true' : undefined,
        limit: 200,
      })
      .then((res) => {
        setRows(res.rows.map(flattenUser))
        setTotal(res.total)
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
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, superadmins, admins, activated, status, deleted])

  const title =
    status === 'deleted' || deleted === 'true' ? 'Deleted Users'
      : superadmins === 'true' ? 'Superusers'
        : admins === 'true' ? 'Admins'
          : activated === '1' ? 'Activated Users'
            : activated === '0' ? 'Inactive Users'
              : 'Users'

  const removeUser = async (id: number) => {
    if (!window.confirm('Soft-delete this user? They will no longer be able to sign in.')) return
    try {
      await usersApi.remove(id)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <AppLayout title={title} subtitle={loading ? 'Loading…' : `${total} users`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <Box
        title={title}
        type="primary"
        tools={
          status === 'deleted' || deleted === 'true'
            ? undefined
            : (
              <Link to="/users/create" className="btn btn-theme btn-sm">
                <i className="fas fa-plus" /> Create New
              </Link>
            )
        }
      >
        <DataTable
          search={search}
          onSearch={setSearch}
          rows={rows}
          exportName="users"
          storageKey="users_columns"
          onRefresh={load}
          onBulkDelete={
            status === 'deleted' || deleted === 'true'
              ? undefined
              : async (ids) => {
                for (const id of ids) await usersApi.remove(id)
              }
          }
          columns={[
            {
              key: 'name',
              label: 'Name',
              render: (r) => <Link to={`/users/${r.id}`}>{String(r.name)}</Link>,
            },
            { key: 'username', label: 'Username' },
            { key: 'email', label: 'Email' },
            { key: 'employee_num', label: 'Employee No.' },
            { key: 'department', label: 'Department', exportValue: (r) => nestName(r.department), render: (r) => nestName(r.department) || String(r.department ?? '') },
            { key: 'location', label: 'Location', exportValue: (r) => nestName(r.location), render: (r) => nestName(r.location) || String(r.location ?? '') },
            { key: 'assets_count', label: 'Assets' },
            {
              key: 'activated',
              label: 'Activated',
              exportValue: (r) => (r.activated ? 'Yes' : 'No'),
              render: (r) => (r.activated
                ? <span className="label label-success">Yes</span>
                : <span className="label label-danger">No</span>),
            },
            {
              key: 'actions',
              label: 'Actions',
              exportable: false,
              render: (r) => (
                <span className="actions">
                  <Link to={`/users/${r.id}`} className="btn btn-sm btn-primary" title="View"><i className="fas fa-eye" /></Link>
                  {!r.deleted && (
                    <>
                      <Link to={`/users/${r.id}/edit`} className="btn btn-sm btn-warning" title="Edit"><i className="fas fa-pencil-alt" /></Link>
                      <Link to={`/users/${r.id}/clone`} className="btn btn-sm btn-default" title="Clone"><i className="fas fa-copy" /></Link>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        title="Delete"
                        onClick={() => removeUser(Number(r.id))}
                      >
                        <i className="fas fa-trash" />
                      </button>
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

export function UserDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [user, setUser] = useState<Row | null>(null)
  const [assets, setAssets] = useState<Row[]>([])
  const [tab, setTab] = useState('info')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([usersApi.get(id), usersApi.assets(id)])
      .then(([u, a]) => {
        setUser(flattenUser(u))
        setAssets(a.rows)
        setError('')
      })
      .catch((e: Error) => {
        setError(e.message)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [id])

  const removeUser = async () => {
    if (!user || !window.confirm('Soft-delete this user? They will no longer be able to sign in.')) return
    try {
      await usersApi.remove(Number(user.id))
      toast.success('User deleted')
      navigate('/users')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  if (loading) {
    return <AppLayout title="User"><p className="text-muted">Loading user…</p></AppLayout>
  }

  if (!user) {
    return (
      <AppLayout title="User">
        <div className="callout callout-danger"><p>{error || 'User not found'}</p></div>
        <Link to="/users" className="btn btn-default">Back to users</Link>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={String(user.name)} subtitle={String(user.username)}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <DetailLayout
        title={String(user.name)}
        backTo="/users"
        status={user.activated ? 'Activated' : 'Inactive'}
        meta={[
          { label: 'Username', value: String(user.username) },
          { label: 'Company', value: String(user.company || '—') },
          { label: 'Location', value: String(user.location || '—') },
        ]}
        actions={(
          <>
            {!user.deleted && (
              <>
                <Link to={`/users/${user.id}/edit`} className="btn btn-warning btn-sm"><i className="fas fa-pencil-alt" /> Edit</Link>
                <Link to={`/users/${user.id}/clone`} className="btn btn-default btn-sm"><i className="fas fa-copy" /> Clone</Link>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => { void removeUser() }}><i className="fas fa-trash" /> Delete</button>
              </>
            )}
          </>
        )}
        tabs={[
          { id: 'info', label: 'Info' },
          { id: 'assets', label: 'Assets' },
          { id: 'licenses', label: 'Licenses' },
          { id: 'accessories', label: 'Accessories' },
          { id: 'consumables', label: 'Consumables' },
          { id: 'history', label: 'History' },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        fields={tab === 'info' ? [
          { label: 'Name', value: String(user.name) },
          { label: 'Username', value: String(user.username) },
          { label: 'Email', value: String(user.email || '—') },
          { label: 'Employee No.', value: String(user.employee_num || '—') },
          { label: 'Job Title', value: String(user.jobtitle || '—') },
          { label: 'Phone', value: String(user.phone || '—') },
          { label: 'Company', value: String(user.company || '—') },
          { label: 'Department', value: String(user.department || '—') },
          { label: 'Location', value: String(user.location || '—') },
          {
            label: 'Activated',
            value: user.activated
              ? <span className="label label-success">Yes</span>
              : <span className="label label-danger">No</span>,
          },
          {
            label: 'Permissions',
            value: (
              <>
                {user.is_superuser ? <span className="label label-danger">Superuser</span> : null}
                {' '}
                {user.is_admin && !user.is_superuser ? <span className="label label-warning">Admin</span> : null}
                {!user.is_admin && !user.is_superuser ? <span className="text-muted">Standard</span> : null}
              </>
            ),
          },
          ...(user.notes ? [{ label: 'Notes', value: String(user.notes), full: true as const }] : []),
        ] : undefined}
      >
        {tab === 'assets' && (
          <DetailPanel title="Assigned Assets">
            <table className="table table-striped">
              <thead><tr><th>Asset Tag</th><th>Name</th><th>Status</th></tr></thead>
              <tbody>
                {assets.length === 0 && <tr><td colSpan={3} className="text-muted">No assets assigned</td></tr>}
                {assets.map((a) => {
                  const status = a.status as Nest & { name?: string }
                  return (
                    <tr key={String(a.id)}>
                      <td><Link to={`/hardware/${a.id}`}>{String(a.asset_tag)}</Link></td>
                      <td>{String(a.name || '')}</td>
                      <td>{String(status?.name || '—')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DetailPanel>
        )}
        {tab !== 'info' && tab !== 'assets' && (
          <DetailPanel title={tab.charAt(0).toUpperCase() + tab.slice(1)}>
            <p className="text-muted mb-0">No {tab} assigned.</p>
          </DetailPanel>
        )}
      </DetailLayout>
    </AppLayout>
  )
}

type FormState = {
  first_name: string
  last_name: string
  username: string
  password: string
  email: string
  employee_num: string
  jobtitle: string
  phone: string
  company_id: string
  department_id: string
  location_id: string
  notes: string
  activated: boolean
  is_admin: boolean
  is_superuser: boolean
  group_id: string
}

const emptyForm: FormState = {
  first_name: '',
  last_name: '',
  username: '',
  password: '',
  email: '',
  employee_num: '',
  jobtitle: '',
  phone: '',
  company_id: '',
  department_id: '',
  location_id: '',
  notes: '',
  activated: true,
  is_admin: false,
  is_superuser: false,
  group_id: '',
}

export function UserForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const location = useLocation()
  const isClone = location.pathname.endsWith('/clone')
  const isEdit = Boolean(id) && !isClone

  const [form, setForm] = useState<FormState>(emptyForm)
  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [departments, setDepartments] = useState<SelectOption[]>([])
  const [locations, setLocations] = useState<SelectOption[]>([])
  const [roles, setRoles] = useState<SelectOption[]>([])
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    Promise.all([
      mastersApi.companies().catch(() => ({ results: [] as SelectOption[] })),
      mastersApi.departments().catch(() => ({ results: [] as SelectOption[] })),
      mastersApi.locations().catch(() => ({ results: [] as SelectOption[] })),
      groupsApi.list().catch(() => ({ rows: [] as Record<string, unknown>[], total: 0 })),
    ]).then(([c, d, l, g]) => {
      setCompanies(c.results || [])
      setDepartments(d.results || [])
      setLocations(l.results || [])
      setRoles((g.rows || []).map((r) => ({ id: Number(r.id), text: String(r.name || r.id) })))
    })
  }, [])

  useEffect(() => {
    if (!id) {
      setForm(emptyForm)
      setLoading(false)
      return
    }
    setLoading(true)
    usersApi
      .get(id)
      .then((u) => {
        const flat = flattenUser(u)
        const gids = Array.isArray(u.group_ids) ? u.group_ids.map(Number) : []
        setForm({
          first_name: String(flat.first_name || ''),
          last_name: String(flat.last_name || ''),
          username: isClone ? '' : String(flat.username || ''),
          password: '',
          email: String(flat.email || ''),
          employee_num: String(flat.employee_num || ''),
          jobtitle: String(flat.jobtitle || ''),
          phone: String(flat.phone || ''),
          company_id: String(flat.company_id || ''),
          department_id: String(flat.department_id || ''),
          location_id: String(flat.location_id || ''),
          notes: String(flat.notes || ''),
          activated: Boolean(flat.activated),
          is_admin: Boolean(flat.is_admin),
          is_superuser: Boolean(flat.is_superuser),
          group_id: gids[0] != null ? String(gids[0]) : '',
        })
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isClone])

  const submit = async () => {
    if (saving) return
    if (!form.first_name.trim() || !form.last_name.trim() || !form.username.trim()) {
      setError('First name, last name, and username are required')
      return
    }
    if (!isEdit && !form.password) {
      setError('Password is required for new users')
      return
    }

    const body: Record<string, unknown> = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      username: form.username.trim(),
      email: form.email.trim() || null,
      employee_num: form.employee_num.trim() || null,
      jobtitle: form.jobtitle.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      company_id: form.company_id ? Number(form.company_id) : null,
      department_id: form.department_id ? Number(form.department_id) : null,
      location_id: form.location_id ? Number(form.location_id) : null,
      activated: form.activated,
      is_admin: form.is_admin || form.is_superuser,
      is_superuser: form.is_superuser,
      group_ids: form.group_id ? [Number(form.group_id)] : [],
    }
    if (form.password) body.password = form.password

    setSaving(true)
    setError('')
    try {
      if (isEdit && id) {
        await usersApi.update(id, body)
        toast.success('User updated')
        navigate(`/users/${id}`)
      } else {
        const res = await usersApi.create(body)
        const newId = res.payload?.id
        toast.success(isClone ? 'User cloned' : 'User created')
        navigate(newId != null ? `/users/${newId}` : '/users')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const title = isEdit ? 'Update User' : isClone ? 'Clone User' : 'Create User'
  const cancelTo = isEdit && id ? `/users/${id}` : '/users'

  if (loading) {
    return <AppLayout title={title}><p className="text-muted">Loading…</p></AppLayout>
  }

  return (
    <AppLayout title={title}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm cancelTo={cancelTo} onSubmit={() => { void submit() }}>
        <Field label="First Name" required>
          <input
            className="form-control"
            value={form.first_name}
            onChange={(e) => set('first_name', e.target.value)}
            required
            disabled={saving}
          />
        </Field>
        <Field label="Last Name" required>
          <input
            className="form-control"
            value={form.last_name}
            onChange={(e) => set('last_name', e.target.value)}
            required
            disabled={saving}
          />
        </Field>
        <Field label="Username" required>
          <input
            className="form-control"
            value={form.username}
            onChange={(e) => set('username', e.target.value)}
            required
            disabled={saving || isEdit}
            autoComplete="off"
          />
        </Field>
        <Field label="Password" required={!isEdit}>
          <input
            type="password"
            className="form-control"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            required={!isEdit}
            disabled={saving}
            placeholder={isEdit ? 'Leave blank to keep current password' : ''}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            className="form-control"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            disabled={saving}
          />
        </Field>
        <Field label="Employee Number">
          <input
            className="form-control"
            value={form.employee_num}
            onChange={(e) => set('employee_num', e.target.value)}
            disabled={saving}
          />
        </Field>
        <Field label="Job Title">
          <input
            className="form-control"
            value={form.jobtitle}
            onChange={(e) => set('jobtitle', e.target.value)}
            disabled={saving}
          />
        </Field>
        <Field label="Phone">
          <input
            className="form-control"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            disabled={saving}
          />
        </Field>
        <MasterSelect
          label="Company"
          value={form.company_id}
          options={companies}
          onChange={(v) => set('company_id', v)}
          onOptionsChange={setCompanies}
          disabled={saving}
          emptyLabel="— None —"
          create={async (name) => {
            const res = await mastersApi.createCompany({ name })
            return masterPayloadId(res, name)
          }}
        />
        <MasterSelect
          label="Department"
          value={form.department_id}
          options={departments}
          onChange={(v) => set('department_id', v)}
          onOptionsChange={setDepartments}
          disabled={saving}
          emptyLabel="— None —"
          create={async (name) => {
            const res = await mastersApi.createDepartment({
              name,
              company_id: form.company_id ? Number(form.company_id) : null,
            })
            return masterPayloadId(res, name)
          }}
        />
        <MasterSelect
          label="Location"
          value={form.location_id}
          options={locations}
          onChange={(v) => set('location_id', v)}
          onOptionsChange={setLocations}
          disabled={saving}
          emptyLabel="— None —"
          create={async (name) => {
            const res = await mastersApi.createLocation({
              name,
              company_id: form.company_id ? Number(form.company_id) : null,
            })
            return masterPayloadId(res, name)
          }}
        />
        <Field label="Notes">
          <textarea
            className="form-control"
            rows={3}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            disabled={saving}
          />
        </Field>
        <Field label="Activated">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.activated}
              onChange={(e) => set('activated', e.target.checked)}
              disabled={saving}
            />
            {' '}User can login
          </label>
        </Field>
        <Field label="Role">
          <select
            className="form-control"
            value={form.group_id}
            onChange={(e) => set('group_id', e.target.value)}
            disabled={saving}
          >
            <option value="">— Select role —</option>
            {roles.map((r) => (
              <option key={r.id} value={String(r.id)}>{r.text}</option>
            ))}
          </select>
          <span className="help-block">
            Module access comes from the role. Manage the matrix under{' '}
            <Link to="/settings/roles">Settings → Roles & permissions</Link>.
          </span>
        </Field>
        <Field label="Flags">
          <label className="checkbox" style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={form.is_admin}
              onChange={(e) => set('is_admin', e.target.checked)}
              disabled={saving}
            />
            {' '}Admin (full access bypass)
          </label>
          <label className="checkbox" style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={form.is_superuser}
              onChange={(e) => set('is_superuser', e.target.checked)}
              disabled={saving}
            />
            {' '}Superuser (full access bypass)
          </label>
        </Field>
        {saving ? <p className="text-muted">Saving…</p> : null}
      </PageForm>
    </AppLayout>
  )
}
