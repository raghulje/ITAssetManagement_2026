import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppLayout from '../layout/AppLayout'
import { AppSelect, SmallBox, StatusBadge } from '../components/ui'
import {
  accessoriesApi,
  api,
  componentsApi,
  consumablesApi,
  dashboardApi,
  hardwareApi,
  licensesApi,
  mastersApi,
  type SelectOption,
} from '../api/client'
import { employeesApi } from '../api/employees'
import { useAuth } from '../api/AuthContext'
import { softwareLicensesInDomain } from '../lib/domainScope'
import AssetPeriodPicker, { getEmptyPeriodState, type PeriodState } from '../components/AssetPeriodPicker'
import { DashFilterSheet, DashFiltersButton, filterCount } from '../components/DashMobileFilters'
import { DashSemanticSearchButton, DashSemanticSearchModal } from '../components/DashSemanticSearch'

type DashCounts = Record<string, number>
type DashModule =
  | 'assets'
  | 'licenses'
  | 'accessories'
  | 'consumables'
  | 'components'
  | 'employees'
  | 'assigned'
  | 'stock'
  | 'eol'

type DashRow = {
  id: string | number
  primary: string
  secondary: string
  meta: string
  status?: string
  statusType?: string
  href: string
}

const emptyCounts: DashCounts = {
  assets: 0,
  licenses: 0,
  accessories: 0,
  consumables: 0,
  components: 0,
  users: 0,
  employees: 0,
  employees_active: 0,
  deployed: 0,
  rtd: 0,
  audit_due: 0,
  eol_due: 0,
}

const MODULE_META: Record<DashModule, { title: string; fullHref: (f: Record<string, string | undefined>) => string }> = {
  assets: { title: 'Assets', fullHref: (f) => appendFilters('/hardware', f) },
  licenses: { title: 'Licenses', fullHref: (f) => appendFilters('/licenses', { company_id: f.company_id }) },
  accessories: { title: 'Accessories', fullHref: (f) => appendFilters('/accessories', f) },
  consumables: { title: 'Consumables', fullHref: (f) => appendFilters('/consumables', f) },
  components: { title: 'Components', fullHref: (f) => appendFilters('/components', f) },
  employees: { title: 'Active employees', fullHref: () => '/employees?active=1' },
  assigned: { title: 'Assigned assets', fullHref: (f) => appendFilters('/hardware?status_type=Assigned', f) },
  stock: { title: 'In stock assets', fullHref: (f) => appendFilters('/hardware?status_type=RTD', f) },
  eol: { title: 'EOL due assets', fullHref: (f) => appendFilters('/hardware/eol/due', f) },
}

function appendFilters(path: string, filters: Record<string, string | undefined>) {
  const [base, existing] = path.split('?')
  const q = new URLSearchParams(existing || '')
  Object.entries(filters).forEach(([k, v]) => {
    if (v) q.set(k, v)
  })
  const s = q.toString()
  return s ? `${base}?${s}` : base
}

function dayGreeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  }).format(now))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function nestName(v: unknown) {
  if (v && typeof v === 'object' && 'name' in v) return String((v as { name?: string }).name || '—')
  return v != null && v !== '' ? String(v) : '—'
}

