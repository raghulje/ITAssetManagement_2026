import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  accessoriesApi,
  componentsApi,
  consumablesApi,
  hardwareApi,
  licensesApi,
} from '../api/client'
import { employeesApi } from '../api/employees'
import { softwareLicensesInDomain } from '../lib/domainScope'
import { useAuth } from '../api/AuthContext'

type Hit = {
  id: string
  kind: string
  title: string
  subtitle: string
  href: string
}

function nestName(v: unknown) {
  if (v && typeof v === 'object' && 'name' in v) return String((v as { name?: string }).name || '')
  return v != null && v !== '' ? String(v) : ''
}

export function DashSemanticSearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="dash-semantic-btn" onClick={onClick} aria-label="Search">
      <i className="fas fa-search" aria-hidden />
      <span>Search</span>
    </button>
  )
}

export function DashSemanticSearchModal({
  open,
  onClose,
  companyId,
  locationId,
}: {
  open: boolean
  onClose: () => void
  companyId?: string
  locationId?: string
}) {
  const { activeDomain } = useAuth()
  const showLicenses = softwareLicensesInDomain(activeDomain)
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [hits, setHits] = useState<Hit[]>([])
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setQ('')
      setHits([])
      setSearched(false)
      setLoading(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      setSearched(false)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(async () => {
      const base = {
        search: term,
        limit: 8,
        company_id: companyId || undefined,
        location_id: locationId || undefined,
        domain: activeDomain,
      }
      try {
        const jobs: Promise<Hit[]>[] = [
          hardwareApi.list(base).then((r) => (r.rows || []).map((row) => ({
            id: `hw-${row.id}`,
            kind: 'Asset',
            title: String(row.asset_tag || row.name || `Asset #${row.id}`),
            subtitle: [String(row.name || ''), nestName(row.model), nestName(row.assigned_to)].filter(Boolean).join(' · '),
            href: `/hardware/${row.id}`,
          }))),
          accessoriesApi.list(base).then((r) => (r.rows || []).map((row) => ({
            id: `acc-${row.id}`,
            kind: 'Accessory',
            title: String(row.name || `Accessory #${row.id}`),
            subtitle: [nestName(row.category), nestName(row.company)].filter(Boolean).join(' · '),
            href: `/accessories/${row.id}`,
          }))),
          consumablesApi.list(base).then((r) => (r.rows || []).map((row) => ({
            id: `con-${row.id}`,
            kind: 'Consumable',
            title: String(row.name || `Consumable #${row.id}`),
            subtitle: [nestName(row.category), nestName(row.company)].filter(Boolean).join(' · '),
            href: `/consumables/${row.id}`,
          }))),
          componentsApi.list(base).then((r) => (r.rows || []).map((row) => ({
            id: `cmp-${row.id}`,
            kind: 'Component',
            title: String(row.name || `Component #${row.id}`),
            subtitle: [nestName(row.category), nestName(row.company)].filter(Boolean).join(' · '),
            href: `/components/${row.id}`,
          }))),
          employeesApi.list({ search: term, limit: 8, active: 1 }).then((r) => (r.rows || []).map((row) => ({
            id: `emp-${row.id}`,
            kind: 'Employee',
            title: String(row.name || row.employee_code || `Employee #${row.id}`),
            subtitle: [String(row.employee_code || ''), String(row.department || ''), String(row.email || '')].filter(Boolean).join(' · '),
            href: `/employees/${row.id}`,
          }))),
        ]
        if (showLicenses) {
          jobs.push(
            licensesApi.list({ search: term, limit: 8, company_id: companyId || undefined, domain: activeDomain }).then((r) => (r.rows || []).map((row) => ({
              id: `lic-${row.id}`,
              kind: 'License',
              title: String(row.name || `License #${row.id}`),
              subtitle: [nestName(row.category), nestName(row.company)].filter(Boolean).join(' · '),
              href: `/licenses/${row.id}`,
            }))),
          )
        }
        const groups = await Promise.all(jobs.map((p) => p.catch(() => [] as Hit[])))
        if (cancelled) return
        setHits(groups.flat())
        setSearched(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 320)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q, open, companyId, locationId, activeDomain, showLicenses])

  if (!open) return null

  const grouped = hits.reduce<Record<string, Hit[]>>((acc, h) => {
    ;(acc[h.kind] ||= []).push(h)
    return acc
  }, {})

  return (
    <div className="dash-semantic-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="dash-semantic-scrim" aria-label="Close search" onClick={onClose} />
      <div className="dash-semantic-panel">
        <div className="dash-semantic-head">
          <div>
            <h2 id={titleId} className="dash-semantic-title">System search</h2>
            <p className="dash-semantic-hint">Find assets, licenses, inventory, and people in one place</p>
          </div>
          <button type="button" className="dash-semantic-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times" />
          </button>
        </div>
        <label className="dash-semantic-field">
          <i className="fas fa-search" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tag, serial, name, employee, license…"
            autoComplete="off"
          />
          {loading ? <i className="fas fa-spinner fa-spin dash-semantic-spin" aria-hidden /> : null}
        </label>
        <div className="dash-semantic-body">
          {!searched && !loading ? (
            <p className="dash-semantic-empty">Type at least 2 characters to search across the system.</p>
          ) : null}
          {searched && !loading && hits.length === 0 ? (
            <p className="dash-semantic-empty">No matches for “{q.trim()}”.</p>
          ) : null}
          {Object.entries(grouped).map(([kind, rows]) => (
            <section key={kind} className="dash-semantic-group">
              <h3>{kind}</h3>
              <ul>
                {rows.map((h) => (
                  <li key={h.id}>
                    <Link to={h.href} onClick={onClose}>
                      <strong>{h.title}</strong>
                      {h.subtitle ? <span>{h.subtitle}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
