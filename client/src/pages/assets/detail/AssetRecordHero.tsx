import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Hash,
  MapPin,
  Monitor,
  Pencil,
  Printer,
  Tag,
  UserMinus,
  UserPlus,
  Wrench,
} from 'lucide-react'
import {
  dash,
  dateVal,
  money,
  nestName,
  statusClass,
  statusTone,
  warrantyKpi,
} from './helpers'

type Props = {
  asset: Record<string, unknown>
  imageUrl: string | null
  backTo: string
  backLabel: string
  returnQs: string
  onPrintLabel: () => void
}

export default function AssetRecordHero({
  asset,
  imageUrl,
  backTo,
  backLabel,
  returnQs,
  onPrintLabel,
}: Props) {
  const navigate = useNavigate()
  const assigned = asset.assigned_to as { name?: string; id?: number; type?: string } | null
  const status = asset.status as { name?: string } | undefined
  const tone = statusTone(Boolean(assigned), status?.name)
  const warranty = warrantyKpi(asset.purchase_date, asset.warranty_months)
  const eol = dateVal(asset.asset_eol_date)
  const modelLabel = [nestName(asset.model), asset.model_number ? `(${String(asset.model_number)})` : '']
    .filter(Boolean)
    .join(' ')
  const title = String(asset.asset_tag || 'Asset')
  const subtitle = [String(asset.name || ''), nestName(asset.location)].filter((s) => s && s !== '—').join('  •  ')
  const actions = asset.available_actions as { checkout?: boolean; checkin?: boolean } | undefined

  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate(backTo)
  }

  return (
    <>
      <div className="vad-crumb">
        <button type="button" className="vad-back-btn" onClick={goBack}>
          <ArrowLeft size={16} /> {backLabel}
        </button>
        <span className="vad-crumb__sep" aria-hidden>/</span>
        <Link to="/">Home</Link>
        <span className="vad-crumb__sep">›</span>
        <Link to="/hardware">Assets</Link>
        <span className="vad-crumb__sep">›</span>
        <span className="vad-crumb__current">{title}</span>
      </div>

      <div className="vad-title-row">
        <div className="vad-title-block">
          <h1>
            {title}
            <span className={`vad-status ${statusClass(tone)}`}>
              {assigned ? 'Assigned' : status?.name || '—'}
            </span>
          </h1>
          <p>{subtitle || 'Asset record'}</p>
        </div>
        <div className="vad-actions">
          <button type="button" className="btn btn-default" onClick={goBack}>
            <ArrowLeft size={15} /> Back
          </button>
          {actions?.checkout ? (
            <Link to={`/hardware/${asset.id}/checkout${returnQs}`} className="btn vad-btn-capture">
              <UserPlus size={15} /> Assign
            </Link>
          ) : null}
          {actions?.checkin ? (
            <Link to={`/hardware/${asset.id}/checkin${returnQs}`} className="btn vad-btn-transfer">
              <UserMinus size={15} /> Unassign
            </Link>
          ) : null}
          <Link to={`/hardware/${asset.id}/edit${returnQs}`} className="btn vad-btn-edit">
            <Pencil size={15} /> Edit asset
          </Link>
          <Link to={`/maintenances/create?asset_id=${asset.id}`} className="btn vad-btn-transfer">
            <Wrench size={15} /> Maintenance
          </Link>
          <button type="button" className="btn vad-btn-transfer" onClick={onPrintLabel}>
            <Printer size={15} /> Print label
          </button>
        </div>
      </div>

      <section className="vad-hero" aria-label="Asset overview">
        <div className="vad-hero__media">
          {imageUrl ? (
            <img src={imageUrl} alt={title} />
          ) : (
            <div className="vad-hero__placeholder">
              <Monitor size={48} strokeWidth={1.5} />
              <span>No asset photo yet</span>
            </div>
          )}
        </div>

        <div className="vad-hero__body">
          <div className="vad-meta">
            <span className="vad-chip">
              <Tag size={14} />
              {nestName(asset.category)}
            </span>
            <span className="vad-chip">
              <Monitor size={14} />
              {modelLabel !== '—' ? modelLabel : 'No model'}
            </span>
            <span className="vad-chip">
              <MapPin size={14} />
              {nestName(asset.location)}
            </span>
            <span className="vad-chip">
              <Hash size={14} />
              {dash(asset.serial)}
            </span>
          </div>

          <div className="vad-kpis">
            <div className="vad-kpi">
              <div className="vad-kpi__label">Purchase cost</div>
              <div className="vad-kpi__value" style={{ fontSize: '1.15rem' }}>{money(asset.purchase_cost)}</div>
              <div className="vad-kpi__hint">
                {dateVal(asset.purchase_date) !== '—' ? `Bought ${dateVal(asset.purchase_date)}` : 'From purchase record'}
              </div>
            </div>
            <div className="vad-kpi">
              <div className="vad-kpi__label">Warranty left</div>
              <div className="vad-kpi__value" style={{ fontSize: warranty.value.length > 6 ? '1.15rem' : undefined }}>
                {warranty.value}
              </div>
              <div className="vad-kpi__hint">{warranty.hint}</div>
            </div>
            <div className="vad-kpi">
              <div className="vad-kpi__label">EOL date</div>
              <div className="vad-kpi__value" style={{ fontSize: '1.05rem' }}>{eol}</div>
              <div className="vad-kpi__hint">{asset.asset_age ? `Age: ${String(asset.asset_age)}` : 'End of life'}</div>
            </div>
            <div className="vad-kpi">
              <div className="vad-kpi__label">Assignment</div>
              <div className="vad-kpi__value" style={{ fontSize: '1.05rem' }}>
                {assigned?.name || 'Unassigned'}
              </div>
              <div className="vad-kpi__hint">
                {assigned && asset.last_checkout
                  ? `Since ${dateVal(asset.last_checkout)}`
                  : nestName(asset.company)}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
