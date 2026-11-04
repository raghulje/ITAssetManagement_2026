import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'framer-motion'
import { MotionMenu } from './motion/menu'

type Props = {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  /** Optional sort control shown beside the filter chevron */
  sortDir?: 'asc' | 'desc' | null
  onSort?: () => void
  allLabel?: string
}

/** Compact table-header filter: looks like other column titles, menu from column values. */
export function ThColumnFilter({
  label,
  value,
  options,
  onChange,
  sortDir = null,
  onSort,
  allLabel = 'All',
}: Props) {
  const menuId = useId()
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 200 })
  const active = Boolean(value)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect()
      const width = Math.min(280, Math.max(180, r.width + 40))
      let left = r.left
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width)
      setPos({ top: r.bottom + 4, left, width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const items = [allLabel, ...options.filter((o) => o && o !== allLabel)]

  return (
    <div className={`th-col-filter${active ? ' is-filtered' : ''}`}>
      <button
        type="button"
        ref={btnRef}
        className="th-col-filter-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        title={active ? `${label}: ${value}` : `Filter ${label}`}
      >
        <span className="th-col-filter-label">
          {label}
          {sortDir === 'asc' ? ' ↑' : sortDir === 'desc' ? ' ↓' : ''}
        </span>
        <i className={`fas fa-caret-${open ? 'up' : 'down'}`} aria-hidden />
      </button>
      {onSort ? (
        <button type="button" className="th-col-filter-sort" onClick={onSort} title={`Sort ${label}`} aria-label={`Sort ${label}`}>
          <i className="fas fa-sort" aria-hidden />
        </button>
      ) : null}

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? (
            <MotionMenu
              key="column-filter"
              ref={menuRef}
              id={menuId}
              origin="top"
              className="th-col-filter-menu th-col-filter-menu--motion"
              role="listbox"
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 5700 }}
            >
              {items.map((opt) => {
                const val = opt === allLabel ? '' : opt
                const selected = value === val
                return (
                  <button
                    key={opt}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`th-col-filter-option${selected ? ' is-selected' : ''}`}
                    onClick={() => {
                      onChange(val)
                      setOpen(false)
                    }}
                  >
                    <span>{opt}</span>
                    {selected ? <i className="fas fa-check" aria-hidden /> : null}
                  </button>
                )
              })}
            </MotionMenu>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  )
}
