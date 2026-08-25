import { Link } from 'react-router-dom'

export type InsightCard = {
  label: string
  value: number | string
  hint?: string
  to?: string
  tone?: 'default' | 'teal' | 'amber' | 'rose' | 'slate'
  icon?: string
  color?: string
}

const TONE_STYLE: Record<NonNullable<InsightCard['tone']>, { color: string; icon: string }> = {
  teal: { color: 'bg-teal', icon: 'fas fa-barcode' },
  amber: { color: 'bg-orange', icon: 'fas fa-user-check' },
  rose: { color: 'bg-maroon', icon: 'fas fa-exclamation-triangle' },
  slate: { color: 'bg-navy', icon: 'fas fa-hourglass-half' },
  default: { color: 'bg-olive', icon: 'fas fa-box-open' },
}

const LABEL_STYLE: Record<string, { color: string; icon: string }> = {
  'Total assets': { color: 'bg-teal', icon: 'fas fa-barcode' },
  Assigned: { color: 'bg-orange', icon: 'fas fa-user-check' },
  'In stock': { color: 'bg-olive', icon: 'fas fa-warehouse' },
  Pending: { color: 'bg-navy', icon: 'fas fa-clock' },
  'Audit due': { color: 'bg-maroon', icon: 'fas fa-clipboard-check' },
  'EOL due': { color: 'bg-red', icon: 'fas fa-calendar-times' },
  Products: { color: 'bg-maroon', icon: 'fas fa-save' },
  'Licenses assigned': { color: 'bg-orange', icon: 'fas fa-id-badge' },
  'Licenses available': { color: 'bg-olive', icon: 'fas fa-check-circle' },
  'Seats assigned': { color: 'bg-orange', icon: 'fas fa-id-badge' },
  'Seats available': { color: 'bg-olive', icon: 'fas fa-check-circle' },
  Employees: { color: 'bg-navy', icon: 'fas fa-users' },
  'Active (page)': { color: 'bg-teal', icon: 'fas fa-user-check' },
  Active: { color: 'bg-teal', icon: 'fas fa-user-check' },
  Inactive: { color: 'bg-maroon', icon: 'fas fa-user-slash' },
  'Assets assigned': { color: 'bg-orange', icon: 'fas fa-laptop' },
  'Catalog items': { color: 'bg-orange', icon: 'fas fa-cubes' },
  'Assigned qty': { color: 'bg-maroon', icon: 'fas fa-share' },
  'Available qty': { color: 'bg-olive', icon: 'fas fa-boxes' },
}

export function ModuleInsights({
  title,
  cards,
}: {
  title?: string
  cards: InsightCard[]
}) {
  if (!cards.length) return null

  return (
    <div className="module-insights">
      {title ? <div className="module-insights-title">{title}</div> : null}
      <div className="module-insights-tiles">
        {cards.map((c, i) => {
          const byLabel = LABEL_STYLE[c.label]
          const byTone = TONE_STYLE[c.tone || 'default']
          const color = c.color || byLabel?.color || byTone.color
          const icon = c.icon || byLabel?.icon || byTone.icon
          const footer = c.to ? undefined : (c.hint || 'Overview')
          const box = (
            <div className={`dashboard small-box ${color}`} style={{ animationDelay: `${40 + i * 40}ms` }}>
              <div className="inner">
                <h3>{typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</h3>
                <p>{c.label}</p>
              </div>
              <div className="icon" aria-hidden="true"><i className={icon} /></div>
              <span className="small-box-footer">
                {footer || <>View all <i className="fas fa-arrow-right" /></>}
              </span>
            </div>
          )
          return c.to ? (
            <Link key={c.label} to={c.to} className="module-insight-tile small-box-link">{box}</Link>
          ) : (
            <div key={c.label} className="module-insight-tile small-box-static">{box}</div>
          )
        })}
      </div>
    </div>
  )
}
