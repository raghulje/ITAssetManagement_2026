/* eslint-disable react-refresh/only-export-components -- period picker + range helpers */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CalendarRange, ChevronDown, ChevronUp, Check } from 'lucide-react'
import { FloatingPortal, useFloatingStyle } from './formControls'

export type PeriodMode = 'weekly' | 'monthly' | 'fy' | 'custom' | ''

export type PeriodRange = { from: string; to: string }

export type PeriodState = {
  mode: PeriodMode
  range: PeriodRange
  summaryLabel: string
}

function padDateInput(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function getMonday(date = new Date()) {
  const d = startOfDay(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMonthLabel(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function getFyStartYear(referenceDate = new Date()) {
  const d = referenceDate instanceof Date ? referenceDate : new Date()
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}

export function getFinancialYearRange(fyStartYear: number, { capToToday = true } = {}) {
  const from = new Date(fyStartYear, 3, 1)
  let to = new Date(fyStartYear + 1, 2, 31)
  if (capToToday) {
    const today = startOfDay(new Date())
    if (to > today) to = today
  }
  return { from: padDateInput(from), to: padDateInput(to), fyStartYear }
}

export function getWeekRange(mondayDate: Date, { capToToday = true } = {}) {
  const from = startOfDay(mondayDate)
  let to = new Date(from)
  to.setDate(to.getDate() + 6)
  if (capToToday) {
    const today = startOfDay(new Date())
    if (to > today) to = today
  }
  return { from: padDateInput(from), to: padDateInput(to), monday: from }
}

export function getMonthRange(year: number, monthIndex: number, { capToToday = true } = {}) {
  const from = new Date(year, monthIndex, 1)
  let to = new Date(year, monthIndex + 1, 0)
  if (capToToday) {
    const today = startOfDay(new Date())
    if (to > today) to = today
  }
  return { from: padDateInput(from), to: padDateInput(to), year, monthIndex }
}

type WeekOption = {
  key: string
  label: string
  sub: string
  hint?: string
  weekNumber: number
  range: PeriodRange
  monday: string
}

export function buildMonthWeekOptions(year: number, monthIndex: number): WeekOption[] {
  const now = new Date()
  const currentMonday = getMonday(now)
  const monthStart = new Date(year, monthIndex, 1)
  const monthEnd = new Date(year, monthIndex + 1, 0)
  let monday = getMonday(monthStart)

  const make = (
    weekMonday: Date,
    opts: { label: string; hint?: string; weekNumber: number; capToToday: boolean },
  ): WeekOption => {
    const range = getWeekRange(weekMonday, { capToToday: opts.capToToday })
    const weekEnd = new Date(weekMonday)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const toLabel =
      opts.capToToday && padDateInput(weekEnd) > padDateInput(startOfDay(now))
        ? 'Today'
        : `Sun ${formatShortDate(weekEnd)}`
    return {
      key: `week:${range.from}`,
      label: opts.label,
      sub: `Mon ${formatShortDate(weekMonday)} → ${toLabel}`,
      hint: opts.hint,
      weekNumber: opts.weekNumber,
      range: { from: range.from, to: range.to },
      monday: padDateInput(weekMonday),
    }
  }

  const options: WeekOption[] = []
  let weekNumber = 0
  for (let i = 0; i < 6; i += 1) {
    const weekEnd = new Date(monday)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const overlapsMonth = weekEnd >= monthStart && monday <= monthEnd
    if (monday > monthEnd) break

    if (overlapsMonth) {
      if (monday.getTime() > currentMonday.getTime()) break
      weekNumber += 1
      const isCurrent = monday.getTime() === currentMonday.getTime()
      const prevMonday = new Date(currentMonday)
      prevMonday.setDate(prevMonday.getDate() - 7)
      const isPrevious = monday.getTime() === prevMonday.getTime()

      let label = `Week ${weekNumber}`
      let hint: string | undefined = formatMonthLabel(year, monthIndex)
      if (isCurrent) {
        label = 'Current week'
        hint = 'This week'
      } else if (isPrevious) {
        label = 'Previous week'
        hint = 'Last week'
      } else if (monday.getTime() < currentMonday.getTime()) {
        const nextMonday = new Date(monday)
        nextMonday.setDate(nextMonday.getDate() + 7)
        if (nextMonday.getTime() === currentMonday.getTime()) {
          hint = 'Next → Current week'
        } else if (nextMonday.getTime() < currentMonday.getTime()) {
          hint = `Next → Week of ${formatShortDate(nextMonday)}`
        }
      }

      options.push(make(monday, { label, hint, weekNumber, capToToday: isCurrent }))
    }

    monday = new Date(monday)
    monday.setDate(monday.getDate() + 7)
  }

  return options.reverse()
}

export function buildWeekNavOptions({ year, monthIndex }: { year?: number; monthIndex?: number } = {}) {
  const now = new Date()
  const y = Number.isFinite(year) ? Number(year) : now.getFullYear()
  const m = Number.isFinite(monthIndex) ? Number(monthIndex) : now.getMonth()
  return buildMonthWeekOptions(y, m)
}

export function getCurrentWeekPeriodState(): PeriodState {
  const now = new Date()
  const options = buildWeekNavOptions({ year: now.getFullYear(), monthIndex: now.getMonth() })
  const current = options.find((opt) => opt.label === 'Current week') || options[options.length - 1]
  if (!current) {
    const monday = getMonday(now)
    const range = getWeekRange(monday, { capToToday: true })
    return {
      mode: 'weekly',
      range: { from: range.from, to: range.to },
      summaryLabel: `Current week · Mon ${formatShortDate(monday)} → Today`,
    }
  }
  return {
    mode: 'weekly',
    range: { from: current.range.from, to: current.range.to },
    summaryLabel: `${current.label} · ${current.sub}`,
  }
}

export function buildMonthOptions(year: number) {
  const now = new Date()
  const options: { key: string; label: string; sub: string; range: PeriodRange }[] = []
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    if (year > now.getFullYear()) continue
    if (year === now.getFullYear() && monthIndex > now.getMonth()) continue
    const range = getMonthRange(year, monthIndex)
    const isCurrent = year === now.getFullYear() && monthIndex === now.getMonth()
    options.push({
      key: `month:${year}-${monthIndex}`,
      label: formatMonthLabel(year, monthIndex),
      sub: isCurrent
        ? `1 ${new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: 'short' })} → Today`
        : 'Full month',
      range: { from: range.from, to: range.to },
    })
  }
  return options
}

type FyPart = 'FULL' | 'H1' | 'H2' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

const FY_PARTS: { part: FyPart; label: string; window: string }[] = [
  { part: 'FULL', label: 'Full year', window: 'Apr–Mar' },
  { part: 'H1', label: 'H1', window: 'Apr–Sep' },
  { part: 'H2', label: 'H2', window: 'Oct–Mar' },
  { part: 'Q1', label: 'Q1', window: 'Apr–Jun' },
  { part: 'Q2', label: 'Q2', window: 'Jul–Sep' },
  { part: 'Q3', label: 'Q3', window: 'Oct–Dec' },
  { part: 'Q4', label: 'Q4', window: 'Jan–Mar' },
]

function fyLabel(fyStartYear: number) {
  return `FY ${fyStartYear}–${String(fyStartYear + 1).slice(-2)}`
}

/** Indian FY slices. A slice that has not started yet is omitted. */
export function getFyPartRange(fyStartYear: number, part: FyPart, { capToToday = true } = {}) {
  const endYear = fyStartYear + 1
  const windows: Record<FyPart, { from: Date; to: Date }> = {
    FULL: { from: new Date(fyStartYear, 3, 1), to: new Date(endYear, 2, 31) },
    H1: { from: new Date(fyStartYear, 3, 1), to: new Date(fyStartYear, 8, 30) },
    H2: { from: new Date(fyStartYear, 9, 1), to: new Date(endYear, 2, 31) },
    Q1: { from: new Date(fyStartYear, 3, 1), to: new Date(fyStartYear, 5, 30) },
    Q2: { from: new Date(fyStartYear, 6, 1), to: new Date(fyStartYear, 8, 30) },
    Q3: { from: new Date(fyStartYear, 9, 1), to: new Date(fyStartYear, 11, 31) },
    Q4: { from: new Date(endYear, 0, 1), to: new Date(endYear, 2, 31) },
  }
  const window = windows[part]
  const today = startOfDay(new Date())
  if (startOfDay(window.from) > today) return null
  let to = window.to
  if (capToToday && to > today) to = today
  if (to < window.from) return null
  return { from: padDateInput(window.from), to: padDateInput(to) }
}

export type FinancialYearOption = {
  key: string
  fyStartYear: number
  part: FyPart
  label: string
  sub: string
  hint?: string
  summary: string
  range: PeriodRange
}

export function buildFinancialYearOptions(count = 6): FinancialYearOption[] {
  const currentFy = getFyStartYear()
  const options: FinancialYearOption[] = []
  for (let i = 0; i < count; i += 1) {
    const fyStartYear = currentFy - i
    const yearName = fyLabel(fyStartYear)
    for (const part of FY_PARTS) {
      const range = getFyPartRange(fyStartYear, part.part)
      if (!range) continue
      const isFull = part.part === 'FULL'
      options.push({
        key: `fy:${fyStartYear}:${part.part}`,
        fyStartYear,
        part: part.part,
        label: isFull ? 'Full year' : part.label,
        sub: isFull
          ? `1 Apr ${fyStartYear} → 31 Mar ${fyStartYear + 1}`
          : `${part.window} · ${yearName}`,
        hint: i === 0 && isFull ? 'Current financial year' : undefined,
        summary: isFull ? `${yearName} · Apr–Mar` : `${yearName} · ${part.label} · ${part.window}`,
        range: { from: range.from, to: range.to },
      })
    }
  }
  return options
}

export function getEmptyPeriodState(): PeriodState {
  return { mode: '', range: { from: '', to: '' }, summaryLabel: '' }
}

type Grain = 'weekly' | 'monthly' | 'year' | 'custom'
type Kind = 'today' | 'mtd' | 'qtd' | 'this_fy'

const KINDS: { id: Kind; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'mtd', label: 'MTD' },
  { id: 'qtd', label: 'QTD' },
  { id: 'this_fy', label: 'This FY' },
]

const GRAINS: { id: Grain; label: string }[] = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'year', label: 'Year' },
  { id: 'custom', label: 'Custom' },
]

