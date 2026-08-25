import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppLayout from '../../layout/AppLayout'
import { AppSelect, Box, Field } from '../../components/ui'
import { labelCodesApi, type BlankLabel } from '../../api/client'
import { assetImageSrc } from '../../api/baseUrl'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../api/AuthContext'

type Kind = 'qr' | 'barcode' | 'both'

export default function LabelsModule() {
  const toast = useToast()
  const navigate = useNavigate()
  const { can } = useAuth()
  const canCreate = can('assets.create')
  const [kind, setKind] = useState<Kind>('qr')
  const [count, setCount] = useState('10')
  const [askCount, setAskCount] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lookup, setLookup] = useState('')
  const [rows, setRows] = useState<BlankLabel[]>([])
  const [printRows, setPrintRows] = useState<BlankLabel[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    labelCodesApi
      .list({ limit: 80, status: status || undefined })
      .then((r) => {
        if (cancelled) return
        setRows(r.rows || [])
        setTotal(r.total || 0)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => { cancelled = true }
  }, [status])

  const generate = async () => {
    const n = Number(count)
    if (!Number.isFinite(n) || n < 1) {
      setError('Enter how many labels to generate')
      return
    }
    if (n > 200) {
      setError('Maximum 200 labels per batch')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await labelCodesApi.generate({ count: n, kind })
      const created = res.payload?.rows || []
      setPrintRows(created)
      setAskCount(false)
      setStatus('blank')
      toast.success(`Generated ${created.length} blank ${kind === 'both' ? 'QR + barcode' : kind} label(s)`)
      const r = await labelCodesApi.list({ limit: 80, status: status || undefined })
      setRows(r.rows || [])
      setTotal(r.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed')
    } finally {
      setBusy(false)
    }
  }

  const openLookup = () => {
    const v = lookup.trim()
    if (!v) return
    navigate(`/asset/${encodeURIComponent(v)}`)
  }

  const sheet = printRows.length ? printRows : rows.filter((r) => r.status === 'blank').slice(0, 80)

  return (
    <AppLayout title="QR / Barcode" subtitle="Print blank labels, stick them on assets, then register on first scan" backTo="/">
      {error ? <div className="callout callout-danger"><p>{error}</p></div> : null}

      <div className="row">
        <div className="col-md-5">
          <Box title="Generate blank labels" type="primary">
            <p className="help-block">
              Labels have no asset data yet. Print them, stick on hardware, then scan once to register.
            </p>
            <Field label="Type">
              <div className="choice-row">
                {([
                  ['qr', 'QR code'],
                  ['barcode', 'Barcode'],
                  ['both', 'QR + Barcode'],
                ] as const).map(([k, label]) => (
                  <label key={k} className="radio">
                    <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} /> {label}
                  </label>
                ))}
              </div>
            </Field>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-theme"
                disabled={busy || !canCreate}
                onClick={() => { setError(''); setAskCount(true) }}
              >
                Generate
              </button>
              <button type="button" className="btn btn-default" disabled={!sheet.length} onClick={() => window.print()}>
                Print sheet
              </button>
            </div>
            {askCount ? (
              <div className="label-generate-dialog">
                <p>How many blank labels?</p>
                <input
                  className="form-control"
                  type="number"
                  min={1}
                  max={200}
                  autoFocus
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void generate() }}
                />
                <p className="help-block" style={{ marginTop: 8 }}>
                  Codes will be empty until the first scan. Maximum 200 per batch.
                </p>
                <div className="form-actions" style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-theme" disabled={busy} onClick={() => { void generate() }}>
                    {busy ? 'Generating…' : 'Generate'}
                  </button>
                  <button type="button" className="btn btn-default" disabled={busy} onClick={() => setAskCount(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {!canCreate ? <p className="help-block">You need asset create permission to generate labels.</p> : null}
          </Box>

          <Box title="Look up / scan">
            <p className="help-block">Type a code from a sticker (or paste the QR token). First scan registers; later scans only show details.</p>
            <div className="label-lookup-row">
              <input
                className="form-control"
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                placeholder="AM-000001 or scan…"
                onKeyDown={(e) => { if (e.key === 'Enter') openLookup() }}
              />
              <button type="button" className="btn btn-theme" onClick={openLookup}>Open</button>
            </div>
          </Box>
        </div>

        <div className="col-md-7">
          <Box
            title="Label list"
            type="primary"
            tools={(
              <AppSelect
                value={status}
                onChange={setStatus}
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'blank', label: 'Blank (not registered)' },
                  { value: 'registered', label: 'Registered' },
                ]}
              />
            )}
          >
            <p className="text-muted" style={{ marginTop: 0 }}>{total} label(s)</p>
            <div className="table-responsive data-table-desktop">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.qr_image_url ? (
                          <img className="label-thumb" src={assetImageSrc(r.qr_image_url) || r.qr_image_url} alt="" />
                        ) : r.barcode_image_url ? (
                          <img className="label-thumb" src={assetImageSrc(r.barcode_image_url) || r.barcode_image_url} alt="" />
                        ) : null}
                        <Link to={`/asset/${r.token}`}>{r.code}</Link>
                      </td>
                      <td>{r.kind}</td>
                      <td>
                        <span className={`space-occupancy-pill ${r.status === 'registered' ? 'is-occupied' : 'is-free'}`}>
                          {r.status === 'registered' ? 'Registered' : 'Blank'}
                        </span>
                      </td>
                      <td>
                        {r.asset_id ? <Link to={`/hardware/${r.asset_id}`}>Asset</Link> : '—'}
                      </td>
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr><td colSpan={4} className="text-muted">No labels yet. Generate a batch to start.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="data-table-mobile" aria-label="Labels">
              {rows.map((r) => (
                <article key={r.id} className="data-card">
                  <div className="data-card-title">
                    {r.qr_image_url ? (
                      <img className="label-thumb" src={assetImageSrc(r.qr_image_url) || r.qr_image_url} alt="" />
                    ) : r.barcode_image_url ? (
                      <img className="label-thumb" src={assetImageSrc(r.barcode_image_url) || r.barcode_image_url} alt="" />
                    ) : null}
                    <Link to={`/asset/${r.token}`}>{r.code}</Link>
                  </div>
                  <dl className="data-card-fields">
                    <div className="data-card-field"><dt>Type</dt><dd>{r.kind}</dd></div>
                    <div className="data-card-field">
                      <dt>Status</dt>
                      <dd>
                        <span className={`space-occupancy-pill ${r.status === 'registered' ? 'is-occupied' : 'is-free'}`}>
                          {r.status === 'registered' ? 'Registered' : 'Blank'}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <div className="data-card-actions">
                    {r.asset_id ? <Link to={`/hardware/${r.asset_id}`} className="btn btn-theme btn-sm">Asset</Link> : <span className="text-muted">Not registered</span>}
                  </div>
                </article>
              ))}
              {!rows.length ? <p className="text-muted data-card-empty">No labels yet. Generate a batch to start.</p> : null}
            </div>
          </Box>
        </div>
      </div>

      <div className="label-print-sheet" aria-hidden={!sheet.length}>
        <h2 className="label-print-sheet-title">Asset Management — blank labels</h2>
        <div className="label-print-grid">
          {sheet.map((r) => (
            <article key={r.id} className="label-print-card">
              {r.qr_image_url && (r.kind === 'qr' || r.kind === 'both') ? (
                <img src={assetImageSrc(r.qr_image_url) || r.qr_image_url} alt={r.code} />
              ) : null}
              {r.barcode_image_url && (r.kind === 'barcode' || r.kind === 'both') ? (
                <img src={assetImageSrc(r.barcode_image_url) || r.barcode_image_url} alt={r.code} className="label-print-barcode" />
              ) : null}
              <strong>{r.code}</strong>
              <span>Scan to register</span>
            </article>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
