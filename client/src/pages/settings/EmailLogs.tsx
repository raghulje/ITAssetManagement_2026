import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { Box } from '../../components/ui'
import { api } from '../../api/client'

type EmailLog = {
  id: number
  email_type: string
  status: string
  related_type: string
  related_id: number | null
  to_addresses: string
  subject: string
  message_id: string
  error_message: string
  meta: { accepted?: string[]; rejected?: string[] } | null
  created_at: string
  sent_at: string
}

type LogsPayload = {
  total: number
  rows: EmailLog[]
  counts: { sent: number; failed: number; skipped: number; queued: number }
  types: Record<string, string>
}

const STATUS_CLASS: Record<string, string> = {
  sent: 'label label-success',
  failed: 'label label-danger',
  skipped: 'label label-warning',
  queued: 'label label-default',
}

function formatWhen(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export default function EmailLogs() {
  const [data, setData] = useState<LogsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [emailType, setEmailType] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const limit = 40

  const load = () => {
    setLoading(true)
    const q = new URLSearchParams()
    if (status) q.set('status', status)
    if (emailType) q.set('email_type', emailType)
    if (search) q.set('search', search)
    q.set('limit', String(limit))
    q.set('offset', String(page * limit))
    api<LogsPayload>(`/settings/email-logs?${q.toString()}`)
      .then((res) => {
        setData(res)
        setError('')
      })
      .catch((e: Error) => {
        setError(e.message)
        setData(null)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [status, emailType, search, page])

  const rows = data?.rows || []
  const total = data?.total || 0
  const counts = data?.counts || { sent: 0, failed: 0, skipped: 0, queued: 0 }
  const types = data?.types || {}
  const pages = Math.max(1, Math.ceil(total / limit))

  return (
    <AppLayout title="Email logs" subtitle="Delivered, failed, and who received each message" backTo="/settings/notifications">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}

      <div className="row">
        <div className="col-sm-3">
          <div className="info-box">
            <span className="info-box-icon bg-green"><i className="fas fa-check" /></span>
            <div className="info-box-content">
              <span className="info-box-text">Delivered</span>
              <span className="info-box-number">{counts.sent}</span>
            </div>
          </div>
        </div>
        <div className="col-sm-3">
          <div className="info-box">
            <span className="info-box-icon bg-red"><i className="fas fa-times" /></span>
            <div className="info-box-content">
              <span className="info-box-text">Failed</span>
              <span className="info-box-number">{counts.failed}</span>
            </div>
          </div>
        </div>
        <div className="col-sm-3">
          <div className="info-box">
            <span className="info-box-icon bg-yellow"><i className="fas fa-ban" /></span>
            <div className="info-box-content">
              <span className="info-box-text">Skipped</span>
              <span className="info-box-number">{counts.skipped}</span>
            </div>
          </div>
        </div>
        <div className="col-sm-3">
          <div className="info-box">
            <span className="info-box-icon bg-aqua"><i className="fas fa-clock" /></span>
            <div className="info-box-content">
              <span className="info-box-text">Queued</span>
              <span className="info-box-number">{counts.queued}</span>
            </div>
          </div>
        </div>
      </div>

      <Box
        title="Outbound emails"
        type="primary"
        tools={(
          <Link to="/settings/notifications" className="btn btn-default btn-sm">
            Notification settings
          </Link>
        )}
      >
        <form
          className="form-inline"
          style={{ marginBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault()
            setPage(0)
            setSearch(searchInput.trim())
          }}
        >
          <input
            className="form-control"
            style={{ minWidth: 220, marginRight: 8 }}
            placeholder="Recipient, subject, error…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            className="form-control"
            style={{ marginRight: 8 }}
            value={status}
            onChange={(e) => { setPage(0); setStatus(e.target.value) }}
          >
            <option value="">All statuses</option>
            <option value="sent">Delivered</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="queued">Queued</option>
          </select>
          <select
            className="form-control"
            style={{ marginRight: 8 }}
            value={emailType}
            onChange={(e) => { setPage(0); setEmailType(e.target.value) }}
          >
            <option value="">All types</option>
            {Object.entries(types).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <button type="submit" className="btn btn-default">Search</button>
          <button type="button" className="btn btn-default" style={{ marginLeft: 6 }} onClick={() => load()}>
            Refresh
          </button>
        </form>

        <div className="table-responsive">
          <table className="table table-striped table-hover">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Type</th>
                <th>To</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="text-muted">No email logs yet.</td></tr>
              ) : rows.map((row) => {
                const open = expandedId === row.id
                const accepted = row.meta?.accepted?.length ? row.meta.accepted.join(', ') : ''
                const rejected = row.meta?.rejected?.length ? row.meta.rejected.join(', ') : ''
                return (
                  <Fragment key={row.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedId(open ? null : row.id)}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatWhen(row.created_at)}</td>
                      <td><span className={STATUS_CLASS[row.status] || 'label label-default'}>{row.status === 'sent' ? 'delivered' : row.status}</span></td>
                      <td>{types[row.email_type] || row.email_type}</td>
                      <td title={row.to_addresses}>{row.to_addresses || '—'}</td>
                      <td title={row.subject}>{row.subject}</td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={5} style={{ background: '#fafafa', fontSize: 13 }}>
                          <div><strong>To:</strong> {row.to_addresses || '—'}</div>
                          {accepted ? <div><strong>Accepted by SMTP:</strong> {accepted}</div> : null}
                          {rejected ? <div><strong>Rejected by SMTP:</strong> {rejected}</div> : null}
                          {row.message_id ? <div><strong>Message ID:</strong> {row.message_id}</div> : null}
                          {row.sent_at ? <div><strong>Sent at:</strong> {formatWhen(row.sent_at)}</div> : null}
                          {row.related_type ? <div><strong>Related:</strong> {row.related_type}{row.related_id ? ` #${row.related_id}` : ''}</div> : null}
                          {row.error_message ? (
                            <div className="text-danger"><strong>Error:</strong> {row.error_message}</div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div>
            <button type="button" className="btn btn-default btn-sm" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Previous
            </button>
            <span className="text-muted" style={{ margin: '0 10px' }}>
              Page {page + 1} of {pages} ({total} total)
            </span>
            <button type="button" className="btn btn-default btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        ) : null}
      </Box>
    </AppLayout>
  )
}
