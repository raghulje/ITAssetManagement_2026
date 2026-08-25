import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState, type FormEvent } from 'react'
import AppLayout from '../../layout/AppLayout'
import { AppSelect, Box, DataTable, DateField, EmployeeSelect, Field, PageForm } from '../../components/ui'
// import { ModuleInsights } from '../../components/ModuleInsights' // restore with insight cards when needed
import { DetailLayout, DetailPanel } from '../../components/DetailLayout'
import { MasterSelect, masterPayloadId } from '../../components/MasterSelect'
import { CompanyEntityFields } from '../../components/CompanyEntityFields'
import {
  // dashboardApi, // restore with insight cards when needed
  hardwareApi,
  licensesApi,
  mastersApi,
  usersApi,
  type SelectOption,
} from '../../api/client'
import { formatINR } from '../../utils/money'
import { useToast } from '../../components/Toast'
import { getApiBase } from '../../api/baseUrl'
import { useAuth } from '../../api/AuthContext'
import { DomainSelect } from '../../components/DomainSelect'
import { defaultDomainCode } from '../../lib/domainScope'

/** Mirror server computeSubscriptionEnd for live form preview. */
function computeSubEnd(
  start: string,
  period: string,
  customValue: string,
  customUnit: string,
  cycles = '1',
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || period === 'none') return ''
  let d = new Date(`${start}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  const nCycles = Math.max(1, Math.min(120, Number(cycles) || 1))
  for (let i = 0; i < nCycles; i++) {
    if (period === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1)
    else if (period === 'annual') d.setUTCFullYear(d.getUTCFullYear() + 1)
    else if (period === 'custom') {
      const n = Number(customValue)
      if (!Number.isFinite(n) || n < 1) return ''
      if (customUnit === 'days') d.setUTCDate(d.getUTCDate() + n)
      else d.setUTCMonth(d.getUTCMonth() + n)
    } else return ''
  }
  return d.toISOString().slice(0, 10)
}

function toDatetimeLocal(v: unknown): string {
  if (!v) return ''
  const s = String(v).trim().replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`
  return ''
}

function nestId(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'object' && v && 'id' in v) return String((v as { id: number }).id ?? '')
  return String(v)
}

function nestName(v: unknown): string {
  if (v && typeof v === 'object' && 'name' in v) return String((v as { name?: string }).name || '—')
  return v != null && v !== '' ? String(v) : '—'
}

function dateVal(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'object' && v && 'date' in v) return String((v as { date: string }).date || '')
  return String(v).slice(0, 10)
}

type FormState = {
  name: string
  product_key: string
  seats: string
  manufacturer_id: string
  company_id: string
  legal_entity_id: string
  category_id: string
  requested_by_employee_id: string
  expiration_date: string
  purchase_date: string
  purchase_cost: string
  subscription_period: 'none' | 'monthly' | 'annual' | 'custom'
  subscription_custom_value: string
  subscription_custom_unit: 'days' | 'months'
  subscription_cycles: string
  is_recurring: boolean
  notes: string
  domain: string
}

const emptyForm: FormState = {
  name: '',
  product_key: '',
  seats: '1',
  manufacturer_id: '',
  company_id: '',
  legal_entity_id: '',
  category_id: '',
  requested_by_employee_id: '',
  expiration_date: '',
  purchase_date: '',
  purchase_cost: '',
  subscription_period: 'none',
  subscription_custom_value: '1',
  subscription_custom_unit: 'months',
  subscription_cycles: '1',
  is_recurring: false,
  notes: '',
  domain: 'it',
}

