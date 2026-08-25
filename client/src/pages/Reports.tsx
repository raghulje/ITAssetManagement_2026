import { Link } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import AppLayout from '../layout/AppLayout'
import { AppSelect } from '../components/ui'
import { api } from '../api/client'
import { formatINR } from '../utils/money'
import { downloadAuthedCsv, downloadCsv } from '../utils/csv'
import { formatAppDateTime } from '../lib/datetime'
import { useAuth } from '../api/AuthContext'
import { softwareLicensesInDomain } from '../lib/domainScope'

const reportCards = [
  { to: '/reports/activity', icon: 'fas fa-history', title: 'Activity Report', desc: 'Activity trail with filters for action, item type, and date range.' },
  { to: '/reports/custom', icon: 'fas fa-file-alt', title: 'Custom Asset Report', desc: 'Column picker, assignment filters, date ranges, CSV export.' },
  // { to: '/reports/audit', icon: 'fas fa-clipboard-check', title: 'Audit Report', desc: 'Assets due for or past audit.' }, // Audit feature — restore when needed
  { to: '/reports/depreciation', icon: 'fas fa-chart-line', title: 'Depreciation Report', desc: 'Book value and depreciation schedule.' },
  { to: '/reports/licenses', icon: 'fas fa-save', title: 'License Report', desc: 'License utilization across software products.' },
  { to: '/reports/maintenances', icon: 'fas fa-wrench', title: 'Maintenance Report', desc: 'Repair and maintenance history.' },
  { to: '/reports/unaccepted', icon: 'fas fa-exclamation-triangle', title: 'Unaccepted Assets', desc: 'Assets awaiting user acceptance.' },
  { to: '/reports/accessories', icon: 'fas fa-keyboard', title: 'Accessory Report', desc: 'Accessory assignments and stock levels.' },
  { to: '/hardware/agent-activity', icon: 'fas fa-satellite-dish', title: 'Agent activity', desc: 'ITAgent sync attempts — updated, created, unmatched, failed.' },
]

