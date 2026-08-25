/* eslint-disable react-refresh/only-export-components -- period picker + range helpers */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarRange, ChevronDown, Check } from 'lucide-react'
import { FloatingPortal, useFloatingStyle } from './formControls'

export type PeriodMode = 'weekly' | 'monthly' | 'fy' | ''

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

export function buildFinancialYearOptions(count = 4) {
  const currentFy = getFyStartYear()
  const options: { key: string; label: string; sub: string; hint?: string; range: PeriodRange }[] = []
  for (let i = 0; i < count; i += 1) {
    const fyStartYear = currentFy - i
    const range = getFinancialYearRange(fyStartYear)
    const label = `FY ${fyStartYear}–${String(fyStartYear + 1).slice(-2)}`
    options.push({
      key: `fy:${fyStartYear}`,
      label,
      sub: `1 Apr ${fyStartYear} → 31 Mar ${fyStartYear + 1}`,
      hint: i === 0 ? 'Current financial year' : undefined,
      range: { from: range.from, to: range.to },
    })
  }
  return options
}

export function getEmptyPeriodState(): PeriodState {
  return { mode: '', range: { from: '', to: '' }, summaryLabel: '' }
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

const MODE_OPTIONS = [
  { key: 'weekly' as const, label: 'Weekly' },
  { key: 'monthly' as const, label: 'Monthly' },
  { key: 'fy' as const, label: 'Financial Year' },
]

type Props = {
  mode?: PeriodMode
  range?: PeriodRange
  summaryLabel?: string
  onChange?: (next: PeriodState) => void
  className?: string
}

/**
 * Adaptive period control — Weekly / Monthly / FY (Apr–Mar).
 * Same UX as ITSM ITApproverPeriodPicker.
 */
export default function AssetPeriodPicker({
  mode = '',
  range = { from: '', to: '' },
  summaryLabel = '',
  onChange,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const [panelMode, setPanelMode] = useState<'weekly' | 'monthly' | 'fy'>(
    mode === 'weekly' || mode === 'monthly' || mode === 'fy' ? mode : 'fy',
  )
  const [monthYear, setMonthYear] = useState(() => new Date().getFullYear())
  const [weekMonthCursor, setWeekMonthCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), monthIndex: now.getMonth() }
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { style: panelStyle } = useFloatingStyle(open, triggerRef, panelRef, {
    minWidth: 360,
    maxWidth: 400,
    matchTriggerWidth: false,
    estimatedHeight: 420,
    align: 'end',
  })

  useEffect(() => {
    if (!open) return undefined
    setPanelMode(mode === 'weekly' || mode === 'monthly' || mode === 'fy' ? mode : 'fy')
    if (mode === 'weekly' && range?.from) {
      const anchor = new Date(`${range.from}T12:00:00`)
      if (!Number.isNaN(anchor.getTime())) {
        setWeekMonthCursor({ year: anchor.getFullYear(), monthIndex: anchor.getMonth() })
      }
    }
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
  }, [open, mode, range?.from])

  const weekOptions = useMemo(
    () => buildWeekNavOptions({ year: weekMonthCursor.year, monthIndex: weekMonthCursor.monthIndex }),
    [weekMonthCursor.year, weekMonthCursor.monthIndex],
  )
  const monthOptions = useMemo(() => buildMonthOptions(monthYear), [monthYear])
  const fyOptions = useMemo(() => buildFinancialYearOptions(4), [])

  const triggerLabel = summaryLabel || 'Select period'
  const hasSelection = Boolean(mode && range.from && range.to)

  const applySelection = (nextMode: PeriodMode, nextRange: PeriodRange, label: string) => {
    onChange?.({ mode: nextMode, range: nextRange, summaryLabel: label })
    setOpen(false)
  }

  const shiftWeekMonth = (delta: number) => {
    setWeekMonthCursor((prev) => {
      const d = new Date(prev.year, prev.monthIndex + delta, 1)
      const now = new Date()
      if (
        d.getFullYear() > now.getFullYear()
        || (d.getFullYear() === now.getFullYear() && d.getMonth() > now.getMonth())
      ) {
        return { year: now.getFullYear(), monthIndex: now.getMonth() }
      }
      return { year: d.getFullYear(), monthIndex: d.getMonth() }
    })
  }

  const canShiftWeekMonthForward =
    weekMonthCursor.year < new Date().getFullYear()
    || (weekMonthCursor.year === new Date().getFullYear() && weekMonthCursor.monthIndex < new Date().getMonth())

  return (
    <div ref={rootRef} className={`asset-period-picker ${className}`.trim()}>
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-label="Period filter"
        data-testid="asset-period-picker"
        onClick={() => setOpen((prev) => !prev)}
        className="asset-period-trigger"
      >
        <span className="asset-period-trigger-icon" aria-hidden>
          <CalendarRange size={14} strokeWidth={2.25} />
        </span>
        <span className="asset-period-trigger-text">
          <span className="asset-period-trigger-kicker">Period</span>
          <span className="asset-period-trigger-label">{triggerLabel}</span>
        </span>
        <ChevronDown
          size={16}
          className={`asset-period-chevron${open ? ' is-open' : ''}`}
          aria-hidden
        />
      </button>

      <FloatingPortal open={open}>
        <div
          ref={panelRef}
          className="asset-period-panel asset-period-panel--portal"
          role="dialog"
          aria-label="Choose period"
          style={panelStyle}
        >
          <div className="asset-period-panel-head">
            <p className="asset-period-panel-kicker">Choose period type</p>
            <div className="asset-period-segments">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`asset-period-seg${panelMode === opt.key ? ' is-active' : ''}`}
                  onClick={() => {
                    setPanelMode(opt.key)
                    if (opt.key === 'weekly') {
                      const now = new Date()
                      setWeekMonthCursor({ year: now.getFullYear(), monthIndex: now.getMonth() })
                      onChange?.(getCurrentWeekPeriodState())
                    }
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="asset-period-panel-body">
            {panelMode === 'weekly' ? (
              <div className="asset-period-stack">
                <div className="asset-period-nav">
                  <p className="asset-period-hint">Weeks in month · Mon → Sun</p>
                  <div className="asset-period-nav-controls">
                    <button type="button" className="asset-period-nav-btn" onClick={() => shiftWeekMonth(-1)}>←</button>
                    <span className="asset-period-nav-label">
                      {formatMonthLabel(weekMonthCursor.year, weekMonthCursor.monthIndex)}
                    </span>
                    <button
                      type="button"
                      className="asset-period-nav-btn"
                      disabled={!canShiftWeekMonthForward}
                      onClick={() => shiftWeekMonth(1)}
                    >
                      →
                    </button>
                  </div>
                </div>
                <p className="asset-period-meta">
                  {weekOptions.length} week{weekOptions.length === 1 ? '' : 's'} available · no future weeks
                </p>
                {weekOptions.map((opt) => {
                  const active = mode === 'weekly' && range.from === opt.range.from && range.to === opt.range.to
                  return (
                    <PeriodOptionRow
                      key={opt.key}
                      active={active}
                      label={opt.label}
                      sub={opt.sub}
                      hint={opt.hint}
                      onClick={() => applySelection('weekly', opt.range, `${opt.label} · ${opt.sub}`)}
                    />
                  )
                })}
                {!weekOptions.length ? (
                  <p className="asset-period-empty">No weeks in this month yet.</p>
                ) : null}
              </div>
            ) : null}

            {panelMode === 'monthly' ? (
              <div className="asset-period-stack">
                <div className="asset-period-nav">
                  <p className="asset-period-hint">Calendar months · January → December</p>
                  <div className="asset-period-nav-controls">
                    <button type="button" className="asset-period-nav-btn" onClick={() => setMonthYear((y) => y - 1)}>←</button>
                    <span className="asset-period-nav-label is-year">{monthYear}</span>
                    <button
                      type="button"
                      className="asset-period-nav-btn"
                      disabled={monthYear >= new Date().getFullYear()}
                      onClick={() => setMonthYear((y) => Math.min(new Date().getFullYear(), y + 1))}
                    >
                      →
                    </button>
                  </div>
                </div>
                <div className="asset-period-month-grid">
                  {monthOptions.map((opt) => {
                    const active = mode === 'monthly' && range.from === opt.range.from
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        className={`asset-period-month-btn${active ? ' is-active' : ''}`}
                        onClick={() => applySelection('monthly', opt.range, opt.label)}
                      >
                        <span className="asset-period-month-name">{opt.label.split(' ')[0]}</span>
                        <span className="asset-period-month-sub">{opt.sub}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {panelMode === 'fy' ? (
              <div className="asset-period-stack">
                <p className="asset-period-hint" style={{ marginBottom: 8 }}>
                  Indian financial year · 1 April → 31 March next year
                </p>
                {fyOptions.map((opt) => {
                  const active = mode === 'fy' && range.from === opt.range.from
                  return (
                    <PeriodOptionRow
                      key={opt.key}
                      active={active}
                      label={opt.label}
                      sub={opt.sub}
                      hint={opt.hint}
                      onClick={() => applySelection('fy', opt.range, `${opt.label} · Apr–Mar`)}
                    />
                  )
                })}
              </div>
            ) : null}
          </div>

          {hasSelection ? (
            <div className="asset-period-panel-foot">
              <button
                type="button"
                className="asset-period-clear"
                onClick={() => {
                  onChange?.(getEmptyPeriodState())
                  setOpen(false)
                }}
              >
                Clear period
              </button>
            </div>
          ) : null}
        </div>
      </FloatingPortal>
    </div>
  )
}

function PeriodOptionRow({
  active,
  label,
  sub,
  hint,
  onClick,
}: {
  active: boolean
  label: string
  sub: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`asset-period-option${active ? ' is-active' : ''}`}
    >
      <span className="asset-period-option-text">
        <span className="asset-period-option-label">{label}</span>
        <span className="asset-period-option-sub">{sub}</span>
        {hint ? <span className="asset-period-option-hint">{hint}</span> : null}
      </span>
      {active ? <Check size={16} className="asset-period-option-check" aria-hidden /> : null}
    </button>
  )
}