type PickerOption = {
  key: string
  label: string
  sub: string
  from: string
  to: string
  current: boolean
}

function formatShort(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function indianQuarterStart(d = new Date()) {
  const day = startOfDay(d)
  const m = day.getMonth()
  if (m >= 3 && m <= 5) return new Date(day.getFullYear(), 3, 1)
  if (m >= 6 && m <= 8) return new Date(day.getFullYear(), 6, 1)
  if (m >= 9 && m <= 11) return new Date(day.getFullYear(), 9, 1)
  return new Date(day.getFullYear(), 0, 1)
}

function rangeForKind(kind: Kind, today = startOfDay(new Date())) {
  const fy = getFyStartYear(today)
  if (kind === 'today') return { from: padDateInput(today), to: padDateInput(today) }
  if (kind === 'mtd') return { from: padDateInput(new Date(today.getFullYear(), today.getMonth(), 1)), to: padDateInput(today) }
  if (kind === 'qtd') return { from: padDateInput(indianQuarterStart(today)), to: padDateInput(today) }
  return { from: padDateInput(new Date(fy, 3, 1)), to: padDateInput(today) }
}

function p2pYearOptions(today = startOfDay(new Date()), count = 8): PickerOption[] {
  const current = getFyStartYear(today)
  return Array.from({ length: count }, (_, i) => {
    const startYear = current - i
    const from = new Date(startYear, 3, 1)
    const end = new Date(startYear + 1, 2, 31)
    const isCurrent = i === 0
    const to = isCurrent && today < end ? today : end
    return {
      key: `fy:${startYear}`,
      label: `FY ${startYear}–${String(startYear + 1).slice(-2)}`,
      sub: isCurrent
        ? `${formatShort(padDateInput(from))} → Today`
        : `${formatShort(padDateInput(from))} → ${formatShort(padDateInput(end))}`,
      from: padDateInput(from),
      to: padDateInput(to),
      current: isCurrent,
    }
  })
}

function p2pMonthOptions(today = startOfDay(new Date()), count = 12): PickerOption[] {
  return Array.from({ length: count }, (_, i) => {
    const from = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0)
    const isCurrent = i === 0
    const to = isCurrent ? today : end
    return {
      key: `month:${padDateInput(from)}`,
      label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      sub: isCurrent
        ? `${formatShort(padDateInput(from))} → Today`
        : `${formatShort(padDateInput(from))} → ${formatShort(padDateInput(end))}`,
      from: padDateInput(from),
      to: padDateInput(to),
      current: isCurrent,
    }
  })
}