function ReportShell({
  title,
  subtitle,
  filters,
  onExport,
  exporting,
  children,
  empty,
  loading,
  rowCount,
}: {
  title: string
  subtitle?: string
  filters?: ReactNode
  onExport?: () => void
  exporting?: boolean
  children: ReactNode
  empty?: boolean
  loading?: boolean
  rowCount?: number
}) {
  return (
    <AppLayout title={title} subtitle={subtitle || (loading ? 'Loading…' : rowCount != null ? `${rowCount} rows` : undefined)} backTo="/reports">
      <div className="report-shell">
        {onExport ? (
          <div className="report-shell-toolbar">
            <div className="spacer" />
            <button type="button" className="btn btn-theme btn-sm" disabled={exporting || loading || empty} onClick={onExport}>
              <i className="fas fa-download" /> {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        ) : null}
        {filters ? <div className="report-shell-filters">{filters}</div> : null}
        <div className="report-shell-body">
          {loading ? (
            <p className="text-muted report-empty">Loading…</p>
          ) : empty ? (
            <div className="report-empty">
              <i className="fas fa-inbox" />
              <p>No results for this report.</p>
            </div>
          ) : children}
        </div>
      </div>
    </AppLayout>
  )
}

function DenseTable({
  columns,
  rows,
  moneyKeys,
}: {
  columns: [string, string][]
  rows: Record<string, unknown>[]
  moneyKeys?: Set<string>
}) {
  const money = moneyKeys || new Set(['purchase_cost', 'book_value', 'cost'])
  return (
    <>
      <div className="table-responsive data-table-desktop">
        <table className="table table-striped table-hover table-condensed report-table">
          <thead>
            <tr>{columns.map(([k, label]) => <th key={k}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map(([k]) => (
                  <td key={k}>{money.has(k) ? formatINR(r[k]) : String(r[k] ?? '—')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="data-table-mobile" aria-label="Report rows">
        {rows.length === 0 ? (
          <p className="text-muted data-card-empty">No rows</p>
        ) : rows.map((r, i) => (
          <article key={i} className="data-card">
            <div className="data-card-title">
              {money.has(columns[0][0]) ? formatINR(r[columns[0][0]]) : String(r[columns[0][0]] ?? '—')}
            </div>
            <dl className="data-card-fields">
              {columns.slice(1).map(([k, label]) => (
                <div key={k} className="data-card-field">
                  <dt>{label}</dt>
                  <dd>{money.has(k) ? formatINR(r[k]) : String(r[k] ?? '—')}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </>
  )
}

export function ReportsHub() {
  const { activeDomain } = useAuth()
  const showLicenses = softwareLicensesInDomain(activeDomain)
  const [hub, setHub] = useState<Record<string, number>>({})
  useEffect(() => {
    api<Record<string, number>>('/reports/hub').then(setHub).catch(() => undefined)
  }, [])

  const kpis = [
    // { label: 'Audit Due', value: hub.audit_due, icon: 'fas fa-clipboard-check', tone: 'warning' }, // Audit feature — restore when needed
    { label: 'EOL Due', value: hub.eol_due, icon: 'fas fa-hourglass-end', tone: 'danger' },
    { label: 'Due for Unassign', value: hub.checkin_due, icon: 'fas fa-undo', tone: 'info' },
    ...(showLicenses
      ? [{ label: 'Licenses Exhausted', value: hub.licenses_exhausted, icon: 'fas fa-save', tone: 'success' }]
      : []),
  ]

  const cards = showLicenses
    ? reportCards
    : reportCards.filter((r) => r.to !== '/reports/licenses')

  return (
    <AppLayout title="Reports" subtitle={showLicenses ? 'Operational insights across assets, licenses, and activity' : 'Operational insights across assets and activity'} backTo="/">
      <div className="row report-kpi-row">
        {kpis.map((k) => (
          <div key={k.label} className="col-md-3 col-sm-6">
            <div className={`report-kpi report-kpi-${k.tone}`}>
              <div className="report-kpi-icon"><i className={k.icon} /></div>
              <div>
                <div className="report-kpi-value">{k.value ?? '—'}</div>
                <div className="report-kpi-label">{k.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="row report-card-grid">
        {cards.map((r) => (
          <div key={r.to} className="col-md-4 col-sm-6">
            <Link to={r.to} className="report-card">
              <div className="report-card-icon"><i className={r.icon} /></div>
              <h4>{r.title}</h4>
              <p>{r.desc}</p>
              <span className="report-card-cta">View report <i className="fas fa-arrow-right" /></span>
            </Link>
          </div>
        ))}
      </div>
    </AppLayout>
  )
}

export function ActivityReport() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [action, setAction] = useState('')
  const [itemType, setItemType] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    const q = new URLSearchParams()
    if (action) q.set('action_type', action)
    if (itemType) q.set('item_type', itemType)
    api<{ rows: Record<string, unknown>[] }>(`/reports/activity?${q}`)
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const mappedRows: Record<string, unknown>[] = rows.map((a) => ({
    ...a,
    action_date: formatAppDateTime(a.action_date),
    action_type: String(a.action_type) === 'checkout' ? 'assign' : String(a.action_type) === 'checkin' ? 'unassign' : a.action_type,
  }))

  const exportCsv = () => {
    downloadCsv(
      'activity-report.csv',
      ['Date', 'Admin', 'Action', 'Item', 'Target', 'Notes'],
      mappedRows.map((a) => [
        String(a.action_date ?? ''),
        String(a.admin ?? ''),
        String(a.action_type ?? ''),
        String(a.item_name ?? ''),
        String(a.target_name ?? ''),
        String(a.note ?? ''),
      ]),
    )
  }

  return (
    <ReportShell
      title="Activity Report"
      filters={(
        <div className="row">
          <div className="col-md-3">
            <AppSelect
              value={action}
              onChange={setAction}
              options={[
                { value: '', label: 'All actions' },
                { value: 'checkout', label: 'assign' },
                { value: 'checkin', label: 'unassign' },
                { value: 'create', label: 'create' },
                { value: 'update', label: 'update' },
                // { value: 'audit', label: 'audit' }, // Audit feature — restore when needed
                { value: 'agent_update', label: 'agent_update' },
                { value: 'agent_create', label: 'agent_create' },
                { value: 'maintenance', label: 'maintenance' },
                { value: 'maintenance_update', label: 'maintenance_update' },
                { value: 'accepted', label: 'accepted' },
                { value: 'import', label: 'import' },
                { value: 'uploaded', label: 'uploaded' },
              ]}
            />
          </div>
          <div className="col-md-3">
            <AppSelect
              value={itemType}
              onChange={setItemType}
              options={[
                { value: '', label: 'All item types' },
                { value: 'asset', label: 'asset' },
                { value: 'license', label: 'license' },
                { value: 'user', label: 'user' },
                { value: 'import', label: 'import' },
              ]}
            />
          </div>
          <div className="col-md-3">
            <button type="button" className="btn btn-theme" onClick={load}>Apply</button>
          </div>
        </div>
      )}
      onExport={exportCsv}
      loading={loading}
      empty={!loading && mappedRows.length === 0}
      rowCount={mappedRows.length}
    >
      <DenseTable
        columns={[['action_date', 'Date'], ['admin', 'Admin'], ['action_type', 'Action'], ['item_name', 'Item'], ['target_name', 'Target'], ['note', 'Notes']]}
        rows={mappedRows}
      />
    </ReportShell>
  )
}

const CUSTOM_FIELDS = [
  ['asset_tag', 'Asset Tag'], ['name', 'Name'], ['serial', 'Serial'], ['model', 'Model'],
  ['category', 'Category'], ['manufacturer', 'Manufacturer'], ['status', 'Status'],
  ['assigned_to', 'Assigned To'], ['username', 'Username'], ['email', 'Email'],
  ['location', 'Location'], ['company', 'Company'], ['supplier', 'Supplier'],
  ['purchase_cost', 'Purchase Cost'], ['purchase_date', 'Purchase Date'],
  ['expected_checkin', 'Expected Return'],
  // ['next_audit_date', 'Next Audit'], // Audit feature — restore when needed
  ['notes', 'Notes'],
] as const

const fieldLabel = (key: string) => CUSTOM_FIELDS.find(([k]) => k === key)?.[1] || key

export function CustomReport() {
  const [selected, setSelected] = useState<string[]>(['asset_tag', 'name', 'serial', 'model', 'status', 'assigned_to', 'location', 'company', 'purchase_cost'])
  const [assignment, setAssignment] = useState('')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const toggle = (key: string) => setSelected((s) => s.includes(key) ? s.filter((x) => x !== key) : [...s, key])

  const generate = () => {
    setLoading(true)
    const q = new URLSearchParams({ fields: selected.join(',') })
    if (assignment) q.set('assignment_status', assignment)
    api<{ rows: Record<string, unknown>[] }>(`/reports/custom?${q}`)
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      await downloadAuthedCsv('/reports/custom/export', 'custom-asset-report.csv')
    } finally {
      setExporting(false)
    }
  }

  const keys = rows[0] ? Object.keys(rows[0]) : selected

  return (
    <ReportShell
      title="Custom Asset Report"
      filters={(
        <>
          <div className="row">
            {CUSTOM_FIELDS.map(([key, label]) => (
              <div key={key} className="col-md-3" style={{ marginBottom: 8 }}>
                <label className="checkbox">
                  <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} /> {label}
                </label>
              </div>
            ))}
          </div>
          <div className="form-stack" style={{ marginTop: 8 }}>
            <div className="form-group" style={{ maxWidth: 280 }}>
              <label>Assignment</label>
              <AppSelect
                value={assignment}
                onChange={setAssignment}
                options={[
                  { value: '', label: 'All' },
                  { value: 'assigned', label: 'Assigned only' },
                  { value: 'unassigned', label: 'Unassigned only' },
                ]}
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-theme" onClick={generate}>Generate</button>
            </div>
          </div>
        </>
      )}
      onExport={() => { void exportCsv() }}
      exporting={exporting}
      loading={loading}
      empty={!loading && rows.length === 0}
      rowCount={rows.length}
    >
      <DenseTable
        columns={keys.map((k) => [k, fieldLabel(k)] as [string, string])}
        rows={rows}
      />
    </ReportShell>
  )
}

function SimpleApiReport({
  title,
  path,
  columns,
  exportName,
}: {
  title: string
  path: string
  columns: [string, string][]
  exportName: string
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const moneyKeys = new Set(['purchase_cost', 'book_value', 'cost'])

  useEffect(() => {
    setLoading(true)
    api<{ rows: Record<string, unknown>[] }>(path)
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [path])

  const exportCsv = () => {
    downloadCsv(
      exportName,
      columns.map(([, label]) => label),
      rows.map((r) => columns.map(([k]) => (
        moneyKeys.has(k) ? formatINR(r[k]) : String(r[k] ?? '')
      ))),
    )
  }

  return (
    <ReportShell
      title={title}
      onExport={exportCsv}
      loading={loading}
      empty={!loading && rows.length === 0}
      rowCount={rows.length}
    >
      <DenseTable columns={columns} rows={rows} moneyKeys={moneyKeys} />
    </ReportShell>
  )
}

/** Audit feature — restore route `/reports/audit` in App.tsx when needed. */
export function AuditReport() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<{ rows: Record<string, unknown>[] }>('/reports/audit')
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const mapped = rows.map((a) => ({
    id: a.id,
    asset_tag: a.asset_tag,
    name: a.name,
    location: (a.location as { name?: string })?.name || '',
    next_audit_date: (a.next_audit_date as { formatted?: string })?.formatted || a.next_audit_date || '',
  }))

  return (
    <ReportShell
      title="Audit Report"
      onExport={() => downloadCsv(
        'audit-report.csv',
        ['Asset Tag', 'Name', 'Location', 'Next Audit'],
        mapped.map((a) => [String(a.asset_tag ?? ''), String(a.name ?? ''), String(a.location ?? ''), String(a.next_audit_date ?? '')]),
      )}
      loading={loading}
      empty={!loading && rows.length === 0}
      rowCount={rows.length}
    >
      <div className="table-responsive">
        <table className="table table-striped table-hover table-condensed report-table">
          <thead><tr><th>Asset Tag</th><th>Name</th><th>Location</th><th>Next Audit</th></tr></thead>
          <tbody>
            {mapped.map((a) => (
              <tr key={String(a.id)}>
                <td><Link to={`/hardware/${a.id}`}>{String(a.asset_tag)}</Link></td>
                <td>{String(a.name || '')}</td>
                <td>{String(a.location || '—')}</td>
                <td>{String(a.next_audit_date || '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportShell>
  )
}

export function DepreciationReport() {
  return (
    <SimpleApiReport
      title="Depreciation Report"
      path="/reports/depreciation"
      exportName="depreciation-report.csv"
      columns={[['asset_tag', 'Asset Tag'], ['name', 'Name'], ['purchase_cost', 'Purchase Cost'], ['book_value', 'Book Value'], ['depreciation_months', 'Months']]}
    />
  )
}

export function LicenseReport() {
  return (
    <SimpleApiReport
      title="License Report"
      path="/reports/licenses"
      exportName="license-report.csv"
      columns={[['name', 'Name'], ['seats', 'Licenses'], ['used', 'Used'], ['remaining', 'Available'], ['used_percent', 'Used %'], ['expiration_date', 'Expiration']]}
    />
  )
}

export function MaintenanceReport() {
  return (
    <SimpleApiReport
      title="Asset Maintenance Report"
      path="/reports/maintenances"
      exportName="maintenance-report.csv"
      columns={[['asset_tag', 'Asset'], ['title', 'Title'], ['asset_maintenance_type', 'Type'], ['cost', 'Cost'], ['start_date', 'Start']]}
    />
  )
}

export function UnacceptedReport() {
  return (
    <SimpleApiReport
      title="Unaccepted Assets"
      path="/reports/unaccepted"
      exportName="unaccepted-assets.csv"
      columns={[['asset_tag', 'Asset'], ['asset_name', 'Name'], ['user_name', 'Assigned To'], ['created_at', 'Assign Date']]}
    />
  )
}

export function AccessoryReport() {
  return (
    <SimpleApiReport
      title="Accessory Report"
      path="/reports/accessories"
      exportName="accessory-report.csv"
      columns={[['name', 'Name'], ['qty', 'Qty'], ['checked_out', 'Checked Out'], ['remaining', 'Remaining'], ['min_amt', 'Min']]}
    />
  )
}
