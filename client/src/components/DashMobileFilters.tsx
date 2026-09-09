import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Building2, ListFilter, MapPin, X } from 'lucide-react'
import { AppSelect } from './ui'
import AssetPeriodPicker, { getEmptyPeriodState, type PeriodState } from './AssetPeriodPicker'
import type { SelectOption } from '../api/client'

function filterCount(companyId: string, locationId: string, period: PeriodState) {
  return [companyId, locationId, period.range.from].filter(Boolean).length
}

export function DashFiltersButton({
  count,
  onClick,
}: {
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`dash-filters-btn${count ? ' is-active' : ''}`}
      onClick={onClick}
    >
      <ListFilter size={16} strokeWidth={2.25} aria-hidden />
      Filters{count ? ` (${count})` : ''}
    </button>
  )
}

function SheetField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="dash-filter-sheet-field">
      <span>{label}</span>
      {children}
      {hint ? <p className="dash-filter-sheet-field-note">{hint}</p> : null}
    </div>
  )
}

export function DashFilterSheet({
  open,
  companies,
  locations,
  companyId,
  locationId,
  period,
  onClose,
  onApply,
}: {
  open: boolean
  companies: SelectOption[]
  locations: SelectOption[]
  companyId: string
  locationId: string
  period: PeriodState
  onClose: () => void
  onApply: (next: { companyId: string; locationId: string; period: PeriodState }) => void
}) {
  const [draftCompany, setDraftCompany] = useState(companyId)
  const [draftLocation, setDraftLocation] = useState(locationId)
  const [draftPeriod, setDraftPeriod] = useState(period)

  useEffect(() => {
    if (!open) return
    setDraftCompany(companyId)
    setDraftLocation(locationId)
    setDraftPeriod(period)
  }, [open, companyId, locationId, period])

  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const companyOptions = [
    { value: '', label: 'All companies' },
    ...companies.map((c) => ({ value: String(c.id), label: c.text })),
  ]
  const locationOptions = [
    { value: '', label: 'All locations' },
    ...locations.map((l) => ({ value: String(l.id), label: l.text })),
  ]

  return createPortal(
    <div className="dash-filter-sheet" role="dialog" aria-modal="true" aria-label="Dashboard filters">
      <button type="button" className="dash-filter-sheet-scrim" aria-label="Close filters" onClick={onClose} />
      <div className="dash-filter-sheet-panel">
        <div className="dash-filter-sheet-head">
          <div>
            <p className="dash-filter-sheet-title">Dashboard filters</p>
            <p className="dash-filter-sheet-hint">Tap Apply to update the view</p>
          </div>
          <button type="button" className="dash-filter-sheet-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <div className="dash-filter-sheet-body">
          <SheetField label="Company">
            <AppSelect
              className="filter-app-select"
              value={draftCompany}
              onChange={setDraftCompany}
              searchable
              placeholder="All companies"
              leading={<Building2 size={16} strokeWidth={2} />}
              options={companyOptions}
            />
          </SheetField>
          <SheetField label="Location">
            <AppSelect
              className="filter-app-select"
              value={draftLocation}
              onChange={setDraftLocation}
              searchable
              placeholder="All locations"
              leading={<MapPin size={16} strokeWidth={2} />}
              options={locationOptions}
            />
          </SheetField>
          <SheetField
            label="Period"
            hint="Uses purchase date. If an asset has no purchase date, the date it was added is used."
          >
            <AssetPeriodPicker
              className="filter-period-picker"
              mode={draftPeriod.mode}
              range={draftPeriod.range}
              summaryLabel={draftPeriod.summaryLabel || 'All time'}
              onChange={setDraftPeriod}
            />
          </SheetField>
        </div>

        <div className="dash-filter-sheet-foot">
          <button
            type="button"
            className="btn btn-default dash-filter-sheet-action"
            onClick={() => {
              const empty = getEmptyPeriodState()
              setDraftCompany('')
              setDraftLocation('')
              setDraftPeriod(empty)
              onApply({ companyId: '', locationId: '', period: empty })
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn btn-theme dash-filter-sheet-action"
            onClick={() => onApply({ companyId: draftCompany, locationId: draftLocation, period: draftPeriod })}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export { filterCount }
