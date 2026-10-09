import { Router } from 'express'
import path from 'node:path'
import { get } from '../db/index.js'
import { authRequired } from '../middleware/auth.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { ensureAssetQr, publicAssetPageUrl } from '../services/assetQr.js'
import { requireItAssetManager } from '../services/permissions.js'
import { makeCaptureUploader, storageRoot } from '../services/uploads.js'
import {
  captureDiskPath,
  deregisterAssetCaptures,
  findAssetByQrToken,
  getAssetCapture,
  insertAssetCapture,
  listAssetCaptures,
  normalizeCaptureKind,
  presentCapture,
  publicCaptureUrl,
  softDeleteAssetCapture,
} from '../services/assetCaptures.js'
import { logAction } from '../services/actionLog.js'

const router = Router()

/** QR scan asset detail — JWT + IT Asset Manager only. Lookup by permanent qr_token (or legacy numeric id). */
router.get('/assets/:token', authRequired, requireItAssetManager, async (req, res) => {
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

router.get('/assets/:token/captures', authRequired, requireItAssetManager, async (req, res) => {
  const token = String(req.params.token || '').trim()
  const asset = await findAssetByQrToken(token)
  if (!asset) return fail(res, 'Asset not found', 404)
  const rows = await listAssetCaptures(asset.id)
  return okList(res, rows.map((r) => presentCapture(r, publicCaptureUrl(token, r.id))))
})

router.post('/assets/:token/captures', authRequired, requireItAssetManager, (req, res) => {
  const upload = makeCaptureUploader('private_uploads/asset_captures')
  upload(req, res, async (err) => {
    if (err) return fail(res, err.message)
    if (!req.file) return fail(res, 'file required')
    try {
      const token = String(req.params.token || '').trim()
      const asset = await findAssetByQrToken(token)
      if (!asset) return fail(res, 'Register the asset before capturing photos or video', 404)
      const mime = String(req.file.mimetype || '')
      const kind = normalizeCaptureKind(String(req.body?.kind || ''), mime)
      const rel = path.relative(storageRoot, req.file.path).replace(/\\/g, '/')
      const lat = req.body?.latitude != null && req.body?.latitude !== '' ? Number(req.body.latitude) : null
      const lng = req.body?.longitude != null && req.body?.longitude !== '' ? Number(req.body.longitude) : null
      const id = await insertAssetCapture({
        assetId: asset.id,
        userId: req.user?.id,
        storagePath: rel,
        originalName: req.file.originalname,
        mime,
        size: req.file.size,
        kind,
        capturedAt: String(req.body?.captured_at || '').trim() || null,
        latitude: Number.isFinite(lat as number) ? lat : null,
        longitude: Number.isFinite(lng as number) ? lng : null,
        accuracyM: req.body?.accuracy_m != null && req.body?.accuracy_m !== '' ? Number(req.body.accuracy_m) : null,
        address: String(req.body?.address || '').trim() || null,
        localityHeader: String(req.body?.locality_header || '').trim() || null,
      })
      const row = await getAssetCapture(id, asset.id)
      return okMessage(res, 'Capture saved', row ? presentCapture(row, publicCaptureUrl(token, row.id)) : { id }, 201)
    } catch (e) {
      return fail(res, e instanceof Error ? e.message : 'Could not save capture', 500)
    }
  })
})

router.delete('/assets/:token/captures', authRequired, requireItAssetManager, async (req, res) => {
  const token = String(req.params.token || '').trim()
  const asset = await findAssetByQrToken(token)
  if (!asset) return fail(res, 'Asset not found', 404)
  const result = await deregisterAssetCaptures(asset.id)
  if (!result.removed) return fail(res, 'No current captures to deregister')
  await logAction({
    userId: req.user?.id,
    actionType: 'deregistered',
    itemType: 'asset',
    itemId: asset.id,
    note: 'Field captures deregistered for recapture at a new location',
    meta: { photos_removed: result.removed, source: 'qr' },
  })
  return okMessage(res, 'Captures deregistered. Recapture at the new location and Submit.', result)
})

router.get('/assets/:token/captures/:id/file', authRequired, requireItAssetManager, async (req, res) => {
  const token = String(req.params.token || '').trim()
  const asset = await findAssetByQrToken(token)
  if (!asset) return fail(res, 'Asset not found', 404)
  const row = await getAssetCapture(Number(req.params.id), asset.id, { includeDeleted: true })
  if (!row) return fail(res, 'Capture not found', 404)
  const abs = captureDiskPath(String((row as { storage_path: string }).storage_path))
  if (!abs) return fail(res, 'File missing on disk', 404)
  res.setHeader('Content-Type', String(row.mime_type || 'application/octet-stream'))
  res.setHeader('Content-Disposition', `inline; filename="${row.original_name || 'capture'}"`)
  return res.sendFile(abs)
})

router.delete('/assets/:token/captures/:id', authRequired, requireItAssetManager, async (req, res) => {
  const token = String(req.params.token || '').trim()
  const asset = await findAssetByQrToken(token)
  if (!asset) return fail(res, 'Asset not found', 404)
  const row = await softDeleteAssetCapture(Number(req.params.id), asset.id)
  if (!row) return fail(res, 'Capture not found', 404)
  return okMessage(res, 'Capture deleted')
})

export default router
