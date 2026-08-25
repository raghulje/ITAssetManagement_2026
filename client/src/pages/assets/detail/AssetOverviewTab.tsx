import type { RefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  History,
  Printer,
  QrCode,
  Satellite,
  UserMinus,
  UserPlus,
  Wrench,
} from 'lucide-react'
import { assetImageSrc, getApiBase, getStorageBase } from '../../../api/baseUrl'
import { Field, dash, dateVal, initials, money, nestName, statusClass, statusTone } from './helpers'

type Props = {
  asset: Record<string, unknown>
  assignRef: RefObject<HTMLElement | null>
  returnQs: string
  receivedImages: Record<string, unknown>[]
  agentLabel?: string
  agentRegistered?: boolean
  agentBusy?: boolean
  onPrintLabel: () => void
  onAgentScan: () => void
  onQuick: (action: 'history' | 'maintenance' | 'agent') => void
}

export default function AssetOverviewTab({
  asset,
  assignRef,
  returnQs,
  receivedImages,
  agentLabel,
  agentRegistered,
  agentBusy,
  onPrintLabel,
  onAgentScan,
  onQuick,
}: Props) {
  const assigned = asset.assigned_to as { name?: string; id?: number; type?: string } | null
  const status = asset.status as { name?: string } | undefined
  const tone = statusTone(Boolean(assigned), status?.name)
  const actions = asset.available_actions as { checkout?: boolean; checkin?: boolean } | undefined
  const attrs = (asset.domain_attrs && typeof asset.domain_attrs === 'object')
    ? asset.domain_attrs as Record<string, unknown>
    : null
  const hasSpecs = Boolean(
    attrs && (attrs.processor || attrs.ram || attrs.storage || attrs.os || attrs.mac_address || attrs.ip_address
      || attrs.color || attrs.material || attrs.condition),
  )

  return (
    <>
      <div className="vad-overview">
        <article className="vad-card">
          <div className="vad-card__head">
            <h3>Basic information</h3>
          </div>
          <dl className="vad-info-grid">
            <Field label="Asset ID">{dash(asset.id)}</Field>
            <Field label="Asset tag">{dash(asset.asset_tag)}</Field>
            <Field label="Old asset tag">{dash(asset.old_asset_tag)}</Field>
            <Field label="Name">{dash(asset.name)}</Field>
            <Field label="Serial">{dash(asset.serial)}</Field>
            <Field label="Model">
              {nestName(asset.model)}
              {asset.model_number ? ` (${String(asset.model_number)})` : ''}
            </Field>
            <Field label="Type">{nestName(asset.category)}</Field>
            <Field label="Manufacturer">{nestName(asset.manufacturer)}</Field>
            <Field label="Status">
              <span className={`vad-status ${statusClass(tone)}`}>
                {assigned ? 'Assigned' : status?.name || '—'}
              </span>
            </Field>
            <Field label="Company">{nestName(asset.company)}</Field>
            <Field label="Department">{nestName(asset.department)}</Field>
            <Field label="Purchase cost">{money(asset.purchase_cost)}</Field>
          </dl>
        </article>

        <article className="vad-card" id="vad-assignment" ref={assignRef as RefObject<HTMLElement>}>
          <div className="vad-card__head">
            <h3>Current assignment</h3>
          </div>
          {assigned ? (
            <div className="vad-assign-body">
              <div className="vad-assign-person">
                <div className="vad-avatar">{initials(assigned.name)}</div>
                <div>
                  <strong>
                    {assigned.type === 'employee' && assigned.id
                      ? <Link to={`/employees/${assigned.id}`}>{assigned.name}</Link>
                      : assigned.name}
                  </strong>
                  <span>{assigned.type === 'employee' ? 'Employee' : assigned.type || 'Assignee'}</span>
                </div>
              </div>
              <dl className="vad-assign-meta">
                <div>
                  <dt>Assigned on</dt>
                  <dd>{dateVal(asset.last_checkout)}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{nestName(asset.location)}</dd>
                </div>
              </dl>
              <button type="button" className="vad-link-btn" onClick={() => onQuick('history')}>
                View assign / unassign history
              </button>
              {actions?.checkin ? (
                <Link to={`/hardware/${asset.id}/checkin${returnQs}`} className="vad-link-btn" style={{ textAlign: 'center' }}>
                  Unassign this asset
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="vad-assign-form">
              <div className="vad-empty" style={{ textAlign: 'left', padding: '0 0 4px' }}>
                <strong>Unassigned</strong>
                Assign this asset to an employee from the assign flow.
              </div>
              {actions?.checkout ? (
                <Link to={`/hardware/${asset.id}/checkout${returnQs}`} className="btn btn-primary btn-sm">
                  <UserPlus size={14} /> Assign
                </Link>
              ) : (
                <p className="help-block mb-0">This status is not deployable, so assign is unavailable.</p>
              )}
            </div>
          )}
        </article>

        <article className="vad-card">
          <div className="vad-card__head">
            <h3>Quick actions</h3>
          </div>
          <div className="vad-qa">
            {actions?.checkout ? (
              <Link to={`/hardware/${asset.id}/checkout${returnQs}`}>
                <UserPlus /> Assign to employee
              </Link>
            ) : null}
            {actions?.checkin ? (
              <Link to={`/hardware/${asset.id}/checkin${returnQs}`}>
                <UserMinus /> Unassign
              </Link>
            ) : null}
            <Link to={`/maintenances/create?asset_id=${asset.id}`}>
              <Wrench /> Log maintenance
            </Link>
            <button type="button" onClick={onPrintLabel}>
              <Printer /> Print label / QR
            </button>
            <button type="button" disabled={agentBusy || !agentRegistered} onClick={onAgentScan}>
              <Satellite /> {agentBusy ? 'Requesting scan…' : agentLabel || 'Run agent scan'}
            </button>
            <button type="button" onClick={() => onQuick('history')}>
              <History /> View activity log
            </button>
          </div>
        </article>
      </div>

      <div className="vad-overview__bottom" style={{ marginTop: 16 }}>
        <article className="vad-card">
          <div className="vad-card__head">
            <h3>Identification &amp; purchase</h3>
          </div>
          <dl className="vad-info-grid vad-info-grid--2">
            <Field label="Supplier / vendor">{nestName(asset.supplier)}</Field>
            <Field label="PO number">{dash(asset.order_number)}</Field>
            <Field label="Purchase date">{dateVal(asset.purchase_date)}</Field>
            <Field label="Warranty (months)">{dash(asset.warranty_months)}</Field>
            <Field label="EOL date">{dateVal(asset.asset_eol_date)}</Field>
            <Field label="Default location">{nestName(asset.rtd_location)}</Field>
            <Field label="Map pin">
              {asset.map_latitude != null && asset.map_longitude != null ? (
                <span>
                  {dash(asset.map_address)}
                  <br />
                  <a
                    href={`https://www.google.com/maps?q=${asset.map_latitude},${asset.map_longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google Maps
                  </a>
                </span>
              ) : '—'}
            </Field>
            <Field label="Notes">{dash(asset.notes)}</Field>
          </dl>
        </article>

        <article className="vad-card">
          <div className="vad-card__head">
            <h3>QR / identity</h3>
            <div className="vad-card__icon" aria-hidden><QrCode size={16} /></div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {asset.qr_image_url ? (
              <img
                src={`${getStorageBase()}${String(asset.qr_image_url)}`}
                alt="Asset QR"
                style={{ width: 120, height: 120, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}
              />
            ) : (
              <div className="vad-empty" style={{ textAlign: 'left', padding: 0 }}>
                <strong>No QR yet</strong>
                Print a label once to mint a permanent code.
              </div>
            )}
            <dl className="vad-info-grid vad-info-grid--2" style={{ flex: 1, minWidth: 180 }}>
              <Field label="QR token">{asset.qr_token ? String(asset.qr_token) : 'Not minted'}</Field>
              <Field label="Public page">
                {asset.qr_url
                  ? <a href={String(asset.qr_url)} target="_blank" rel="noreferrer">Open scan page</a>
                  : '—'}
              </Field>
              <Field label="Label printed">
                {asset.label_printed_at
                  ? `${dateVal(asset.label_printed_at)} (${Number(asset.label_print_count || 0)}×)`
                  : 'Never'}
              </Field>
            </dl>
          </div>
        </article>
      </div>

      {hasSpecs ? (
        <article className="vad-card" style={{ marginTop: 16 }}>
          <div className="vad-card__head">
            <h3>Specifications</h3>
          </div>
          <dl className="vad-info-grid">
            {attrs?.processor ? <Field label="Processor">{dash(attrs.processor)}</Field> : null}
            {attrs?.ram ? <Field label="RAM">{dash(attrs.ram)}</Field> : null}
            {attrs?.storage ? <Field label="Storage">{dash(attrs.storage)}</Field> : null}
            {attrs?.os ? <Field label="OS">{dash(attrs.os)}</Field> : null}
            {attrs?.mac_address ? <Field label="MAC">{dash(attrs.mac_address)}</Field> : null}
            {attrs?.ip_address ? <Field label="IP">{dash(attrs.ip_address)}</Field> : null}
            {attrs?.color ? <Field label="Color">{dash(attrs.color)}</Field> : null}
            {attrs?.material ? <Field label="Material">{dash(attrs.material)}</Field> : null}
            {attrs?.condition ? <Field label="Condition">{dash(attrs.condition)}</Field> : null}
          </dl>
        </article>
      ) : null}

      {(asset.received_condition || receivedImages.length > 0) ? (
        <article className="vad-card" style={{ marginTop: 16 }}>
          <div className="vad-card__head">
            <h3>Received condition</h3>
          </div>
          {asset.received_condition ? (
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{String(asset.received_condition)}</p>
          ) : (
            <p className="text-muted">No condition description</p>
          )}
          {receivedImages.length > 0 ? (
            <div className="received-condition-gallery" style={{ marginTop: 12 }}>
              {receivedImages.map((f) => {
                const url = f.url
                  ? (assetImageSrc(String(f.url)) || String(f.url))
                  : `${getApiBase()}/files/${f.id}/download`
                return (
                  <a
                    key={String(f.id)}
                    className="received-condition-thumb"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={String(f.original_filename || f.filename)}
                  >
                    <img src={url} alt={String(f.original_filename || f.filename)} />
                    <span className="received-condition-caption">
                      {String(f.original_filename || f.filename)}
                    </span>
                  </a>
                )
              })}
            </div>
          ) : null}
        </article>
      ) : null}
    </>
  )
}
