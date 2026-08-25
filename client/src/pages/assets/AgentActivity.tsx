import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { Box } from '../../components/ui'
import { hardwareApi } from '../../api/client'
import { formatAppDateTime } from '../../lib/datetime'

function actionClass(action: string) {
  if (action === 'updated') return 'label label-success'
  if (action === 'created') return 'label label-info'
  if (action === 'failed') return 'label label-danger'
  if (action === 'unmatched') return 'label label-warning'
  return 'label label-default'
}

export default function AgentActivity() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = (q = search) => {
    setLoading(true)
    hardwareApi.agentSyncLogs({ limit: 200, search: q || undefined })
      .then((r) => setRows(r.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <AppLayout title="Agent activity" subtitle="Every ITAgent sync attempt — update, create, unmatched, or failed" backTo="/reports">
      <Box title="ITAgent sync log" type="primary">
        <div className="form-inline" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="form-control"
            style={{ maxWidth: 320 }}
            placeholder="Search hostname, serial, tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load() }}
          />
          <button type="button" className="btn btn-theme btn-sm" onClick={() => load()}>Search</button>
          <button type="button" className="btn btn-default btn-sm" onClick={() => load()}>Refresh</button>
        </div>
        <p className="help-block">
          When a friend runs <code>ITAgent_2026.ps1</code>, a row appears here.
          If the device serial/hostname already matches an asset, action is <strong>updated</strong> (no duplicate).
        </p>
        <div className="table-responsive">
          <table className="table table-striped table-condensed">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Message</th>
                <th>Hostname</th>
                <th>Serial</th>
                <th>Asset</th>
                <th>Matched by</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-muted">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="text-muted">No agent syncs yet — ask them to run the script again.</td></tr>
              )}
              {rows.map((r) => {
                const assetId = r.asset_id != null ? Number(r.asset_id) : null
                const tag = String(r.linked_asset_tag || r.asset_tag || '')
                return (
                  <tr key={String(r.id)}>
                    <td style={{ whiteSpace: 'nowrap' }} title={String(r.created_at || '')}>{formatAppDateTime(r.created_at)}</td>
                    <td><span className={actionClass(String(r.action || ''))}>{String(r.action || '—')}</span></td>
                    <td>{String(r.message || '—')}</td>
                    <td>{String(r.hostname || '—')}</td>
                    <td>{String(r.serial_number || '—')}</td>
                    <td>
                      {assetId
                        ? <Link to={`/hardware/${assetId}`}>{tag || `#${assetId}`}</Link>
                        : (tag || '—')}
                    </td>
                    <td>{String(r.matched_by || '—')}</td>
                    <td>{String(r.client_ip || '—')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Box>
    </AppLayout>
  )
}
