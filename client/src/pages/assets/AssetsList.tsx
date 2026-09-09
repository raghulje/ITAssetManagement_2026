import { Link, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../../layout/AppLayout'
import { AppSelect, Box, StatusBadge } from '../../components/ui'
import { ThColumnFilter } from '../../components/ThColumnFilter'
import { ModuleInsights } from '../../components/ModuleInsights'
import AssetPeriodPicker, { getEmptyPeriodState, type PeriodState } from '../../components/AssetPeriodPicker'
import { dashboardApi, hardwareApi, mastersApi, type SelectOption } from '../../api/client'
import { downloadCsv } from '../../utils/csv'
import { useAuth } from '../../api/AuthContext'

type Row = Record<string, unknown>

type ColDef = {
  key: string
  label: string
  sortable?: boolean
  exportable?: boolean
  render?: (row: Row) => React.ReactNode
}

function flattenAsset(a: Row): Row {
  const status = a.status as Row | undefined
  const assigned = a.assigned_to as Row | null | undefined
  const model = a.model as Row | undefined
  const location = a.location as Row | undefined
  const company = a.company as Row | undefined
  const isAssigned = Boolean(assigned && (assigned.id != null || assigned.name))
  const assigneeLabel = assigned?.name
    ? String(assigned.name)
    : assigned?.id != null
      ? `Assignee #${assigned.id}`
      : null
  return {
    id: a.id,
    asset_tag: a.asset_tag,
    old_asset_tag: a.old_asset_tag,
    name: a.name,
    serial: a.serial,
    model: model?.name,
    status: isAssigned ? 'Assigned' : status?.name,
    status_type: isAssigned ? 'deployed' : status?.status_type,
    assigned_to: assigneeLabel,
    is_assigned: isAssigned,
    location: location?.name,
    company: company?.name,
    available_actions: a.available_actions,
  }
}

const LIST_COLUMNS = ['asset_tag', 'old_asset_tag', 'serial', 'model', 'status', 'assigned_to', 'location', 'company', 'actions']

export default function AssetsList() {
  const [params] = useSearchParams()
  const { activeDomain } = useAuth()
  const statusType = params.get('status_type')
  const q = params.get('q') || ''

  const [search, setSearch] = useState(q)
  const [searchInput, setSearchInput] = useState(q)
  const [companyId, setCompanyId] = useState(() => params.get('company_id') || '')
  const [locationId, setLocationId] = useState(() => params.get('location_id') || '')
  const [period, setPeriod] = useState<PeriodState>(() => getEmptyPeriodState())
  const [sort, setSort] = useState('id')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [locations, setLocations] = useState<SelectOption[]>([])
  /** Displayed Status column value, e.g. Assigned / In Stock */
  const [statusFilter, setStatusFilter] = useState('')
  /** Displayed Assigned To column value, e.g. Unassigned / person name */
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [statusOptions, setStatusOptions] = useState<string[]>([])
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([])
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')
  const [dash, setDash] = useState<Record<string, number>>({})
  const pageSize = 15

  const listFilterParams = useMemo(() => {
    const p: Record<string, string | number | undefined> = {
      status_type: statusType || undefined,
      search: search || undefined,
      company_id: companyId || undefined,
      location_id: locationId || undefined,
      period_from: period.range.from || undefined,
      period_to: period.range.to || undefined,
      domain: activeDomain,
      sort,
      order,
    }
    if (statusFilter) p.status_value = statusFilter
    if (assigneeFilter) p.assigned_name = assigneeFilter
    return p
  }, [statusType, search, companyId, locationId, period.range.from, period.range.to, activeDomain, sort, order, statusFilter, assigneeFilter])

  // Apply filter keys from insight deep-links without clearing local filters on status tabs
  useEffect(() => {
    if (params.has('company_id')) setCompanyId(params.get('company_id') || '')
    if (params.has('location_id')) setLocationId(params.get('location_id') || '')
    if (params.has('period_from') || params.has('period_to')) {
      const from = params.get('period_from') || ''
      const to = params.get('period_to') || ''
      setPeriod({
        mode: '',
        range: { from, to },
        summaryLabel: from && to ? `${from} – ${to}` : from || to,
      })
    }
    if (params.has('q')) {
      const nextQ = params.get('q') || ''
      setSearch(nextQ)
      setSearchInput(nextQ)
    }
  }, [params])

  // Debounced search (no separate search icon button)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // Insights follow the same company / location / search filters as the list
  useEffect(() => {
    let cancelled = false
    dashboardApi
      .counts({
        company_id: companyId || undefined,
        location_id: locationId || undefined,
        search: search || undefined,
        period_from: period.range.from || undefined,
        period_to: period.range.to || undefined,
        domain: activeDomain,
      })
      .then((c) => {
        if (!cancelled) setDash(c as Record<string, number>)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [companyId, locationId, search, period.range.from, period.range.to, activeDomain])

  const filterQuery = useMemo(() => {
    const q = new URLSearchParams()
    if (companyId) q.set('company_id', companyId)
    if (locationId) q.set('location_id', locationId)
    if (search) q.set('q', search)
    if (period.range.from) q.set('period_from', period.range.from)
    if (period.range.to) q.set('period_to', period.range.to)
    const s = q.toString()
    return s ? `&${s}` : ''
  }, [companyId, locationId, search, period.range.from, period.range.to])

  const titleMap: Record<string, string> = {
    Assigned: 'Assigned Assets',
    Deployed: 'Assigned Assets',
    RTD: 'In Stock',
    ReadyToAssign: 'In Stock',
    Pending: 'Pending',
    Deleted: 'Deleted Assets',
  }

  const cell = (v: unknown) => {
    const s = v == null || v === '' ? '' : String(v)
    return s ? s : <span className="cell-muted">—</span>
  }

  const allColumns: ColDef[] = useMemo(() => [
    {
      key: 'asset_tag',
      label: 'Asset Tag',
      sortable: true,
      render: (r) => (
        <Link to={`/hardware/${r.id}`} className="asset-tag-link">{String(r.asset_tag)}</Link>
      ),
    },
    {
      key: 'old_asset_tag',
      label: 'Old Asset Tag',
      sortable: true,
      render: (r) => cell(r.old_asset_tag),
    },
    { key: 'serial', label: 'Serial', sortable: true, render: (r) => cell(r.serial) },
    { key: 'model', label: 'Model', sortable: true, render: (r) => cell(r.model) },
    {
      key: 'status',
      label: 'Status',
      sortable: false,
      render: (r) => (
        <StatusBadge
          status={String(r.status || '')}
          type={String(r.is_assigned ? 'deployed' : r.status_type || '')}
        />
      ),
    },
    {
      key: 'assigned_to',
      label: 'Assigned To',
      render: (r) => (r.assigned_to ? String(r.assigned_to) : <span className="cell-muted">—</span>),
    },
    { key: 'location', label: 'Location', sortable: true, render: (r) => cell(r.location) },
    { key: 'company', label: 'Company', sortable: true, render: (r) => cell(r.company) },
    {
      key: 'actions',
      label: 'Actions',
      exportable: false,
      render: (r) => (
        <div className="row-actions">
          <Link to={`/hardware/${r.id}`} className="icon-btn icon-btn-view" title="View" aria-label="View">
            <i className="fas fa-eye" />
          </Link>
          <Link to={`/hardware/${r.id}/edit`} className="icon-btn icon-btn-edit" title="Edit" aria-label="Edit">
            <i className="fas fa-pencil-alt" />
          </Link>
          {!r.is_assigned && r.status_type === 'deployable' && (
            <Link to={`/hardware/${r.id}/checkout`} className="icon-btn icon-btn-assign" title="Assign" aria-label="Assign">
              <i className="fas fa-user-plus" />
            </Link>
          )}
          {Boolean(r.is_assigned) && (
            <Link to={`/hardware/${r.id}/checkin`} className="icon-btn icon-btn-unassign" title="Unassign" aria-label="Unassign">
              <i className="fas fa-user-minus" />
            </Link>
          )}
        </div>
      ),
    },
  ], [])

  const visibleColumns = allColumns.filter((c) => LIST_COLUMNS.includes(c.key))
  const exportableColumns = allColumns.filter((c) => c.exportable !== false && c.key !== 'actions')

  useEffect(() => {
    mastersApi.companies().then((r) => setCompanies(r.results || [])).catch(() => setCompanies([]))
    mastersApi.locations().then((r) => setLocations(r.results || [])).catch(() => setLocations([]))
  }, [])

  // Facet options from actual Status / Assigned To column values (scoped by current list filters)
  useEffect(() => {
    let cancelled = false
    hardwareApi
      .facets({
        status_type: statusType || undefined,
        search: search || undefined,
        company_id: companyId || undefined,
        location_id: locationId || undefined,
        period_from: period.range.from || undefined,
        period_to: period.range.to || undefined,
        domain: activeDomain,
      })
      .then((f) => {
        if (cancelled) return
        setStatusOptions(f.statuses || [])
        setAssigneeOptions(f.assignees || [])
      })
      .catch(() => {
        if (!cancelled) {
          setStatusOptions([])
          setAssigneeOptions([])
        }
      })
    return () => { cancelled = true }
  }, [statusType, search, companyId, locationId, period.range.from, period.range.to, activeDomain])

  const load = () => {
    setLoading(true)
    hardwareApi.list({
      ...listFilterParams,
      limit: pageSize,
      offset: page * pageSize,
    })
      .then((res) => {
        setRows(res.rows.map(flattenAsset))
        setTotal(res.total)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [listFilterParams, page])

  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [listFilterParams])

  useEffect(() => {
    setSelected(new Set())
  }, [rows])

  const toggleSort = (key: string) => {
    if (sort === key) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      setOrder('asc')
    }
  }

  const exportRows = async () => {
    const cols = exportableColumns
    const res = await hardwareApi.list({
      ...listFilterParams,
      limit: 500,
      offset: 0,
    })
    const data = res.rows.map(flattenAsset)
    downloadCsv(
      `assets-export-${new Date().toISOString().slice(0, 10)}.csv`,
      cols.map((c) => c.label),
      data.map((r) => cols.map((c) => String(r[c.key] ?? ''))),
    )
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const rowIds = rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0)
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id))

  const bulkDelete = async () => {
    if (!selected.size) return
    const count = selected.size
    if (!confirm(`Delete ${count} selected asset(s)?`)) return
    setBulkBusy(true)
    setBulkMsg('')
    try {
      for (const id of selected) await hardwareApi.remove(id)
      setSelected(new Set())
      setBulkMsg(`Deleted ${count} asset(s)`)
      load()
    } catch (e) {
      setBulkMsg(e instanceof Error ? e.message : 'Bulk delete failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const exportSelected = () => {
    const cols = exportableColumns
    const data = rows.filter((r) => selected.has(Number(r.id)))
    if (!data.length) return
    downloadCsv(
      `assets-selected-${new Date().toISOString().slice(0, 10)}.csv`,
      cols.map((c) => c.label),
      data.map((r) => cols.map((c) => String(r[c.key] ?? ''))),
    )
  }

  return (
    <AppLayout title={titleMap[statusType || ''] || 'Assets'} subtitle={`${total} items`}>
      {error && <div className="callout callout-danger"><p>{error}</p></div>}
      {bulkMsg ? <p className="help-block">{bulkMsg}</p> : null}
      <ModuleInsights
        title="Asset inventory"
        cards={[
          { label: 'Total assets', value: dash.assets ?? total, tone: 'teal', to: `/hardware${filterQuery ? `?${filterQuery.slice(1)}` : ''}` },
          { label: 'Assigned', value: dash.deployed ?? 0, tone: 'amber', to: `/hardware?status_type=Assigned${filterQuery}` },
          { label: 'In stock', value: dash.rtd ?? 0, tone: 'default', to: `/hardware?status_type=RTD${filterQuery}` },
          // Pending — not used at Refex for now; restore when needed
          // { label: 'Pending', value: dash.pending ?? 0, tone: 'slate', to: `/hardware?status_type=Pending${filterQuery}` },
          // { label: 'Audit due', value: dash.audit_due ?? 0, tone: 'rose', to: `/hardware/audit/due${filterQuery ? `?${filterQuery.slice(1)}` : ''}` }, // Audit feature — restore when needed
          { label: 'EOL due', value: dash.eol_due ?? 0, tone: 'rose', to: `/hardware/eol/due${filterQuery ? `?${filterQuery.slice(1)}` : ''}` },
        ]}
      />
      <Box type="primary">
        <div className="asset-toolbar">
          <div className="asset-toolbar-bar">
            <div className="asset-toolbar-actions">
              <Link to="/hardware/create" className="btn btn-theme btn-sm"><i className="fas fa-plus" /> Create New</Link>
              <Link to="/maintenances/create" className="btn btn-default btn-sm"><i className="fas fa-wrench" /> Add Maintenance</Link>
            </div>
            <div className="asset-toolbar-tools">
              <button
                type="button"
                className="btn btn-default btn-sm"
                onClick={() => { void exportRows() }}
              >
                <i className="fas fa-download" /> Export
              </button>
              <button type="button" className="btn btn-default btn-sm" onClick={load} disabled={loading} title="Refresh">
                <i className={`fas fa-sync ${loading ? 'fa-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="asset-toolbar-filters">
            <div className="search-inline">
              <i className="fas fa-search" aria-hidden />
              <input
                placeholder="Search tag, serial, model…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search assets"
              />
            </div>

            <AppSelect
              className="filter-app-select"
              value={companyId}
              onChange={setCompanyId}
              searchable
              placeholder="All companies"
              options={[
                { value: '', label: 'All companies' },
                ...companies.map((c) => ({ value: String(c.id), label: c.text })),
              ]}
            />

            <AppSelect
              className="filter-app-select"
              value={locationId}
              onChange={setLocationId}
              searchable
              placeholder="All locations"
              options={[
                { value: '', label: 'All locations' },
                ...locations.map((l) => ({ value: String(l.id), label: l.text })),
              ]}
            />

            <AssetPeriodPicker
              className="filter-period-picker"
              mode={period.mode}
              range={period.range}
              summaryLabel={period.summaryLabel}
              onChange={setPeriod}
            />

            {(companyId || locationId || search || statusFilter || assigneeFilter || period.range.from) && (
              <button
                type="button"
                className="btn btn-default btn-sm asset-toolbar-clear"
                onClick={() => {
                  setCompanyId('')
                  setLocationId('')
                  setSearch('')
                  setSearchInput('')
                  setStatusFilter('')
                  setAssigneeFilter('')
                  setPeriod(getEmptyPeriodState())
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="bulk-bar">
            <span><strong>{selected.size}</strong> selected</span>
            <button type="button" className="btn btn-default btn-sm" onClick={exportSelected}>
              <i className="fas fa-download" /> Export selected
            </button>
            {statusType !== 'Deleted' ? (
              <button type="button" className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={() => { void bulkDelete() }}>
                <i className="fas fa-trash" /> {bulkBusy ? 'Deleting…' : 'Delete selected'}
              </button>
            ) : null}
            <button type="button" className="btn btn-link btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        ) : null}

        <div className="table-responsive data-table-desktop">
          <table className="table table-hover data-list-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={!rowIds.length}
                    onChange={() => {
                      if (allSelected) setSelected(new Set())
                      else setSelected(new Set(rowIds))
                    }}
                    aria-label="Select all"
                  />
                </th>
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.key === 'actions' ? 'col-actions' : undefined}>
                    {c.key === 'status' ? (
                      <ThColumnFilter
                        label="Status"
                        value={statusFilter}
                        options={statusOptions}
                        onChange={setStatusFilter}
                        allLabel="All"
                      />
                    ) : c.key === 'assigned_to' ? (
                      <ThColumnFilter
                        label="Assigned To"
                        value={assigneeFilter}
                        options={assigneeOptions}
                        onChange={setAssigneeFilter}
                        allLabel="All"
                      />
                    ) : c.sortable ? (
                      <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort === c.key ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length + 1, 1)} className="cell-muted" style={{ textAlign: 'center', padding: '36px 12px' }}>
                    {loading ? 'Loading…' : 'No matching records found'}
                  </td>
                </tr>
              )}
              {rows.map((row, i) => {
                const id = Number(row.id)
                return (
                  <tr key={String(row.id ?? i)} className={selected.has(id) ? 'is-selected' : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(id)) next.delete(id)
                            else next.add(id)
                            return next
                          })
                        }}
                        aria-label={`Select ${String(row.asset_tag || id)}`}
                      />
                    </td>
                    {visibleColumns.map((c) => (
                      <td
                        key={c.key}
                        className={
                          c.key === 'actions' ? 'col-actions'
                            : c.key === 'company' ? 'col-company'
                              : c.key === 'location' ? 'col-location'
                                : undefined
                        }
                        title={c.key === 'company' || c.key === 'location' ? String(row[c.key] || '') : undefined}
                      >
                        {c.render ? c.render(row) : cell(row[c.key])}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="data-table-mobile" aria-label="Assets">
          {rows.length === 0 ? (
            <p className="text-muted data-card-empty">{loading ? 'Loading…' : 'No matching records found'}</p>
          ) : rows.map((row, i) => {
            const id = Number(row.id)
            const actionCol = visibleColumns.find((c) => c.key === 'actions')
            const bodyCols = visibleColumns.filter((c) => c.key !== 'actions')
            const titleCol = bodyCols.find((c) => c.key === 'asset_tag') || bodyCols[0]
            const metaCols = bodyCols.filter((c) => c !== titleCol)
            return (
              <article key={String(row.id ?? i)} className={`data-card${selected.has(id) ? ' is-selected' : ''}`}>
                <div className="data-card-top">
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    onChange={() => {
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })
                    }}
                    aria-label={`Select ${String(row.asset_tag || id)}`}
                  />
                  <div className="data-card-title">
                    {titleCol?.render ? titleCol.render(row) : cell(row[titleCol?.key || 'asset_tag'])}
                  </div>
                </div>
                {metaCols.length > 0 ? (
                  <dl className="data-card-fields">
                    {metaCols.map((c) => (
                      <div key={c.key} className="data-card-field">
                        <dt>{c.label}</dt>
                        <dd>{c.render ? c.render(row) : cell(row[c.key])}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {actionCol ? (
                  <div className="data-card-actions">
                    {actionCol.render ? actionCol.render(row) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>

        <div className="pagination" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 12 }}>
          <button type="button" disabled={page <= 0} onClick={() => setPage(0)} title="First page">«</button>
          <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
          {Array.from({ length: pageCount }, (_, i) => i)
            .filter((i) => i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 2)
            .reduce<number[]>((acc, i) => {
              if (acc.length && i - acc[acc.length - 1] > 1) acc.push(-1)
              acc.push(i)
              return acc
            }, [])
            .map((i, idx) => (
              i < 0
                ? <span key={`gap-${idx}`} className="text-muted" style={{ padding: '0 4px' }}>…</span>
                : (
                  <button
                    key={i}
                    type="button"
                    className={i === page ? 'active' : undefined}
                    onClick={() => setPage(i)}
                  >
                    {i + 1}
                  </button>
                )
            ))}
          <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
          <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(pageCount - 1)} title="Last page">»</button>
          <span className="text-muted" style={{ padding: '0 8px', alignSelf: 'center' }}>
            {total === 0 ? '0 items' : `${page * pageSize + 1}–${Math.min(total, (page + 1) * pageSize)} of ${total}`}
          </span>
        </div>
      </Box>
    </AppLayout>
  )
}
