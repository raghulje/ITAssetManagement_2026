import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import AppLayout from '../../layout/AppLayout'
import AssetAttachments from '../../components/AssetAttachments'
import { api, hardwareApi } from '../../api/client'
import { assetImageSrc } from '../../api/baseUrl'
import { formatINR } from '../../utils/money'
import { formatAppDateTime } from '../../lib/datetime'
import AssetRecordHero from './detail/AssetRecordHero'
import AssetOverviewTab from './detail/AssetOverviewTab'

type TabId = 'overview' | 'attachments' | 'history' | 'agent' | 'maintenance'

type AgentStatus = {
  registered?: boolean
  presence?: string
  presence_label?: string
  online?: boolean
  polling?: boolean
  pending_commands?: number
  last_agent_sync_at?: string | null
  agent_hostname?: string | null
  agent?: {
    hostname?: string | null
    serial_number?: string | null
    platform?: string | null
    agent_version?: string | null
    last_heartbeat_at?: string | null
    last_inventory_at?: string | null
  } | null
  recent_commands?: Array<{
    id: number
    command: string
    status: string
    created_at?: string | null
    completed_at?: string | null
    error_message?: string | null
  }>
  recent_syncs?: Array<{
    id: number
    action: string
    status?: string
    message?: string | null
    serial_number?: string | null
    hostname?: string | null
    matched_by?: string | null
    client_ip?: string | null
    created_at?: string | null
  }>
  installed_software_count?: number
  installed_software?: Array<{
    name: string
    publisher?: string
    version?: string
    install_date?: string
  }>
}

