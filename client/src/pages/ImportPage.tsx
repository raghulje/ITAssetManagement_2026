import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppLayout from '../layout/AppLayout'
import { AppSelect, Box, FileInput, StackField } from '../components/ui'
import { DomainSelect } from '../components/DomainSelect'
import { api } from '../api/client'
import { getApiBase } from '../api/baseUrl'
import { downloadAuthedCsv } from '../utils/csv'
import { useAuth } from '../api/AuthContext'
import { defaultDomainCode } from '../lib/domainScope'

type Field = { key: string; label: string; required?: boolean }

export function ImportPage() {
  const { domainScope, activeDomain } = useAuth()
  const [searchParams] = useSearchParams()
  const defaultLabels: Record<string, string> = {
    asset: 'Assets', user: 'Users', accessory: 'Accessories', consumable: 'Consumables',
    component: 'Components', license: 'Licenses', location: 'Locations', manufacturer: 'Manufacturers',
    supplier: 'Suppliers', model: 'Models', category: 'Categories',
  }
  const [types, setTypes] = useState<string[]>(Object.keys(defaultLabels))
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>(defaultLabels)
  const [type, setType] = useState(searchParams.get('type') || 'asset')
  const [fields, setFields] = useState<Field[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [importId, setImportId] = useState<number | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [updateExisting, setUpdateExisting] = useState(true)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [domain, setDomain] = useState(activeDomain || defaultDomainCode(domainScope))
  const inventoryTypes = useMemo(() => new Set(['asset', 'license', 'accessory', 'consumable', 'component']), [])

  const loadHistory = () => api<{ rows: Record<string, unknown>[] }>('/imports').then((r) => setHistory(r.rows)).catch(() => undefined)

  useEffect(() => {
    const t = searchParams.get('type')
    if (t) setType(t)
  }, [searchParams])

  useEffect(() => {
    api<{ types: string[]; labels?: Record<string, string> }>('/imports/types').then((r) => {
      setTypes(r.types)
      if (r.labels) setTypeLabels((prev) => ({ ...prev, ...r.labels }))
    }).catch(() => undefined)
    loadHistory()
  }, [])

  useEffect(() => {
    api<{ fields: Field[] }>(`/imports/fields/${type}`).then((r) => {
      setFields(r.fields)
      setMappings({})
      setImportId(null)
      setResult(null)
    }).catch(() => undefined)
  }, [type])

  const upload = async () => {
    if (!file) return setError('Choose a CSV file')
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('import_type', type)
      const t = localStorage.getItem('refex_token')
      const res = await fetch(`${getApiBase()}/imports`, {
        method: 'POST',
        headers: t ? { Authorization: `Bearer ${t}` } : {},
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error((data.messages || []).join(', ') || 'Upload failed')
      const payload = data.payload || data
      setImportId(payload.id)
      setHeaders(payload.header_row || [])
      setMappings(payload.suggested_mappings || {})
      setFields(payload.fields || fields)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const process = async () => {
    if (!importId) return
    setBusy(true)
    setError('')
    try {
      const data = await api<{ payload: Record<string, unknown> }>(`/imports/process/${importId}`, {
        method: 'POST',
        json: {
          'import-type': type,
          mappings,
          'import-update': updateExisting,
          ...(inventoryTypes.has(type) ? { domain } : {}),
        },
      })
      setResult((data as { payload?: Record<string, unknown> }).payload || (data as unknown as Record<string, unknown>))
      loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Process failed')
    } finally {
      setBusy(false)
    }
  }

  const downloadSample = () => {
    setError('')
    void downloadAuthedCsv(`/imports/sample/${type}`, `sample-${type}.csv`).catch((e: Error) => {
      setError(e.message || 'Could not download template')
    })
  }

  const clearUpload = () => {
    setFile(null)
    setImportId(null)
    setHeaders([])
    setMappings({})
    setResult(null)
    setError('')
  }

  const errors = useMemo(() => {
    const e = result?.errors
    return Array.isArray(e) ? e as { row: number; message: string }[] : []
  }, [result])

  return (
    <AppLayout title="Import" backTo="/">
      {error && <div className="callout callout-danger"><p>{error}</p></div>}
      <Box title="1. Upload CSV" type="primary">
        <div className="form-stack">
          <StackField label="Import type">
            <AppSelect
              value={type}
              onChange={setType}
              options={types.map((t) => ({ value: t, label: typeLabels[t] || t }))}
            />
          </StackField>
          {inventoryTypes.has(type) ? (
            <DomainSelect
              value={domain}
              onChange={setDomain}
              allowed={domainScope.codes}
              required={domainScope.all}
              label="Domain"
            />
          ) : null}
          <StackField label="CSV file" hint="Upload a .csv file. Download a sample first if you need the column layout.">
            <FileInput
              accept=".csv,text/csv"
              fileName={file?.name}
              onChange={setFile}
            />
          </StackField>
          <div className="form-actions">
            <button type="button" className="btn btn-theme" disabled={busy || !file} onClick={() => { void upload() }}>
              {busy ? 'Uploading…' : 'Upload'}
            </button>
            {(file || importId) ? (
              <button type="button" className="btn btn-default" disabled={busy} onClick={clearUpload}>
                Remove file
              </button>
            ) : null}
            <button type="button" className="btn btn-default" onClick={downloadSample}>Download Sample</button>
          </div>
        </div>
      </Box>

      {importId && (
        <Box title="2. Map columns" type="default">
          <p className="text-muted">Import #{importId} — map CSV headers to fields</p>
          <div className="form-group">
            <label className="checkbox">
              <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} /> Update existing records
            </label>
          </div>
          <div className="table-responsive" style={{ marginBottom: 16 }}>
            <table className="table table-striped">
              <thead><tr><th>Field</th><th>CSV Column</th></tr></thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key}>
                    <td>{f.label}{f.required ? ' *' : ''}</td>
                    <td>
                      <select
                        className="form-control"
                        value={mappings[f.key] || ''}
                        onChange={(e) => setMappings((m) => ({ ...m, [f.key]: e.target.value }))}
                      >
                        <option value="">— skip —</option>
                        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-theme" disabled={busy} onClick={() => { void process() }}>Process Import</button>
          </div>
        </Box>
      )}

      {result && (
        <Box title="3. Results" type="success">
          <p>Created: <strong>{String(result.created)}</strong> · Updated: <strong>{String(result.updated)}</strong> · Errors: <strong>{String(errors.length)}</strong> · Rows: <strong>{String(result.total_rows)}</strong></p>
          {errors.length > 0 && (
            <table className="table table-striped">
              <thead><tr><th>Row</th><th>Error</th></tr></thead>
              <tbody>
                {errors.slice(0, 50).map((e, i) => <tr key={i}><td>{e.row}</td><td>{e.message}</td></tr>)}
              </tbody>
            </table>
          )}
        </Box>
      )}

      <Box title="Import history">
        <table className="table table-striped">
          <thead><tr><th>ID</th><th>File</th><th>Type</th><th>Status</th><th>Rows</th><th>Errors</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={String(h.id)}>
                <td>{String(h.id)}</td>
                <td>{String(h.name)}</td>
                <td>{typeLabels[String(h.import_type)] || String(h.import_type)}</td>
                <td>{String(h.status)}</td>
                <td>{String(h.row_count ?? '—')}</td>
                <td>{String(h.error_count ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </AppLayout>
  )
}