export function LicensesList() {
  const { activeDomain } = useAuth()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState('')
  const [companies, setCompanies] = useState<SelectOption[]>([])
  // const [dash, setDash] = useState<Record<string, number>>({}) // restore with insight cards when needed

  const load = () => {
    setLoading(true)
    licensesApi
      .list({ search: q || undefined, company_id: companyId || undefined, limit: 200 })
      .then((r) => {
        setRows(r.rows || [])
        setTotal(r.total || 0)
      })
      .catch(() => {
        setRows([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    mastersApi.companies().then((c) => setCompanies(c.results || [])).catch(() => undefined)
  }, [])

  // restore with insight cards when needed
  // useEffect(() => {
  //   let cancelled = false
  //   dashboardApi
  //     .counts({ company_id: companyId || undefined, search: q || undefined })
  //     .then((c) => {
  //       if (!cancelled) setDash(c as Record<string, number>)
  //     })
  //     .catch(() => undefined)
  //   return () => { cancelled = true }
  // }, [companyId, q])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [q, companyId, activeDomain])

  return (
    <AppLayout title="Licenses" subtitle={loading ? 'Loading…' : `${total} licenses`}>
      {/* Module insight cards — restore when needed (kept on Dashboard / Assets / People only)
      <ModuleInsights
        title="License insights"
        cards={[
          { label: 'Products', value: dash.licenses ?? total, tone: 'teal' },
          { label: 'Licenses assigned', value: dash.licenses_assigned ?? 0, tone: 'amber' },
          { label: 'Licenses available', value: dash.licenses_available ?? 0, tone: 'default' },
        ]}
      />
      */}
      <Box
        title="Licenses"
        tools={<Link to="/licenses/create" className="btn btn-primary btn-sm"><i className="fas fa-plus icon-white" /> Create New</Link>}
      >
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', maxWidth: 280 }}>
          <AppSelect
            value={companyId}
            onChange={setCompanyId}
            searchable
            options={[
              { value: '', label: 'All companies' },
              ...companies.map((c) => ({ value: String(c.id), label: c.text })),
            ]}
          />
        </div>
        <DataTable
          search={q}
          onSearch={setQ}
          rows={rows}
          exportName="licenses"
          storageKey="licenses_columns"
          onRefresh={load}
          onBulkDelete={async (ids) => {
            for (const id of ids) await licensesApi.remove(id)
          }}
          columns={[
            { key: 'name', label: 'Name', render: (r) => <Link to={`/licenses/${r.id}`}>{String(r.name)}</Link> },
            { key: 'product_key', label: 'Product Key' },
            { key: 'seats', label: 'Licenses' },
            {
              key: 'assigned',
              label: 'Assigned',
              render: (r) => String(
                r.assigned
                ?? Math.max(0, Number(r.seats) - Number(r.remaining ?? r.free_seats_count ?? 0)),
              ),
            },
            {
              key: 'remaining',
              label: 'Available',
              render: (r) => (
                <span className={Number(r.remaining) === 0 ? 'text-danger' : ''}>{String(r.remaining ?? r.free_seats_count ?? 0)}</span>
              ),
            },
            { key: 'manufacturer', label: 'Manufacturer', exportValue: (r) => nestName(r.manufacturer), render: (r) => nestName(r.manufacturer) },
            { key: 'company', label: 'Company', exportValue: (r) => nestName(r.company), render: (r) => nestName(r.company) },
            {
              key: 'requested_by',
              label: 'Requested by',
              exportValue: (r) => nestName(r.requested_by_employee),
              render: (r) => nestName(r.requested_by_employee),
            },
            {
              key: 'subscription',
              label: 'Subscription',
              exportValue: (r) => {
                const p = String(r.subscription_period || 'none')
                const c = Number(r.subscription_cycles) || 1
                let s = p
                if (p === 'custom') s = `${r.subscription_custom_value || '?'} ${r.subscription_custom_unit || 'mo'}`
                if (p !== 'none' && c > 1) s += ` × ${c}`
                if (r.is_recurring) s += ' recurring'
                return s
              },
              render: (r) => {
                const p = String(r.subscription_period || 'none')
                if (p === 'none') return <span className="text-muted">—</span>
                const c = Number(r.subscription_cycles) || 1
                let s = p === 'monthly' ? 'Monthly' : p === 'annual' ? 'Annual' : 'Custom'
                if (c > 1) s += ` × ${c}`
                if (r.is_recurring) s += ' · ↻'
                return s
              },
            },
            {
              key: 'invoices',
              label: 'Invoices',
              exportValue: (r) => `${r.invoices_recorded ?? 0}/${r.expected_invoice_count ?? 0}`,
              render: (r) => {
                const exp = Number(r.expected_invoice_count || 0)
                if (!exp) return <span className="text-muted">—</span>
                return `${r.invoices_recorded ?? 0} / ${exp}`
              },
            },
            {
              key: 'expiration_date',
              label: 'Expiration',
              exportValue: (r) => dateVal(r.expiration_date),
              render: (r) => dateVal(r.expiration_date) || '—',
            },
            {
              key: 'purchase_cost',
              label: 'Cost (INR)',
              exportValue: (r) => String(r.purchase_cost ?? ''),
              render: (r) => formatINR(r.purchase_cost),
            },
            {
              key: 'actions',
              label: 'Actions',
              exportable: false,
              render: (r) => (
                <span className="actions">
                  <Link to={`/licenses/${r.id}/checkout`} className="btn btn-sm btn-info" title="Assign"><i className="fas fa-user-plus" /></Link>
                  <Link to={`/licenses/${r.id}/edit`} className="btn btn-sm btn-warning"><i className="fas fa-pencil-alt" /></Link>
                </span>
              ),
            },
          ]}
        />
      </Box>
    </AppLayout>
  )
}

export function LicenseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [lic, setLic] = useState<Record<string, unknown> | null>(null)
  const [seats, setSeats] = useState<Record<string, unknown>[]>([])
  const [invoices, setInvoices] = useState<Record<string, unknown>[]>([])
  const [tab, setTab] = useState('details')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Record<number, {
    invoice_at: string
    amount: string
    notes: string
  }>>({})

  const load = () => {
    if (!id) return
    licensesApi.get(id).then(setLic).catch(() => setLic(null))
    licensesApi.seats(id).then((r) => setSeats(r.rows || [])).catch(() => setSeats([]))
    licensesApi.invoices(id).then((r) => {
      const rows = r.rows || []
      setInvoices(rows)
      const next: typeof draft = {}
      for (const row of rows) {
        next[Number(row.id)] = {
          invoice_at: toDatetimeLocal(row.invoice_at),
          amount: row.amount != null ? String(row.amount) : '',
          notes: String(row.notes || ''),
        }
      }
      setDraft(next)
    }).catch(() => setInvoices([]))
  }

  useEffect(load, [id])

  const remove = async () => {
    if (!id || !confirm('Delete this license?')) return
    setBusy(true)
    try {
      await licensesApi.remove(id)
      toast.success('License deleted')
      navigate('/licenses')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const unassign = async (seatId: number) => {
    if (!id) return
    setBusy(true)
    setMsg('')
    try {
      await licensesApi.checkin(id, { seat_id: seatId })
      setMsg('License unassigned')
      toast.success('License unassigned')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Unassign failed')
    } finally {
      setBusy(false)
    }
  }

  const saveInvoice = async (invoiceId: number) => {
    const d = draft[invoiceId] || { invoice_at: '', amount: '', notes: '' }
    setBusy(true)
    setMsg('')
    try {
      await licensesApi.updateInvoice(invoiceId, {
        invoice_at: d.invoice_at ? d.invoice_at.replace('T', ' ') + ':00' : null,
        amount: d.amount !== '' ? Number(d.amount) : null,
        notes: d.notes || null,
      })
      toast.success('Invoice saved')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save invoice failed')
    } finally {
      setBusy(false)
    }
  }

  const addInvoicePeriod = async () => {
    if (!id) return
    setBusy(true)
    try {
      await licensesApi.addInvoicePeriod(id)
      toast.success('Invoice period added')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add period')
    } finally {
      setBusy(false)
    }
  }

  const removeInvoice = async (invoiceId: number) => {
    if (!confirm('Remove this invoice period?')) return
    setBusy(true)
    try {
      await licensesApi.removeInvoice(invoiceId)
      toast.success('Invoice period removed')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const uploadInvoice = async (invoiceId: number, file: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      await licensesApi.uploadInvoiceFile(invoiceId, file)
      toast.success('Invoice file uploaded')
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  /** File download requires Bearer auth — plain <a href> opens without token. */
  const previewInvoiceFile = async (fileId: number, fileName?: string) => {
    setBusy(true)
    setMsg('')
    try {
      const t = localStorage.getItem('refex_token')
      const res = await fetch(`${getApiBase()}/files/${fileId}/download`, {
        headers: t ? { Authorization: `Bearer ${t}` } : {},
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data.messages || []).join(', ') || 'Could not open file')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (!win) {
        // Popup blocked — fall back to download
        const a = document.createElement('a')
        a.href = url
        a.download = fileName || 'invoice'
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 120_000)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Preview failed')
      toast.error(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  if (!lic) {
    return (
      <AppLayout title="License">
        <Box title="License"><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={String(lic.name)}>
      {msg ? <div className="callout callout-success"><p>{msg}</p></div> : null}
      <DetailLayout
        title={String(lic.name)}
        backTo="/licenses"
        status={`${String(lic.remaining ?? lic.free_seats_count ?? 0)} available`}
        meta={[
          { label: 'Licenses', value: String(lic.seats) },
          { label: 'Manufacturer', value: nestName(lic.manufacturer) },
          { label: 'Expires', value: dateVal(lic.expiration_date) || '—' },
        ]}
        actions={(
          <>
            <Link to={`/licenses/${lic.id}/checkout`} className="btn btn-info btn-sm"><i className="fas fa-user-plus" /> Assign</Link>
            <Link to={`/licenses/${lic.id}/edit`} className="btn btn-warning btn-sm"><i className="fas fa-pencil-alt" /> Edit</Link>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => { void remove() }}>
              <i className="fas fa-trash" /> Delete
            </button>
          </>
        )}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'invoices', label: `Invoices (${lic.invoices_recorded ?? 0}/${lic.expected_invoice_count ?? 0})` },
          { id: 'seats', label: 'Licenses' },
          { id: 'history', label: 'History' },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        fields={tab === 'details' ? [
          { label: 'Name', value: String(lic.name) },
          { label: 'Product Key', value: String(lic.product_key || '—') },
          { label: 'Licenses', value: String(lic.seats) },
          { label: 'Available', value: String(lic.remaining ?? lic.free_seats_count ?? 0) },
          { label: 'Manufacturer', value: nestName(lic.manufacturer) },
          { label: 'Company', value: nestName(lic.company) },
          { label: 'Requested by', value: nestName(lic.requested_by_employee) },
          {
            label: 'Subscription',
            value: (() => {
              const p = String(lic.subscription_period || 'none')
              const c = Number(lic.subscription_cycles) || 1
              let s = 'One-time / none'
              if (p === 'monthly') s = c > 1 ? `Monthly × ${c}` : 'Monthly'
              else if (p === 'annual') s = c > 1 ? `Annual × ${c}` : 'Annual'
              else if (p === 'custom') {
                s = `Custom (${lic.subscription_custom_value || '?'} ${lic.subscription_custom_unit || 'months'})`
                if (c > 1) s += ` × ${c}`
              }
              if (lic.is_recurring) s += ' · recurring'
              return s
            })(),
          },
          {
            label: 'Invoices',
            value: Number(lic.expected_invoice_count || 0)
              ? `${lic.invoices_recorded ?? 0} / ${lic.expected_invoice_count} recorded`
              : '—',
          },
          { label: 'Subscription ends', value: dateVal(lic.expiration_date) || '—' },
          { label: 'Purchase Cost', value: formatINR(lic.purchase_cost) },
          { label: 'Notes', value: String(lic.notes || '—'), full: true },
        ] : undefined}
      >
        {tab === 'invoices' && (
          <DetailPanel
            title="Subscription invoices"
            tools={(
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => { void addInvoicePeriod() }}>
                <i className="fas fa-plus" /> Add invoice period
              </button>
            )}
          >
            <p className="help-block" style={{ marginTop: 0, marginBottom: 16 }}>
              Periods are generated from billing frequency × cycles (e.g. Monthly × 12 → 12 invoices).
              Save a date/time stamp, amount, notes, and optional PDF/image per period.
            </p>
            {invoices.length === 0 ? (
              <p className="text-muted mb-0">
                No invoice periods yet. Set subscription period + cycles on Edit, or add a period here.
              </p>
            ) : (
              <div className="license-invoice-list">
                {invoices.map((inv) => {
                  const invId = Number(inv.id)
                  const d = draft[invId] || { invoice_at: '', amount: '', notes: '' }
                  const recorded = Boolean(inv.invoice_at || inv.amount != null || inv.file_id || (inv.notes && String(inv.notes).trim()))
                  return (
                    <article key={invId} className={`license-invoice-card${recorded ? ' is-recorded' : ''}`}>
                      <header className="license-invoice-card-head">
                        <div className="license-invoice-card-title">
                          <span className="license-invoice-period-badge">#{String(inv.period_index)}</span>
                          <div>
                            <strong>Billing period</strong>
                            <div className="license-invoice-period-range">
                              {String(inv.period_start).slice(0, 10)} → {String(inv.period_end).slice(0, 10)}
                            </div>
                          </div>
                        </div>
                        <div className="license-invoice-card-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-success"
                            disabled={busy}
                            onClick={() => { void saveInvoice(invId) }}
                          >
                            <i className="fas fa-save" /> Save
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            disabled={busy}
                            title="Remove period"
                            onClick={() => { void removeInvoice(invId) }}
                          >
                            <i className="fas fa-trash" />
                          </button>
                        </div>
                      </header>
                      <div className="license-invoice-card-grid">
                        <label className="license-invoice-field">
                          <span>Invoice date / time</span>
                          <input
                            type="datetime-local"
                            className="form-control"
                            value={d.invoice_at}
                            onChange={(e) => setDraft((prev) => ({
                              ...prev,
                              [invId]: { ...d, invoice_at: e.target.value },
                            }))}
                          />
                        </label>
                        <label className="license-invoice-field">
                          <span>Amount (INR)</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="form-control"
                            placeholder="e.g. 2500"
                            value={d.amount}
                            onChange={(e) => setDraft((prev) => ({
                              ...prev,
                              [invId]: { ...d, amount: e.target.value },
                            }))}
                          />
                        </label>
                        <div className="license-invoice-field license-invoice-field-file">
                          <span>Invoice file</span>
                          {inv.file_id ? (
                            <button
                              type="button"
                              className="license-invoice-file-link"
                              disabled={busy}
                              onClick={() => {
                                void previewInvoiceFile(
                                  Number(inv.file_id),
                                  String(inv.file_name || 'invoice'),
                                )
                              }}
                            >
                              <i className="fas fa-eye" /> Preview {String(inv.file_name || 'file')}
                            </button>
                          ) : (
                            <span className="license-invoice-file-empty">No file attached</span>
                          )}
                          <label className="license-invoice-file-btn btn btn-default btn-sm">
                            <i className="fas fa-upload" /> {inv.file_id ? 'Replace file' : 'Choose file'}
                            <input
                              type="file"
                              accept=".pdf,image/*"
                              disabled={busy}
                              onChange={(e) => {
                                const f = e.target.files?.[0] || null
                                void uploadInvoice(invId, f)
                                e.target.value = ''
                              }}
                            />
                          </label>
                        </div>
                        <label className="license-invoice-field license-invoice-field-notes">
                          <span>Notes</span>
                          <input
                            className="form-control"
                            placeholder="Optional note for this period"
                            value={d.notes}
                            onChange={(e) => setDraft((prev) => ({
                              ...prev,
                              [invId]: { ...d, notes: e.target.value },
                            }))}
                          />
                        </label>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </DetailPanel>
        )}
        {tab === 'seats' && (
          <DetailPanel title="Licenses">
            <table className="table table-striped">
              <thead><tr><th>#</th><th>Assigned To</th><th>Asset</th><th>Notes</th><th /></tr></thead>
              <tbody>
                {seats.length === 0 ? (
                  <tr><td colSpan={5} className="text-muted">No licenses recorded</td></tr>
                ) : seats.map((s, i) => {
                  const assigned = s.assigned_to || s.asset_id
                  return (
                    <tr key={String(s.id)}>
                      <td>{i + 1}</td>
                      <td>{s.user_name ? String(s.user_name) : <span className="text-muted">Unassigned</span>}</td>
                      <td>{s.asset_tag ? String(s.asset_tag) : '—'}</td>
                      <td>{String(s.notes || '—')}</td>
                      <td>
                        {assigned
                          ? <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => { void unassign(Number(s.id)) }}>Unassign</button>
                          : <Link to={`/licenses/${lic.id}/checkout`} className="btn btn-sm btn-info">Assign</Link>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DetailPanel>
        )}
        {tab === 'history' && (
          <DetailPanel title="History">
            <p className="text-muted mb-0">License assignment history appears under Reports → Activity.</p>
          </DetailPanel>
        )}
      </DetailLayout>
    </AppLayout>
  )
}

export function LicenseForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { domainScope, activeDomain } = useAuth()
  const isEdit = Boolean(id)
  const [form, setForm] = useState<FormState>({ ...emptyForm, domain: activeDomain || defaultDomainCode(domainScope) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [manufacturers, setManufacturers] = useState<SelectOption[]>([])
  const [categories, setCategories] = useState<SelectOption[]>([])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    Promise.all([mastersApi.companies(), mastersApi.manufacturers()])
      .then(([c, m]) => {
        setCompanies(c.results || [])
        setManufacturers(m.results || [])
        if (!isEdit) {
          setForm((f) => ({
            ...f,
            company_id: f.company_id || (c.results?.[0] ? String(c.results[0].id) : ''),
          }))
        }
      })
      .catch(() => undefined)
  }, [isEdit])

  useEffect(() => {
    mastersApi
      .categories(undefined, 'license', form.domain || defaultDomainCode(domainScope))
      .then((cat) => setCategories(cat.results || []))
      .catch(() => setCategories([]))
  }, [form.domain, domainScope])

  // Auto-fill subscription end from purchase date + period × cycles
  useEffect(() => {
    if (form.subscription_period === 'none') return
    const end = computeSubEnd(
      form.purchase_date,
      form.subscription_period,
      form.subscription_custom_value,
      form.subscription_custom_unit,
      form.subscription_cycles,
    )
    if (end && end !== form.expiration_date) set('expiration_date', end)
  }, [
    form.purchase_date,
    form.subscription_period,
    form.subscription_custom_value,
    form.subscription_custom_unit,
    form.subscription_cycles,
  ])

  useEffect(() => {
    if (!isEdit || !id) return
    licensesApi
      .get(id)
      .then((lic) => {
        const period = String(lic.subscription_period || 'none') as FormState['subscription_period']
        setForm({
          name: String(lic.name || ''),
          product_key: String(lic.product_key || ''),
          seats: String(lic.seats ?? 1),
          manufacturer_id: nestId(lic.manufacturer),
          company_id: nestId(lic.company),
          legal_entity_id: nestId(lic.legal_entity),
          category_id: nestId(lic.category),
          requested_by_employee_id: nestId(lic.requested_by_employee),
          expiration_date: dateVal(lic.expiration_date),
          purchase_date: dateVal(lic.purchase_date),
          purchase_cost: lic.purchase_cost != null ? String(lic.purchase_cost) : '',
          subscription_period: (['none', 'monthly', 'annual', 'custom'].includes(period) ? period : 'none'),
          subscription_custom_value: lic.subscription_custom_value != null
            ? String(lic.subscription_custom_value)
            : '1',
          subscription_custom_unit: String(lic.subscription_custom_unit || 'months') === 'days' ? 'days' : 'months',
          subscription_cycles: String(lic.subscription_cycles ?? 1),
          is_recurring: Boolean(lic.is_recurring),
          notes: String(lic.notes || ''),
          domain: String((lic.domain as { code?: string } | null)?.code || defaultDomainCode(domainScope)),
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  const submit = async () => {
    setBusy(true)
    setError('')
    if (form.subscription_period === 'custom' && !(Number(form.subscription_custom_value) > 0)) {
      setError('Enter a custom duration (days or months)')
      setBusy(false)
      return
    }
    const body = {
      name: form.name.trim(),
      product_key: form.product_key || null,
      seats: Number(form.seats) || 1,
      manufacturer_id: form.manufacturer_id ? Number(form.manufacturer_id) : null,
      company_id: form.company_id ? Number(form.company_id) : null,
      legal_entity_id: form.legal_entity_id ? Number(form.legal_entity_id) : null,
      category_id: form.category_id ? Number(form.category_id) : null,
      requested_by_employee_id: form.requested_by_employee_id
        ? Number(form.requested_by_employee_id)
        : null,
      expiration_date: form.expiration_date || null,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
      subscription_period: form.subscription_period,
      subscription_custom_value: form.subscription_period === 'custom'
        ? Number(form.subscription_custom_value)
        : null,
      subscription_custom_unit: form.subscription_period === 'custom'
        ? form.subscription_custom_unit
        : null,
      subscription_cycles: form.subscription_period !== 'none'
        ? Math.max(1, Number(form.subscription_cycles) || 1)
        : 1,
      is_recurring: form.is_recurring,
      notes: form.notes || null,
      domain: form.domain,
    }
    try {
      if (isEdit && id) {
        await licensesApi.update(id, body)
        toast.success('License updated')
        navigate(`/licenses/${id}`)
      } else {
        const res = await licensesApi.create(body)
        const newId = res.payload?.id
        toast.success('License created')
        navigate(newId != null ? `/licenses/${newId}` : '/licenses')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <AppLayout title="License">
        <Box title="License"><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  return (
    <AppLayout title={isEdit ? 'Update License' : 'Create License'}>
      {error ? <p className="text-danger">{error}</p> : null}
      <PageForm
        cancelTo={isEdit ? `/licenses/${id}` : '/licenses'}
        onSubmit={() => { void submit() }}
        submitLabel={busy ? 'Saving…' : isEdit ? 'Update' : 'Create'}
        submitDisabled={busy}
      >
        <DomainSelect
          value={form.domain}
          allowed={domainScope.codes}
          onChange={(code) => set('domain', code)}
          required
        />
        <Field label="Software Name" required>
          <input className="form-control" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="Product Key">
          <input className="form-control" value={form.product_key} onChange={(e) => set('product_key', e.target.value)} />
        </Field>
        <Field label="Licenses" required>
          <input type="number" min={1} className="form-control" value={form.seats} onChange={(e) => set('seats', e.target.value)} required />
        </Field>

        <MasterSelect
          label="Manufacturer"
          value={form.manufacturer_id}
          options={manufacturers}
          onChange={(v) => set('manufacturer_id', v)}
          onOptionsChange={setManufacturers}
          emptyLabel="— Select manufacturer —"
          create={async (name) => {
            const res = await mastersApi.createManufacturer({ name })
            return masterPayloadId(res, name)
          }}
        />

        <CompanyEntityFields
          required
          companyId={form.company_id}
          legalEntityId={form.legal_entity_id}
          companies={companies}
          onCompaniesChange={setCompanies}
          onCompanyChange={(v) => set('company_id', v)}
          onLegalEntityChange={(v) => set('legal_entity_id', v)}
        />

        <MasterSelect
          label="Category"
          value={form.category_id}
          options={categories}
          onChange={(v) => set('category_id', v)}
          onOptionsChange={setCategories}
          emptyLabel="— Select category —"
          create={async (name) => {
            const res = await mastersApi.createCategory({ name, category_type: 'license' })
            return masterPayloadId(res, name)
          }}
        />

        <Field label="Requested by (employee)">
          <EmployeeSelect
            value={form.requested_by_employee_id}
            onChange={(v) => set('requested_by_employee_id', v)}
            emptyOption="— Select requester —"
          />
          <p className="help-block">HRMS employee who requested this license (e.g. for Cursor Pro)</p>
        </Field>

        <Field label="Purchase / start date">
          <DateField value={form.purchase_date} onChange={(v) => set('purchase_date', v)} />
        </Field>

        <Field label="Subscription period">
          <select
            className="form-control"
            value={form.subscription_period}
            onChange={(e) => {
              const v = e.target.value as FormState['subscription_period']
              set('subscription_period', v)
              if (v !== 'none' && !form.is_recurring) set('is_recurring', true)
            }}
          >
            <option value="none">One-time / no period</option>
            <option value="monthly">Monthly (1 month)</option>
            <option value="annual">Annual (1 year)</option>
            <option value="custom">Custom days or months</option>
          </select>
        </Field>

        {form.subscription_period === 'custom' ? (
          <Field label="Custom duration" required>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={1}
                className="form-control"
                style={{ maxWidth: 120 }}
                value={form.subscription_custom_value}
                onChange={(e) => set('subscription_custom_value', e.target.value)}
              />
              <select
                className="form-control"
                style={{ maxWidth: 160 }}
                value={form.subscription_custom_unit}
                onChange={(e) => set('subscription_custom_unit', e.target.value as 'days' | 'months')}
              >
                <option value="months">Months</option>
                <option value="days">Days</option>
              </select>
            </div>
          </Field>
        ) : null}

        {form.subscription_period !== 'none' ? (
          <Field label="Cycles / term count" required>
            <input
              type="number"
              min={1}
              max={120}
              className="form-control"
              style={{ maxWidth: 160 }}
              value={form.subscription_cycles}
              onChange={(e) => set('subscription_cycles', e.target.value)}
            />
            <p className="help-block">
              {(() => {
                const c = Math.max(1, Number(form.subscription_cycles) || 1)
                const label = form.subscription_period === 'monthly'
                  ? 'Monthly'
                  : form.subscription_period === 'annual'
                    ? 'Annual'
                    : `Custom (${form.subscription_custom_value || '?'} ${form.subscription_custom_unit})`
                const end = computeSubEnd(
                  form.purchase_date,
                  form.subscription_period,
                  form.subscription_custom_value,
                  form.subscription_custom_unit,
                  form.subscription_cycles,
                )
                return `${label} × ${c} → ${c} invoice${c === 1 ? '' : 's'}${end ? ` · ends ${end}` : ''}`
              })()}
            </p>
          </Field>
        ) : null}

        <Field label="Subscription end date">
          <DateField
            value={form.expiration_date}
            onChange={(v) => set('expiration_date', v)}
            placeholder={form.subscription_period !== 'none' ? 'Auto from start + period × cycles' : 'Optional'}
          />
          <p className="help-block">
            {form.subscription_period !== 'none'
              ? 'Filled from start date + period × cycles (you can override).'
              : 'Optional end / expiry date.'}
          </p>
        </Field>

        <Field label="Recurring subscription">
          <label className="checkbox" style={{ fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={form.is_recurring}
              onChange={(e) => set('is_recurring', e.target.checked)}
            />{' '}
            Send renewal alerts to IT Asset Manager (1 week before, then last 3 days)
          </label>
        </Field>

        <Field label="Purchase Cost (INR)">
          <input type="number" className="form-control" value={form.purchase_cost} onChange={(e) => set('purchase_cost', e.target.value)} placeholder="e.g. 125000" />
        </Field>
        <Field label="Notes">
          <textarea className="form-control" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </PageForm>
    </AppLayout>
  )
}

export function LicenseCheckout() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [lic, setLic] = useState<Record<string, unknown> | null>(null)
  const [target, setTarget] = useState<'employee' | 'user' | 'asset'>('employee')
  const [userId, setUserId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [note, setNote] = useState('')
  const [users, setUsers] = useState<SelectOption[]>([])
  const [assets, setAssets] = useState<SelectOption[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    licensesApi.get(id).then(setLic).catch(() => setLic(null))
    usersApi.list({ limit: 200 }).then((r) => {
      setUsers((r.rows || []).map((u) => ({
        id: Number(u.id),
        text: String(u.name || `${u.first_name || ''} ${u.last_name || ''}`.trim()),
      })))
    }).catch(() => undefined)
    hardwareApi.list({ limit: 200 }).then((r) => {
      setAssets((r.rows || []).map((a) => ({
        id: Number(a.id),
        text: `${a.asset_tag || ''} ${a.name || ''}`.trim(),
      })))
    }).catch(() => undefined)
  }, [id])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!id) return
    setBusy(true)
    setError('')
    try {
      await licensesApi.checkout(id, {
        checkout_to_type: target,
        assigned_user: target === 'user' && userId ? Number(userId) : null,
        assigned_employee_id: target === 'employee' && employeeId ? Number(employeeId) : null,
        asset_id: target === 'asset' && assetId ? Number(assetId) : null,
        note: note || null,
      })
      toast.success('License assigned')
      navigate(`/licenses/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assign failed')
    } finally {
      setBusy(false)
    }
  }

  if (!lic) {
    return (
      <AppLayout title="Assign License">
        <Box title="Assign"><p className="text-muted">Loading…</p></Box>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Assign License" subtitle={String(lic.name)}>
      <Box title="Assign" type="primary">
        {error ? <p className="text-danger">{error}</p> : null}
        <form className="form-horizontal" onSubmit={(e) => { void submit(e) }}>
          <Field label="Assign to">
            <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
              {(['employee', 'user', 'asset'] as const).map((t) => (
                <label key={t} className="radio">
                  <input type="radio" checked={target === t} onChange={() => setTarget(t)} />{' '}
                  {t === 'employee' ? 'Employee' : t === 'user' ? 'App User' : 'Asset'}
                </label>
              ))}
            </div>
            {target === 'employee' ? (
              <EmployeeSelect
                value={employeeId}
                onChange={setEmployeeId}
                required
              />
            ) : target === 'user' ? (
              <select className="form-control" value={userId} onChange={(e) => setUserId(e.target.value)} required>
                <option value="">Select user…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.text}</option>)}
              </select>
            ) : (
              <select className="form-control" value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
                <option value="">Select asset…</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.text}</option>)}
              </select>
            )}
          </Field>
          <Field label="Notes"><textarea className="form-control" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-theme" disabled={busy}>{busy ? 'Assigning…' : 'Assign'}</button>
            <Link to={`/licenses/${lic.id}`} className="btn btn-default">Cancel</Link>
          </div>
        </form>
      </Box>
    </AppLayout>
  )
}
