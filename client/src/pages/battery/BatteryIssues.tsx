import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import AppLayout from '../../layout/AppLayout'
import { Box, DataTable, Field, PageForm } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'
import { formatAppDateTime } from '../../lib/datetime'
import { ModuleInsights } from '../../components/ModuleInsights'
import {
  batteryIssuesApi,
  type BatteryCall,
  type BatteryCallQueue,
  type BatteryCallQueueLimit,
  type BatteryCallStats,
  type BatterySyncAll,
  type BatteryIssue,
  type BatteryTrackerStep,
  type BatteryTranscriptLine,
} from '../../api/batteryIssues'
import { transcriptInEnglish } from './transcriptEnglish'

const LIST_QUERY_KEY = 'battery_issues_list_query'

function rememberListQuery(search: string) {
  try {
    sessionStorage.setItem(LIST_QUERY_KEY, search || '')
  } catch {
    // ignore private-mode storage failures
  }
}

function rememberedListQuery() {
  try {
    return sessionStorage.getItem(LIST_QUERY_KEY) || ''
  } catch {
    return ''
  }
}

function listReturnPath(listSearch?: string | null) {
  const query = listSearch != null ? listSearch : rememberedListQuery()
  return query ? `/battery-issues${query.startsWith('?') ? query : `?${query}`}` : '/battery-issues'
}

const CALL_PENDING_OPTIONS: Array<{ limit: BatteryCallQueueLimit; label: string; hint: string }> = [
  { limit: 15, label: 'Call first 15', hint: 'Oldest 15 yet-to-call contacts' },
  { limit: 30, label: 'Call first 30', hint: 'Oldest 30 yet-to-call contacts' },
  { limit: 50, label: 'Call first 50', hint: 'Oldest 50 yet-to-call contacts' },
  { limit: 'all', label: 'Call all', hint: 'Every pending contact with a phone number' },
]

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
]

function statusLabel(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label || status || 'In Progress'
}

function statusClass(status: string) {
  if (status === 'completed' || status === 'closed') return 'bdi-pill bdi-pill--ok'
  if (status === 'open') return 'bdi-pill bdi-pill--muted'
  return 'bdi-pill bdi-pill--progress'
}

function isNoIssueClose(issue: { status?: unknown; close_comments?: unknown }) {
  return String(issue.status || '') === 'closed' && /^no issues$/i.test(String(issue.close_comments || '').trim())
}

function yesNoLabel(value: unknown) {
  const v = String(value || '').toLowerCase()
  if (v === 'yes') return 'Yes'
  if (v === 'no') return 'No'
  return '—'
}

function otherTypeLabels(issue: { battery_issue_confirmed?: unknown; other_issue_reported?: unknown; other_issue_types?: Array<{ label?: string; key?: string }> }) {
  const types: string[] = []
  if (String(issue.battery_issue_confirmed || '') === 'yes') types.push('Battery drain')
  for (const item of issue.other_issue_types || []) {
    const label = String(item.label || item.key || '').trim()
    if (label && !types.includes(label)) types.push(label)
  }
  if (!types.length && String(issue.other_issue_reported || '') === 'yes') types.push('Other IT issue')
  return types
}

function callResultLabel(result: string) {
  switch (String(result || '').toLowerCase()) {
    case 'yet_to_call': return 'Yet to call'
    case 'queued':
    case 'calling':
    case 'in_progress': return 'Calling'
    case 'completed':
    case 'ended': return 'Call completed'
    case 'rejected': return 'Rejected'
    case 'ignored': return 'Ignored'
    default: return result ? result.replace(/_/g, ' ') : 'Yet to call'
  }
}

function callResultClass(result: string) {
  const r = String(result || '').toLowerCase()
  if (r === 'completed' || r === 'ended') return 'bdi-pill bdi-pill--ok'
  if (r === 'rejected') return 'bdi-pill bdi-pill--danger'
  if (r === 'ignored') return 'bdi-pill bdi-pill--warn'
  if (r === 'queued' || r === 'calling' || r === 'in_progress') return 'bdi-pill bdi-pill--progress'
  return 'bdi-pill bdi-pill--muted'
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?'
}

function trackerTone(status: BatteryTrackerStep['status']) {
  if (status === 'completed') return 'completed'
  if (status === 'in_progress') return 'progress'
  if (status === 'skipped') return 'skipped'
  return 'idle'
}

function trackerBadge(status: BatteryTrackerStep['status']) {
  if (status === 'completed') return 'Completed'
  if (status === 'in_progress') return 'In Progress'
  if (status === 'skipped') return 'Skipped'
  return 'Not Started'
}

function callStateIcon(result: string) {
  const r = String(result || 'yet_to_call').toLowerCase()
  if (r === 'completed' || r === 'ended') return { icon: 'fas fa-phone', cls: 'bdi-call-ico bdi-call-ico--ok', title: 'Call completed' }
  if (r === 'rejected') return { icon: 'fas fa-phone-slash', cls: 'bdi-call-ico bdi-call-ico--danger', title: 'Rejected' }
  if (r === 'ignored') return { icon: 'fas fa-phone-alt', cls: 'bdi-call-ico bdi-call-ico--warn', title: 'Ignored / no answer' }
  if (r === 'queued' || r === 'calling' || r === 'in_progress') return { icon: 'fas fa-spinner fa-spin', cls: 'bdi-call-ico bdi-call-ico--progress', title: 'Calling' }
  return { icon: 'far fa-clock', cls: 'bdi-call-ico bdi-call-ico--muted', title: 'Yet to call' }
}

