import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { hardwareApi } from '../../api/client'
import { getApiBase } from '../../api/baseUrl'

type Change = { field: string; label: string; from: string; to: string; source?: string }
type Review = { label: string; report: string; system: string }
type Status = 'update' | 'unchanged' | 'unmatched' | 'ambiguous' | 'skipped'

type CompareRow = {
  row_index: number
  endpoint: string
  serial: string
  model: string
  site: string
  last_user: string
  email: string
  status: Status
  match_by: string
  reason: string
  asset_id: number | null
  asset_tag: string | null
  asset_name: string | null
  changes: Change[]
  review: Review[]
}

type CompareResult = {
  upload_id: string
  summary: {
    rows: number
    columns: number
    columns_with_values: number
    matched: number
    updates: number
    unchanged: number
    unmatched: number
    ambiguous: number
    skipped: number
    storage_ready: boolean
    original_serials: number
  }
  detail_columns: string[]
  rows: CompareRow[]
}

const FILTERS: Array<{ id: Status | 'all'; label: string }> = [
  { id: 'update', label: 'Updates' },
  { id: 'unchanged', label: 'Already current' },
  { id: 'unmatched', label: 'Will create' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'ambiguous', label: 'Needs a look' },
  { id: 'all', label: 'All rows' },
]

function recount(rows: CompareRow[], summary: CompareResult['summary']): CompareResult['summary'] {
  return {
    ...summary,
    matched: rows.filter((row) => row.asset_id != null && row.status !== 'ambiguous').length,
    updates: rows.filter((row) => row.status === 'update').length,
    unchanged: rows.filter((row) => row.status === 'unchanged').length,
    unmatched: rows.filter((row) => row.status === 'unmatched').length,
    ambiguous: rows.filter((row) => row.status === 'ambiguous').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
  }
}

