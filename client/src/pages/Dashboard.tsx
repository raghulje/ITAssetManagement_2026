import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppLayout from '../layout/AppLayout'
import { AppSelect, SmallBox, Box } from '../components/ui'
import { dashboardApi, mastersApi, type DashCharts, type SelectOption } from '../api/client'
import { useAuth } from '../api/AuthContext'
import { softwareLicensesInDomain } from '../lib/domainScope'
import { BarList, DonutChart, Legend, TrendChart } from '../components/DashCharts'
import AssetPeriodPicker, { getEmptyPeriodState, type PeriodState } from '../components/AssetPeriodPicker'
import { DashFilterSheet, DashFiltersButton, filterCount } from '../components/DashMobileFilters'

type DashCounts = Record<string, number>

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

const emptyCharts: DashCharts = {
  status: [],
  types: [],
  companies: [],
  trend: [],
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

export default function Dashboard() {
  const { activeDomain } = useAuth()
  const [params] = useSearchParams()
  const showLicenses = softwareLicensesInDomain(activeDomain)
  const [counts, setCounts] = useState<DashCounts>(emptyCounts)
  const [charts, setCharts] = useState<DashCharts>(emptyCharts)
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
    const mq = window.matchMedia('(min-width: 992px)')
    const onChange = () => {
      if (mq.matches) setSheetOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      dashboardApi.counts(filterParams).then((c) => {
        if (!cancelled) setCounts({ ...emptyCounts, ...c })
      }),
      dashboardApi.charts(filterParams).then((c) => {
        if (!cancelled) setCharts(c)
      }).catch(() => {
        if (!cancelled) setCharts(emptyCharts)
      }),
    ])
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filterParams])

  const load = () => {
    setLoading(true)
    Promise.all([
      dashboardApi.counts(filterParams).then((c) => setCounts({ ...emptyCounts, ...c })),
      dashboardApi.charts(filterParams).then(setCharts).catch(() => setCharts(emptyCharts)),
    ])
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }

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
  const assignedPct = totalAssets ? `${Math.round((assigned / totalAssets) * 100)}%` : '0%'
  const showCompanies = charts.companies.filter((c) => c.label !== 'No company').length > 1
    || charts.companies.length > 1
  const trendTitle = period.summaryLabel
    ? (period.range.from && period.range.to && (Date.parse(`${period.range.to}T12:00:00`) - Date.parse(`${period.range.from}T12:00:00`)) / 86400000 > 31
      ? `Assignments · last 14 days of ${period.summaryLabel}`
      : `Assignments · ${period.summaryLabel}`)
    : 'Assignments · last 14 days'
  const trendEmpty = period.range.from
    ? 'No assignment activity in the selected period.'
    : 'No assignment activity in the last 14 days.'

  return (
    <AppLayout title="Dashboard">
      <div className="dash-filters-mobile">
        <DashFiltersButton count={activeFilterCount} onClick={() => setSheetOpen(true)} />
      </div>

      <div className="dash-filters-desktop">
        <Box type="primary">
          <div className="asset-toolbar dash-toolbar">
            <div className="asset-toolbar-bar">
              <div className="asset-toolbar-actions">
                <span className="dash-filter-kicker">Filters</span>
              </div>
              <div className="asset-toolbar-tools">
                <button type="button" className="btn btn-default btn-sm" onClick={load} disabled={loading} title="Refresh">
                  <i className={`fas fa-sync ${loading ? 'fa-spin' : ''}`} />
                </button>
              </div>
            </div>
            <div className="asset-toolbar-filters">
              <AppSelect
                className="filter-app-select"
                value={companyId}
                onChange={setCompanyId}
                searchable
                placeholder="All companies"
                options={companyOptions}
              />
              <AppSelect
                className="filter-app-select"
                value={locationId}
                onChange={setLocationId}
                searchable
                placeholder="All locations"
                options={locationOptions}
              />
              <AssetPeriodPicker
                className="filter-period-picker"
                mode={period.mode}
                range={period.range}
                summaryLabel={period.summaryLabel}
                onChange={setPeriod}
              />
              {hasFilters ? (
                <button
                  type="button"
                  className="btn btn-default btn-sm asset-toolbar-clear"
                  onClick={clearFilters}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </Box>
      </div>

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

      <div className="row">
        <SmallBox to={appendFilters('/hardware', hrefFilters)} count={counts.assets} label="Assets" color="bg-teal" icon="fas fa-barcode" />
        {showLicenses ? (
          <SmallBox to={appendFilters('/licenses', { company_id: companyId || undefined })} count={counts.licenses} label="Licenses" color="bg-maroon" icon="fas fa-save" />
        ) : null}
        <SmallBox to={appendFilters('/accessories', { company_id: companyId || undefined, location_id: locationId || undefined })} count={counts.accessories} label="Accessories" color="bg-orange" icon="fas fa-keyboard" />
        <SmallBox to={appendFilters('/consumables', { company_id: companyId || undefined, location_id: locationId || undefined })} count={counts.consumables} label="Consumables" color="bg-purple" icon="fas fa-tint" />
        <SmallBox to={appendFilters('/components', { company_id: companyId || undefined, location_id: locationId || undefined })} count={counts.components} label="Components" color="bg-olive" icon="fas fa-hdd" />
        <SmallBox
          to="/employees?active=1"
          count={counts.employees_active ?? counts.employees ?? counts.users}
          label="Active employees"
          color="bg-navy"
          icon="fas fa-users"
        />
      </div>

      <div className="module-insights-title" style={{ marginTop: 4 }}>Asset inventory snapshot</div>
      <div className="row">
        <SmallBox to={appendFilters('/hardware?status_type=Assigned', hrefFilters)} count={assigned} label="Assigned" color="bg-orange" icon="fas fa-user-check" />
        <SmallBox to={appendFilters('/hardware?status_type=RTD', hrefFilters)} count={counts.rtd || 0} label="In stock" color="bg-olive" icon="fas fa-warehouse" />
        <SmallBox to={appendFilters('/hardware/eol/due', { company_id: companyId || undefined, location_id: locationId || undefined })} count={counts.eol_due || 0} label="EOL due" color="bg-red" icon="fas fa-calendar-times" />
      </div>

      <div className="row dash-chart-row">
        <div className="col-md-5">
          <Box title="Status mix" type="primary">
            <div className="dash-donut-panel">
              <DonutChart slices={charts.status} centerValue={assignedPct} centerLabel="assigned" />
              <Legend slices={charts.status} />
            </div>
          </Box>
        </div>
        <div className="col-md-7">
          <Box title="By asset type" type="primary">
            <BarList slices={charts.types} empty="No assets to chart yet." />
          </Box>
        </div>
      </div>

      <div className="row">
        <div className={showCompanies ? 'col-md-8' : 'col-md-12'}>
          <Box
            title={trendTitle}
            type="primary"
            tools={<Link to="/reports/activity" className="btn btn-default btn-sm">Activity log</Link>}
          >
            <TrendChart points={charts.trend} empty={trendEmpty} />
          </Box>
        </div>
        {showCompanies ? (
          <div className="col-md-4">
            <Box title="By company" type="default">
              <BarList slices={charts.companies} empty="No company split yet." />
            </Box>
          </div>
        ) : null}
      </div>
    </AppLayout>
  )
}
