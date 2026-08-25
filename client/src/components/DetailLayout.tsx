import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export type DetailField = {
  label: string
  value: ReactNode
  full?: boolean
}

export type DetailTab = {
  id: string
  label: string
}

/** Tone for plain-text status chips (nested .label tones use :has() in CSS). */
function statusToneClass(status: ReactNode): string {
  if (typeof status !== 'string' && typeof status !== 'number') return ''
  const s = String(status).trim().toLowerCase()
  if (!s || s === '—' || s === '-') return ' detail-chip--muted'
  if (['inactive', 'deleted', 'archived', 'undeployable', 'unassigned'].some((k) => s.includes(k))) {
    return ' detail-chip--muted'
  }
  if (['pending', 'due'].some((k) => s.includes(k))) return ' detail-chip--warn'
  if (['active', 'activated', 'assigned', 'deployed', 'available', 'in stock', 'ready'].some((k) => s.includes(k))) {
    return ' detail-chip--ok'
  }
  return ''
}

export function DetailLayout({
  title,
  kicker = 'Record',
  status,
  meta,
  actions,
  tabs,
  activeTab,
  onTabChange,
  fields,
  children,
  panelTitle = 'Details',
  backTo,
  backLabel = 'Back',
}: {
  title: ReactNode
  kicker?: ReactNode
  status?: ReactNode
  meta?: { label: string; value: ReactNode }[]
  actions?: ReactNode
  tabs?: DetailTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  fields?: DetailField[]
  children?: ReactNode
  panelTitle?: string
  /** List path for this module — always shown as the first action */
  backTo?: string
  backLabel?: string
}) {
  return (
    <div className="detail-layout">
      <div className="detail-summary">
        <div className="detail-summary-top">
          <div>
            {kicker ? <p className="detail-kicker">{kicker}</p> : null}
            <h2 className="detail-summary-title">{title}</h2>
            {(status || (meta && meta.length > 0)) && (
              <div className="detail-summary-meta">
                {status ? (
                  <span className={`detail-chip${statusToneClass(status)}`}>{status}</span>
                ) : null}
                {meta?.map((m) => (
                  <span key={m.label} className="detail-meta-item"><strong>{m.label}</strong>{m.value}</span>
                ))}
              </div>
            )}
          </div>
          <div className="detail-actions">
            {backTo ? (
              <Link to={backTo} className="btn btn-default btn-sm">
                <i className="fas fa-arrow-left" /> {backLabel}
              </Link>
            ) : null}
            {actions}
          </div>
        </div>
      </div>

      {tabs && tabs.length > 0 ? (
        <div className="detail-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={`detail-tab${activeTab === t.id ? ' is-active' : ''}`}
              aria-selected={activeTab === t.id}
              onClick={() => onTabChange?.(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {fields && fields.length > 0 ? (
        <div className="detail-panel">
          <h3 className="detail-panel-title">{panelTitle}</h3>
          <div className="detail-fields">
            {fields.map((f) => (
              <div key={f.label} className={`detail-field${f.full ? ' is-full' : ''}`}>
                <span className="detail-field-label">{f.label}</span>
                <div className="detail-field-value">{f.value ?? '—'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {children}
    </div>
  )
}

export function DetailPanel({ title, children, tools }: { title?: string; children: ReactNode; tools?: ReactNode }) {
  return (
    <div className="detail-panel">
      {(title || tools) && (
        <div className="detail-panel-head">
          {title ? <h3 className="detail-panel-title" style={{ margin: 0, flex: 1 }}>{title}</h3> : <div style={{ flex: 1 }} />}
          {tools ? <div className="detail-panel-tools">{tools}</div> : null}
        </div>
      )}
      {children}
    </div>
  )
}