function p2pWeekOptions(today = startOfDay(new Date()), count = 12): PickerOption[] {
  const monday = getMonday(today)
  return Array.from({ length: count }, (_, i) => {
    const from = new Date(monday)
    from.setDate(from.getDate() - i * 7)
    const end = new Date(from)
    end.setDate(end.getDate() + 6)
    const isCurrent = i === 0
    const to = isCurrent ? today : end
    return {
      key: `week:${padDateInput(from)}`,
      label: `Week of ${formatShort(padDateInput(from))}`,
      sub: isCurrent
        ? `${formatShort(padDateInput(from))} → Today`
        : `${formatShort(padDateInput(from))} → ${formatShort(padDateInput(end))}`,
      from: padDateInput(from),
      to: padDateInput(to),
      current: isCurrent,
    }
  })
}

function periodButtonLabel(from: string, to: string) {
  if (!from || !to) return ''
  const today = startOfDay(new Date())
  const todayIso = padDateInput(today)
  const years = p2pYearOptions(today)
  const currentFy = years[0]
  if (currentFy && from === currentFy.from && (to === currentFy.to || to === todayIso)) return currentFy.label
  if (from === todayIso && to === todayIso) return 'Today'
  const mtd = rangeForKind('mtd', today)
  if (from === mtd.from && to === mtd.to) return 'MTD'
  const qtd = rangeForKind('qtd', today)
  if (from === qtd.from && to === qtd.to) return 'QTD'
  const match = years.find((y) => y.from === from && (y.to === to || (y.current && to === todayIso)))
  if (match) return match.label
  return `${formatShort(from)} – ${formatShort(to)}`
}

