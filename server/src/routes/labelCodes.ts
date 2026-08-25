import { Router } from 'express'
import { get, run, now } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import {
  findLabelByTokenOrCode,
  generateBlankLabels,
  labelsInBatch,
  listBatches,
  listLabelCodes,
  markLabelRegistered,
  presentLabel,
  type LabelKind,
} from '../services/blankLabels.js'
import { logAction } from '../services/actionLog.js'
import { transformAsset } from '../services/transformers.js'
import { inventoryDomainColumnsReady, resolveWriteDomainId, tableHasColumn } from '../services/domainAuth.js'
import { publicAssetPageUrl } from '../services/assetQr.js'

const router = Router()

router.get('/', async (req, res) => {
  const result = await listLabelCodes({
    status: String(req.query.status || ''),
    search: String(req.query.search || ''),
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
  })
  return okList(res, result.rows, result.total)
})

router.get('/batches', async (_req, res) => {
  const rows = await listBatches(40)
  return okList(res, rows)
})

router.get('/batches/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return fail(res, 'Invalid batch')
  const rows = await labelsInBatch(id)
  if (!rows.length) return fail(res, 'Batch not found', 404)
  return okList(res, rows)
})

router.post('/generate', async (req, res) => {
  const count = Number(req.body?.count)
  const kind = String(req.body?.kind || 'qr') as LabelKind
  if (!Number.isFinite(count) || count < 1) return fail(res, 'Enter how many labels to generate')
  try {
    const result = await generateBlankLabels({
      count,
      kind,
      userId: req.user?.id,
    })
    await logAction({
      userId: req.user?.id,
      actionType: 'create',
      itemType: 'label_batch',
      itemId: result.batch_id,
      note: `Generated ${result.count} blank ${kind} label(s)`,
    })
    return okMessage(res, `Generated ${result.count} blank label(s)`, result)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Generate failed')
  }
})

router.post('/:token/register', async (req, res) => {
  const label = await findLabelByTokenOrCode(String(req.params.token || ''))
  if (!label) return fail(res, 'Label not found', 404)
  if (label.status !== 'blank' || label.asset_id) {
    return fail(res, 'This label is already registered. Scan again to view details.', 409)
  }

  const b = req.body || {}
  if (!b.model_id || !b.status_id) return fail(res, 'model_id and status_id are required')
  if (!b.company_id && !b.legal_entity_id) {
    return fail(res, 'company_id (or legal_entity_id) is required')
  }

  const taken = await get<{ id: number }>(
    `SELECT id FROM assets WHERE asset_tag = ? AND deleted_at IS NULL`,
    [label.code],
  )
  if (taken) return fail(res, `Asset tag ${label.code} is already in use`)

  let domain
  try {
    domain = await resolveWriteDomainId(req.user?.permissions, b)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid domain'
    return fail(res, msg, /Forbidden/.test(msg) ? 403 : 400)
  }

  const ts = now()
  const domainReady = await inventoryDomainColumnsReady()
  const hasQr = await tableHasColumn('assets', 'qr_token')
  const pageUrl = publicAssetPageUrl(label.token)
  const qrRel = label.qr_image_path || `public/labels/qr/${label.token}.png`

  const cols: string[] = []
  const vals: unknown[] = []
  if (domainReady) {
    cols.push('domain_id')
    vals.push(domain.id)
  }
  cols.push('asset_tag')
  vals.push(label.code)
  if (hasQr) {
    cols.push('qr_token', 'qr_url', 'qr_image_path')
    vals.push(label.token, pageUrl, qrRel)
  }
  cols.push(
    'name', 'serial', 'model_id', 'status_id', 'company_id', 'legal_entity_id',
    'department_id', 'supplier_id', 'location_id', 'rtd_location_id', 'notes',
    'requestable', 'byod', 'created_at', 'updated_at',
  )
  vals.push(
    b.name || null,
    b.serial || null,
    Number(b.model_id),
    Number(b.status_id),
    b.company_id ? Number(b.company_id) : null,
    b.legal_entity_id ? Number(b.legal_entity_id) : null,
    b.department_id ? Number(b.department_id) : null,
    b.supplier_id ? Number(b.supplier_id) : null,
    b.location_id || b.rtd_location_id ? Number(b.location_id || b.rtd_location_id) : null,
    b.rtd_location_id ? Number(b.rtd_location_id) : null,
    b.notes ? String(b.notes).trim() : null,
    0, 0, ts, ts,
  )

  let assetId: number
  try {
    const info = await run(
      `INSERT INTO assets (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      vals,
    )
    assetId = info.insertId
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not create asset'
    if (/uk_assets_tag|duplicate/i.test(msg)) {
      return fail(res, `Asset tag ${label.code} is already in use`, 409)
    }
    return fail(res, msg)
  }

  const claimed = await markLabelRegistered({ labelId: label.id, assetId, userId: req.user?.id })
  if (!claimed) {
    await run(`UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?`, [ts, ts, assetId])
    return fail(res, 'This label is already registered. Scan again to view details.', 409)
  }
  await logAction({
    userId: req.user?.id,
    actionType: 'create',
    itemType: 'asset',
    itemId: assetId,
    note: `Registered from blank label ${label.code}`,
  })
  return okMessage(res, 'Asset registered', await transformAsset(assetId), 201)
})

router.get('/lookup/:value', async (req, res) => {
  const label = await findLabelByTokenOrCode(String(req.params.value || ''))
  if (!label) return fail(res, 'Label not found', 404)
  return okItem(res, presentLabel(label))
})

export default router
