/** India financial year (Apr 1 – Mar 31) helpers for asset list filters. */

export type PeriodType = 'fy' | 'half' | 'quarter' | 'month'

export type DateRange = { from: string; to: string }

/** YYYY-MM-DD in local calendar math (no TZ shift). */
function ymd(y: number, month1: number, day: number): string {
  return `${y}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** FY start calendar year for a given date (Apr–Mar). */
export function fyStartYear(d = new Date()): number {
  const y = d.getFullYear()
  const m = d.getMonth() // 0-based
  return m >= 3 ? y : y - 1
}

export function currentFyLabel(d = new Date()): string {
  const start = fyStartYear(d)
  return `${start}-${String(start + 1).slice(-2)}`
}

export function currentFyRange(d = new Date()): DateRange {
  const start = fyStartYear(d)
  return { from: ymd(start, 4, 1), to: ymd(start + 1, 3, 31) }
}

/**
 * Parse period selectors into an inclusive date range.
 * - fy: `2025-26` or `FY2025-26`
 * - half: `2025-26-H1` | `2025-26-H2`
 * - quarter: `2025-26-Q1` … `Q4`
 * - month: `2025-04` (YYYY-MM)
 */
export function resolvePeriodRange(periodType: string, period: string): DateRange | null {
  const type = periodType.toLowerCase().trim() as PeriodType
  const raw = period.trim()
  if (!type || !raw) return null

  if (type === 'month') {
    const m = raw.match(/^(\d{4})-(\d{2})$/)
    if (!m) return null
    const y = Number(m[1])
    const mo = Number(m[2])
    if (mo < 1 || mo > 12) return null
    const lastDay = new Date(y, mo, 0).getDate()
    return { from: ymd(y, mo, 1), to: ymd(y, mo, lastDay) }
  }

  const fy = raw.match(/^(?:FY)?(\d{4})-(\d{2})(?:-(H[12]|Q[1-4]))?$/i)
  if (!fy) return null
  const startY = Number(fy[1])
  const endYShort = Number(fy[2])
  if (endYShort !== (startY + 1) % 100) return null
  const suffix = (fy[3] || '').toUpperCase()

  if (type === 'fy') {
    if (suffix) return null
    return { from: ymd(startY, 4, 1), to: ymd(startY + 1, 3, 31) }
  }

  if (type === 'half') {
    if (suffix === 'H1') return { from: ymd(startY, 4, 1), to: ymd(startY, 9, 30) }
    if (suffix === 'H2') return { from: ymd(startY, 10, 1), to: ymd(startY + 1, 3, 31) }
    return null
  }

  if (type === 'quarter') {
    if (suffix === 'Q1') return { from: ymd(startY, 4, 1), to: ymd(startY, 6, 30) }
    if (suffix === 'Q2') return { from: ymd(startY, 7, 1), to: ymd(startY, 9, 30) }
    if (suffix === 'Q3') return { from: ymd(startY, 10, 1), to: ymd(startY, 12, 31) }
    if (suffix === 'Q4') return { from: ymd(startY + 1, 1, 1), to: ymd(startY + 1, 3, 31) }
    return null
  }

  return null
}

/** SQL expression: purchase date, else date of created_at. */
export const ASSET_AGE_DATE_SQL = 'COALESCE(a.purchase_date, DATE(a.created_at))'

/** Normalize DB date / datetime / Date to YYYY-MM-DD. */
export function toDateOnly(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return ymd(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }
  const s = String(value).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** New = within current India FY; Existing = older or unknown. */
export function classifyAssetAge(
  purchaseDate: unknown,
  createdAt: unknown,
  now = new Date(),
): 'new' | 'existing' {
  const d = toDateOnly(purchaseDate) || toDateOnly(createdAt)
  if (!d) return 'existing'
  const fy = currentFyRange(now)
  return d >= fy.from && d <= fy.to ? 'new' : 'existing'
}