export function BatteryIssuesList() {
  const { can } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') || ''
  const callFilter = searchParams.get('call') || ''
  const reportFilter = searchParams.get('report') || ''
  const otherTypeFilter = searchParams.get('other_type') || ''
  const page = Math.max(0, Number(searchParams.get('page') || 0) || 0)
  const [rows, setRows] = useState<BatteryIssue[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<BatteryCallStats | null>(null)
  const [queue, setQueue] = useState<BatteryCallQueue | null>(null)
  const [startingQueue, setStartingQueue] = useState(false)
  const [queueBusy, setQueueBusy] = useState(false)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [refreshJob, setRefreshJob] = useState<BatterySyncAll | null>(null)
  const queueActive = Boolean(queue?.running)
  const [callMenuOpen, setCallMenuOpen] = useState(false)
  const callMenuRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const pageSize = 15
  const cardFilterOn = Boolean(callFilter || reportFilter || otherTypeFilter)

  const loadStats = () => {
    batteryIssuesApi.stats().then(setStats).catch(() => undefined)
    batteryIssuesApi.queueStatus().then(setQueue).catch(() => undefined)
    batteryIssuesApi.syncAllStatus().then(setRefreshJob).catch(() => undefined)
  }

  const load = () => {
    setLoading(true)
    batteryIssuesApi
      .list({
        search: search || undefined,
        call_result: callFilter || undefined,
        report: reportFilter || undefined,
        other_type: otherTypeFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      })
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
    loadStats()
  }

  const writeListParams = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || (key === 'page' && Number(value) === 0)) next.delete(key)
      else next.set(key, String(value))
    }
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    rememberListQuery(location.search)
  }, [location.search])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page, callFilter, reportFilter, otherTypeFilter])

  useEffect(() => {
    if (!queue?.running && !queue?.paused) return
    const timer = window.setInterval(() => {
      void batteryIssuesApi.queueStatus().then((q) => {
        setQueue(q)
        if (!q.running) load()
      })
    }, 2500)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue?.running, queue?.paused])

  useEffect(() => {
    if (!refreshJob?.running && !refreshingAll) return
    const timer = window.setInterval(() => {
      void batteryIssuesApi.syncAllStatus().then((job) => {
        const finished = (refreshJob?.running || refreshingAll) && !job.running
        setRefreshJob(job)
        if (!job.running) {
          setRefreshingAll(false)
          load()
          if (finished && job.message) toast.success(job.message)
        }
      })
    }, 2000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshJob?.running, refreshingAll])

  useEffect(() => {
    if (!callMenuOpen) return
    const onDoc = (ev: MouseEvent) => {
      if (!callMenuRef.current?.contains(ev.target as Node)) setCallMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [callMenuOpen])

  const startQueue = async (limit: BatteryCallQueueLimit) => {
    const pending = Number(stats?.yet_to_call || 0)
    const count = limit === 'all' ? pending : Math.min(limit, pending)
    if (!count) {
      toast.error('No pending contacts with a phone number')
      return
    }
    const who = limit === 'all'
      ? `all ${count} pending contact${count === 1 ? '' : 's'}`
      : `the first ${count} pending contact${count === 1 ? '' : 's'}`
    if (!window.confirm(
      `Call ${who}, one after another?\n\nIgnored or rejected numbers in this batch are retried after 30 minutes, up to 3 calls. Other pending contacts stay until you start another batch.`,
    )) return
    setCallMenuOpen(false)
    setStartingQueue(true)
    try {
      const res = await batteryIssuesApi.startQueue(limit)
      if (res.payload) setQueue(res.payload)
      toast.success(res.messages?.[0] || 'Call queue started')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the call queue')
    } finally {
      setStartingQueue(false)
    }
  }

  const refreshAllConversations = async () => {
    if (refreshJob?.running || refreshingAll) return
    setRefreshingAll(true)
    try {
      const res = await batteryIssuesApi.syncAll()
      if (res.payload) setRefreshJob(res.payload)
      toast.success(res.messages?.[0] || 'Refreshing conversations')
      if (!res.payload?.running) {
        setRefreshingAll(false)
        load()
      }
    } catch (e) {
      setRefreshingAll(false)
      toast.error(e instanceof Error ? e.message : 'Could not refresh conversations')
    }
  }

  const controlQueue = async (action: 'pause' | 'resume' | 'stop') => {
    const confirmStop = action === 'stop'
      ? window.confirm('Stop calling pending contacts? Already placed calls stay. Remaining numbers are not called until you start Call pending again.')
      : true
    if (!confirmStop) return
    setQueueBusy(true)
    try {
      const res = action === 'pause'
        ? await batteryIssuesApi.pauseQueue()
        : action === 'resume'
          ? await batteryIssuesApi.resumeQueue()
          : await batteryIssuesApi.stopQueue()
      if (res.payload) setQueue(res.payload)
      toast.success(res.messages?.[0] || (action === 'pause' ? 'Paused' : action === 'resume' ? 'Continuing' : 'Stopped'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the call queue')
    } finally {
      setQueueBusy(false)
    }
  }

  const scrollToRecords = () => {
    window.setTimeout(() => {
      listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  const setFilter = (value: string) => {
    writeListParams({
      call: callFilter === value ? '' : value,
      report: '',
      other_type: '',
      page: 0,
    })
    scrollToRecords()
  }

  const setReport = (value: string) => {
    writeListParams({
      report: reportFilter === value ? '' : value,
      call: '',
      other_type: '',
      page: 0,
    })
    scrollToRecords()
  }

  const setOtherType = (value: string) => {
    writeListParams({
      other_type: otherTypeFilter === value ? '' : value,
      call: '',
      report: '',
      page: 0,
    })
    scrollToRecords()
  }

  return (
    <AppLayout title="Battery Degradation Issue" subtitle={loading ? 'Loading…' : `${total} issues`}>
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <ModuleInsights
        title="Call insights"
        cards={[
          { filter: 'all', label: 'Total users', value: stats?.total ?? '—', icon: 'fas fa-users', color: 'bg-navy', hint: 'All contacts' },
          { filter: 'called', label: 'Called', value: stats?.called ?? '—', icon: 'fas fa-phone', color: 'bg-teal', hint: 'Attended + rejected + ignored + calling' },
          { filter: 'yet_to_call', label: 'Yet to call', value: stats?.yet_to_call ?? '—', icon: 'far fa-clock', color: 'bg-olive', hint: 'No call yet' },
          { filter: 'completed', label: 'Attended', value: stats?.attended ?? '—', icon: 'fas fa-user-check', color: 'bg-green', hint: 'Latest call was picked up' },
          { filter: 'rejected', label: 'Rejected', value: stats?.rejected ?? '—', icon: 'fas fa-phone-slash', color: 'bg-maroon', hint: 'Latest call was declined' },
          { filter: 'ignored', label: 'Ignored', value: stats?.ignored ?? '—', icon: 'fas fa-phone-alt', color: 'bg-orange', hint: 'Latest call had no answer' },
          { filter: 'calling', label: 'Calling', value: stats?.calling ?? '—', icon: 'fas fa-phone-volume', color: 'bg-aqua', hint: 'Attempted, waiting for a final outcome' },
        ].map((c) => ({
          label: c.label,
          value: c.value,
          icon: c.icon,
          color: c.color,
          hint: (c.filter === 'all' ? !callFilter && !reportFilter && !otherTypeFilter : callFilter === c.filter)
            ? 'Showing this filter'
            : c.hint,
          active: c.filter === 'all' ? !callFilter && !reportFilter && !otherTypeFilter : callFilter === c.filter,
          onClick: () => setFilter(c.filter === 'all' ? '' : c.filter),
        }))}
      />
      <ModuleInsights
        title="Issue report"
        cards={[
          { filter: 'battery_yes', label: 'Battery yes', value: stats?.battery_yes ?? '—', icon: 'fas fa-battery-quarter', color: 'bg-maroon', hint: 'Yes to battery, no other issue' },
          { filter: 'other_only', label: 'Other issue only', value: stats?.other_only ?? '—', icon: 'fas fa-laptop', color: 'bg-orange', hint: 'No battery, other IT issue' },
          { filter: 'no_issues', label: 'No issues', value: stats?.no_issues ?? '—', icon: 'fas fa-check-circle', color: 'bg-teal', hint: 'No battery and no other issue' },
          { filter: 'both', label: 'Both issues', value: stats?.both_issues ?? '—', icon: 'fas fa-layer-group', color: 'bg-navy', hint: 'Battery and another issue' },
        ].map((c) => ({
          label: c.label,
          value: c.value,
          icon: c.icon,
          color: c.color,
          hint: reportFilter === c.filter ? 'Showing this filter' : c.hint,
          active: reportFilter === c.filter,
          onClick: () => setReport(c.filter),
        }))}
      />
      {(stats?.other_type_counts || []).some((c) => Number(c.count) > 0) ? (
      <ModuleInsights
        title="Other issue types"
        cards={(stats?.other_type_counts || []).filter((c) => Number(c.count) > 0).map((c) => ({
          label: c.label,
          value: c.count,
          icon: c.icon,
          color: otherTypeFilter === c.key ? 'bg-navy' : 'bg-olive',
          hint: otherTypeFilter === c.key ? 'Showing this filter' : 'Reported on the voice call',
          active: otherTypeFilter === c.key,
          onClick: () => setOtherType(c.key),
        }))}
      />
      ) : null}
      <ModuleInsights
        title="Survey answers"
        cards={[
          { filter: 'answered_both', label: 'Answered both', value: stats?.answered_both ?? '—', icon: 'fas fa-clipboard-check', color: 'bg-teal', hint: 'Battery yes + other only + no issues + both' },
          { filter: 'incomplete', label: 'Not answered', value: stats?.incomplete ?? '—', icon: 'fas fa-comment-slash', color: 'bg-orange', hint: 'Picked up, then cut the call or answered only one question' },
        ].map((c) => ({
          label: c.label,
          value: c.value,
          icon: c.icon,
          color: c.color,
          hint: reportFilter === c.filter ? 'Showing this filter' : c.hint,
          active: reportFilter === c.filter,
          onClick: () => setReport(c.filter),
        }))}
      />
      {queue?.running || queue?.paused || queue?.credit_blocked || queue?.message ? (
        <div className={`callout ${
          queue.credit_blocked ? 'callout-danger'
            : queue.paused ? 'callout-warning'
              : queue.running ? 'callout-info'
                : 'callout-success'
        }`}>
          <p>
            {queue.credit_blocked ? <i className="fas fa-ban" />
              : queue.paused ? <i className="fas fa-pause-circle" />
                : queue.running ? <i className="fas fa-spinner fa-spin" />
                  : <i className="fas fa-check" />}
            {' '}{queue.message}
            {queue.running && queue.total ? ` (${queue.done + queue.failed} / ${queue.total})` : ''}
            {queue.running && !queue.paused && queue.current_name ? ` — ${queue.current_name}` : ''}
          </p>
        </div>
      ) : null}
      {refreshJob?.running ? (
        <div className="callout callout-info">
          <p>
            <i className="fas fa-sync fa-spin" /> {refreshJob.message}
            {refreshJob.recordings ? ` — ${refreshJob.recordings} recording${refreshJob.recordings === 1 ? '' : 's'} stored locally` : ''}
          </p>
        </div>
      ) : null}
      <div id="battery-issues-list" ref={listRef}>
      <Box
        title="Issues"
        type="primary"
        tools={
          <>
            {can('battery_issues.edit') ? (
              <>
                <div className={`dropdown ${callMenuOpen ? 'open' : ''}`} ref={callMenuRef}>
                  <button
                    type="button"
                    className="btn btn-theme btn-sm"
                    disabled={startingQueue || queueActive || !stats?.yet_to_call}
                    onClick={() => setCallMenuOpen((open) => !open)}
                  >
                    <i className="fas fa-phone-volume" /> {startingQueue ? 'Starting…' : 'Call pending'}
                    {' '}<i className="fas fa-caret-down" />
                  </button>
                  <div className="dropdown-menu">
                    {CALL_PENDING_OPTIONS.map((opt) => (
                      <button
                        key={String(opt.limit)}
                        type="button"
                        disabled={startingQueue || queueActive || !stats?.yet_to_call}
                        onClick={() => { void startQueue(opt.limit) }}
                      >
                        {opt.label}
                        <span className="text-muted" style={{ display: 'block', fontSize: 11, fontWeight: 400 }}>
                          {opt.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                {queue?.paused ? (
                  <button
                    type="button"
                    className="btn btn-theme btn-sm"
                    disabled={queueBusy || !queueActive}
                    onClick={() => { void controlQueue('resume') }}
                  >
                    <i className="fas fa-play" /> Continue
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-default btn-sm"
                    disabled={queueBusy || !queueActive}
                    onClick={() => { void controlQueue('pause') }}
                  >
                    <i className="fas fa-pause" /> Pause
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={queueBusy || !queueActive}
                  onClick={() => { void controlQueue('stop') }}
                >
                  <i className="fas fa-stop" /> Stop
                </button>
                <button
                  type="button"
                  className="btn btn-default btn-sm"
                  disabled={refreshingAll || Boolean(refreshJob?.running) || queueActive || !stats?.called}
                  onClick={() => { void refreshAllConversations() }}
                >
                  <i className={`fas fa-sync${refreshingAll || refreshJob?.running ? ' fa-spin' : ''}`} />
                  {' '}{refreshingAll || refreshJob?.running ? 'Refreshing…' : 'Refresh conversations'}
                </button>
              </>
            ) : null}
            {can('battery_issues.create') ? (
              <Link to="/battery-issues/create" className="btn btn-default btn-sm">
                <i className="fas fa-plus" /> Create New
              </Link>
            ) : null}
          </>
        }
      >
        <DataTable
          search={search}
          onSearch={(v) => { writeListParams({ q: v, page: 0 }) }}
          rows={rows as unknown as Record<string, unknown>[]}
          exportName="battery-degradation-issues"
          storageKey="battery_issues_columns_v6"
          highlightRows={cardFilterOn}
          onRefresh={load}
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(nextPage) => { writeListParams({ page: nextPage }) }}
          onBulkDelete={can('battery_issues.delete') ? async (ids) => {
            for (const id of ids) await batteryIssuesApi.remove(id)
            load()
          } : undefined}
          columns={[
            {
              key: 'name',
              label: 'Name',
              render: (r) => {
                const result = String(r.call_result || (Number(r.call_count || 0) ? r.call_status : 'yet_to_call'))
                const ico = callStateIcon(result)
                return (
                  <span className="bdi-name-cell">
                    <i className={`${ico.icon} ${ico.cls}`} title={ico.title} />
                    <Link to={`/battery-issues/${r.id}`} state={{ listSearch: location.search }}>{String(r.name)}</Link>
                  </span>
                )
              },
            },
            { key: 'phone', label: 'Phone' },
            { key: 'email', label: 'Email' },
            { key: 'company', label: 'Company' },
            {
              key: 'battery_issue_confirmed',
              label: 'Battery',
              exportValue: (r) => yesNoLabel(r.battery_issue_confirmed),
              render: (r) => yesNoLabel(r.battery_issue_confirmed),
            },
            {
              key: 'other_issue_reported',
              label: 'Other issue',
              exportValue: (r) => yesNoLabel(r.other_issue_reported),
              render: (r) => yesNoLabel(r.other_issue_reported),
            },
            {
              key: 'assigned_name',
              label: 'Technician',
              exportValue: (r) => String(r.assigned_name || ''),
              render: (r) => String(r.assigned_name || '') || <span className="cell-muted">—</span>,
            },
            {
              key: 'call_result',
              label: 'Call',
              exportValue: (r) => callResultLabel(String(r.call_result || (Number(r.call_count || 0) ? r.call_status : 'yet_to_call'))),
              render: (r) => {
                const result = String(r.call_result || (Number(r.call_count || 0) ? r.call_status : 'yet_to_call'))
                return <span className={callResultClass(result)}>{callResultLabel(result)}</span>
              },
            },
            {
              key: 'status',
              label: 'Status',
              exportValue: (r) => statusLabel(String(r.status || '')),
              render: (r) => <span className={statusClass(String(r.status || ''))}>{statusLabel(String(r.status || ''))}</span>,
            },
            {
              key: 'created_at',
              label: 'Created',
              exportValue: (r) => formatAppDateTime(r.created_at, ''),
              render: (r) => formatAppDateTime(r.created_at),
            },
            {
              key: 'actions',
              label: '',
              exportable: false,
              render: (r) => (
                <span className="actions">
                  <Link to={`/battery-issues/${r.id}`} state={{ listSearch: location.search }} className="btn btn-sm btn-default" title="View"><i className="fas fa-eye" /></Link>
                  {can('battery_issues.edit') ? (
                    <Link to={`/battery-issues/${r.id}/edit`} state={{ listSearch: location.search }} className="btn btn-sm btn-warning" title="Edit"><i className="fas fa-pencil-alt" /></Link>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </Box>
      </div>
    </AppLayout>
  )
}

function RecordingPlayer({ streamUrl = '', remoteUrl = '' }: { streamUrl?: string; remoteUrl?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [src, setSrc] = useState('')
  const [loading, setLoading] = useState(Boolean(streamUrl || remoteUrl))
  const remote = /^https?:\/\//i.test(remoteUrl) ? remoteUrl : ''

  useEffect(() => {
    let objectUrl = ''
    let cancelled = false
    if (!streamUrl) {
      setSrc(remote)
      setLoading(false)
      return
    }
    setLoading(true)
    void batteryIssuesApi.recordingBlobUrl(streamUrl)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc(remote)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [streamUrl, remote])

  const fmt = (n: number) => {
    if (!Number.isFinite(n) || n < 0) return '0:00'
    const m = Math.floor(n / 60)
    const s = Math.floor(n % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  if (loading) {
    return <p className="bdi-muted">Loading recording…</p>
  }

  if (!src) {
    return <p className="bdi-muted">No recording attached.</p>
  }

  return (
    <div className="bdi-player">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        className="bdi-play"
        onClick={() => {
          const el = audioRef.current
          if (!el) return
          if (el.paused) void el.play()
          else el.pause()
        }}
      >
        <i className={`fas ${playing ? 'fa-pause' : 'fa-play'}`} /> {playing ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={current}
        onChange={(e) => {
          const el = audioRef.current
          const v = Number(e.target.value)
          if (el) el.currentTime = v
          setCurrent(v)
        }}
      />
      <span className="bdi-player-time">{fmt(current)} / {fmt(duration)}</span>
    </div>
  )
}

function callStillOpen(status: string) {
  const s = status.toLowerCase()
  return s === 'in_queue' || s === 'queued' || s === 'ringing' || s === 'in_progress' || s === 'connected'
}

function visibleConversations(issue: BatteryIssue): BatteryCall[] {
  if (issue.conversations?.length) return issue.conversations
  if (issue.conversation_id || issue.bot_summary || (issue.transcript || []).length) {
    return [{
      id: 0,
      sequence: 1,
      label: 'Conversation 1',
      conversation_id: issue.conversation_id || '',
      call_status: issue.call_status || '',
      call_result: issue.call_result || issue.call_status || '',
      disconnect_reason: '',
      siptrunk_id: issue.siptrunk_id || '',
      agent_id: issue.agent_id || '',
      bot_summary: issue.bot_summary || '',
      recording_url: issue.recording_url || '',
      recording_stream: issue.recording_stream || '',
      transcript: issue.transcript || [],
      transcript_en: [],
      duration: '',
      connected_at: '',
      ended_at: '',
      callback_queued_at: '',
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    }]
  }
  return []
}

function ConversationLangTabs({
  view,
  onChange,
}: {
  view: 'original' | 'english'
  onChange: (view: 'original' | 'english') => void
}) {
  return (
    <div className="bdi-convo-tabs" role="tablist" aria-label="Transcript language">
      <button
        type="button"
        role="tab"
        className={view === 'original' ? 'is-active' : ''}
        aria-selected={view === 'original'}
        onClick={() => onChange('original')}
      >
        Original
      </button>
      <button
        type="button"
        role="tab"
        className={view === 'english' ? 'is-active' : ''}
        aria-selected={view === 'english'}
        onClick={() => onChange('english')}
      >
        See in English
      </button>
    </div>
  )
}

function ConversationCard({
  call,
  issue,
  result,
  latestSeq,
  retryWaiting,
}: {
  call: BatteryCall
  issue: BatteryIssue
  result: string
  latestSeq: number
  retryWaiting: boolean
}) {
  const [view, setView] = useState<'original' | 'english'>('original')
  return (
    <section className="bdi-card">
      <div className="bdi-convo-head">
        <h3>{call.label}</h3>
        {(call.transcript || []).length ? <ConversationLangTabs view={view} onChange={setView} /> : null}
        <span className={callResultClass(result)}>{callResultLabel(result)}</span>
        {call.duration ? <span className="bdi-call-chip">{call.duration}</span> : null}
      </div>
      {retryWaiting ? (
        <p className="bdi-callback-note">
          {result === 'rejected' ? 'Call was rejected.' : 'Call was ignored / not answered.'}
          {' '}A callback will be placed 30 minutes after this call (attempt {call.sequence} of 3).
        </p>
      ) : null}
      {call.conversation_id ? (
        <p className="bdi-step-source">Ello id {call.conversation_id}</p>
      ) : null}
      <div className="bdi-recording-label">Bot Summary</div>
      <p className="bdi-summary">{call.bot_summary || 'No bot summary yet.'}</p>
      <div className="bdi-recording-label">Recording</div>
      <RecordingPlayer
        streamUrl={call.recording_stream || (Number(call.sequence || 1) === latestSeq ? issue.recording_stream : '')}
        remoteUrl={call.recording_url}
      />
      <ConversationTranscript issueId={issue.id} call={call} view={view} />
    </section>
  )
}

function ConversationTranscript({
  issueId,
  call,
  view,
}: {
  issueId: number
  call: BatteryCall
  view: 'original' | 'english'
}) {
  const original = call.transcript || []
  const cached = call.transcript_en || []
  const [english, setEnglish] = useState<BatteryTranscriptLine[]>(cached)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fallback = useMemo(() => transcriptInEnglish(original), [original])
  const fetchedKey = useRef('')

  useEffect(() => {
    if (view !== 'english' || !original.length || !call.id) return
    const key = `${call.id}:${original.map((line) => line.text).join('\n')}`
    const alreadyEnglish = english.length === original.length
      && english.every((line) => !/[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(line.text || ''))
    if (alreadyEnglish && english.length) {
      fetchedKey.current = key
      return
    }
    if (fetchedKey.current === key) return
    fetchedKey.current = key
    let cancelled = false
    setLoading(true)
    setError('')
    void batteryIssuesApi.translateCall(issueId, call.id)
      .then((res) => {
        if (!cancelled) setEnglish(res.transcript_en || [])
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setEnglish(fallback)
          setError(e.message || 'Could not translate this conversation')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [view, issueId, call.id, original, english, fallback])

  const lines = view === 'english' ? (english.length ? english : fallback) : original

  return (
    <>
      <div className="bdi-recording-label">Conversation transcript</div>
      {view === 'english' ? (
        <p className="bdi-muted">
          {loading
            ? 'Translating Hindi, Tamil, and Telugu into English…'
            : 'English view for the helpdesk. Hindi, Tamil, and Telugu lines are machine-translated.'}
        </p>
      ) : null}
      {view === 'english' && error ? <p className="bdi-muted">{error}</p> : null}
      <div className="bdi-chat">
        {loading && view === 'english' && !english.length ? (
          <p className="bdi-muted">Translating…</p>
        ) : lines.length === 0 ? (
          <p className="bdi-muted">No transcript captured yet.</p>
        ) : (
          lines.map((line, i) => (
            <div key={`${call.sequence}-${view}-${line.speaker}-${i}`} className={`bdi-bubble bdi-bubble--${line.speaker}`}>
              {line.speaker === 'bot' ? <span className="bdi-chat-mark">E</span> : null}
              <p>{line.text}</p>
              {line.speaker === 'user' ? <span className="bdi-chat-user"><i className="fas fa-user" /></span> : null}
            </div>
          ))
        )}
      </div>
    </>
  )
}

export function BatteryIssueDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const listBackTo = listReturnPath((location.state as { listSearch?: string } | null)?.listSearch)
  const { can, user, isAdmin } = useAuth()
  const toast = useToast()
  const [issue, setIssue] = useState<BatteryIssue | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [calling, setCalling] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [comments, setComments] = useState('')
  const [proofFiles, setProofFiles] = useState<File[]>([])
  const [closing, setClosing] = useState(false)

  const load = (silent = false) => {
    if (!id) return Promise.resolve()
    if (!silent) setLoading(true)
    return batteryIssuesApi.get(id)
      .then((row) => { setIssue(row); setError('') })
      .catch((e: Error) => { setError(e.message); setIssue(null) })
      .finally(() => { if (!silent) setLoading(false) })
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const open = (issue?.conversations || []).some((c) => callStillOpen(c.call_status))
      || (issue?.conversation_id && callStillOpen(issue.call_status || '') && !(issue.conversations || []).length)
    if (!issue || !open) return
    const timer = window.setInterval(() => {
      void batteryIssuesApi.syncCall(issue.id)
        .then((res) => { if (res.payload) setIssue(res.payload) })
        .catch(() => undefined)
    }, 8000)
    return () => window.clearInterval(timer)
  }, [issue?.id, issue?.conversation_id, issue?.call_status, issue?.conversations])

  const startCall = async () => {
    if (!issue) return
    setCalling(true)
    try {
      const res = await batteryIssuesApi.startCall(issue.id)
      if (res.payload) setIssue(res.payload)
      toast.success(res.messages?.[0] || 'Call queued')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start call')
    } finally {
      setCalling(false)
    }
  }

  const syncCall = async () => {
    if (!issue) return
    setSyncing(true)
    try {
      const res = await batteryIssuesApi.syncCall(issue.id)
      if (res.payload) setIssue(res.payload)
      toast.success(res.messages?.[0] || 'Conversation refreshed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to refresh conversation')
    } finally {
      setSyncing(false)
    }
  }

  const remove = async () => {
    if (!issue) return
    if (!window.confirm('Delete this battery degradation issue?')) return
    try {
      await batteryIssuesApi.remove(issue.id)
      toast.success('Issue deleted')
      navigate(listBackTo)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const closeIssue = async () => {
    if (!issue) return
    const text = comments.trim()
    if (!text) {
      toast.error('Comments are required to close this issue')
      return
    }
    if (!proofFiles.length) {
      toast.error('Attach at least one proof file to close this issue')
      return
    }
    setClosing(true)
    try {
      const res = await batteryIssuesApi.close(issue.id, text, proofFiles)
      if (res.payload) setIssue(res.payload)
      setComments('')
      setProofFiles([])
      toast.success(res.messages?.[0] || 'Issue closed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not close this issue')
    } finally {
      setClosing(false)
    }
  }

  if (loading) {
    return <AppLayout title="Battery Degradation Issue"><p>Loading…</p></AppLayout>
  }
  if (error || !issue) {
    return (
      <AppLayout title="Battery Degradation Issue" backTo={listBackTo}>
        <div className="callout callout-danger"><p>{error || 'Issue not found'}</p></div>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={issue.name} subtitle="Battery Degradation Issue" backTo={listBackTo} backLabel="Issues">
      <div className="bdi-layout">
        <div className="bdi-main">
          <section className="bdi-card">
            <div className="bdi-identity">
              <div className="bdi-avatar">{initials(issue.name)}</div>
              <div className="bdi-identity-copy">
                <span className="bdi-kicker">Name</span>
                <h2>{issue.name}</h2>
              </div>
              <span className={statusClass(issue.status)}>{statusLabel(issue.status)}</span>
            </div>
            {can('battery_issues.edit') ? (
              <div className="bdi-call-bar">
                <button
                  type="button"
                  className="btn btn-theme btn-sm"
                  disabled={calling || !issue.phone}
                  onClick={() => { void startCall() }}
                >
                  <i className="fas fa-phone" /> {calling ? 'Starting…' : (issue.call_count || issue.conversation_id) ? 'Call again' : 'Start voice call'}
                </button>
                <button
                  type="button"
                  className="btn btn-default btn-sm"
                  disabled={syncing || !(issue.call_count || issue.conversation_id)}
                  onClick={() => { void syncCall() }}
                >
                  <i className="fas fa-sync" /> {syncing ? 'Refreshing…' : 'Refresh conversations'}
                </button>
                {issue.call_count ? <span className="bdi-call-chip">{issue.call_count} conversation{issue.call_count === 1 ? '' : 's'}</span> : null}
                <span className={callResultClass(issue.call_result || (issue.call_count ? issue.call_status : 'yet_to_call'))}>
                  {callResultLabel(issue.call_result || (issue.call_count ? issue.call_status : 'yet_to_call'))}
                </span>
              </div>
            ) : (issue.call_count || issue.call_status || issue.call_result) ? (
              <div className="bdi-call-bar">
                {issue.call_count ? <span className="bdi-call-chip">{issue.call_count} conversation{issue.call_count === 1 ? '' : 's'}</span> : null}
                <span className={callResultClass(issue.call_result || 'yet_to_call')}>
                  {callResultLabel(issue.call_result || 'yet_to_call')}
                </span>
              </div>
            ) : null}
            <div className="bdi-meta">
              <div>
                <span>Company</span>
                <strong>{issue.company || '—'}</strong>
              </div>
              <div>
                <span>Created</span>
                <strong>{formatAppDateTime(issue.created_at)}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{issue.phone || '—'}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{issue.email || '—'}</strong>
              </div>
              <div>
                <span>Assigned technician</span>
                <strong>{
                  issue.assigned_name
                  || (isNoIssueClose(issue)
                    ? 'Not assigned (no issue)'
                    : issue.call_result === 'rejected'
                      ? 'Not assigned (call rejected)'
                      : '—')
                }</strong>
              </div>
              <div>
                <span>Language</span>
                <strong>{issue.preferred_language || '—'}</strong>
              </div>
              <div>
                <span>Battery drain</span>
                <strong>{yesNoLabel(issue.battery_issue_confirmed)}</strong>
              </div>
              <div>
                <span>Other IT issue</span>
                <strong>{yesNoLabel(issue.other_issue_reported)}</strong>
              </div>
              <div>
                <span>Issue types</span>
                <strong>{otherTypeLabels(issue).join(', ') || '—'}</strong>
              </div>
            </div>
            {issue.other_issue_description ? (
              <div className="bdi-message">
                <span>Other issue reported</span>
                <p>{issue.other_issue_description}</p>
              </div>
            ) : null}
            {issue.message ? (
              <div className="bdi-message">
                <span>Message</span>
                <p>{issue.message}</p>
              </div>
            ) : null}
          </section>

          {visibleConversations(issue).length === 0 ? (
            <section className="bdi-card">
              <h3>Conversations</h3>
              <p className="bdi-muted">No voice conversations yet. Start a call to create Conversation 1.</p>
            </section>
          ) : (
            [...visibleConversations(issue)].reverse().map((call) => {
              const result = call.call_result || call.call_status || 'queued'
              const convos = visibleConversations(issue)
              const latestSeq = Math.max(...convos.map((c) => Number(c.sequence || 1)))
              const attended = convos.some((c) => c.call_result === 'completed')
              const retryWaiting = !attended
                && Number(call.sequence || 1) === latestSeq
                && Number(call.sequence || 1) < 3
                && (result === 'ignored' || result === 'rejected')
                && !call.callback_queued_at
              return (
              <ConversationCard
                key={call.id || call.sequence}
                call={call}
                issue={issue}
                result={result}
                latestSeq={latestSeq}
                retryWaiting={retryWaiting}
              />
              )
            })
          )}
        </div>

        <aside className="bdi-side">
          <section className="bdi-card">
            <div className="bdi-side-head">
              <h3>Status Tracker</h3>
              {can('battery_issues.edit') ? (
                <Link to={`/battery-issues/${issue.id}/edit`} state={{ listSearch: (location.state as { listSearch?: string } | null)?.listSearch }} className="btn btn-default btn-sm">Edit</Link>
              ) : null}
            </div>
            <ol className="bdi-tracker">
              {(issue.tracker || []).map((step) => (
                <li key={step.key} className={`bdi-step bdi-step--${trackerTone(step.status)}`}>
                  <span className="bdi-step-dot">
                    {step.status === 'completed' ? <i className="fas fa-check" /> : <i className="fas fa-circle" />}
                  </span>
                  <div className="bdi-step-body">
                    <div className="bdi-step-top">
                      <strong>{step.label}</strong>
                      <em className={`bdi-step-badge bdi-step-badge--${trackerTone(step.status)}`}>{trackerBadge(step.status)}</em>
                    </div>
                    {step.source ? <p className="bdi-step-source">{step.source}{step.at ? ` · ${formatAppDateTime(step.at)}` : ''}</p> : null}
                    {step.call_status || step.duration ? (
                      <div className="bdi-step-call">
                        {step.call_status ? <span>Call status <strong>{step.call_status}</strong></span> : null}
                        {step.duration ? <span>Call duration <strong>{step.duration}</strong></span> : null}
                      </div>
                    ) : null}
                    {step.key === 'assign' && step.assignee ? (
                      <p className="bdi-step-source">Assigned to <strong>{step.assignee}</strong></p>
                    ) : step.assignee ? (
                      <p className="bdi-step-source">{step.assignee}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            {issue.status === 'closed' && (issue.close_comments || (issue.close_attachments || []).length) ? (
              <div className="bdi-close-box">
                {issue.close_comments ? (
                  <>
                    <div className="bdi-recording-label">Close comments</div>
                    <p className="bdi-summary">{issue.close_comments}</p>
                  </>
                ) : null}
                {(issue.close_attachments || []).length ? (
                  <div className="bdi-proofs">
                    <div className="bdi-recording-label">Close proof</div>
                    <ul>
                      {issue.close_attachments.map((file) => (
                        <li key={`${file.index}-${file.original_name}`}>
                          <button
                            type="button"
                            className="btn btn-default btn-sm"
                            onClick={() => {
                              void batteryIssuesApi.openCloseProof(issue.id, file.index, file.original_name)
                                .catch((e: Error) => toast.error(e.message))
                            }}
                          >
                            <i className="fas fa-paperclip" /> {file.original_name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {issue.closed_by_name || issue.closed_at ? (
                  <p className="bdi-step-source">
                    Closed{issue.closed_by_name ? ` by ${issue.closed_by_name}` : ''}
                    {issue.closed_at ? ` · ${formatAppDateTime(issue.closed_at)}` : ''}
                  </p>
                ) : null}
              </div>
            ) : issue.assigned_to && issue.status !== 'closed' && can('battery_issues.edit') && (isAdmin || user?.id === issue.assigned_to) ? (
              <div className="bdi-close-box">
                <label className="bdi-recording-label" htmlFor="bdi-close-comments">Comments <span className="text-danger">*</span></label>
                <textarea
                  id="bdi-close-comments"
                  className="form-control"
                  rows={4}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Describe the work done before closing this issue"
                  required
                />
                <label className="bdi-recording-label" htmlFor="bdi-close-proof">Proof attachment <span className="text-danger">*</span></label>
                <input
                  id="bdi-close-proof"
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={(e) => setProofFiles(Array.from(e.target.files || []).slice(0, 8))}
                />
                {proofFiles.length ? (
                  <ul className="bdi-proof-pending">
                    {proofFiles.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="bdi-muted">Attach photo or file proof of the work before closing.</p>
                )}
                <button
                  type="button"
                  className="btn btn-theme btn-sm"
                  disabled={closing || !comments.trim() || !proofFiles.length}
                  onClick={() => { void closeIssue() }}
                >
                  <i className="fas fa-check" /> {closing ? 'Closing…' : 'Close issue'}
                </button>
              </div>
            ) : issue.assigned_name && issue.status !== 'closed' ? (
              <p className="bdi-callback-note">Assigned to {issue.assigned_name}. Comments and a proof attachment are required before this issue can be closed.</p>
            ) : null}
            {can('battery_issues.delete') ? (
              <button type="button" className="btn btn-danger btn-sm bdi-delete" onClick={() => { void remove() }}>
                Delete issue
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </AppLayout>
  )
}

type FormState = {
  name: string
  phone: string
  email: string
  company: string
  message: string
  bot_summary: string
  recording_url: string
  status: string
  transcript: BatteryTranscriptLine[]
}

const emptyForm: FormState = {
  name: '',
  phone: '',
  email: '',
  company: '',
  message: '',
  bot_summary: '',
  recording_url: '',
  status: 'in_progress',
  transcript: [{ speaker: 'bot', text: '' }],
}

export function BatteryIssueForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEdit || !id) return
    batteryIssuesApi.get(id)
      .then((row) => {
        setForm({
          name: row.name || '',
          phone: row.phone || '',
          email: row.email || '',
          company: row.company || '',
          message: row.message || '',
          bot_summary: row.bot_summary || '',
          recording_url: row.recording_url || '',
          status: row.status || 'in_progress',
          transcript: row.transcript?.length ? row.transcript : [{ speaker: 'bot', text: '' }],
        })
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const submit = async () => {
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError('')
    const body = {
      ...form,
      transcript: form.transcript.filter((l) => l.text.trim()),
    }
    try {
      const res = isEdit && id
        ? await batteryIssuesApi.update(id, body)
        : await batteryIssuesApi.create(body)
      const saved = res.payload
      if (file && saved?.id) {
        await batteryIssuesApi.uploadRecording(saved.id, file)
      }
      toast.success(isEdit ? 'Issue updated' : 'Issue created')
      navigate(saved?.id ? `/battery-issues/${saved.id}` : '/battery-issues')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const transcript = useMemo(() => form.transcript, [form.transcript])

  if (loading) {
    return <AppLayout title="Battery Degradation Issue"><p>Loading…</p></AppLayout>
  }

  return (
    <AppLayout title={isEdit ? 'Update issue' : 'Create issue'} backTo="/battery-issues">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
      <PageForm
        cancelTo={isEdit && id ? `/battery-issues/${id}` : '/battery-issues'}
        submitLabel={saving ? 'Saving…' : 'Save'}
        submitDisabled={saving}
        onSubmit={() => { void submit() }}
      >
        <Field label="Name" required>
          <input className="form-control" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="Phone">
          <input className="form-control" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="form-control" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Company">
          <input className="form-control" value={form.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
        <Field label="Status">
          {form.status === 'closed' ? (
            <input className="form-control" value="Closed" disabled />
          ) : (
            <select className="form-control" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUS_OPTIONS.filter((s) => s.value !== 'closed').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Message" full>
          <textarea className="form-control" rows={3} value={form.message} onChange={(e) => set('message', e.target.value)} />
        </Field>
        <Field label="Bot Summary" full>
          <textarea className="form-control" rows={5} value={form.bot_summary} onChange={(e) => set('bot_summary', e.target.value)} />
        </Field>
        <Field label="Recording URL">
          <input className="form-control" value={form.recording_url} onChange={(e) => set('recording_url', e.target.value)} placeholder="https://… or upload a file" />
        </Field>
        <Field label="Upload recording">
          <input type="file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <Field label="Conversation transcript" full>
          <div className="bdi-transcript-editor">
            {transcript.map((line, i) => (
              <div key={i} className="bdi-transcript-row">
                <select
                  className="form-control"
                  value={line.speaker}
                  onChange={(e) => {
                    const next = [...form.transcript]
                    next[i] = { ...next[i], speaker: e.target.value as 'bot' | 'user' }
                    set('transcript', next)
                  }}
                >
                  <option value="bot">Bot</option>
                  <option value="user">User</option>
                </select>
                <input
                  className="form-control"
                  value={line.text}
                  placeholder="Message"
                  onChange={(e) => {
                    const next = [...form.transcript]
                    next[i] = { ...next[i], text: e.target.value }
                    set('transcript', next)
                  }}
                />
                <button
                  type="button"
                  className="btn btn-default btn-sm"
                  onClick={() => set('transcript', form.transcript.filter((_, idx) => idx !== i))}
                >
                  <i className="fas fa-times" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-default btn-sm"
              onClick={() => set('transcript', [...form.transcript, { speaker: form.transcript.length % 2 ? 'user' : 'bot', text: '' }])}
            >
              <i className="fas fa-plus" /> Add line
            </button>
          </div>
        </Field>
      </PageForm>
    </AppLayout>
  )
}
