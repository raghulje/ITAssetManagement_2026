import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../layout/AppLayout'
import { SmallBox, Box } from '../components/ui'
import { dashboardApi, type DashCharts } from '../api/client'
import { useAuth } from '../api/AuthContext'
import { softwareLicensesInDomain } from '../lib/domainScope'
import { BarList, DonutChart, Legend, TrendChart } from '../components/DashCharts'

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

export default function Dashboard() {
  const { activeDomain } = useAuth()
  const showLicenses = softwareLicensesInDomain(activeDomain)
  const [counts, setCounts] = useState<DashCounts>(emptyCounts)
  const [charts, setCharts] = useState<DashCharts>(emptyCharts)

  useEffect(() => {
    const params = { domain: activeDomain }
    dashboardApi.counts(params).then((c) => setCounts({ ...emptyCounts, ...c })).catch(() => undefined)
    dashboardApi.charts(params).then(setCharts).catch(() => setCharts(emptyCharts))
  }, [activeDomain])

  const assigned = counts.deployed || 0
  const totalAssets = counts.assets || 0
  const assignedPct = totalAssets ? `${Math.round((assigned / totalAssets) * 100)}%` : '0%'
  const showCompanies = charts.companies.filter((c) => c.label !== 'No company').length > 1
    || charts.companies.length > 1

  return (
    <AppLayout title="Dashboard">
      <div className="row">
        <SmallBox to="/hardware" count={counts.assets} label="Assets" color="bg-teal" icon="fas fa-barcode" />
        {showLicenses ? (
          <SmallBox to="/licenses" count={counts.licenses} label="Licenses" color="bg-maroon" icon="fas fa-save" />
        ) : null}
        <SmallBox to="/accessories" count={counts.accessories} label="Accessories" color="bg-orange" icon="fas fa-keyboard" />
        <SmallBox to="/consumables" count={counts.consumables} label="Consumables" color="bg-purple" icon="fas fa-tint" />
        <SmallBox to="/components" count={counts.components} label="Components" color="bg-olive" icon="fas fa-hdd" />
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
        <SmallBox to="/hardware?status_type=Assigned" count={assigned} label="Assigned" color="bg-orange" icon="fas fa-user-check" />
        <SmallBox to="/hardware?status_type=RTD" count={counts.rtd || 0} label="In stock" color="bg-olive" icon="fas fa-warehouse" />
        <SmallBox to="/hardware/eol/due" count={counts.eol_due || 0} label="EOL due" color="bg-red" icon="fas fa-calendar-times" />
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
            title="Assignments · last 14 days"
            type="primary"
            tools={<Link to="/reports/activity" className="btn btn-default btn-sm">Activity log</Link>}
          >
            <TrendChart points={charts.trend} />
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
