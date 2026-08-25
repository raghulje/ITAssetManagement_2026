import { Router } from 'express'
import { get } from '../db/index.js'
import { fail, okItem } from '../utils/response.js'
import { ensureAssetQr, publicAssetPageUrl } from '../services/assetQr.js'

const router = Router()

/** Public asset detail for QR scan — no auth. Lookup by permanent qr_token (or legacy numeric id). */
router.get('/assets/:token', async (req, res) => {
  const token = String(req.params.token || '').trim()
  if (!token) return fail(res, 'Token required', 400)

  let asset = await get<Record<string, unknown>>(`
    SELECT a.id, a.asset_tag, a.old_asset_tag, a.name, a.serial, a.qr_token, a.qr_url, a.qr_image_path,
      a.purchase_date, a.purchase_cost, a.order_number, a.warranty_months, a.asset_eol_date,
      a.map_latitude, a.map_longitude, a.map_address,
      a.notes, a.last_checkout, a.last_checkin, a.last_audit_date, a.next_audit_date,
      a.assigned_to, a.assigned_type, a.label_printed_at, a.label_print_count,
      a.last_agent_sync_at, a.agent_hostname,
      m.name as model_name, m.model_number,
      mf.name as manufacturer_name,
      s.name as status_name, s.type as status_type,
      co.name as company_name,
      dep.name as department_name,
      loc.name as location_name,
      rtd.name as rtd_location_name,
      sup.name as supplier_name,
      CASE
        WHEN a.assigned_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to)
        WHEN a.assigned_type = 'employee' THEN (
          SELECT CONCAT(first_name, ' ', last_name, ' (', employee_code, ')') FROM employees WHERE id = a.assigned_to
        )
        WHEN a.assigned_type = 'location' THEN (SELECT name FROM locations WHERE id = a.assigned_to)
        WHEN a.assigned_type = 'asset' THEN (SELECT asset_tag FROM assets WHERE id = a.assigned_to)
        ELSE NULL
      END as assigned_name
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
    LEFT JOIN status_labels s ON s.id = a.status_id
    LEFT JOIN companies co ON co.id = a.company_id
    LEFT JOIN departments dep ON dep.id = a.department_id
    LEFT JOIN locations loc ON loc.id = a.location_id
    LEFT JOIN locations rtd ON rtd.id = a.rtd_location_id
    LEFT JOIN suppliers sup ON sup.id = a.supplier_id
    WHERE a.deleted_at IS NULL AND a.qr_token = ?
    LIMIT 1
  `, [token])

  // Fallback: numeric id only if QR not yet minted (admin preview) — prefer token
  if (!asset && /^\d+$/.test(token)) {
    asset = await get<Record<string, unknown>>(`
      SELECT a.id, a.asset_tag, a.old_asset_tag, a.name, a.serial, a.qr_token, a.qr_url, a.qr_image_path,
        a.purchase_date, a.purchase_cost, a.order_number, a.warranty_months, a.asset_eol_date,
        a.map_latitude, a.map_longitude, a.map_address,
        a.notes, a.last_checkout, a.last_checkin, a.last_audit_date, a.next_audit_date,
        a.assigned_to, a.assigned_type, a.label_printed_at, a.label_print_count,
        a.last_agent_sync_at, a.agent_hostname,
        m.name as model_name, m.model_number,
        mf.name as manufacturer_name,
        s.name as status_name, s.type as status_type,
        co.name as company_name,
        dep.name as department_name,
        loc.name as location_name,
        rtd.name as rtd_location_name,
        sup.name as supplier_name,
        CASE
          WHEN a.assigned_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to)
          WHEN a.assigned_type = 'employee' THEN (
            SELECT CONCAT(first_name, ' ', last_name, ' (', employee_code, ')') FROM employees WHERE id = a.assigned_to
          )
          WHEN a.assigned_type = 'location' THEN (SELECT name FROM locations WHERE id = a.assigned_to)
          WHEN a.assigned_type = 'asset' THEN (SELECT asset_tag FROM assets WHERE id = a.assigned_to)
          ELSE NULL
        END as assigned_name
      FROM assets a
      LEFT JOIN models m ON m.id = a.model_id
      LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
      LEFT JOIN status_labels s ON s.id = a.status_id
      LEFT JOIN companies co ON co.id = a.company_id
      LEFT JOIN departments dep ON dep.id = a.department_id
      LEFT JOIN locations loc ON loc.id = a.location_id
      LEFT JOIN locations rtd ON rtd.id = a.rtd_location_id
      LEFT JOIN suppliers sup ON sup.id = a.supplier_id
      WHERE a.deleted_at IS NULL AND a.id = ?
      LIMIT 1
    `, [Number(token)])
    if (asset?.id) {
      const qr = await ensureAssetQr(Number(asset.id))
      asset.qr_token = qr.qr_token
      asset.qr_url = qr.public_url
      asset.qr_image_path = qr.qr_image_path
    }
  }

  if (!asset) {
    const { findLabelByTokenOrCode, presentLabel } = await import('../services/blankLabels.js')
    const label = await findLabelByTokenOrCode(token)
    if (label?.status === 'registered' && label.asset_id) {
      asset = await get<Record<string, unknown>>(`
        SELECT a.id, a.asset_tag, a.old_asset_tag, a.name, a.serial, a.qr_token, a.qr_url, a.qr_image_path,
          a.purchase_date, a.purchase_cost, a.order_number, a.warranty_months, a.asset_eol_date,
          a.map_latitude, a.map_longitude, a.map_address,
          a.notes, a.last_checkout, a.last_checkin, a.last_audit_date, a.next_audit_date,
          a.assigned_to, a.assigned_type, a.label_printed_at, a.label_print_count,
          a.last_agent_sync_at, a.agent_hostname,
          m.name as model_name, m.model_number,
          mf.name as manufacturer_name,
          s.name as status_name, s.type as status_type,
          co.name as company_name,
          dep.name as department_name,
          loc.name as location_name,
          rtd.name as rtd_location_name,
          sup.name as supplier_name,
          CASE
            WHEN a.assigned_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to)
            WHEN a.assigned_type = 'employee' THEN (
              SELECT CONCAT(first_name, ' ', last_name, ' (', employee_code, ')') FROM employees WHERE id = a.assigned_to
            )
            WHEN a.assigned_type = 'location' THEN (SELECT name FROM locations WHERE id = a.assigned_to)
            WHEN a.assigned_type = 'asset' THEN (SELECT asset_tag FROM assets WHERE id = a.assigned_to)
            ELSE NULL
          END as assigned_name
        FROM assets a
        LEFT JOIN models m ON m.id = a.model_id
        LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
        LEFT JOIN status_labels s ON s.id = a.status_id
        LEFT JOIN companies co ON co.id = a.company_id
        LEFT JOIN departments dep ON dep.id = a.department_id
        LEFT JOIN locations loc ON loc.id = a.location_id
        LEFT JOIN locations rtd ON rtd.id = a.rtd_location_id
        LEFT JOIN suppliers sup ON sup.id = a.supplier_id
        WHERE a.deleted_at IS NULL AND a.id = ?
        LIMIT 1
      `, [label.asset_id])
    } else if (label && label.status === 'blank') {
      const shown = presentLabel(label)
      return okItem(res, {
        registered: false,
        token: shown.token,
        code: shown.code,
        kind: shown.kind,
        public_url: shown.public_url,
        qr_image_url: shown.qr_image_url,
        barcode_image_url: shown.barcode_image_url,
      })
    }
  }

  if (!asset) return fail(res, 'Asset not found', 404)

  const qrToken = String(asset.qr_token || token)
  const imagePath = asset.qr_image_path
    ? `/storage/${String(asset.qr_image_path).replace(/\\/g, '/').replace(/^public\//, '')}`
    : null

  return okItem(res, {
    registered: true,
    id: asset.id,
    asset_tag: asset.asset_tag,
    old_asset_tag: asset.old_asset_tag || null,
    name: asset.name,
    serial: asset.serial,
    model: asset.model_name,
    model_number: asset.model_number,
    manufacturer: asset.manufacturer_name,
    status: asset.assigned_to ? 'Assigned' : asset.status_name,
    status_type: asset.assigned_to ? 'deployed' : asset.status_type,
    company: asset.company_name,
    department: asset.department_name,
    location: asset.location_name || asset.rtd_location_name,
    map_latitude: asset.map_latitude != null ? Number(asset.map_latitude) : null,
    map_longitude: asset.map_longitude != null ? Number(asset.map_longitude) : null,
    map_address: asset.map_address || null,
    supplier: asset.supplier_name,
    purchase_date: asset.purchase_date,
    purchase_cost: asset.purchase_cost,
    order_number: asset.order_number,
    warranty_months: asset.warranty_months,
    asset_eol_date: asset.asset_eol_date,
    notes: asset.notes,
    assigned_to: asset.assigned_to
      ? { id: asset.assigned_to, name: asset.assigned_name, type: asset.assigned_type }
      : null,
    last_checkout: asset.last_checkout,
    last_checkin: asset.last_checkin,
    last_audit_date: asset.last_audit_date,
    next_audit_date: asset.next_audit_date,
    label_printed_at: asset.label_printed_at,
    label_print_count: asset.label_print_count,
    last_agent_sync_at: asset.last_agent_sync_at,
    agent_hostname: asset.agent_hostname,
    public_url: asset.qr_url || publicAssetPageUrl(qrToken),
    qr_token: qrToken,
    qr_image_url: imagePath,
  })
})

export default router
