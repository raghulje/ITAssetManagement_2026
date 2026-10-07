import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { InsightGlyph, resolveInsightIconKey } from './insightIcons'

export type InsightCard = {
  label: string
  value: number | string
  hint?: string
  to?: string
  onClick?: () => void
  active?: boolean
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

const THEMES: Record<string, { accent: string; border: string; wash: string }> = {
  'bg-teal': { accent: '#0f766e', border: 'rgba(15, 118, 110, 0.22)', wash: '#ecfdf5' },
  'bg-green': { accent: '#15803d', border: 'rgba(21, 128, 61, 0.22)', wash: '#f0fdf4' },
  'bg-olive': { accent: '#15803d', border: 'rgba(21, 128, 61, 0.22)', wash: '#f0fdf4' },
  'bg-maroon': { accent: '#e11d48', border: 'rgba(225, 29, 72, 0.2)', wash: '#fff1f2' },
  'bg-red': { accent: '#e53935', border: 'rgba(229, 57, 53, 0.2)', wash: '#fef2f2' },
  'bg-orange': { accent: '#fb8c00', border: 'rgba(251, 140, 0, 0.22)', wash: '#fff7ed' },
  'bg-yellow': { accent: '#d97706', border: 'rgba(217, 119, 6, 0.22)', wash: '#fffbeb' },
  'bg-navy': { accent: '#1e88e5', border: 'rgba(30, 136, 229, 0.2)', wash: '#f0f7ff' },
  'bg-purple': { accent: '#7c3aed', border: 'rgba(124, 58, 237, 0.18)', wash: '#faf5ff' },
  'bg-aqua': { accent: '#0284c7', border: 'rgba(2, 132, 199, 0.2)', wash: '#f0f9ff' },
  'bg-blue': { accent: '#1e88e5', border: 'rgba(30, 136, 229, 0.2)', wash: '#f0f7ff' },
}

function themeFromColor(color: string) {
  return THEMES[color] || THEMES['bg-navy']
}

function parseCount(value: number | string) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const n = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function useCountUp(endValue: number | string, duration = 1100) {
  const parsed = parseCount(endValue)
  const [display, setDisplay] = useState(parsed ?? 0)
  const displayRef = useRef(parsed ?? 0)

  useEffect(() => {
    if (parsed == null) return
    const from = displayRef.current
    const to = Math.round(parsed)
    let raf = 0
    const t0 = performance.now()
    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      const rounded = Math.round(from + (to - from) * easeOutCubic(t))
      setDisplay(rounded)
      displayRef.current = rounded
      if (t < 1) raf = requestAnimationFrame(step)
      else {
        displayRef.current = to
        setDisplay(to)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [parsed, duration])

  if (parsed == null) return String(endValue)
  return display.toLocaleString('en-IN')
}

function AnimatedValue({ value }: { value: number | string }) {
  const text = useCountUp(value)
  return <span>{text}</span>
}

export function InsightKpiCard({
  label,
  value,
  hint,
  color,
  icon,
  active,
  delayMs = 0,
}: {
  label: string
  value: number | string
  hint?: string
  color: string
  icon?: string
  active?: boolean
  delayMs?: number
}) {
  const theme = themeFromColor(color)
  const glyph = resolveInsightIconKey(label, icon)
  const style = {
    '--summary-accent': theme.accent,
    '--summary-border': theme.border,
    background: `radial-gradient(ellipse 90% 85% at 0% 0%, ${theme.wash} 0%, transparent 58%), radial-gradient(ellipse 65% 60% at 100% 100%, ${theme.wash} 0%, transparent 54%), #fff`,
    animationDelay: `${delayMs}ms`,
  } as CSSProperties

  return (
    <div className={`insight-kpi-card${active ? ' is-active' : ''}`} style={style}>
      <div className="insight-kpi-head">
        <span className="insight-kpi-icon" aria-hidden="true">
          <span className="insight-icon-glow" />
          <span className="insight-icon-shine" />
          <InsightGlyph name={glyph} />
        </span>
        <span className="insight-kpi-title">
          <p title={label}>{label}</p>
          <span>{hint || (active ? 'Showing this filter' : 'Requires your attention')}</span>
        </span>
        <span className="insight-kpi-total">
          <AnimatedValue value={value} />
          <span>Total</span>
        </span>
      </div>
    </div>
  )
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
          const hint = c.hint || (c.to || c.onClick ? (c.active ? 'Showing this filter' : 'View records') : 'Overview')
          const card = (
            <InsightKpiCard
              label={c.label}
              value={c.value}
              hint={hint}
              color={color}
              icon={icon}
              active={c.active}
              delayMs={40 + i * 50}
            />
          )
          const tileClass = `module-insight-tile${c.active ? ' is-active' : ''}`
          if (c.onClick) {
            return (
              <button key={`${c.label}-${i}`} type="button" className={`${tileClass} insight-kpi-hit`} onClick={c.onClick}>
                {card}
              </button>
            )
          }
          return c.to ? (
            <Link key={`${c.label}-${i}`} to={c.to} className={`${tileClass} insight-kpi-hit`}>{card}</Link>
          ) : (
            <div key={`${c.label}-${i}`} className={tileClass}>{card}</div>
          )
        })}
      </div>
    </div>
  )
}