export default function LatestAssetCompare() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [filter, setFilter] = useState<Status | 'all'>('update')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [originalFiles, setOriginalFiles] = useState<FileList | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (result?.rows || []).filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false
      if (!q) return true
      return [row.endpoint, row.serial, row.asset_tag, row.model, row.site, row.last_user, row.email]
        .some((value) => String(value || '').toLowerCase().includes(q))
    })
  }, [result, filter, query])

  const compare = async () => {
    if (!file) {
      setError('Choose the latest asset workbook')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const data = await hardwareApi.previewLatestData(file)
      setResult(data)
      setFilter(data.summary.updates ? 'update' : 'all')
      setOpen(null)
      setSelected(new Set(data.rows.filter((row) => row.status === 'update' || row.status === 'unmatched').map((row) => row.row_index)))
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : 'Could not read the workbook')
    } finally {
      setBusy(false)
    }
  }

  const loadOriginalSheets = async () => {
    if (!originalFiles?.length) {
      setError('Choose OverAll Asset Lists and the other workbooks used to create the assets')
      return
    }
    setSheetBusy(true)
    setError('')
    setMessage('')
    try {
      const fd = new FormData()
      Array.from(originalFiles).forEach((item) => fd.append('files', item))
      const token = localStorage.getItem('refex_token')
      const res = await fetch(`${getApiBase()}/settings/load_original_asset_sheets`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      const data = await res.json().catch(() => ({})) as { messages?: string[]; message?: string }
      if (!res.ok) {
        const messages = Array.isArray(data.messages) ? data.messages : [data.message || 'Upload failed']
        throw new Error(messages.join(', '))
      }
      const msg = Array.isArray(data.messages) ? data.messages.join(' ') : 'Original asset sheets loaded'
      setMessage(msg)
      if (file) await compare()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the original asset sheets')
    } finally {
      setSheetBusy(false)
    }
  }

  const apply = async () => {
    if (!result) return
    const ids = [...selected]
    if (!ids.length) {
      setError('Select at least one row to update or create')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const applied = await hardwareApi.applyLatestData(result.upload_id, ids)
      if (!applied.failed?.length) {
        const done = new Set(ids)
        const created = new Map((applied.created_rows || []).map((row) => [row.row_index, row]))
        setResult((prev) => {
          if (!prev) return prev
          const rows = prev.rows.map((row) => {
            if (!done.has(row.row_index)) return row
            const made = created.get(row.row_index)
            if (made) {
              return { ...row, status: 'unchanged' as const, changes: [], asset_id: made.asset_id, asset_tag: made.asset_tag, reason: 'Created' }
            }
            if (row.status === 'update') return { ...row, status: 'unchanged' as const, changes: [] }
            return row
          })
          return { ...prev, rows, summary: recount(rows, prev.summary) }
        })
        setSelected(new Set())
      }
      const failed = applied.failed?.length ? ` ${applied.failed.join(' ')}` : ''
      const createdCount = applied.created || 0
      setMessage(`Updated ${applied.updated} asset${applied.updated === 1 ? '' : 's'} and created ${createdCount}.${failed} Open an asset and use the Additional Details tab to see the extra columns.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleIds = visible.filter((row) => row.status === 'update' || row.status === 'unmatched').map((row) => row.row_index)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const toggleVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }

  const summary = result?.summary

  return (
    <AppLayout title="Compare latest asset data">
      <div className="latest-data">
        <div className="latest-data__intro">
          <p>
            Upload <strong>latest_asset_data.xlsx</strong>. Each row is matched by serial number, then by endpoint name or asset tag.
            The table shows the value in the system and the value that will be written, including assigned user, email, and company.
            Rows that are not in the system are created. If the original asset workbooks have been loaded in Admin, those rows also keep the old asset number, company, model, invoice, and cost.
          </p>
          <div className="latest-data__upload">
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null)
                setMessage('')
                setError('')
              }}
            />
            <button type="button" className="btn btn-theme" disabled={busy} onClick={() => { void compare() }}>
              {busy ? 'Working…' : 'Compare with assets'}
            </button>
            <Link to="/hardware" className="btn btn-default">Back to assets</Link>
          </div>
        </div>

        {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}
        {message ? <div className="callout callout-success"><p>{message}</p></div> : null}
        {summary && summary.original_serials === 0 ? (
          <div className="callout callout-warning">
            <p>
              Original asset sheets are not loaded on this server. Choose <strong>OverAll Asset Lists 1.xlsx</strong> and <strong>RIL Asset Couriered List.xlsx</strong>, then click load_original_asset_sheets.
              New assets will then keep the old asset number, company, invoice, and cost. The same button is also under Settings → General → Original asset sheets.
            </p>
            <div className="latest-data__upload">
              <input
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple
                disabled={sheetBusy || busy}
                onChange={(e) => setOriginalFiles(e.target.files)}
              />
              <button type="button" className="btn btn-theme" disabled={sheetBusy || busy || !originalFiles?.length} onClick={() => { void loadOriginalSheets() }}>
                {sheetBusy ? 'Loading…' : 'load_original_asset_sheets'}
              </button>
            </div>
          </div>
        ) : null}
        {summary && !summary.storage_ready ? (
          <div className="callout callout-warning">
            <p>The comparison is ready, but the database does not have the additional-details column yet. In Admin, click migrate_comparision_feature before applying. That does not run the older migrations.</p>
          </div>
        ) : null}

        {summary ? (
          <>
            <div className="latest-kpis">
              <div className="latest-kpi"><strong>{summary.rows}</strong><span>Report rows</span></div>
              <div className="latest-kpi"><strong>{summary.columns_with_values}</strong><span>Columns with values</span></div>
              <div className="latest-kpi"><strong>{summary.updates}</strong><span>Assets to update</span></div>
              <div className="latest-kpi"><strong>{summary.unmatched}</strong><span>Will be created</span></div>
              <div className="latest-kpi"><strong>{summary.skipped}</strong><span>Skipped, no serial</span></div>
            </div>

            <div className="latest-data__bar">
              <div className="latest-filters">
                {FILTERS.map((item) => {
                  const count = item.id === 'all'
                    ? summary.rows
                    : item.id === 'update'
                      ? summary.updates
                      : item.id === 'unchanged'
                        ? summary.unchanged
                        : item.id === 'unmatched'
                          ? summary.unmatched
                          : item.id === 'skipped'
                            ? summary.skipped
                            : summary.ambiguous
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={filter === item.id ? 'is-active' : ''}
                      onClick={() => setFilter(item.id)}
                    >
                      {item.label} <span>{count}</span>
                    </button>
                  )
                })}
              </div>
              <input
                className="form-control"
                placeholder="Search endpoint, serial, tag…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="button" className="btn btn-theme" disabled={busy || selected.size === 0} onClick={() => { void apply() }}>
                Apply {selected.size} row{selected.size === 1 ? '' : 's'}
              </button>
            </div>

            <div className="table-responsive">
              <table className="table table-striped latest-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select visible updates" />
                    </th>
                    <th>Endpoint</th>
                    <th>Serial</th>
                    <th>Asset</th>
                    <th>What will change</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr><td colSpan={5}>Nothing in this view.</td></tr>
                  ) : visible.map((row) => {
                    const core = row.changes.filter((change) => !change.field.startsWith('extra:'))
                    const extra = row.changes.filter((change) => change.field.startsWith('extra:'))
                    const expanded = open === row.row_index
                    return (
                      <Fragment key={row.row_index}>
                        <tr>
                          <td>
                            {row.status === 'update' || row.status === 'unmatched' ? (
                              <input
                                type="checkbox"
                                checked={selected.has(row.row_index)}
                                onChange={() => toggle(row.row_index)}
                                aria-label={`Select ${row.endpoint}`}
                              />
                            ) : null}
                          </td>
                          <td>
                            <strong>{row.endpoint || '—'}</strong>
                            <div className="latest-muted">{row.model}</div>
                          </td>
                          <td>{row.serial || '—'}</td>
                          <td>
                            {row.asset_id != null ? (
                              <Link to={`/hardware/${row.asset_id}`}>{row.asset_tag || `Asset ${row.asset_id}`}</Link>
                            ) : row.status === 'unmatched' ? 'Will be created' : '—'}
                            <div className="latest-muted">
                              {row.status === 'update' ? `Matched by ${row.match_by}` : row.reason || (row.status === 'unchanged' ? `Matched by ${row.match_by}` : '')}
                            </div>
                          </td>
                          <td>
                            {core.length ? (
                              <div className="latest-pairs">
                                {core.map((change) => (
                                  <div key={change.field} className="latest-pair">
                                    <b>{change.label}</b>
                                    <span>{change.from}</span>
                                    <span className="latest-arrow">→</span>
                                    <span>{change.to}</span>
                                  </div>
                                ))}
                              </div>
                            ) : row.status === 'unchanged' ? 'No difference' : null}
                            {extra.length ? (
                              <button type="button" className="btn btn-link btn-sm latest-expand" onClick={() => setOpen(expanded ? null : row.row_index)}>
                                {expanded ? 'Hide' : 'Show'} {extra.length} additional field{extra.length === 1 ? '' : 's'}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="latest-detail-row">
                            <td colSpan={5}>
                              {extra.length ? (
                                <div>
                                  <h4>Additional Details</h4>
                                  <ul>
                                    {extra.map((change) => (
                                      <li key={change.field}><b>{change.label}</b>: {change.from} → {change.to}</li>
                                    ))}
                                  </ul>
                                </div>
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
          </>
        ) : null}
      </div>
    </AppLayout>
  )
}
