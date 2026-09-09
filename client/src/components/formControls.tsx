import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

export type AppSelectOption = { value: string; label: string }

export function useFloatingStyle(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  opts?: {
    minWidth?: number
    matchTriggerWidth?: boolean
    estimatedHeight?: number
    maxWidth?: number
    align?: 'start' | 'end'
  },
) {
  const [style, setStyle] = useState<CSSProperties>({})
  const [placement, setPlacement] = useState<'down' | 'up'>('down')
  /** Lock width on open — remeasuring on option-list scroll was shrinking the menu. */
  const lockedWidthRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      lockedWidthRef.current = null
      return
    }

    const measureContentWidth = (menu: HTMLElement) => {
      let max = menu.scrollWidth
      menu.querySelectorAll<HTMLElement>('.app-select-option, .app-select-search').forEach((el) => {
        max = Math.max(max, el.scrollWidth + 28)
      })
      return max
    }

    const update = (remeasureWidth: boolean) => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const pad = 8
      const gap = 6
      const vw = window.innerWidth
      const vh = window.innerHeight
      const estimated = opts?.estimatedHeight ?? menuRef.current?.offsetHeight ?? 280
      const spaceBelow = vh - rect.bottom - gap
      const spaceAbove = rect.top - gap
      const openUp = spaceBelow < estimated && spaceAbove > spaceBelow
      const avail = Math.max(0, openUp ? spaceAbove : spaceBelow)
      const maxH = Math.min(280, Math.max(avail || 160, 96))

      const maxW = Math.min(opts?.maxWidth ?? 420, vw - pad * 2)
      const floor = opts?.minWidth ?? (opts?.matchTriggerWidth === false ? 280 : 160)

      let width: number
      if (!remeasureWidth && lockedWidthRef.current != null) {
        width = lockedWidthRef.current
      } else {
        width = opts?.matchTriggerWidth === false
          ? Math.max(floor, rect.width)
          : Math.max(rect.width, floor)
        if (menuRef.current) {
          const contentW = measureContentWidth(menuRef.current)
          if (contentW > width) width = Math.min(Math.max(width, contentW), maxW)
        }
        width = Math.min(Math.max(width, floor), maxW)
        lockedWidthRef.current = width
      }

      // Keep a stable width even if the viewport is tight
      width = Math.min(Math.max(width, floor), maxW)

      let left = opts?.align === 'end' ? rect.right - width : rect.left
      if (left + width > vw - pad) {
        left = Math.max(pad, Math.min(rect.right - width, vw - pad - width))
      }
      if (left < pad) left = pad

      setPlacement(openUp ? 'up' : 'down')
      setStyle({
        position: 'fixed',
        left,
        width,
        minWidth: width,
        maxWidth: width,
        maxHeight: maxH,
        zIndex: 5800,
        ...(openUp
          ? { bottom: vh - rect.top + gap, top: 'auto' }
          : { top: rect.bottom + gap, bottom: 'auto' }),
      })
    }

    update(true)
    const t = window.setTimeout(() => update(true), 0)
    const t2 = window.setTimeout(() => update(true), 50)

    const onScroll = (e: Event) => {
      // Scrolling the option list must not remeasure / shrink the menu
      const target = e.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      update(false)
    }
    const onResize = () => {
      lockedWidthRef.current = null
      update(true)
    }

    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(t2)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, triggerRef, menuRef, opts?.estimatedHeight, opts?.minWidth, opts?.matchTriggerWidth, opts?.maxWidth, opts?.align])

  return { style, placement }
}

