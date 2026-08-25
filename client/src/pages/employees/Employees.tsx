import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../../layout/AppLayout'
import { AppSelect, Box, DataTable, Field, FileInput, PageForm, StackField } from '../../components/ui'
import { DetailLayout, DetailPanel } from '../../components/DetailLayout'
import { ModuleInsights } from '../../components/ModuleInsights'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'
import { employeesApi } from '../../api/employees'
import { dashboardApi, hardwareApi } from '../../api/client'
import { formatAppDateTime } from '../../lib/datetime'
import { DomainFilter } from '../../components/DomainSelect'
import { domainLabel } from '../../lib/domainScope'

type Row = Record<string, unknown>

export function EmployeesList() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [insights, setInsights] = useState({ employees: 0, deployed: 0 })
  const pageSize = 15

  const load = () => {
    setLoading(true)
    employeesApi
      .list({ search: search || undefined, limit: pageSize, offset: page * pageSize })
      .then((res) => {
        setRows(res.rows)
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
    dashboardApi.counts().then((c) => {
      setInsights({
        employees: Number(c.employees || 0),
        deployed: Number(c.deployed || 0),
      })
    }).catch(() => undefined)
  }, [])

  const syncHrms = async () => {
    setSyncing(true)
    setSyncMsg('')
    setError('')
    try {
      const res = await employeesApi.syncFromHrms()
      const p = res.payload
      const m = p.masters
      setSyncMsg(
        `HRMS sync: fetched ${p.fetched} · created ${p.created} · updated ${p.updated} · skipped ${p.skipped}`
        + (m ? ` · masters ${m.companies.total} companies / ${m.departments.total} departments / ${m.locations.total} locations` : ''),
      )
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'HRMS sync failed')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page])

  const onSearch = (value: string) => {
    setPage(0)
    setSearch(value)
  }

  const activeCount = rows.filter((r) =>
    String(r.employment_status_description || '') === 'Active' || r.employment_status === '1',
  ).length

  return (
    <AppLayout title="Employees" subtitle={loading ? 'Loading…' : `${total} employees`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      {syncMsg ? <div className="callout callout-success"><p>{syncMsg}</p></div> : null}
      <ModuleInsights
        title="People insights"
        cards={[
          { label: 'Employees', value: insights.employees || total, tone: 'teal' },
          { label: 'Active (page)', value: activeCount, tone: 'default' },
          { label: 'Assets assigned', value: insights.deployed, tone: 'amber', to: '/hardware?status_type=Assigned', hint: 'Across all employees' },
        ]}
      />
      <Box
        title="Employees"
        type="primary"
        tools={
          <>
            <button
              type="button"
              className="btn btn-success btn-sm"
              disabled={syncing}
              onClick={() => { void syncHrms() }}
              title="Pull latest employees from Adrenalin Live"
            >
              <i className={`fas ${syncing ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`} />{' '}
              {syncing ? 'Syncing…' : 'Sync from HRMS'}
            </button>
            {' '}
            <Link to="/employees/import" className="btn btn-default btn-sm">
              <i className="fas fa-file-import" /> Import Excel
            </Link>
            {' '}
            <Link to="/employees/create" className="btn btn-theme btn-sm">
              <i className="fas fa-plus" /> Create New
            </Link>
          </>
        }
      >
        <DataTable
          search={search}
          onSearch={onSearch}
          rows={rows}
          exportName="employees"
          storageKey="employees_columns"
          onRefresh={load}
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onBulkDelete={async (ids) => {
            for (const id of ids) await employeesApi.remove(id)
            load()
          }}
          columns={[
            {
              key: 'employee_code',
              label: 'Employee ID',
              render: (r) => <Link to={`/employees/${r.id}`}>{String(r.employee_code)}</Link>,
            },
            {
              key: 'name',
              label: 'Name',
              render: (r) => <Link to={`/employees/${r.id}`}>{String(r.name)}</Link>,
            },
            { key: 'email', label: 'Email' },
            { key: 'department_name', label: 'Department' },
            { key: 'designation', label: 'Designation' },
            { key: 'refex_company_name', label: 'Company' },
            { key: 'refex_location', label: 'Location' },
            {
              key: 'employment_status_description',
              label: 'Status',
              exportValue: (r) => String(r.employment_status_description || r.employment_status || ''),
              render: (r) => {
                const active = String(r.employment_status_description || '') === 'Active' || r.employment_status === '1'
                return active
                  ? <span className="label label-success">{String(r.employment_status_description || 'Active')}</span>
                  : <span className="label label-default">{String(r.employment_status_description || r.employment_status || '—')}</span>
              },
            },
            {
              key: 'actions',
              label: 'Actions',
              exportable: false,
              render: (r) => (
                <span className="actions">
                  <Link to={`/employees/${r.id}`} className="btn btn-sm btn-primary" title="View"><i className="fas fa-eye" /></Link>
                  <Link to={`/employees/${r.id}/edit`} className="btn btn-sm btn-warning" title="Edit"><i className="fas fa-pencil-alt" /></Link>
                </span>
              ),
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

function empVal(value: unknown) {
  if (value == null || value === '') return <span className="text-muted">Not provided</span>
  return String(value)
}

function actionLabel(action: string) {
  if (action === 'checkout') return 'Assigned'
  if (action === 'checkin') return 'Unassigned'
  if (action === 'replace_out') return 'Replaced (out)'
  if (action === 'replace_in') return 'Replaced (in)'
  return action
}

function FieldGroup({ title, fields }: { title: string; fields: { label: string; value: unknown }[] }) {
  return (
    <div className="emp-field-group">
      <h4 className="emp-field-group-title">{title}</h4>
      <div className="detail-fields">
        {fields.map((f) => (
          <div key={f.label}>
            <span className="detail-field-label">{f.label}</span>
            <div className="detail-field-value">{empVal(f.value)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EmployeeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { isAdmin, domainScope, activeDomain } = useAuth()
  const [emp, setEmp] = useState<Row | null>(null)
  const [assets, setAssets] = useState<Row[]>([])
  const [assignments, setAssignments] = useState<Row[]>([])
  const [summary, setSummary] = useState({ total: 0, it: 0, admin: 0 })
  const [history, setHistory] = useState<Row[]>([])
  const [assignmentHistory, setAssignmentHistory] = useState<Row[]>([])
  const [domainFilter, setDomainFilter] = useState<string>(activeDomain)
  const [tab, setTab] = useState<'overview' | 'hrms' | 'assets' | 'history'>('overview')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [replaceFor, setReplaceFor] = useState<Row | null>(null)
  const [replaceAssetId, setReplaceAssetId] = useState('')
  const [replaceReason, setReplaceReason] = useState('')
  const [stockOpts, setStockOpts] = useState<{ id: number; text: string }[]>([])
  const [busy, setBusy] = useState(false)

  /** Open asset while preserving People module return context. */
  const assetLink = (assetId: string | number, suffix = '') => {
    const path = suffix ? `/hardware/${assetId}/${suffix}` : `/hardware/${assetId}`
    if (!id) return path
    return `${path}?from=employee&employee_id=${encodeURIComponent(id)}`
  }

  const reload = () => {
    if (!id) return
    setLoading(true)
    const domain = domainFilter || undefined
    Promise.all([
      employeesApi.get(id),
      employeesApi.assets(id, { domain }),
      employeesApi.assignments(id, { domain }),
      employeesApi.history(id),
      employeesApi.assignmentHistory(id, { domain }),
    ])
      .then(([e, a, asg, h, ah]) => {
        setEmp(e)
        setAssets(a.rows)
        setAssignments(asg.rows || [])
        setSummary(asg.summary || { total: 0, it: 0, admin: 0 })
        setHistory(h.rows || [])
        setAssignmentHistory(ah.rows || [])
        setError('')
      })
      .catch((err: Error) => {
        setError(err.message)
        setEmp(null)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { setDomainFilter(activeDomain) }, [activeDomain])

  useEffect(() => { reload() }, [id, domainFilter])

  useEffect(() => {
    if (!isAdmin && tab === 'hrms') setTab('overview')
  }, [isAdmin, tab])

  useEffect(() => {
    if (!replaceFor) return
    hardwareApi.list({ status_type: 'RTD', limit: 200 })
      .then((r) => {
        setStockOpts(
          r.rows
            .filter((a) => !a.assigned_to)
            .map((a) => ({
              id: Number(a.id),
              text: `${String(a.asset_tag)} — ${String(a.name || a.model || 'Asset')}`,
            })),
        )
      })
      .catch(() => setStockOpts([]))
  }, [replaceFor])

  const remove = async () => {
    if (!emp || !window.confirm('Soft-delete this employee?')) return
    try {
      await employeesApi.remove(Number(emp.id))
      toast.success('Employee deleted')
      navigate('/employees')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const submitReplace = async () => {
    if (!replaceFor) return
    if (!replaceAssetId) {
      setError('Select a replacement asset')
      return
    }
    if (!replaceReason.trim()) {
      setError('Reason is required to replace an asset')
      return
    }
    setBusy(true)
    setError('')
    try {
      await hardwareApi.replace(Number(replaceFor.id), {
        new_asset_id: Number(replaceAssetId),
        reason: replaceReason.trim(),
      })
      toast.success('Asset replaced')
      setReplaceFor(null)
      setReplaceAssetId('')
      setReplaceReason('')
      reload()
      setTab('assets')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replace failed')
    } finally {
      setBusy(false)
    }
  }

  const itemLink = (row: Row) => {
    const module = String(row.module || '')
    const itemId = Number(row.item_id)
    if (module === 'asset') return assetLink(itemId)
    if (module === 'license') return `/licenses/${itemId}`
    if (module === 'accessory') return `/accessories/${itemId}`
    if (module === 'consumable') return `/consumables/${itemId}`
    if (module === 'component') return `/components/${itemId}`
    return '#'
  }

  const custodyHistory = useMemo(
    () => assignmentHistory.filter((h) => ['checkout', 'checkin', 'replace_in', 'replace_out'].includes(String(h.action || h.action_type))),
    [assignmentHistory],
  )

  const renderHistoryTable = (rows: Row[], emptyText: string) => (
    <table className="table table-striped">
      <thead>
        <tr>
          <th>Date</th>
          <th>Action</th>
          <th>Item</th>
          <th>Module</th>
          <th>Domain</th>
          <th>Performed By</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={7} className="text-muted">{emptyText}</td></tr>
        )}
        {rows.map((h) => (
          <tr key={String(h.id)}>
            <td style={{ whiteSpace: 'nowrap' }} title={String(h.action_date || '')}>
              {formatAppDateTime(h.action_date)}
            </td>
            <td>{String(h.action_label || actionLabel(String(h.action || h.action_type || '')))}</td>
            <td>
              {h.item_id && String(h.module || h.item_type) === 'asset'
                ? <Link to={assetLink(Number(h.item_id))}>{String(h.item_name || `Asset #${h.item_id}`)}</Link>
                : String(h.item_name || '—')}
            </td>
            <td>{String(h.module_label || h.module || h.item_type || '—')}</td>
            <td>{domainLabel((h.domain as { code?: string } | null)?.code)}</td>
            <td>{String(h.performed_by || h.admin || '—')}</td>
            <td>{String(h.note || '—')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (loading) return <AppLayout title="Employee"><p className="text-muted">Loading…</p></AppLayout>
  if (!emp) {
    return (
      <AppLayout title="Employee">
        <div className="callout callout-danger"><p>{error || 'Employee not found'}</p></div>
        <Link to="/employees" className="btn btn-default">Back</Link>
      </AppLayout>
    )
  }

  const statusText = String(emp.employment_status_description || emp.employment_status || '')
  const isActive = statusText === 'Active' || emp.employment_status === '1'
  const initials = `${String(emp.first_name || '?')[0] || '?'}${String(emp.last_name || '')[0] || ''}`.toUpperCase()

  return (
    <AppLayout title={String(emp.name)} subtitle={String(emp.employee_code)}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <DetailLayout
        title={String(emp.name)}
        backTo="/employees"
        status={statusText || '—'}
        meta={[
          { label: 'ID', value: String(emp.employee_code || '—') },
          { label: 'Department', value: String(emp.department_name || '—') },
          { label: 'Company', value: String(emp.refex_company_name || '—') },
        ]}
        actions={(
          <>
            <Link to={`/employees/${emp.id}/edit`} className="btn btn-warning btn-sm"><i className="fas fa-pencil-alt" /> Edit</Link>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => { void remove() }}><i className="fas fa-trash" /> Delete</button>
          </>
        )}
        tabs={[
          { id: 'overview', label: 'Overview' },
          ...(isAdmin ? [{ id: 'hrms' as const, label: 'HRMS Profile' }] : []),
          { id: 'assets', label: `Assigned items (${summary.total})` },
          { id: 'history', label: `History (${assignmentHistory.length || history.length})` },
        ]}
        activeTab={tab}
        onTabChange={(t) => setTab(t as typeof tab)}
      >
        {tab === 'overview' && (
          <>
            <div className="emp-hero">
              <div className="emp-avatar" aria-hidden>{initials}</div>
              <div className="emp-hero-body">
                <h3 className="emp-hero-name">{String(emp.name)}</h3>
                <p className="emp-hero-role">{String(emp.designation || 'No designation')} · {String(emp.grade_name || '—')}</p>
                <div className="emp-hero-chips">
                  <span className="emp-chip">{String(emp.refex_company_name || 'No company')}</span>
                  <span className="emp-chip">{String(emp.department_name || 'No department')}</span>
                  <span className="emp-chip">{String(emp.refex_location || 'No location')}</span>
                </div>
              </div>
              <div className="emp-hero-kpis">
                <button type="button" className="emp-kpi emp-kpi-btn" onClick={() => setTab('assets')}>
                  <strong>{summary.total}</strong>
                  <span>Assigned items</span>
                </button>
                <button type="button" className="emp-kpi emp-kpi-btn" onClick={() => setTab('history')}>
                  <strong>{custodyHistory.length}</strong>
                  <span>Custody events</span>
                </button>
                <div className="emp-kpi">
                  <strong className="emp-kpi-sm">{emp.synced_at ? formatAppDateTime(emp.synced_at) : '—'}</strong>
                  <span>Last synced</span>
                </div>
              </div>
            </div>

            <DetailPanel
              title="Custody log"
              tools={(
                <button type="button" className="btn btn-default btn-xs" onClick={() => setTab('history')}>
                  View full history
                </button>
              )}
            >
              {renderHistoryTable(custodyHistory.slice(0, 10), 'No assign / unassign events for this employee yet.')}
            </DetailPanel>

            <DetailPanel title="Contact">
              <div className="emp-contact-grid">
                <div>
                  <span className="detail-field-label">Work email</span>
                  <div className="detail-field-value">{empVal(emp.email)}</div>
                </div>
                <div>
                  <span className="detail-field-label">Work mobile</span>
                  <div className="detail-field-value">{empVal(emp.work_mobile)}</div>
                </div>
                <div>
                  <span className="detail-field-label">Personal email</span>
                  <div className="detail-field-value">{empVal(emp.personal_email)}</div>
                </div>
                <div>
                  <span className="detail-field-label">Mobile</span>
                  <div className="detail-field-value">{empVal(emp.mobile)}</div>
                </div>
              </div>
            </DetailPanel>

            <DetailPanel title="Currently assigned items">
              {assignments.length === 0 ? (
                <p className="text-muted mb-0">No items assigned to this employee in your domain scope.</p>
              ) : (
                <ul className="emp-asset-summary">
                  {assignments.map((a, i) => (
                    <li key={`${String(a.module)}-${String(a.item_id)}-${i}`}>
                      <Link to={itemLink(a)}>{String(a.identifier || a.item_name)}</Link>
                      <span>{String(a.module_label)} · {domainLabel((a.domain as { code?: string } | null)?.code)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailPanel>
          </>
        )}

        {tab === 'hrms' && (
          <div className="emp-hrms-sections">
            <FieldGroup
              title="Identity"
              fields={[
                { label: 'Employee ID', value: emp.employee_code },
                { label: 'First Name', value: emp.first_name },
                { label: 'Last Name', value: emp.last_name },
                { label: 'Title', value: emp.title },
                { label: 'Sex', value: emp.sex },
                { label: 'Date of Birth', value: emp.date_of_birth },
                { label: 'PAN', value: emp.pan_number },
              ]}
            />
            <FieldGroup
              title="Contact"
              fields={[
                { label: 'Email', value: emp.email },
                { label: 'Personal Email', value: emp.personal_email },
                { label: 'Mobile', value: emp.mobile },
                { label: 'Work Mobile', value: emp.work_mobile },
                { label: 'Pincode', value: emp.employee_pincode },
              ]}
            />
            <FieldGroup
              title="Employment"
              fields={[
                { label: 'Joining Date', value: emp.joining_date },
                { label: 'Date of Exit', value: emp.date_of_exit },
                { label: 'Designation', value: emp.designation },
                { label: 'Grade', value: emp.grade_name },
                { label: 'Employment Status', value: emp.employment_status_description || emp.employment_status },
                { label: 'Employee Status', value: emp.employee_status_description || emp.employee_status },
                { label: 'Supervisor', value: emp.supervisor_employee_code },
              ]}
            />
            <FieldGroup
              title="Organization"
              fields={[
                { label: 'Company', value: emp.refex_company_name },
                { label: 'Department', value: emp.department_name },
                { label: 'Department Code', value: emp.department_code },
                { label: 'Business Line', value: emp.business_line },
                { label: 'Legal Entity', value: emp.legal_entity_code },
                { label: 'Branch Code', value: emp.branch_code },
                { label: 'Location', value: emp.refex_location },
                { label: 'Office Location', value: emp.office_location },
                { label: 'Added On (HRMS)', value: emp.emp_added_on },
                { label: 'Last Synced', value: emp.synced_at },
              ]}
            />
          </div>
        )}

        {tab === 'assets' && (
          <DetailPanel
            title="Assigned items"
            tools={<DomainFilter value={domainFilter} onChange={setDomainFilter} allowed={domainScope.codes} />}
          >
            <p className="help-block">
              Total {summary.total} · IT {summary.it} · Admin {summary.admin}
            </p>
            <table className="table table-striped">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Module</th>
                  <th>Domain</th>
                  <th>Identifier</th>
                  <th>Assigned On</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.length === 0 && (
                  <tr><td colSpan={7} className="text-muted">No assigned items</td></tr>
                )}
                {assignments.map((a, i) => (
                  <tr key={`${String(a.module)}-${String(a.item_id)}-${i}`}>
                    <td><Link to={itemLink(a)}>{String(a.item_name || '—')}</Link></td>
                    <td>{String(a.module_label || a.module)}</td>
                    <td>{domainLabel((a.domain as { code?: string } | null)?.code)}</td>
                    <td>{String(a.identifier || '—')}</td>
                    <td>{a.assigned_at ? formatAppDateTime(a.assigned_at) : '—'}</td>
                    <td>{String(a.status || 'Assigned')}</td>
                    <td className="actions">
                      <Link to={itemLink(a)} className="btn btn-xs btn-default">View</Link>
                      {a.module === 'asset' ? (
                        <>
                          <Link to={assetLink(Number(a.item_id), 'checkin')} className="btn btn-xs btn-primary">Unassign</Link>
                          <button
                            type="button"
                            className="btn btn-xs btn-theme"
                            onClick={() => {
                              const asset = assets.find((x) => Number(x.id) === Number(a.item_id)) || a
                              setReplaceFor({ ...asset, id: a.item_id, asset_tag: a.identifier })
                              setReplaceAssetId('')
                              setReplaceReason('')
                              setError('')
                            }}
                          >
                            Replace
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DetailPanel>
        )}

        {tab === 'history' && (
          <>
            <DetailPanel title="Custody events (assign / unassign / replace)">
              {renderHistoryTable(custodyHistory, 'No custody events yet.')}
            </DetailPanel>
            <DetailPanel title="All employee history">
              {renderHistoryTable(assignmentHistory.length ? assignmentHistory : history, 'No history yet.')}
            </DetailPanel>
          </>
        )}
      </DetailLayout>

      {replaceFor ? (
        <div className="modal-backdrop" onClick={() => !busy && setReplaceFor(null)}>
          <div className="modal-panel" style={{ width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Replace asset</h3>
            <p className="help-block">
              Unassign <strong>{String(replaceFor.asset_tag)}</strong> and assign a stock asset to{' '}
              <strong>{String(emp.name)}</strong>. Reason is required and saved to both histories.
            </p>
            <div className="form-group">
              <label>Replacement asset</label>
              <AppSelect
                value={replaceAssetId}
                onChange={setReplaceAssetId}
                searchable
                placeholder="Select in-stock asset…"
                options={[
                  { value: '', label: 'Select in-stock asset…' },
                  ...stockOpts.map((o) => ({ value: String(o.id), label: o.text })),
                ]}
              />
            </div>
            <div className="form-group">
              <label className="required">Reason</label>
              <textarea
                className="form-control"
                rows={3}
                value={replaceReason}
                onChange={(e) => setReplaceReason(e.target.value)}
                placeholder="Why is this asset being replaced?"
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-theme" disabled={busy} onClick={() => { void submitReplace() }}>
                {busy ? 'Replacing…' : 'Confirm replace'}
              </button>
              <button type="button" className="btn btn-default" disabled={busy} onClick={() => setReplaceFor(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppLayout>
  )
}

type FormState = {
  employee_code: string
  first_name: string
  last_name: string
  email: string
  designation: string
  department_name: string
  department_code: string
  refex_company_name: string
  refex_location: string
  mobile: string
  work_mobile: string
  employment_status: string
  employment_status_description: string
  notes: string
}

const emptyForm: FormState = {
  employee_code: '',
  first_name: '',
  last_name: '',
  email: '',
  designation: '',
  department_name: '',
  department_code: '',
  refex_company_name: '',
  refex_location: '',
  mobile: '',
  work_mobile: '',
  employment_status: '1',
  employment_status_description: 'Active',
  notes: '',
}

export function EmployeeForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = Boolean(id)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    if (!id) {
      setForm(emptyForm)
      setLoading(false)
      return
    }
    setLoading(true)
    employeesApi
      .get(id)
      .then((e) => {
        setForm({
          employee_code: String(e.employee_code || ''),
          first_name: String(e.first_name || ''),
          last_name: String(e.last_name || ''),
          email: String(e.email || ''),
          designation: String(e.designation || ''),
          department_name: String(e.department_name || ''),
          department_code: String(e.department_code || ''),
          refex_company_name: String(e.refex_company_name || ''),
          refex_location: String(e.refex_location || ''),
          mobile: String(e.mobile || ''),
          work_mobile: String(e.work_mobile || ''),
          employment_status: String(e.employment_status || '1'),
          employment_status_description: String(e.employment_status_description || 'Active'),
          notes: String(e.notes || ''),
        })
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const submit = async () => {
    if (saving) return
    if (!form.first_name.trim() || (!isEdit && !form.employee_code.trim())) {
      setError('Employee ID and first name are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const body = {
        ...form,
        employee_code: form.employee_code.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim() || null,
      }
      if (isEdit && id) {
        await employeesApi.update(id, body)
        toast.success('Employee updated')
        navigate(`/employees/${id}`)
      } else {
        const res = await employeesApi.create(body)
        const newId = res.payload?.id
        toast.success('Employee created')
        navigate(newId != null ? `/employees/${newId}` : '/employees')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <AppLayout title="Employee"><p className="text-muted">Loading…</p></AppLayout>

  return (
    <AppLayout title={isEdit ? 'Update Employee' : 'Create Employee'}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm cancelTo={isEdit && id ? `/employees/${id}` : '/employees'} onSubmit={() => { void submit() }}>
        <Field label="Employee ID" required>
          <input className="form-control" value={form.employee_code} onChange={(e) => set('employee_code', e.target.value)} required disabled={saving || isEdit} />
        </Field>
        <Field label="First Name" required>
          <input className="form-control" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required disabled={saving} />
        </Field>
        <Field label="Last Name">
          <input className="form-control" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Email">
          <input type="email" className="form-control" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Designation">
          <input className="form-control" value={form.designation} onChange={(e) => set('designation', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Department">
          <input className="form-control" value={form.department_name} onChange={(e) => set('department_name', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Department Code">
          <input className="form-control" value={form.department_code} onChange={(e) => set('department_code', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Company">
          <input className="form-control" value={form.refex_company_name} onChange={(e) => set('refex_company_name', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Location">
          <input className="form-control" value={form.refex_location} onChange={(e) => set('refex_location', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Mobile">
          <input className="form-control" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Work Mobile">
          <input className="form-control" value={form.work_mobile} onChange={(e) => set('work_mobile', e.target.value)} disabled={saving} />
        </Field>
        <Field label="Employment Status">
          <select
            className="form-control"
            value={form.employment_status_description}
            onChange={(e) => {
              const desc = e.target.value
              set('employment_status_description', desc)
              set('employment_status', desc === 'Active' ? '1' : '0')
            }}
            disabled={saving}
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </Field>
        <Field label="Notes">
          <textarea className="form-control" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} disabled={saving} />
        </Field>
        {saving ? <p className="text-muted">Saving…</p> : null}
      </PageForm>
    </AppLayout>
  )
}

export function EmployeeImport() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<{
    total: number
    created: number
    updated: number
    skipped: number
    fetched?: number
    errors: { row: number; message: string }[]
  } | null>(null)

  const runImport = async () => {
    if (!file) {
      setError('Choose an .xlsx or .csv file first')
      return
    }
    setBusy(true)
    setError('')
    setSummary(null)
    try {
      const res = await employeesApi.importFile(file)
      setSummary(res.payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const runApiSync = async () => {
    setSyncing(true)
    setError('')
    setSummary(null)
    try {
      const res = await employeesApi.syncFromHrms()
      setSummary(res.payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'HRMS sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <AppLayout title="Import Employees" subtitle="Adrenalin Live API or Excel / CSV" backTo="/employees">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}

      <Box title="Sync from Adrenalin Live" type="primary">
        <p className="help-block">
          Calls HRMS <code>Authorization/UserLogin</code> then <code>Employee/GetEmployeeDetails</code> and upserts by Employee ID.
          Prefer this over Excel when the API is available.
        </p>
        <button type="button" className="btn btn-success" disabled={busy || syncing} onClick={() => { void runApiSync() }}>
          <i className={`fas ${syncing ? 'fa-spinner fa-spin' : 'fa-cloud-download-alt'}`} />{' '}
          {syncing ? 'Syncing from HRMS…' : 'Sync from HRMS API'}
        </button>
      </Box>

      <Box title="Upload Employee List" type="primary">
        <p className="help-block">
          Manual fallback using the Refex HRMS export format (columns like <code>EMPLOYEE_ID</code>, <code>FIRST_NAME</code>, <code>EMAIL_ADDRESS</code>, …).
          Existing employees are updated by Employee ID; new ones are created.
        </p>
        <div className="form-stack">
          <StackField label="Employee file" hint="Accepts .xlsx, .xls, or .csv">
            <FileInput
              accept=".xlsx,.xls,.csv"
              disabled={busy}
              fileName={file?.name}
              onChange={setFile}
            />
          </StackField>
          <div className="form-actions">
            <button type="button" className="btn btn-theme" disabled={busy || !file} onClick={() => { void runImport() }}>
              {busy ? 'Importing…' : 'Import'}
            </button>
            <Link to="/employees" className="btn btn-default">Cancel</Link>
          </div>
        </div>
      </Box>

      {summary ? (
        <Box title="Import Result" type="success">
          <ul>
            {summary.fetched != null ? <li>Fetched from API: <strong>{summary.fetched}</strong></li> : null}
            <li>Total rows: <strong>{summary.total}</strong></li>
            <li>Created: <strong>{summary.created}</strong></li>
            <li>Updated: <strong>{summary.updated}</strong></li>
            <li>Skipped: <strong>{summary.skipped}</strong></li>
          </ul>
          {summary.errors.length > 0 && (
            <>
              <p>First errors:</p>
              <ul>
                {summary.errors.slice(0, 10).map((err) => (
                  <li key={`${err.row}-${err.message}`}>Row {err.row}: {err.message}</li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className="btn btn-primary" onClick={() => navigate('/employees')}>
            View Employees
          </button>
        </Box>
      ) : null}
    </AppLayout>
  )
}
