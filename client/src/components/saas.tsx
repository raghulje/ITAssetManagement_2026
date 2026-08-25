import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function DomainBadge({
  code,
  size = 'sm',
}: {
  code?: string | null
  size?: 'sm' | 'md'
}) {
  const value = String(code || 'it').toLowerCase() === 'admin' ? 'admin' : 'it'
  const label = value === 'admin' ? 'ADMIN' : 'IT'
  return (
    <span className={`domain-badge domain-badge-${value} domain-badge-${size}`}>
      <span className="domain-badge-dot" aria-hidden />
      {label}
    </span>
  )
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="form-section">
      <div className="form-section-head">
        <h3 className="form-section-title">{title}</h3>
        {description ? <p className="form-section-desc">{description}</p> : null}
      </div>
      <div className="form-grid">{children}</div>
    </section>
  )
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="form-grid">{children}</div>
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="form-actions form-actions-bar">{children}</div>
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: string
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden>
        <i className={icon || 'fas fa-inbox'} />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}

export function StatCard({
  to,
  count,
  label,
  hint,
  icon,
  tone = 'default',
}: {
  to?: string
  count: number | string
  label: string
  hint?: string
  icon?: string
  tone?: 'default' | 'teal' | 'amber' | 'rose' | 'slate'
}) {
  const inner = (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {icon ? (
          <span className="stat-card-icon" aria-hidden>
            <i className={icon} />
          </span>
        ) : null}
      </div>
      <div className="stat-card-value">{typeof count === 'number' ? count.toLocaleString() : count}</div>
      {hint ? <div className="stat-card-hint">{hint}</div> : null}
    </div>
  )
  return to ? (
    <Link to={to} className="stat-card-link">{inner}</Link>
  ) : (
    inner
  )
}

export function ActivityTimeline({
  items,
  empty,
}: {
  items: Array<{
    id: string | number
    date: string
    title: string
    meta?: string
    tone?: 'default' | 'ok' | 'warn' | 'muted'
  }>
  empty?: string
}) {
  if (!items.length) {
    return <p className="text-muted mb-0">{empty || 'No activity yet.'}</p>
  }

  const groups: Array<{ day: string; rows: typeof items }> = []
  for (const item of items) {
    const day = item.date ? String(item.date).slice(0, 10) : 'Unknown'
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(item)
    else groups.push({ day, rows: [item] })
  }

  return (
    <div className="activity-timeline">
      {groups.map((g) => (
        <div key={g.day} className="activity-day">
          <div className="activity-day-label">{formatDayLabel(g.day)}</div>
          <ul className="activity-list">
            {g.rows.map((row) => (
              <li key={row.id} className={`activity-item tone-${row.tone || 'default'}`}>
                <span className="activity-dot" aria-hidden />
                <div className="activity-body">
                  <div className="activity-title">{row.title}</div>
                  <div className="activity-meta">
                    {row.date ? <time>{formatTime(row.date)}</time> : null}
                    {row.meta ? <span>{row.meta}</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function formatDayLabel(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(`${iso}T12:00:00`)
  const today = new Date()
  const yest = new Date()
  yest.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yest)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(11, 16)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function DomainScopeCard({
  code,
  counts,
}: {
  code: 'it' | 'admin'
  counts: Record<string, number>
}) {
  return (
    <div className={`domain-scope-card domain-scope-${code}`}>
      <div className="domain-scope-head">
        <DomainBadge code={code} size="md" />
      </div>
      <dl className="domain-scope-counts">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
