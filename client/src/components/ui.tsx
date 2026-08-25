import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { downloadCsv } from '../utils/csv'
import { useToast } from './Toast'

export function Box({
  title,
  children,
  tools,
  type = 'default',
}: {
  title?: ReactNode
  children: ReactNode
  tools?: ReactNode
  type?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
}) {
  return (
    <div className={`box box-${type}`}>
      {(title || tools) && (
        <div className="box-header">
          {title ? <h3 className="box-title">{title}</h3> : <span />}
          {tools ? <div className="box-tools">{tools}</div> : null}
        </div>
      )}
      <div className="box-body">{children}</div>
    </div>
  )
}

/** Return to the previous in-app page, or a fallback when there is no history. */
export function PageBack({
  fallback = '/',
  label = 'Back',
  onClick,
}: {
  fallback?: string
  label?: string
  onClick?: () => void
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="btn btn-default btn-sm page-back-btn"
      onClick={() => {
        if (onClick) {
          onClick()
          return
        }
        const idx = typeof window.history.state?.idx === 'number' ? window.history.state.idx : 0
        if (idx > 0) navigate(-1)
        else navigate(fallback)
      }}
    >
      <i className="fas fa-arrow-left" /> {label}
    </button>
  )
}

export function SmallBox({
  to,
  count,
  label,
  color,
  icon,
  colClass = 'col-lg-2 col-xs-6',
  footer,
}: {
  to?: string
  count: number | string
  label: string
  color: string
  icon: string
  colClass?: string
  footer?: string
}) {
  const box = (
    <div className={`dashboard small-box ${color}`}>
      <div className="inner">
        <h3>{typeof count === 'number' ? count.toLocaleString() : count}</h3>
        <p>{label}</p>
      </div>
      <div className="icon" aria-hidden="true"><i className={icon} /></div>
      <span className="small-box-footer">
        {footer || (to ? <>View all <i className="fas fa-arrow-right" /></> : 'Overview')}
      </span>
    </div>
  )
  return (
    <div className={colClass}>
      {to ? <Link to={to} className="small-box-link">{box}</Link> : <div className="small-box-static">{box}</div>}
    </div>
  )
}

export function StatusBadge({ status, type }: { status: string; type?: string }) {
  const map: Record<string, string> = {
    deployable: 'label-success',
    deployed: 'label-info',
    pending: 'label-warning',
    undeployable: 'label-danger',
    archived: 'label-default',
  }
  const label =
    type === 'deployed' || status === 'Deployed' || status === 'Assigned' ? 'Assigned'
      : status === 'Ready to Deploy' || status === 'Ready to Assign' || status === 'In Stock' ? 'In Stock'
        : status
  return <span className={`label ${map[type || ''] || 'label-primary'}`}>{label}</span>
}

