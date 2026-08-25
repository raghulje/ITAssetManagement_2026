import type { DashSlice, DashTrendPoint } from '../api/client'

const STATUS_COLORS: Record<string, string> = {
  Assigned: '#F97316',
  'In stock': '#0F9D8A',
  Pending: '#C05600',
  'Not deployable': '#64748B',
  Other: '#94A3B8',
}
const PALETTE = ['#0F9D8A', '#3B82F6', '#F97316', '#7C3AED', '#059669', '#E11D48', '#0F766E', '#64748B']

function colorFor(label: string, i: number) {
  return STATUS_COLORS[label] || PALETTE[i % PALETTE.length]
}

function fmtDay(iso: string) {
  const p = iso.split('-')
  if (p.length !== 3) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(p[2])} ${months[Number(p[1]) - 1] || p[1]}`
}

export function DonutChart({ slices, centerLabel, centerValue }: {
  slices: DashSlice[]
  centerLabel: string
  centerValue: string
}) {
  const total = slices.reduce((n, s) => n + s.value, 0)
  const r = 52
  const c = 2 * Math.PI * r
  let offset = 0
  if (!total) {
    return (
      <div className="dash-donut-wrap">
        <svg viewBox="0 0 160 160" className="dash-donut" aria-hidden>
          <circle cx="80" cy="80" r={r} fill="none" stroke="#E2E8F0" strokeWidth="16" />
        </svg>
        <div className="dash-donut-center">
          <strong>0</strong>
          <span>No assets</span>
        </div>
      </div>
    )
  }
  return (
    <div className="dash-donut-wrap">
      <svg viewBox="0 0 160 160" className="dash-donut" role="img" aria-label="Asset status mix">
        <g transform="translate(80 80) rotate(-90)">
          {slices.map((s, i) => {
            const frac = s.value / total
            const dash = Math.max(frac * c, frac > 0 ? 2 : 0)
            const el = (
              <circle
                key={s.label}
                r={r}
                fill="none"
                stroke={colorFor(s.label, i)}
                strokeWidth="16"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            )
            offset += frac * c
            return el
          })}
        </g>
      </svg>
      <div className="dash-donut-center">
        <strong>{centerValue}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  )
}

export function Legend({ slices }: { slices: DashSlice[] }) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1
  return (
    <ul className="dash-legend">
      {slices.map((s, i) => (
        <li key={s.label}>
          <i style={{ background: colorFor(s.label, i) }} />
          <span>{s.label}</span>
          <strong>{s.value}</strong>
          <em>{Math.round((s.value / total) * 100)}%</em>
        </li>
      ))}
    </ul>
  )
}

export function BarList({ slices, empty }: { slices: DashSlice[]; empty: string }) {
  const max = Math.max(...slices.map((s) => s.value), 1)
  if (!slices.length) return <p className="text-muted mb-0">{empty}</p>
  return (
    <div className="dash-bar-list">
      {slices.map((s, i) => (
        <div key={s.label} className="dash-bar-row">
          <div className="dash-bar-meta">
            <span title={s.label}>{s.label}</span>
            <strong>{s.value}</strong>
          </div>
          <div className="dash-bar-track">
            <div
              className="dash-bar-fill"
              style={{ width: `${Math.max(4, Math.round((s.value / max) * 100))}%`, background: colorFor(s.label, i) }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TrendChart({ points }: { points: DashTrendPoint[] }) {
  const w = 640
  const h = 200
  const pad = { t: 16, r: 12, b: 36, l: 28 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const max = Math.max(...points.flatMap((p) => [p.assigned, p.returned]), 1)
  const group = innerW / Math.max(points.length, 1)
  const barW = Math.min(10, group * 0.32)
  const ticks = [0, Math.round(max / 2), max]
  if (!points.length) return <p className="text-muted mb-0">No assignment activity in the last 14 days.</p>
  return (
    <div className="dash-trend">
      <svg viewBox={`0 0 ${w} ${h}`} className="dash-trend-svg" role="img" aria-label="Assignments over the last 14 days">
        {ticks.map((t) => {
          const y = pad.t + innerH - (t / max) * innerH
          return (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="#E2E8F0" />
              <text x={pad.l - 6} y={y + 4} textAnchor="end" className="dash-chart-axis">{t}</text>
            </g>
          )
        })}
        {points.map((p, i) => {
          const x = pad.l + i * group + group / 2
          const aH = (p.assigned / max) * innerH
          const rH = (p.returned / max) * innerH
          const labelEvery = points.length > 10 ? 2 : 1
          return (
            <g key={p.day}>
              <rect x={x - barW - 1} y={pad.t + innerH - aH} width={barW} height={aH} rx="2" fill="#F97316">
                <title>{`${fmtDay(p.day)}: ${p.assigned} assigned`}</title>
              </rect>
              <rect x={x + 1} y={pad.t + innerH - rH} width={barW} height={rH} rx="2" fill="#0F9D8A">
                <title>{`${fmtDay(p.day)}: ${p.returned} returned`}</title>
              </rect>
              {i % labelEvery === 0 ? (
                <text x={x} y={h - 10} textAnchor="middle" className="dash-chart-axis">{fmtDay(p.day)}</text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <div className="dash-trend-legend">
        <span><i style={{ background: '#F97316' }} /> Assigned</span>
        <span><i style={{ background: '#0F9D8A' }} /> Returned</span>
      </div>
    </div>
  )
}