export default function AssetDetail() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const [asset, setAsset] = useState<Record<string, unknown> | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [maintenances, setMaintenances] = useState<Record<string, unknown>[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [receivedImages, setReceivedImages] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const assignRef = useRef<HTMLElement | null>(null)

  const fromEmployeeId = params.get('from') === 'employee' ? params.get('employee_id') : null
  const returnQs = useMemo(() => {
    if (!fromEmployeeId) return ''
    const q = new URLSearchParams({ from: 'employee', employee_id: fromEmployeeId })
    return `?${q.toString()}`
  }, [fromEmployeeId])
  const backTo = fromEmployeeId ? `/employees/${fromEmployeeId}` : '/hardware'
  const backLabel = fromEmployeeId ? 'Back to employee' : 'Back to assets'

  const loadAgent = () => {
    if (!id) return
    hardwareApi.agentStatus(id)
      .then((s) => setAgentStatus(s as AgentStatus))
      .catch(() => setAgentStatus(null))
  }

  const load = () => {
    if (!id) return
    setLoading(true)
    hardwareApi.get(id)
      .then((a) => setAsset(a))
      .catch(() => setAsset(null))
      .finally(() => setLoading(false))
    hardwareApi.history(id)
      .then((r) => setHistory(r.rows || []))
      .catch(() => setHistory([]))
    hardwareApi.maintenances(id)
      .then((r) => setMaintenances(r.rows || []))
      .catch(() => setMaintenances([]))
    api<{ rows: Record<string, unknown>[] }>(`/hardware/${id}/files`)
      .then((r) => setReceivedImages((r.rows || []).filter((f) => String(f.kind) === 'received')))
      .catch(() => setReceivedImages([]))
    loadAgent()
  }
  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (tab !== 'agent' || !id) return
    const t = window.setInterval(() => loadAgent(), 8000)
    return () => window.clearInterval(t)
  }, [tab, id])

  const printLabel = async () => {
    try {
      const res = await api<{ pdf_base64: string }>(`/labels/hardware/${id}`, { method: 'POST', json: {} })
      const b64 = (res as { payload?: { pdf_base64: string }; pdf_base64?: string }).payload?.pdf_base64
        || (res as { pdf_base64?: string }).pdf_base64
      if (!b64) throw new Error('No PDF returned')
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const opened = window.open(url, '_blank')
      if (!opened) {
        const a = document.createElement('a')
        a.href = url
        a.download = `print-label-${id}.pdf`
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setMsg('Print label generated — QR is permanent for this asset')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Print label failed')
    }
  }

  const requestAgentScan = async () => {
    if (!id) return
    setAgentBusy(true)
    setMsg('')
    try {
      const res = await hardwareApi.agentScan(id, { command: 'scan' }) as {
        messages?: string[]
        payload?: { message?: string }
      }
      setMsg(res.payload?.message || res.messages?.[0] || 'Scan requested')
      loadAgent()
      setTab('agent')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not request scan')
    } finally {
      setAgentBusy(false)
    }
  }

  const presenceClass = (p?: string) => {
    if (p === 'online') return 'label label-success'
    if (p === 'idle') return 'label label-warning'
    if (p === 'stale') return 'label label-default'
    return 'label label-default'
  }

  const actionLabel = (action: string) => {
    if (action === 'checkout') return 'Assigned'
    if (action === 'checkin') return 'Unassigned'
    if (action === 'replace_out') return 'Replaced (out)'
    if (action === 'replace_in') return 'Replaced (in)'
    if (action === 'maintenance') return 'Maintenance'
    if (action === 'maintenance_update') return 'Maintenance updated'
    return action
  }

  const focusAssignment = () => {
    setTab('overview')
    window.setTimeout(() => {
      const el = assignRef.current
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('vad-card--highlight')
      void el.offsetWidth
      el.classList.add('vad-card--highlight')
      window.setTimeout(() => el.classList.remove('vad-card--highlight'), 2400)
    }, 60)
  }

  if (loading) {
    return (
      <AppLayout title="Asset" hideHeader>
        <div className="vad-page">
          <div className="vad-skel-title vad-skeleton" />
          <div className="vad-skel-line vad-skeleton" style={{ width: '40%' }} />
          <div className="vad-hero vad-skeleton vad-skel-hero" />
          <div className="vad-overview" style={{ marginTop: 8 }}>
            <div className="vad-card vad-skeleton" style={{ height: 220 }} />
            <div className="vad-card vad-skeleton" style={{ height: 220 }} />
            <div className="vad-card vad-skeleton" style={{ height: 220 }} />
          </div>
        </div>
      </AppLayout>
    )
  }

  if (!asset) {
    return (
      <AppLayout title="Asset" hideHeader>
        <div className="vad-page">
          <div className="vad-error">
            <h2>Unable to load asset</h2>
            <p>This asset could not be found, or you do not have access.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary" onClick={() => load()}>Retry</button>
              <Link to={backTo} className="btn btn-default">{backLabel}</Link>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  const a = asset
  const imageUrl = assetImageSrc(
    (a.image_url as string | undefined) || (a.image as string | undefined) || null,
  )
  const custody = history.filter((x) => ['checkout', 'checkin', 'replace_in', 'replace_out'].includes(String(x.action_type)))

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'maintenance', label: 'Maintenance', count: maintenances.length },
    { id: 'agent', label: 'Agent' },
    { id: 'attachments', label: 'Documents' },
    { id: 'history', label: 'Activity', count: history.length || undefined },
  ]

  return (
    <AppLayout title={String(a.asset_tag || 'Asset')} hideHeader>
      {msg ? <div className="callout callout-info"><p>{msg}</p></div> : null}
      <div className="vad-page">
        <AssetRecordHero
          asset={a}
          imageUrl={imageUrl}
          backTo={backTo}
          backLabel={backLabel}
          returnQs={returnQs}
          onPrintLabel={() => { void printLabel() }}
        />

        <div className="vad-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'is-active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count != null ? <span>({t.count})</span> : null}
            </button>
          ))}
        </div>

        {tab === 'overview' ? (
          <AssetOverviewTab
            asset={a}
            assignRef={assignRef}
            returnQs={returnQs}
            receivedImages={receivedImages}
            agentLabel={agentStatus?.registered ? 'Run agent scan' : 'Install agent first'}
            agentRegistered={Boolean(agentStatus?.registered)}
            agentBusy={agentBusy}
            onPrintLabel={() => { void printLabel() }}
            onAgentScan={() => { void requestAgentScan() }}
            onQuick={(action) => {
              if (action === 'history') setTab('history')
              if (action === 'maintenance') setTab('maintenance')
              if (action === 'agent') setTab('agent')
            }}
          />
        ) : null}

        {tab === 'maintenance' ? (
          <div className="vad-panel">
            <div className="vad-panel__bar">
              <h3>Maintenance log</h3>
              <Link to={`/maintenances/create?asset_id=${a.id}`} className="btn btn-primary btn-sm">
                Add maintenance
              </Link>
            </div>
            {maintenances.length === 0 ? (
              <div className="vad-empty">
                <strong>No maintenance records yet</strong>
                Log a repair or service for this asset.
              </div>
            ) : (
              <ul className="vad-timeline">
                {maintenances.map((m) => (
                  <li key={String(m.id)}>
                    <span className={`vad-timeline__dot${m.completion_date ? ' vad-timeline__dot--muted' : ''}`} />
                    <div className="vad-timeline__body">
                      <strong>{String(m.title || '—')}</strong>
                      <span>
                        {String(m.asset_maintenance_type || '—')}
                        {m.note ? ` · ${String(m.note)}` : ''}
                      </span>
                    </div>
                    <div className="vad-timeline__time">
                      <div>{formatAppDateTime(m.start_date || m.created_at)}</div>
                      <div>{m.cost != null && m.cost !== '' ? formatINR(Number(m.cost)) : ''}</div>
                      <div className="vad-timeline__actions">
                        <span className={`vad-assign-pill${m.completion_date ? '' : ' vad-assign-pill--open'}`}>
                          {m.completion_date ? 'Completed' : 'Open'}
                        </span>
                        <Link to={`/maintenances/${m.id}/edit`} className="btn btn-xs btn-default">Edit</Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'agent' ? (
          <div className="vad-panel">
            <div className="vad-panel__bar">
              <h3>ITAgent control</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={agentBusy || !agentStatus?.registered}
                  onClick={() => { void requestAgentScan() }}
                >
                  {agentBusy ? 'Requesting…' : 'Request inventory scan'}
                </button>
                <button type="button" className="btn btn-default btn-sm" onClick={() => loadAgent()}>
                  Refresh status
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div className="help-block mb-1">Agent presence</div>
                <span className={presenceClass(agentStatus?.presence)}>
                  {agentStatus?.presence_label || 'No agent'}
                </span>
                {agentStatus?.polling ? (
                  <span className="label label-success" style={{ marginLeft: 8 }}>Polling</span>
                ) : agentStatus?.registered ? (
                  <span className="label label-warning" style={{ marginLeft: 8 }}>Not polling</span>
                ) : null}
                {agentStatus?.pending_commands ? (
                  <span className="label label-info" style={{ marginLeft: 8 }}>
                    {agentStatus.pending_commands} queued
                  </span>
                ) : null}
              </div>
              <p className="help-block mb-0" style={{ flex: 1, minWidth: 220 }}>
                When ITAgent_2026 is installed and running on the device, you can queue a remote inventory scan from here.
              </p>
            </div>

            {!agentStatus?.registered && (
              <div className="callout callout-warning">
                <p className="mb-0">
                  No agent registered for this asset yet. On the device, install and run
                  {' '}<code>ITAgent_2026</code> → <strong>Install &amp; Start</strong>
                  (not Sync once only). After heartbeats show Online, this button can queue remote scans.
                </p>
              </div>
            )}

            {agentStatus?.registered && (agentStatus.pending_commands || 0) > 0 && !agentStatus.polling && (
              <div className="callout callout-warning">
                <p className="mb-0">
                  Scan is queued, but this PC is <strong>not polling</strong> right now.
                  On <code>{String(agentStatus?.agent?.hostname || 'the device')}</code> open the agent EXE →
                  confirm API <code>https://asset.refexone.com/api/v1</code> → click <strong>Install &amp; Start</strong>
                  (approve UAC). Within ~30 seconds the pending scan should move to done.
                </p>
              </div>
            )}

            {agentStatus?.registered && agentStatus.polling && (agentStatus.pending_commands || 0) > 0 && (
              <div className="callout callout-info">
                <p className="mb-0">
                  Agent is polling — waiting for the next heartbeat (~30s) to claim and run the scan.
                </p>
              </div>
            )}

            <dl className="vad-info-grid vad-info-grid--3" style={{ marginBottom: 16 }}>
              <div className="vad-field">
                <dt>Hostname</dt>
                <dd>{String(agentStatus?.agent?.hostname || agentStatus?.agent_hostname || '—')}</dd>
              </div>
              <div className="vad-field">
                <dt>Serial</dt>
                <dd>{String(agentStatus?.agent?.serial_number || a.serial || '—')}</dd>
              </div>
              <div className="vad-field">
                <dt>Platform / version</dt>
                <dd>
                  {String(agentStatus?.agent?.platform || '—')}
                  {agentStatus?.agent?.agent_version ? ` · v${agentStatus.agent.agent_version}` : ''}
                </dd>
              </div>
              <div className="vad-field">
                <dt>Last heartbeat</dt>
                <dd>{formatAppDateTime(agentStatus?.agent?.last_heartbeat_at)}</dd>
              </div>
              <div className="vad-field">
                <dt>Last inventory</dt>
                <dd>{formatAppDateTime(agentStatus?.agent?.last_inventory_at || agentStatus?.last_agent_sync_at || a.last_agent_sync_at)}</dd>
              </div>
            </dl>

            <h5 style={{ marginTop: 8 }}>
              Sync history{' '}
              <Link to="/hardware/agent-activity" className="btn btn-default btn-xs" style={{ marginLeft: 8 }}>All agent activity</Link>
            </h5>
            {(agentStatus?.recent_syncs || []).length === 0 ? (
              <p className="text-muted">No syncs for this asset yet</p>
            ) : (
              <ul className="vad-timeline">
                {(agentStatus?.recent_syncs || []).map((s) => (
                  <li key={s.id}>
                    <span className="vad-timeline__dot" />
                    <div className="vad-timeline__body">
                      <strong>{s.action}</strong>
                      <span>{String(s.message || '—')}{s.matched_by ? ` · ${s.matched_by}` : ''}</span>
                    </div>
                    <div className="vad-timeline__time">{formatAppDateTime(s.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}

            <h5 style={{ marginTop: 16 }}>
              Installed software{' '}
              {agentStatus?.installed_software_count
                ? <span className="text-muted" style={{ fontWeight: 400 }}>({agentStatus.installed_software_count})</span>
                : null}
            </h5>
            <div className="table-responsive" style={{ maxHeight: 360, overflow: 'auto', marginBottom: 16 }}>
              <table className="vad-doc-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Publisher</th>
                    <th>Version</th>
                    <th>Install date</th>
                  </tr>
                </thead>
                <tbody>
                  {(agentStatus?.installed_software || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-muted">
                        No software list yet — run a full inventory sync / remote scan on the device.
                      </td>
                    </tr>
                  )}
                  {(agentStatus?.installed_software || []).map((app, i) => (
                    <tr key={`${app.name}-${app.version || ''}-${i}`}>
                      <td>{app.name}</td>
                      <td>{app.publisher || '—'}</td>
                      <td>{app.version || '—'}</td>
                      <td>{app.install_date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h5 style={{ marginTop: 16 }}>Remote commands</h5>
            <table className="vad-doc-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Command</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {(agentStatus?.recent_commands || []).length === 0 && (
                  <tr><td colSpan={6} className="text-muted">No remote commands yet</td></tr>
                )}
                {(agentStatus?.recent_commands || []).map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.command}</td>
                    <td>{c.status}</td>
                    <td>{formatAppDateTime(c.created_at)}</td>
                    <td>{formatAppDateTime(c.completed_at)}</td>
                    <td>{String(c.error_message || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === 'attachments' && id ? (
          <div className="vad-panel">
            <div className="vad-panel__bar">
              <h3>Documents</h3>
            </div>
            <AssetAttachments assetId={id} readOnly />
          </div>
        ) : null}

        {tab === 'history' ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="vad-panel">
              <div className="vad-panel__bar">
                <h3>Assign / unassign history</h3>
                <button type="button" className="btn btn-default btn-sm" onClick={focusAssignment}>
                  Current assignment
                </button>
              </div>
              {custody.length === 0 ? (
                <div className="vad-empty">
                  <strong>No custody events yet</strong>
                  Assign or unassign this asset — entries appear here.
                </div>
              ) : (
                <ul className="vad-timeline">
                  {custody.map((x) => (
                    <li key={`custody-${String(x.id)}`}>
                      <span className={`vad-timeline__dot${String(x.action_type) === 'checkin' ? ' vad-timeline__dot--muted' : ''}`} />
                      <div className="vad-timeline__body">
                        <strong>{actionLabel(String(x.action_type || ''))}</strong>
                        <span>
                          {x.target_type === 'employee' && x.target_id
                            ? <Link to={`/employees/${x.target_id}`}>{String(x.target_name || x.target_id)}</Link>
                            : String(x.target_name || '—')}
                          {x.note ? ` · ${String(x.note)}` : ''}
                        </span>
                        <span className="vad-timeline__meta">
                          {String(x.admin || 'System')}
                        </span>
                      </div>
                      <div className="vad-timeline__time">{formatAppDateTime(x.action_date)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="vad-panel">
              <div className="vad-panel__bar"><h3>Complete asset history</h3></div>
              {history.length === 0 ? (
                <div className="vad-empty">
                  <strong>No other activity yet</strong>
                </div>
              ) : (
                <ul className="vad-timeline">
                  {history.map((x) => (
                    <li key={String(x.id)}>
                      <span className="vad-timeline__dot" />
                      <div className="vad-timeline__body">
                        <strong>{actionLabel(String(x.action_type || 'Activity'))}</strong>
                        <span>
                          {String(x.admin || 'System')}
                          {x.target_type === 'employee' && x.target_id
                            ? <> · <Link to={`/employees/${x.target_id}`}>{String(x.target_name || x.target_id)}</Link></>
                            : x.target_name ? ` · ${String(x.target_name)}` : ''}
                          {x.note ? ` · ${String(x.note)}` : ''}
                        </span>
                      </div>
                      <div className="vad-timeline__time">{formatAppDateTime(x.action_date)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </AppLayout>
  )
}