function grainForMode(mode: PeriodMode): Grain {
  if (mode === 'weekly') return 'weekly'
  if (mode === 'monthly') return 'monthly'
  if (mode === 'custom') return 'custom'
  return 'year'
}

export function getDefaultApproverPeriodState(): PeriodState {
  const fyStartYear = getFyStartYear()
  const range = getFinancialYearRange(fyStartYear)
  return {
    mode: 'fy',
    range: { from: range.from, to: range.to },
    summaryLabel: `FY ${fyStartYear}–${String(fyStartYear + 1).slice(-2)} · Apr–Mar`,
  }
}

type Props = {
  mode?: PeriodMode
  range?: PeriodRange
  summaryLabel?: string
  onChange?: (next: PeriodState) => void
  className?: string
}

/**
 * Period control. Closed button and open menu match the P2P dashboard picker.
 * The selected range is what asset lists filter on.
 */
export default function AssetPeriodPicker({
  mode = '',
  range = { from: '', to: '' },
  summaryLabel = '',
  onChange,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const [grain, setGrain] = useState<Grain>(() => grainForMode(mode))
  const [kind, setKind] = useState<Kind>('this_fy')
  const [customFrom, setCustomFrom] = useState(range.from)
  const [customTo, setCustomTo] = useState(range.to)
  const fromId = useId()
  const toId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { style: panelStyle } = useFloatingStyle(open, triggerRef, panelRef, {
    minWidth: 360,
    maxWidth: 360,
    matchTriggerWidth: false,
    estimatedHeight: 460,
    maxHeight: 640,
    align: 'start',
    gap: 8,
  })

  useEffect(() => {
    setCustomFrom(range.from)
    setCustomTo(range.to)
  }, [range.from, range.to])

  useEffect(() => {
    if (!open) return undefined
    setGrain(grainForMode(mode))
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, mode])

  const weeks = useMemo(() => p2pWeekOptions(), [])
  const months = useMemo(() => p2pMonthOptions(), [])
  const years = useMemo(() => p2pYearOptions(), [])
  const list = grain === 'monthly' ? months : grain === 'weekly' ? weeks : grain === 'year' ? years : []

  const activeKind = (['today', 'mtd', 'qtd', 'this_fy'] as Kind[]).find((id) => {
    const next = rangeForKind(id)
    return next.from === range.from && next.to === range.to
  })

  const triggerLabel = summaryLabel || periodButtonLabel(range.from, range.to) || 'Select period'

  const applyRange = (nextMode: PeriodMode, from: string, to: string, close = false) => {
    onChange?.({
      mode: nextMode,
      range: { from, to },
      summaryLabel: periodButtonLabel(from, to),
    })
    if (close) setOpen(false)
  }

  const pickKind = (next: Kind) => {
    setKind(next)
    const picked = rangeForKind(next)
    if (next === 'this_fy') {
      setGrain('year')
      applyRange('fy', picked.from, picked.to)
    } else if (next === 'mtd') {
      setGrain('monthly')
      applyRange('monthly', picked.from, picked.to)
    } else if (next === 'today') {
      setGrain('custom')
      applyRange('custom', picked.from, picked.to, true)
    } else {
      setGrain('custom')
      applyRange('custom', picked.from, picked.to)
    }
  }

  const pickGrain = (next: Grain) => {
    setGrain(next)
    if (next === 'monthly') {
      const item = months[0]
      if (item) applyRange('monthly', item.from, item.to)
      setKind(item?.current ? 'mtd' : 'this_fy')
      return
    }
    if (next === 'weekly') {
      const item = weeks[0]
      if (item) applyRange('weekly', item.from, item.to)
      return
    }
    if (next === 'year') {
      const item = years[0]
      if (item) applyRange('fy', item.from, item.to)
      setKind('this_fy')
    }
  }

  return (
    <div ref={rootRef} className={`asset-period-picker ${className}`.trim()}>
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-label="Period filter"
        title="Filters by purchase date. If an asset has no purchase date, the date it was added is used."
        data-testid="asset-period-picker"
        onClick={() => setOpen((prev) => !prev)}
        className="asset-period-trigger"
      >
        <span className="asset-period-trigger-icon" aria-hidden>
          <CalendarRange size={16} strokeWidth={2.15} />
        </span>
        <span className="asset-period-trigger-text">
          <span className="asset-period-trigger-kicker">Period</span>
          <span className="asset-period-trigger-label">{triggerLabel}</span>
        </span>
        {open ? (
          <ChevronUp size={18} className="asset-period-chevron" aria-hidden />
        ) : (
          <ChevronDown size={18} className="asset-period-chevron" aria-hidden />
        )}
      </button>

      <FloatingPortal open={open}>
        <div
          ref={panelRef}
          className="asset-period-panel asset-period-panel--portal"
          role="dialog"
          aria-label="Choose period"
          style={{ ...panelStyle, zIndex: 9999, maxHeight: 'none' }}
        >
          <p className="asset-period-panel-kicker">Choose period type</p>
          <div className="asset-period-kinds">
            {KINDS.map((item) => {
              const active = (activeKind || kind) === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`asset-period-kind${active ? ' is-active' : ''}`}
                  onClick={() => pickKind(item.id)}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
          <div className="asset-period-grains">
            {GRAINS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`asset-period-grain${grain === item.id ? ' is-active' : ''}`}
                onClick={() => pickGrain(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {grain === 'year' ? (
            <p className="asset-period-year-hint">Indian financial year · 1 April → 31 March next year</p>
          ) : null}

          {grain === 'custom' ? (
            <div className="asset-period-custom">
              <div>
                <label className="asset-period-custom-label" htmlFor={fromId}>From</label>
                <input
                  id={fromId}
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="asset-period-custom-input"
                />
              </div>
              <div>
                <label className="asset-period-custom-label" htmlFor={toId}>To</label>
                <input
                  id={toId}
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="asset-period-custom-input"
                />
              </div>
              <button
                type="button"
                className="asset-period-apply"
                onClick={() => {
                  if (customFrom && customTo) applyRange('custom', customFrom, customTo, true)
                }}
              >
                Apply custom range
              </button>
            </div>
          ) : (
            <div className="asset-period-list">
              {list.map((item) => {
                const selected = range.from === item.from && range.to === item.to
                const badge = item.current
                  ? grain === 'year'
                    ? 'CURRENT FINANCIAL YEAR'
                    : grain === 'monthly'
                      ? 'CURRENT MONTH'
                      : 'CURRENT WEEK'
                  : ''
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`asset-period-option${selected ? ' is-active' : ''}`}
                    onClick={() => {
                      const nextMode: PeriodMode = grain === 'monthly' ? 'monthly' : grain === 'weekly' ? 'weekly' : 'fy'
                      if (grain === 'monthly') setKind(item.current ? 'mtd' : 'this_fy')
                      else if (grain === 'year' && item.current) setKind('this_fy')
                      applyRange(nextMode, item.from, item.to, true)
                    }}
                  >
                    <span className="asset-period-option-top">
                      <span className="asset-period-option-label">{item.label}</span>
                      {selected ? <Check size={16} className="asset-period-option-check" aria-hidden /> : null}
                    </span>
                    <span className="asset-period-option-sub">{item.sub}</span>
                    {badge ? <span className="asset-period-badge">{badge}</span> : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </FloatingPortal>
    </div>
  )
}