export function DataTable({
  columns,
  rows,
  search,
  onSearch,
  exportName = 'export',
  onRefresh,
  onBulkDelete,
  selectable = true,
  storageKey,
  page,
  pageSize,
  total,
  onPageChange,
}: {
  columns: {
    key: string
    label: string
    render?: (row: Record<string, unknown>) => ReactNode
    exportValue?: (row: Record<string, unknown>) => string
    exportable?: boolean
  }[]
  rows: Record<string, unknown>[]
  search?: string
  onSearch?: (v: string) => void
  /** Filename prefix for CSV (date appended) */
  exportName?: string
  onRefresh?: () => void
  /** Soft-delete each selected id; return after all done */
  onBulkDelete?: (ids: number[]) => Promise<void>
  selectable?: boolean
  /** Persist column visibility */
  storageKey?: string
  /** 0-based page index for server-side pagination */
  page?: number
  pageSize?: number
  total?: number
  onPageChange?: (page: number) => void
}) {
  const toast = useToast()
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => {
    const defaults = columns.map((c) => c.key)
    if (!storageKey) return defaults
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        if (Array.isArray(parsed) && parsed.length) {
          return parsed.filter((k) => defaults.includes(k))
        }
      }
    } catch { /* ignore */ }
    return defaults
  })

  useEffect(() => {
    setSelected(new Set())
  }, [rows])

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(visibleKeys))
  }, [storageKey, visibleKeys])

  const visibleColumns = columns.filter((c) => visibleKeys.includes(c.key))
  const exportColumns = columns.filter((c) => c.exportable !== false && c.key !== 'actions')
  const rowIds = rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0)
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id))
  const someSelected = selected.size > 0

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(rowIds))
  }

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const cellExport = (row: Record<string, unknown>, col: (typeof columns)[0]) => {
    if (col.exportValue) return col.exportValue(row)
    const v = row[col.key]
    if (v && typeof v === 'object' && 'name' in v) return String((v as { name?: string }).name ?? '')
    if (v && typeof v === 'object' && 'date' in v) return String((v as { date?: string }).date ?? '')
    return String(v ?? '')
  }

  const doExport = (onlySelected: boolean) => {
    const source = onlySelected
      ? rows.filter((r) => selected.has(Number(r.id)))
      : rows
    if (!source.length) {
      setMsg('Nothing to export')
      return
    }
    const cols = exportColumns.filter((c) => visibleKeys.includes(c.key) || !onlySelected)
    const useCols = cols.length ? cols : exportColumns
    downloadCsv(
      `${exportName}-${new Date().toISOString().slice(0, 10)}.csv`,
      useCols.map((c) => c.label),
      source.map((r) => useCols.map((c) => cellExport(r, c))),
    )
    setMsg(`Exported ${source.length} row(s)`)
    toast.success(`Exported ${source.length} row(s)`)
  }

  const doBulkDelete = async () => {
    if (!onBulkDelete || !selected.size) return
    if (!confirm(`Delete ${selected.size} selected item(s)? This cannot be undone easily.`)) return
    setBusy(true)
    setMsg('')
    try {
      await onBulkDelete([...selected])
      setSelected(new Set())
      setMsg('Deleted selected items')
      toast.success('Deleted selected items')
      onRefresh?.()
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Bulk delete failed'
      setMsg(err)
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const toggleColumn = (key: string) => {
    setVisibleKeys((keys) => {
      if (keys.includes(key)) {
        if (keys.length <= 1) return keys
        return keys.filter((k) => k !== key)
      }
      return [...keys, key]
    })
  }

  return (
    <>
      <div className="toolbar">
        {onSearch && (
          <div className="search-inline">
            <i className="fas fa-search" aria-hidden />
            <input
              placeholder="Search"
              value={search || ''}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        )}
        <div className="spacer" />
        <div className={`dropdown ${columnsOpen ? 'open' : ''}`}>
          <button type="button" className="btn btn-default btn-sm" onClick={() => setColumnsOpen((o) => !o)}>
            <i className="fas fa-columns" /> Columns
          </button>
          {columnsOpen ? (
            <div className="dropdown-menu columns-menu" style={{ display: 'block', right: 0, left: 'auto', minWidth: 220 }}>
              {columns.map((c) => (
                <label key={c.key} className="columns-menu-item">
                  <input
                    type="checkbox"
                    checked={visibleKeys.includes(c.key)}
                    onChange={() => toggleColumn(c.key)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="btn btn-default btn-sm" onClick={() => doExport(false)} title="Export all rows on this page">
          <i className="fas fa-download" /> Export
        </button>
        {onRefresh ? (
          <button type="button" className="btn btn-default btn-sm" onClick={onRefresh} title="Refresh">
            <i className="fas fa-sync" />
          </button>
        ) : null}
      </div>

      {someSelected ? (
        <div className="bulk-bar">
          <span><strong>{selected.size}</strong> selected</span>
          <button type="button" className="btn btn-default btn-sm" onClick={() => doExport(true)}>
            <i className="fas fa-download" /> Export selected
          </button>
          {onBulkDelete ? (
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => { void doBulkDelete() }}>
              <i className="fas fa-trash" /> {busy ? 'Deleting…' : 'Delete selected'}
            </button>
          ) : null}
          <button type="button" className="btn btn-link btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      {msg ? <p className="help-block" style={{ marginTop: 0 }}>{msg}</p> : null}

      {(() => {
        const actionCol = visibleColumns.find((c) => c.key === 'actions' || c.label === 'Actions')
        const bodyCols = visibleColumns.filter((c) => c !== actionCol)
        const titleCol = bodyCols[0]
        const metaCols = bodyCols.slice(1)

        return (
          <>
            <div className="table-responsive data-table-desktop">
              <table className="table table-striped table-hover">
                <thead>
                  <tr>
                    {selectable ? (
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          aria-label="Select all"
                          disabled={!rowIds.length}
                        />
                      </th>
                    ) : null}
                    {visibleColumns.map((c) => <th key={c.key}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={visibleColumns.length + (selectable ? 1 : 0)} className="text-muted">
                        No matching records found
                      </td>
                    </tr>
                  )}
                  {rows.map((row, i) => {
                    const id = Number(row.id)
                    const canSelect = Number.isFinite(id) && id > 0
                    return (
                      <tr key={String(row.id ?? i)} className={canSelect && selected.has(id) ? 'is-selected' : undefined}>
                        {selectable ? (
                          <td>
                            <input
                              type="checkbox"
                              checked={canSelect && selected.has(id)}
                              disabled={!canSelect}
                              onChange={() => canSelect && toggleOne(id)}
                              aria-label={`Select row ${id}`}
                            />
                          </td>
                        ) : null}
                        {visibleColumns.map((c) => (
                          <td key={c.key}>
                            {c.render ? c.render(row) : String(row[c.key] ?? '')}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="data-table-mobile" aria-label="Records">
              {rows.length === 0 ? (
                <p className="text-muted data-card-empty">No matching records found</p>
              ) : rows.map((row, i) => {
                const id = Number(row.id)
                const canSelect = Number.isFinite(id) && id > 0
                return (
                  <article
                    key={String(row.id ?? i)}
                    className={`data-card${canSelect && selected.has(id) ? ' is-selected' : ''}`}
                  >
                    <div className="data-card-top">
                      {selectable ? (
                        <input
                          type="checkbox"
                          checked={canSelect && selected.has(id)}
                          disabled={!canSelect}
                          onChange={() => canSelect && toggleOne(id)}
                          aria-label={`Select row ${id}`}
                        />
                      ) : null}
                      <div className="data-card-title">
                        {titleCol
                          ? (titleCol.render ? titleCol.render(row) : String(row[titleCol.key] ?? '—'))
                          : `Row ${i + 1}`}
                      </div>
                    </div>
                    {metaCols.length > 0 ? (
                      <dl className="data-card-fields">
                        {metaCols.map((c) => (
                          <div key={c.key} className="data-card-field">
                            <dt>{c.label}</dt>
                            <dd>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {actionCol ? (
                      <div className="data-card-actions">
                        {actionCol.render ? actionCol.render(row) : String(row[actionCol.key] ?? '')}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </>
        )
      })()}
      {page != null && pageSize != null && total != null && onPageChange ? (
        (() => {
          const pageCount = Math.max(1, Math.ceil(total / pageSize))
          const safePage = Math.min(Math.max(0, page), pageCount - 1)
          return (
            <div className="pagination" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 12 }}>
              <button type="button" disabled={safePage <= 0} onClick={() => onPageChange(0)} title="First page">«</button>
              <button type="button" disabled={safePage <= 0} onClick={() => onPageChange(Math.max(0, safePage - 1))}>Prev</button>
              {Array.from({ length: pageCount }, (_, i) => i)
                .filter((i) => i === 0 || i === pageCount - 1 || Math.abs(i - safePage) <= 2)
                .reduce<number[]>((acc, i) => {
                  if (acc.length && i - acc[acc.length - 1] > 1) acc.push(-1)
                  acc.push(i)
                  return acc
                }, [])
                .map((i, idx) => (
                  i < 0
                    ? <span key={`gap-${idx}`} className="text-muted" style={{ padding: '0 4px' }}>…</span>
                    : (
                      <button
                        key={i}
                        type="button"
                        className={i === safePage ? 'active' : undefined}
                        onClick={() => onPageChange(i)}
                      >
                        {i + 1}
                      </button>
                    )
                ))}
              <button type="button" disabled={safePage + 1 >= pageCount} onClick={() => onPageChange(safePage + 1)}>Next</button>
              <button type="button" disabled={safePage + 1 >= pageCount} onClick={() => onPageChange(pageCount - 1)} title="Last page">»</button>
              <span className="text-muted" style={{ padding: '0 8px', alignSelf: 'center' }}>
                {total === 0 ? '0 items' : `${safePage * pageSize + 1}–${Math.min(total, (safePage + 1) * pageSize)} of ${total}`}
              </span>
            </div>
          )
        })()
      ) : (
        <div className="pagination">
          <span className="text-muted" style={{ padding: '6px 10px' }}>{rows.length} row(s) on this page</span>
        </div>
      )}
    </>
  )
}

export function PageForm({
  children,
  onSubmit,
  cancelTo,
  submitLabel = 'Save',
  submitDisabled = false,
}: {
  children: ReactNode
  onSubmit?: () => void
  cancelTo: string
  submitLabel?: string
  submitDisabled?: boolean
}) {
  return (
    <form
      className="form-horizontal page-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!submitDisabled) onSubmit?.()
      }}
    >
      <Box
        title={(
          <span className="page-form-heading">
            <span className="page-form-kicker">Record</span>
            Details
          </span>
        )}
        type="primary"
        tools={
          <>
            <button type="submit" className="btn btn-theme btn-sm" disabled={submitDisabled}>
              <i className="fas fa-check" /> {submitLabel}
            </button>
            <Link to={cancelTo} className="btn btn-default btn-sm">Cancel</Link>
          </>
        }
      >
        <div className="page-form-fields">
          {children}
        </div>
        <div className="box-footer page-form-actions">
          <button type="submit" className="btn btn-theme" disabled={submitDisabled}>
            <i className="fas fa-check" /> {submitLabel}
          </button>
          <Link to={cancelTo} className="btn btn-default">Cancel</Link>
        </div>
      </Box>
    </form>
  )
}

export function Field({
  label, children, required, full,
}: {
  label: string
  children: ReactNode
  required?: boolean
  full?: boolean
}) {
  return (
    <div className={`form-group${full ? ' is-full' : ''}`}>
      <label className={`control-label ${required ? 'required' : ''}`}>{label}</label>
      <div className="form-control-wrap">{children}</div>
    </div>
  )
}

/** Stacked label + control (Import, filters, non-horizontal forms). */
export function StackField({
  label, children, required, hint,
}: {
  label: string
  children: ReactNode
  required?: boolean
  hint?: string
}) {
  return (
    <div className="form-group">
      <label className={required ? 'required' : undefined}>{label}</label>
      {children}
      {hint ? <span className="help-block">{hint}</span> : null}
    </div>
  )
}

type FileInputProps = {
  accept?: string
  disabled?: boolean
  fileName?: string | null
  onChange: (file: File | null) => void
  label?: string
}

export function FileInput({ accept, disabled, fileName, onChange, label = 'Choose file' }: FileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const clear = () => {
    if (inputRef.current) inputRef.current.value = ''
    onChange(null)
  }

  return (
    <div className="file-field">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          onChange(e.target.files?.[0] || null)
        }}
      />
      {fileName ? (
        <div className="file-field-selected">
          <span className="file-field-name" title={fileName}>{fileName}</span>
          <button
            type="button"
            className="btn btn-default btn-xs"
            disabled={disabled}
            onClick={clear}
            aria-label="Remove selected file"
          >
            <i className="fas fa-times" /> Remove
          </button>
        </div>
      ) : null}
    </div>
  )
}

export { AppSelect, DateField, type AppSelectOption } from './formControls'
export { EmployeeSelect } from './EmployeeSelect'