export function FloatingPortal({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  if (!open || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

type AppSelectProps = {
  value: string
  onChange: (value: string) => void
  options: AppSelectOption[]
  disabled?: boolean
  required?: boolean
  placeholder?: string
  className?: string
  searchable?: boolean
  searchPlaceholder?: string
  /** Optional icon rendered at the start of the trigger. */
  leading?: ReactNode
  /** When set, typing in the menu search box is forwarded (debounced) for remote lists. */
  onSearch?: (query: string) => void
  loading?: boolean
  id?: string
  name?: string
}

export function AppSelect({
  value,
  onChange,
  options,
  disabled,
  required,
  placeholder = 'Select…',
  className = '',
  searchable,
  searchPlaceholder = 'Search…',
  leading,
  onSearch,
  loading,
  id,
  name,
}: AppSelectProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<AppSelectOption | null>(null)
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const remote = Boolean(onSearch)
  const enableSearch = remote || (searchable ?? options.length > 8)
  const { style: menuStyle } = useFloatingStyle(open, triggerRef, menuRef, {
    minWidth: 220,
    maxWidth: 480,
    matchTriggerWidth: true,
    estimatedHeight: 260,
  })

  const selectedFromOptions = options.find((o) => o.value === value)
  const selected = selectedFromOptions
    || (value && selectedRef.current?.value === value ? selectedRef.current : null)

  useEffect(() => {
    if (!value) {
      selectedRef.current = null
      return
    }
    if (selectedFromOptions?.value === value) selectedRef.current = selectedFromOptions
  }, [value, selectedFromOptions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = options
    if (!remote && q) {
      list = options.filter((o) => o.label.toLowerCase().includes(q))
    }
    if (selected?.value && !list.some((o) => o.value === selected.value)) {
      const matchesQuery = !q || selected.label.toLowerCase().includes(q)
      if (!remote || matchesQuery) list = [selected, ...list]
    }
    return list
  }, [options, query, remote, selected])

  useEffect(() => {
    if (!onSearchRef.current || !open) return
    const delay = query.trim() ? 220 : 0
    const t = window.setTimeout(() => onSearchRef.current?.(query.trim()), delay)
    return () => window.clearTimeout(t)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
      setQuery('')
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (open && enableSearch) {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open, enableSearch])

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  const pick = (v: string) => {
    const opt = filtered.find((o) => o.value === v) || options.find((o) => o.value === v)
    if (opt) selectedRef.current = opt
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[highlight]
      if (opt) pick(opt.value)
    }
  }

  return (
    <div
      className={`app-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      {name ? <input type="hidden" name={name} value={value} required={required && !value} /> : null}
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className="app-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (!disabled) setOpen((o) => !o)
        }}
      >
        {leading ? <span className="app-select-leading" aria-hidden>{leading}</span> : null}
        <span className={`app-select-value${!selected || selected.value === '' ? ' is-placeholder' : ''}`}>
          {selected && selected.value !== '' ? selected.label : (selected?.label || placeholder)}
        </span>
        <span className="app-select-chevron" aria-hidden>
          <i className={`fas fa-chevron-${open ? 'up' : 'down'}`} />
        </span>
      </button>

      <FloatingPortal open={open}>
        <div
          className="app-select-menu app-select-menu--portal"
          role="listbox"
          id={listId}
          ref={menuRef}
          style={menuStyle}
        >
          {enableSearch ? (
            <div className="app-select-search">
              <i className="fas fa-search" aria-hidden />
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
          ) : null}
          <ul className="app-select-options">
            {filtered.length === 0 ? (
              <li className="app-select-empty">
                {loading
                  ? 'Searching…'
                  : remote && !query.trim()
                    ? 'Type a name or ID'
                    : 'No matches'}
              </li>
            ) : (
              filtered.map((opt, i) => (
                <li key={`${opt.value}-${opt.label}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    className={`app-select-option${opt.value === value ? ' is-selected' : ''}${i === highlight ? ' is-active' : ''}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(opt.value)}
                  >
                    <span>{opt.label}</span>
                    {opt.value === value ? <i className="fas fa-check" aria-hidden /> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </FloatingPortal>
    </div>
  )
}

/* ─── Date field + calendar ─── */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parseYmd(v: string): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return dt
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDisplay(v: string): string {
  const d = parseYmd(v)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

type DateFieldProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  placeholder?: string
  className?: string
  id?: string
  name?: string
  allowClear?: boolean
}

export function DateField({
  value,
  onChange,
  disabled,
  required,
  placeholder = 'Select date',
  className = '',
  id,
  name,
  allowClear = true,
}: DateFieldProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selected = parseYmd(value)
  const [view, setView] = useState(() => selected || new Date())
  const { style: menuStyle, placement } = useFloatingStyle(open, triggerRef, menuRef, {
    minWidth: 300,
    matchTriggerWidth: false,
    estimatedHeight: 340,
  })

  useEffect(() => {
    if (open) setView(selected || new Date())
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const year = view.getFullYear()
  const month = view.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const today = toYmd(new Date())

  return (
    <div
      className={`date-field ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
      ref={rootRef}
    >
      {name ? <input type="hidden" name={name} value={value} required={required && !value} /> : null}
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className="date-field-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { if (!disabled) setOpen((o) => !o) }}
      >
        <span className="date-field-icon" aria-hidden>
          <i className="fas fa-calendar-alt" />
        </span>
        <span className={`date-field-value${!value ? ' is-placeholder' : ''}`}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        {allowClear && value && !disabled ? (
          <span
            className="date-field-clear"
            role="button"
            tabIndex={-1}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onChange('')
              }
            }}
          >
            <i className="fas fa-times" />
          </span>
        ) : null}
      </button>

      <FloatingPortal open={open}>
        <div
          className={`date-picker date-picker--portal placement-${placement}`}
          role="dialog"
          aria-label="Choose date"
          ref={menuRef}
          style={menuStyle}
        >
          <div className="date-picker-header">
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Previous month"
              onClick={() => setView(new Date(year, month - 1, 1))}
            >
              <i className="fas fa-chevron-left" />
            </button>
            <div className="date-picker-title">
              <span>{MONTHS[month]}</span>
              <span className="date-picker-year">{year}</span>
            </div>
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Next month"
              onClick={() => setView(new Date(year, month + 1, 1))}
            >
              <i className="fas fa-chevron-right" />
            </button>
          </div>

          <div className="date-picker-weekdays">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="date-picker-grid">
            {cells.map((day, i) => {
              if (day == null) return <span key={`e-${i}`} className="date-picker-cell is-empty" />
              const ymd = toYmd(new Date(year, month, day))
              const isSelected = value === ymd
              const isToday = today === ymd
              return (
                <button
                  key={ymd}
                  type="button"
                  className={`date-picker-cell${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                  onClick={() => {
                    onChange(ymd)
                    setOpen(false)
                  }}
                >
                  {day}
                </button>
              )
            })}
          </div>

          <div className="date-picker-footer">
            <button
              type="button"
              className="btn btn-theme btn-sm"
              onClick={() => {
                onChange(today)
                setOpen(false)
              }}
            >
              Today
            </button>
            {allowClear ? (
              <button
                type="button"
                className="btn btn-default btn-sm"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </FloatingPortal>
    </div>
  )
}
