import type { ReactNode } from 'react'
import { formatINR } from '../../../utils/money'

export function dash(v: unknown): string {
  if (v == null || v === '') return '—'
  return String(v)
}

export function nestName(v: unknown): string {
  if (v && typeof v === 'object' && 'name' in v) {
    const n = (v as { name?: unknown }).name
    if (n != null && n !== '') return String(n)
  }
  if (v == null || v === '') return '—'
  return String(v)
}

export function dateVal(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'object' && v) {
    const o = v as { formatted?: unknown; date?: unknown }
    const raw = o.formatted ?? o.date
    if (raw != null && raw !== '') return String(raw).slice(0, 10)
  }
  return String(v).slice(0, 10)
}

export function initials(name: string | null | undefined): string {
  const parts = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?'
}

export function statusTone(assigned: boolean, statusName?: string): 'active' | 'assigned' | 'maintenance' | 'inactive' {
  const s = (statusName || '').toLowerCase()
  if (s.includes('maint')) return 'maintenance'
  if (['inactive', 'deleted', 'archived', 'undeployable'].some((k) => s.includes(k))) return 'inactive'
  if (assigned) return 'assigned'
  return 'active'
}

export function statusClass(tone: ReturnType<typeof statusTone>): string {
  if (tone === 'maintenance') return 'vad-status--maintenance'
  if (tone === 'inactive') return 'vad-status--inactive'
  if (tone === 'assigned') return 'vad-status--assigned'
  return 'vad-status--active'
}

export function warrantyKpi(purchase: unknown, months: unknown): { value: string; hint: string } {
  const m = Number(months)
  const startStr = dateVal(purchase)
  if (!Number.isFinite(m) || m <= 0) return { value: '—', hint: 'Warranty term' }
  if (startStr === '—') return { value: `${m} mo`, hint: 'Warranty term' }
  const start = new Date(startStr)
  if (Number.isNaN(start.getTime())) return { value: `${m} mo`, hint: 'Warranty term' }
  const end = new Date(start)
  end.setMonth(end.getMonth() + m)
  const days = Math.round((end.getTime() - Date.now()) / 86_400_000)
  const until = end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  if (days < 0) return { value: 'Expired', hint: `Ended ${until}` }
  const remMo = Math.max(0, Math.round(days / 30.44))
  return { value: `${remMo} mo`, hint: `Until ${until}` }
}

export function money(v: unknown): string {
  if (v == null || v === '') return '—'
  return formatINR(v)
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="vad-field">
      <dt>{label}</dt>
      <dd>{children ?? '—'}</dd>
    </div>
  )
}