export default function Dashboard() {
  const { activeDomain, user } = useAuth()
  const [params] = useSearchParams()
  const showLicenses = softwareLicensesInDomain(activeDomain)
  const [counts, setCounts] = useState<DashCounts>(emptyCounts)
  const [loading, setLoading] = useState(false)
  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [locations, setLocations] = useState<SelectOption[]>([])
  const [companyId, setCompanyId] = useState(() => params.get('company_id') || '')
  const [locationId, setLocationId] = useState(() => params.get('location_id') || '')
  const [period, setPeriod] = useState<PeriodState>(() => {
    const from = params.get('period_from') || ''
    const to = params.get('period_to') || ''
    if (!from && !to) return getEmptyPeriodState()
    return {
      mode: '',
      range: { from, to },
      summaryLabel: from && to ? `${from} – ${to}` : from || to,
    }
  })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeModule, setActiveModule] = useState<DashModule>('assets')
  const [rows, setRows] = useState<DashRow[]>([])
  const [tableTotal, setTableTotal] = useState(0)
  const [tableLoading, setTableLoading] = useState(false)
  const [flash, setFlash] = useState(false)
  const tableRef = useRef<HTMLElement | null>(null)

  const filterParams = useMemo(() => ({
    domain: activeDomain,
    company_id: companyId || undefined,
    location_id: locationId || undefined,
    period_from: period.range.from || undefined,
    period_to: period.range.to || undefined,
  }), [activeDomain, companyId, locationId, period.range.from, period.range.to])

  const hrefFilters = useMemo(() => ({
    company_id: companyId || undefined,
    location_id: locationId || undefined,
    period_from: period.range.from || undefined,
    period_to: period.range.to || undefined,
  }), [companyId, locationId, period.range.from, period.range.to])

  useEffect(() => {
    if (!showLicenses && activeModule === 'licenses') setActiveModule('assets')
  }, [showLicenses, activeModule])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 992px)')
    const onChange = () => {
      if (mq.matches) setSheetOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      mastersApi.companies().then((r) => r.results || []).catch(() => [] as SelectOption[]),
      mastersApi.locations().then((r) => r.results || []).catch(() => [] as SelectOption[]),
    ]).then(([nextCompanies, nextLocations]) => {
      if (cancelled) return
      setCompanies(nextCompanies)
      setLocations(nextLocations)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadCounts = useCallback(() => {
    setLoading(true)
    dashboardApi.counts(filterParams)
      .then((c) => setCounts({ ...emptyCounts, ...c }))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [filterParams])

  useEffect(() => {
    loadCounts()
  }, [loadCounts])

  const selectModule = useCallback((mod: DashModule) => {
    setActiveModule(mod)
    setFlash(true)
    window.setTimeout(() => setFlash(false), 900)
    window.requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setTableLoading(true)
    const base = {
      ...filterParams,
      limit: 25,
      offset: 0,
      sort: 'id',
      order: 'desc',
    }

    async function load() {
      if (activeModule === 'assets') {
        const res = await hardwareApi.list(base)
        return {
          total: res.total || res.rows?.length || 0,
          rows: (res.rows || []).map((r) => ({
            id: Number(r.id),
            primary: String(r.asset_tag || `Asset #${r.id}`),
            secondary: String(r.name || nestName(r.model)),
            meta: [nestName(r.location), nestName(r.company)].filter((x) => x !== '—').join(' · ') || '—',
            status: String((r.status as { name?: string } | undefined)?.name || (r.is_assigned ? 'Assigned' : '—')),
            statusType: String(r.is_assigned ? 'deployed' : r.status_type || ''),
            href: `/hardware/${r.id}`,
          })),
        }
      }
      if (activeModule === 'assigned') {
        const res = await hardwareApi.list({ ...base, status_type: 'Assigned' })
        return {
          total: res.total || res.rows?.length || 0,
          rows: (res.rows || []).map((r) => ({
            id: Number(r.id),
            primary: String(r.asset_tag || `Asset #${r.id}`),
            secondary: nestName(r.assigned_to) || String(r.name || '—'),
            meta: [nestName(r.model), nestName(r.location)].filter((x) => x !== '—').join(' · ') || '—',
            status: 'Assigned',
            statusType: 'deployed',
            href: `/hardware/${r.id}`,
          })),
        }
      }
      if (activeModule === 'stock') {
        const res = await hardwareApi.list({ ...base, status_type: 'RTD' })
        return {
          total: res.total || res.rows?.length || 0,
          rows: (res.rows || []).map((r) => ({
            id: Number(r.id),
            primary: String(r.asset_tag || `Asset #${r.id}`),
            secondary: String(r.name || nestName(r.model)),
            meta: [nestName(r.location), nestName(r.company)].filter((x) => x !== '—').join(' · ') || '—',
            status: String((r.status as { name?: string } | undefined)?.name || 'In Stock'),
            statusType: String(r.status_type || 'deployable'),
            href: `/hardware/${r.id}`,
          })),
        }
      }
      if (activeModule === 'eol') {
        const q = new URLSearchParams()
        Object.entries(filterParams).forEach(([k, v]) => {
          if (v !== undefined && v !== '') q.set(k, String(v))
        })
        const res = await api<{ rows?: Record<string, unknown>[]; total?: number }>(`/hardware/eol/due?${q}`)
        const list = (res.rows || []).slice(0, 25)
        return {
          total: res.total || list.length,
          rows: list.map((r) => ({
            id: Number(r.id),
            primary: String(r.asset_tag || `Asset #${r.id}`),
            secondary: String(r.name || nestName(r.model)),
            meta: [nestName(r.location), String(r.asset_eol_date || '')].filter(Boolean).join(' · ') || '—',
            status: 'EOL due',
            statusType: 'undeployable',
            href: `/hardware/${r.id}`,
          })),
        }
      }
      if (activeModule === 'licenses') {
        const res = await licensesApi.list({
          search: undefined,
          limit: 25,
          company_id: companyId || undefined,
          domain: activeDomain,
        })
        return {
          total: res.total || res.rows?.length || 0,
          rows: (res.rows || []).map((r) => ({
            id: Number(r.id),
            primary: String(r.name || `License #${r.id}`),
            secondary: nestName(r.category),
            meta: nestName(r.company),
            status: String(r.seats != null ? `${r.remaining ?? '—'} seats left` : '—'),
            href: `/licenses/${r.id}`,
          })),
        }
      }
      if (activeModule === 'accessories' || activeModule === 'consumables' || activeModule === 'components') {
        const apiMap = {
          accessories: accessoriesApi,
          consumables: consumablesApi,
          components: componentsApi,
        } as const
        const res = await apiMap[activeModule].list(base)
        const path = `/${activeModule}`
        return {
          total: res.total || res.rows?.length || 0,
          rows: (res.rows || []).map((r) => ({
            id: Number(r.id),
            primary: String(r.name || `#${r.id}`),
            secondary: nestName(r.category),
            meta: [nestName(r.company), nestName(r.location)].filter((x) => x !== '—').join(' · ') || '—',
            status: r.qty != null ? `Qty ${r.qty}` : '—',
            href: `${path}/${r.id}`,
          })),
        }
      }
      const res = await employeesApi.list({ active: 1, limit: 25, search: undefined })
      return {
        total: res.total || res.rows?.length || 0,
        rows: (res.rows || []).map((r) => ({
          id: Number(r.id),
          primary: String(r.name || r.employee_code || `#${r.id}`),
          secondary: String(r.employee_code || '—'),
          meta: [String(r.department || ''), String(r.email || '')].filter(Boolean).join(' · ') || '—',
          status: r.active ? 'Active' : 'Inactive',
          statusType: r.active ? 'deployable' : 'undeployable',
          href: `/employees/${r.id}`,
        })),
      }
    }

    load()
      .then((next) => {
        if (cancelled) return
        setRows(next.rows)
        setTableTotal(next.total)
      })
      .catch(() => {
        if (cancelled) return
        setRows([])
        setTableTotal(0)
      })
      .finally(() => {
        if (!cancelled) setTableLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeModule, filterParams, companyId, activeDomain])

  const hasFilters = Boolean(companyId || locationId || period.range.from)
  const activeFilterCount = filterCount(companyId, locationId, period)

  const clearFilters = () => {
    setCompanyId('')
    setLocationId('')
    setPeriod(getEmptyPeriodState())
  }

  const companyOptions = [
    { value: '', label: 'All companies' },
    ...companies.map((c) => ({ value: String(c.id), label: c.text })),
  ]
  const locationOptions = [
    { value: '', label: 'All locations' },
    ...locations.map((l) => ({ value: String(l.id), label: l.text })),
  ]
  const assigned = counts.deployed || 0
  const totalAssets = counts.assets || 0
  const helloName = String(user?.first_name || user?.name || 'there').trim()
  const designation = String(user?.hrms_designation || '').trim()
  const helloMeta = [designation ? `Logged in as ${designation}` : '', user?.hrms_department, user?.hrms_company, user?.email]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
  const helloInitial = helloName.charAt(0).toUpperCase() || 'R'
  const moduleMeta = MODULE_META[activeModule]

  return (
    <AppLayout title="Dashboard" hideHeader>
      <section className="dash-hello" aria-label="Signed in" data-aos="fade-down">
        <span className="p2p-header-bubbles" aria-hidden><i /><i /><i /><i /><i /><i /><i /></span>
        <div className="dash-hello-person">
          <span className="dash-hello-avatar" aria-hidden="true">{helloInitial}</span>
          <div className="dash-hello-copy">
            <p className="dash-hello-greet">{dayGreeting()}, {helloName}</p>
            <p className="dash-hello-role">{helloMeta.join(' · ') || 'Signed in to IT Asset Management'}</p>
          </div>
        </div>
        <div className="dash-hello-actions">
          <DashSemanticSearchButton onClick={() => setSearchOpen(true)} />
          <div className="dash-filters-mobile">
            <DashFiltersButton count={activeFilterCount} onClick={() => setSheetOpen(true)} />
          </div>
        </div>
        <div className="dash-hello-filters dash-filters-desktop">
          <label className="dash-hello-field">
            <span>Company</span>
            <AppSelect
              className="filter-app-select"
              value={companyId}
              onChange={setCompanyId}
              searchable
              placeholder="All companies"
              options={companyOptions}
            />
          </label>
          <label className="dash-hello-field">
            <span>Location</span>
            <AppSelect
              className="filter-app-select"
              value={locationId}
              onChange={setLocationId}
              searchable
              placeholder="All locations"
              options={locationOptions}
            />
          </label>
          <label className="dash-hello-field dash-hello-field--period">
            <span>Period</span>
            <AssetPeriodPicker
              className="filter-period-picker"
              mode={period.mode}
              range={period.range}
              summaryLabel={period.summaryLabel}
              onChange={setPeriod}
            />
          </label>
          {hasFilters ? (
            <button type="button" className="btn btn-default btn-sm" onClick={clearFilters}>
              Clear
            </button>
          ) : null}
          <button type="button" className="btn btn-default btn-sm dash-hello-refresh" onClick={loadCounts} disabled={loading} title="Refresh">
            <i className={`fas fa-sync ${loading ? 'fa-spin' : ''}`} />
          </button>
        </div>
      </section>

      <DashFilterSheet
        open={sheetOpen}
        companies={companies}
        locations={locations}
        companyId={companyId}
        locationId={locationId}
        period={period}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setCompanyId(next.companyId)
          setLocationId(next.locationId)
          setPeriod(next.period)
          setSheetOpen(false)
        }}
      />

      <DashSemanticSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        companyId={companyId}
        locationId={locationId}
      />

      <div className="row">
        <SmallBox
          active={activeModule === 'assets'}
          onClick={() => selectModule('assets')}
          count={counts.assets}
          label="Assets"
          color="bg-teal"
          icon="fas fa-barcode"
        />
        {showLicenses ? (
          <SmallBox
            active={activeModule === 'licenses'}
            onClick={() => selectModule('licenses')}
            count={counts.licenses}
            label="Licenses"
            color="bg-maroon"
            icon="fas fa-save"
          />
        ) : null}
        <SmallBox
          active={activeModule === 'accessories'}
          onClick={() => selectModule('accessories')}
          count={counts.accessories}
          label="Accessories"
          color="bg-orange"
          icon="fas fa-keyboard"
        />
        <SmallBox
          active={activeModule === 'consumables'}
          onClick={() => selectModule('consumables')}
          count={counts.consumables}
          label="Consumables"
          color="bg-purple"
          icon="fas fa-tint"
        />
        <SmallBox
          active={activeModule === 'components'}
          onClick={() => selectModule('components')}
          count={counts.components}
          label="Components"
          color="bg-olive"
          icon="fas fa-hdd"
        />
        <SmallBox
          active={activeModule === 'employees'}
          onClick={() => selectModule('employees')}
          count={counts.employees_active ?? counts.employees ?? counts.users}
          label="Active employees"
          color="bg-navy"
          icon="fas fa-users"
        />
      </div>

      <div className="module-insights-title dash-snapshot-title">Asset inventory snapshot</div>
      <div className="row">
        <SmallBox
          active={activeModule === 'assigned'}
          onClick={() => selectModule('assigned')}
          count={assigned}
          label="Assigned"
          color="bg-orange"
          icon="fas fa-user-check"
          share={totalAssets ? (assigned / totalAssets) * 100 : 0}
          total={totalAssets}
        />
        <SmallBox
          active={activeModule === 'stock'}
          onClick={() => selectModule('stock')}
          count={counts.rtd || 0}
          label="In stock"
          color="bg-olive"
          icon="fas fa-warehouse"
          share={totalAssets ? ((counts.rtd || 0) / totalAssets) * 100 : 0}
          total={totalAssets}
        />
        <SmallBox
          active={activeModule === 'eol'}
          onClick={() => selectModule('eol')}
          count={counts.eol_due || 0}
          label="EOL due"
          color="bg-red"
          icon="fas fa-calendar-times"
          share={totalAssets ? ((counts.eol_due || 0) / totalAssets) * 100 : 0}
          total={totalAssets}
        />
      </div>

      <section
        ref={tableRef}
        className={`dash-records${flash ? ' is-flash' : ''}`}
        aria-label={`${moduleMeta.title} records`}
      >
        <div className="dash-records-head">
          <div>
            <p className="dash-records-kicker">Records</p>
            <h2 className="dash-records-title">{moduleMeta.title}</h2>
            <p className="dash-records-sub">
              {tableLoading ? 'Loading…' : `${tableTotal.toLocaleString()} matching · showing ${rows.length}`}
            </p>
          </div>
          <Link to={moduleMeta.fullHref(hrefFilters)} className="btn btn-theme btn-sm">
            Open full list
          </Link>
        </div>
        <div className="dash-records-table-wrap">
          <table className="table table-striped dash-records-table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Detail</th>
                <th>Context</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tableLoading ? (
                <tr><td colSpan={4} className="text-muted">Loading records…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="text-muted">No records for this card yet.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${activeModule}-${r.id}`}>
                    <td>
                      <Link to={r.href} className="dash-records-primary">{r.primary}</Link>
                    </td>
                    <td>{r.secondary}</td>
                    <td>{r.meta}</td>
                    <td>
                      {r.statusType ? (
                        <StatusBadge status={r.status || '—'} type={r.statusType} />
                      ) : (
                        <span className="label label-default">{r.status || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppLayout>
  )
}
