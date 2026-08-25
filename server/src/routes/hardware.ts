import { Router } from 'express'
import multer from 'multer'
import { all, get, run, now, limitSql } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { transformAsset } from '../services/transformers.js'
import { logAction } from '../services/actionLog.js'
import { actorLabel, notifyWorkflow, resolveAssigneeEmail } from '../services/notify.js'
import { allocateAssetTag, nextAssetTag } from '../services/assetTag.js'
import {
  ASSET_AGE_DATE_SQL,
  currentFyRange,
  resolvePeriodRange,
} from '../utils/period.js'
import {
  assertRecordDomainAccess,
  inventoryDomainClause,
  inventoryDomainColumnsReady,
  loadItemDomain,
  resolveWriteDomainId,
  tableHasColumn,
} from '../services/domainAuth.js'

const router = Router()

function parseDomainAttrs(raw: unknown): Record<string, string> | null {
  if (raw == null || raw === '') return null
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return null }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v == null) continue
    const s = String(v).trim()
    if (s) out[k] = s
  }
  return Object.keys(out).length ? out : null
}
const parsePoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('file')

async function requireAssetDomain(req: import('express').Request, res: import('express').Response, id: number) {
  const row = await loadItemDomain('assets', 'id = ? AND deleted_at IS NULL', [id])
  if (!row) {
    fail(res, 'Asset not found', 404)
    return null
  }
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return null
  return row
}

async function listIds(req: { query: Record<string, unknown>; user?: { permissions?: Record<string, unknown> } }) {
  const statusType = String(req.query.status_type || req.query.status || '')
  const search = String(req.query.search || req.query.q || '').trim()
  const companyId = req.query.company_id ? Number(req.query.company_id) : null
  const locationId = req.query.location_id ? Number(req.query.location_id) : null
  const sort = String(req.query.sort || 'id').toLowerCase()
  const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'

  let sql = `
    SELECT a.id FROM assets a
    LEFT JOIN status_labels s ON s.id = a.status_id
    LEFT JOIN companies c ON c.id = a.company_id
    LEFT JOIN locations loc ON loc.id = COALESCE(a.location_id, a.rtd_location_id)
    LEFT JOIN models m ON m.id = a.model_id
    WHERE a.deleted_at IS NULL
  `
  const params: unknown[] = []

  if (statusType === 'Deployed' || statusType === 'Assigned') {
    sql += ' AND a.assigned_to IS NOT NULL'
  } else if (statusType === 'RTD' || statusType === 'ReadyToAssign') {
    sql += " AND a.assigned_to IS NULL AND s.type = 'deployable'"
  } else if (statusType === 'Pending') {
    sql += " AND s.type = 'pending'"
  } else if (statusType === 'Undeployable' || statusType === 'NotAssignable') {
    sql += " AND s.type = 'undeployable'"
  } else if (statusType === 'Archived') {
    sql += " AND s.type = 'archived'"
  } else if (statusType === 'Requestable') {
    sql += ' AND a.requestable = 1'
  } else if (statusType === 'byod') {
    sql += ' AND a.byod = 1'
  } else if (statusType === 'Deleted') {
    sql = `
      SELECT a.id FROM assets a
      LEFT JOIN status_labels s ON s.id = a.status_id
      LEFT JOIN companies c ON c.id = a.company_id
      LEFT JOIN locations loc ON loc.id = COALESCE(a.location_id, a.rtd_location_id)
      LEFT JOIN models m ON m.id = a.model_id
      WHERE a.deleted_at IS NOT NULL
    `
  }

  if (companyId) {
    sql += ' AND a.company_id = ?'
    params.push(companyId)
  }

  if (locationId) {
    sql += ' AND (a.location_id = ? OR a.rtd_location_id = ?)'
    params.push(locationId, locationId)
  }

  const statusId = req.query.status_id ? Number(req.query.status_id) : null
  if (statusId) {
    sql += ' AND a.status_id = ?'
    params.push(statusId)
  }

  // Column filter by displayed Status value (Assigned | status label name)
  const statusValue = String(req.query.status_value || '').trim()
  if (statusValue === 'Assigned') {
    sql += ' AND a.assigned_to IS NOT NULL'
  } else if (statusValue) {
    sql += ' AND a.assigned_to IS NULL AND s.name = ?'
    params.push(statusValue)
  }

  // Column filter: assigned=1 | assigned=0 | assigned_to + assigned_type | assigned_name
  const assignedFlag = String(req.query.assigned || '').toLowerCase()
  if (assignedFlag === '1' || assignedFlag === 'yes' || assignedFlag === 'assigned') {
    sql += ' AND a.assigned_to IS NOT NULL'
  } else if (assignedFlag === '0' || assignedFlag === 'no' || assignedFlag === 'unassigned' || assignedFlag === 'none') {
    sql += ' AND a.assigned_to IS NULL'
  }
  const assignedTo = req.query.assigned_to ? Number(req.query.assigned_to) : null
  if (assignedTo) {
    const assignedType = String(req.query.assigned_type || 'employee')
    sql += ' AND a.assigned_to = ? AND a.assigned_type = ?'
    params.push(assignedTo, assignedType)
  }
  const assignedName = String(req.query.assigned_name || '').trim()
  if (assignedName === '—' || assignedName.toLowerCase() === 'unassigned') {
    sql += ' AND a.assigned_to IS NULL'
  } else if (assignedName) {
    sql += ` AND a.assigned_to IS NOT NULL AND (
      (a.assigned_type = 'employee' AND (
        SELECT CONCAT(first_name, ' ', last_name, ' (', employee_code, ')') FROM employees WHERE id = a.assigned_to
      ) = ?)
      OR (a.assigned_type = 'user' AND (
        SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to
      ) = ?)
      OR (a.assigned_type = 'location' AND (
        SELECT name FROM locations WHERE id = a.assigned_to
      ) = ?)
      OR (a.assigned_type = 'asset' AND (
        SELECT asset_tag FROM assets WHERE id = a.assigned_to
      ) = ?)
    )`
    params.push(assignedName, assignedName, assignedName, assignedName)
  }

  if (search) {
    sql += ` AND (
      a.asset_tag LIKE ? OR a.old_asset_tag LIKE ? OR a.name LIKE ? OR a.serial LIKE ? OR CAST(a.id AS CHAR) = ?
      OR m.name LIKE ? OR c.name LIKE ? OR loc.name LIKE ?
    )`
    const like = `%${search}%`
    params.push(like, like, like, like, search, like, like, like)
  }

  if (req.query.order_number) {
    sql += ' AND a.order_number = ?'
    params.push(req.query.order_number)
  }

  // Period filter: explicit date range (ITSM Weekly / Monthly / FY picker)
  // or legacy period_type + period tokens
  const periodFrom = String(req.query.period_from || req.query.purchase_from || '').trim()
  const periodTo = String(req.query.period_to || req.query.purchase_to || '').trim()
  if (periodFrom || periodTo) {
    if (periodFrom) {
      sql += ` AND ${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} >= ?`
      params.push(periodFrom)
    }
    if (periodTo) {
      sql += ` AND ${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} <= ?`
      params.push(periodTo)
    }
  } else {
    const periodType = String(req.query.period_type || '').trim()
    const period = String(req.query.period || '').trim()
    if (periodType && period) {
      const range = resolvePeriodRange(periodType, period)
      if (range) {
        sql += ` AND ${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} >= ? AND ${ASSET_AGE_DATE_SQL} <= ?`
        params.push(range.from, range.to)
      }
    }
  }

  // New = within current FY; Existing = before current FY (or unknown date)
  const assetAge = String(req.query.asset_age || '').toLowerCase().trim()
  if (assetAge === 'new' || assetAge === 'existing') {
    const fy = currentFyRange()
    if (assetAge === 'new') {
      sql += ` AND ${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} >= ? AND ${ASSET_AGE_DATE_SQL} <= ?`
      params.push(fy.from, fy.to)
    } else {
      sql += ` AND (${ASSET_AGE_DATE_SQL} IS NULL OR ${ASSET_AGE_DATE_SQL} < ?)`
      params.push(fy.from)
    }
  }

  const sortMap: Record<string, string> = {
    id: 'a.id',
    asset_tag: 'a.asset_tag',
    name: 'a.name',
    serial: 'a.serial',
    model: 'm.name',
    status: 's.name',
    company: 'c.name',
    location: 'loc.name',
    purchase_date: 'a.purchase_date',
    created_at: 'a.created_at',
  }
  const sortCol = sortMap[sort] || 'a.id'
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  sql += domain.sql
  params.push(...domain.params)
  sql += ` ORDER BY ${sortCol} ${order}, a.id DESC`
  return { sql, params }
}

router.get('/', async (req, res) => {
  const { sql, params } = await listIds(req)
  const limit = Math.min(Number(req.query.limit) || 50, 500)
  const offset = Number(req.query.offset) || 0
  const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _count_q`, params)
  const total = Number(totalRow?.c || 0)
  const ids = await all<{ id: number }>(`${sql} ${limitSql(limit, offset)}`, params)
  const rows = (await Promise.all(ids.map((r) => transformAsset(r.id)))).filter(Boolean)
  return okList(res, rows, total)
})

/** Distinct Status / Assigned To values as shown in the assets list columns. */
router.get('/facets', async (req, res) => {
  const companyId = req.query.company_id ? Number(req.query.company_id) : null
  const locationId = req.query.location_id ? Number(req.query.location_id) : null
  const search = String(req.query.search || req.query.q || '').trim()
  const statusType = String(req.query.status_type || req.query.status || '')

  let where = 'a.deleted_at IS NULL'
  const params: unknown[] = []
  if (statusType === 'Deployed' || statusType === 'Assigned') {
    where += ' AND a.assigned_to IS NOT NULL'
  } else if (statusType === 'RTD' || statusType === 'ReadyToAssign') {
    where += " AND a.assigned_to IS NULL AND s.type = 'deployable'"
  } else if (statusType === 'Pending') {
    where += " AND s.type = 'pending'"
  } else if (statusType === 'Deleted') {
    where = 'a.deleted_at IS NOT NULL'
  }
  if (companyId) {
    where += ' AND a.company_id = ?'
    params.push(companyId)
  }
  if (locationId) {
    where += ' AND (a.location_id = ? OR a.rtd_location_id = ?)'
    params.push(locationId, locationId)
  }
  if (search) {
    where += ` AND (
      a.asset_tag LIKE ? OR a.old_asset_tag LIKE ? OR a.name LIKE ? OR a.serial LIKE ?
      OR m.name LIKE ? OR c.name LIKE ? OR loc.name LIKE ?
    )`
    const like = `%${search}%`
    params.push(like, like, like, like, like, like, like)
  }

  const periodFrom = String(req.query.period_from || req.query.purchase_from || '').trim()
  const periodTo = String(req.query.period_to || req.query.purchase_to || '').trim()
  if (periodFrom) {
    where += ` AND ${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} >= ?`
    params.push(periodFrom)
  }
  if (periodTo) {
    where += ` AND ${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} <= ?`
    params.push(periodTo)
  }

  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  where += domain.sql
  params.push(...domain.params)

  const statusRows = await all<{ value: string }>(`
    SELECT DISTINCT
      CASE
        WHEN a.assigned_to IS NOT NULL THEN 'Assigned'
        ELSE COALESCE(NULLIF(TRIM(s.name), ''), 'Unknown')
      END AS value
    FROM assets a
    LEFT JOIN status_labels s ON s.id = a.status_id
    LEFT JOIN companies c ON c.id = a.company_id
    LEFT JOIN locations loc ON loc.id = COALESCE(a.location_id, a.rtd_location_id)
    LEFT JOIN models m ON m.id = a.model_id
    WHERE ${where}
    ORDER BY value ASC
  `, params)

  const assigneeRows = await all<{ value: string }>(`
    SELECT DISTINCT TRIM(assignee) AS value FROM (
      SELECT
        CASE
          WHEN a.assigned_to IS NULL THEN 'Unassigned'
          WHEN a.assigned_type = 'employee' THEN (
            SELECT CONCAT(first_name, ' ', last_name, ' (', employee_code, ')') FROM employees WHERE id = a.assigned_to
          )
          WHEN a.assigned_type = 'user' THEN (
            SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to
          )
          WHEN a.assigned_type = 'location' THEN (
            SELECT name FROM locations WHERE id = a.assigned_to
          )
          WHEN a.assigned_type = 'asset' THEN (
            SELECT asset_tag FROM assets WHERE id = a.assigned_to
          )
          ELSE CONCAT('Assignee #', a.assigned_to)
        END AS assignee
      FROM assets a
      LEFT JOIN status_labels s ON s.id = a.status_id
      LEFT JOIN companies c ON c.id = a.company_id
      LEFT JOIN locations loc ON loc.id = COALESCE(a.location_id, a.rtd_location_id)
      LEFT JOIN models m ON m.id = a.model_id
      WHERE ${where}
    ) t
    WHERE assignee IS NOT NULL AND TRIM(assignee) <> ''
    ORDER BY
      CASE WHEN value = 'Unassigned' THEN 0 ELSE 1 END,
      value ASC
  `, params)

  return okItem(res, {
    statuses: statusRows.map((r) => String(r.value)).filter(Boolean),
    assignees: assigneeRows.map((r) => String(r.value)).filter(Boolean),
  })
})

router.get('/selectlist', async (req, res) => {
  const q = String(req.query.search || '').trim()
  let sql = `SELECT id, CONCAT(asset_tag, ' - ', COALESCE(name, '')) as text FROM assets WHERE deleted_at IS NULL`
  const params: unknown[] = []
  if (q) {
    sql += ' AND (asset_tag LIKE ? OR name LIKE ?)'
    params.push(`%${q}%`, `%${q}%`)
  }
  if (req.query.companyId) {
    sql += ' AND company_id = ?'
    params.push(Number(req.query.companyId))
  }
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  sql += domain.sql
  params.push(...domain.params)
  const results = await all(sql + ' ORDER BY id DESC LIMIT 50', params)
  return res.json({ results, pagination: { more: false } })
})

router.get('/bytag/:tag', async (req, res) => {
  const row = await loadItemDomain('assets', 'asset_tag = ? AND deleted_at IS NULL', [req.params.tag])
  if (!row) return fail(res, 'Asset not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  return okItem(res, await transformAsset(row.id))
})

router.get('/byserial/:serial', async (req, res) => {
  const row = await loadItemDomain('assets', 'serial = ? AND deleted_at IS NULL', [req.params.serial])
  if (!row) return fail(res, 'Asset not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  return okItem(res, await transformAsset(row.id))
})

router.get('/audit/due', async (req, res) => {
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain, '')
  const ids = await all<{ id: number }>(`
    SELECT id FROM assets
    WHERE deleted_at IS NULL AND next_audit_date IS NOT NULL
      AND DATE(next_audit_date) <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      ${domain.sql}
    ORDER BY next_audit_date ASC
  `, domain.params)
  const rows = (await Promise.all(ids.map((r) => transformAsset(r.id)))).filter(Boolean)
  return okList(res, rows)
})

router.get('/checkins/due', async (req, res) => {
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain, '')
  const ids = await all<{ id: number }>(`
    SELECT id FROM assets
    WHERE deleted_at IS NULL AND expected_checkin IS NOT NULL AND assigned_to IS NOT NULL
      ${domain.sql}
    ORDER BY expected_checkin ASC
  `, domain.params)
  const rows = (await Promise.all(ids.map((r) => transformAsset(r.id)))).filter(Boolean)
  return okList(res, rows)
})

router.get('/eol/due', async (req, res) => {
  const { listEolDueAssets } = await import('../services/eolAlerts.js')
  const rows = await listEolDueAssets({
    permissions: req.user?.permissions,
    domain: req.query.domain || req.query.domain_id,
  })
  return okList(res, rows)
})

/** Global ITAgent sync activity (session auth) — must be before /:id */
/** Preview next auto tag — must be before /:id */
router.get('/next-tag', async (req, res) => {
  try {
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null
    const companyId = req.query.company_id ? Number(req.query.company_id) : null
    const legalEntityId = req.query.legal_entity_id ? Number(req.query.legal_entity_id) : null
    const preview = await nextAssetTag({ companyId, legalEntityId, categoryId })
    return okItem(res, preview)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Could not preview asset tag')
  }
})

/** OCR / parse Purchase Order → purchase fields (must be before /:id) */
router.post('/parse-po', (req, res) => {
  parsePoUpload(req, res, async (err) => {
    if (err) return fail(res, err instanceof Error ? err.message : 'Upload failed')
    const file = req.file
    if (!file?.buffer?.length) return fail(res, 'PO file is required')
    try {
      // Lazy-load so pdfjs-dist never runs at server boot
      const { extractPoFromFile } = await import('../services/poExtract.js')
      const extracted = await extractPoFromFile({
        buffer: file.buffer,
        mime: file.mimetype,
        filename: file.originalname,
      })
      await logAction({
        userId: req.user?.id,
        actionType: 'parse_po',
        itemType: 'asset',
        itemId: 0,
        note: file.originalname,
        meta: {
          method: extracted.method,
          confidence: extracted.confidence,
          order_number: extracted.order_number,
        },
      })
      return okMessage(res, 'PO parsed', extracted)
    } catch (e) {
      return fail(res, e instanceof Error ? e.message : 'PO parse failed', 500)
    }
  })
})

router.get('/agent-sync-logs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500)
  const q = String(req.query.search || '').trim()
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  let sql = `
    SELECT l.*, a.asset_tag as linked_asset_tag
    FROM agent_sync_logs l
    LEFT JOIN assets a ON a.id = l.asset_id
    WHERE (l.asset_id IS NULL OR (a.id IS NOT NULL${domain.sql}))
  `
  const params: unknown[] = [...domain.params]
  if (q) {
    sql += ` AND (
      l.hostname LIKE ? OR l.serial_number LIKE ? OR l.asset_tag LIKE ?
      OR a.asset_tag LIKE ? OR l.message LIKE ? OR l.action LIKE ?
    )`
    const like = `%${q}%`
    params.push(like, like, like, like, like, like)
  }
  sql += ` ORDER BY l.id DESC LIMIT ${limit}`
  try {
    const rows = await all(sql, params)
    return okList(res, rows)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Failed to load agent sync logs', 500)
  }
})

router.get('/:id', async (req, res) => {
  const scoped = await requireAssetDomain(req, res, Number(req.params.id))
  if (!scoped) return
  const asset = await transformAsset(scoped.id)
  if (!asset) return fail(res, 'Asset not found', 404)
  return okItem(res, asset)
})

router.get('/:id/history', async (req, res) => {
  const scoped = await requireAssetDomain(req, res, Number(req.params.id))
  if (!scoped) return
  const rows = await all(`
    SELECT al.*, u.username as admin,
      CASE
        WHEN al.target_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = al.target_id)
        WHEN al.target_type = 'employee' THEN (
          SELECT TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) FROM employees WHERE id = al.target_id
        )
        WHEN al.target_type = 'location' THEN (SELECT name FROM locations WHERE id = al.target_id)
        WHEN al.target_type = 'asset' THEN (SELECT asset_tag FROM assets WHERE id = al.target_id)
        ELSE CAST(al.target_id AS CHAR)
      END as target_name
    FROM action_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.item_type = 'asset' AND al.item_id = ? AND al.deleted_at IS NULL
    ORDER BY al.action_date DESC, al.id DESC
  `, [req.params.id])
  return okList(res, rows)
})

/** ITAgent status for this asset (session auth) */
router.get('/:id/agent', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await requireAssetDomain(req, res, id))) return
  const { getAssetAgentStatus } = await import('../services/agentControl.js')
  return okItem(res, await getAssetAgentStatus(id))
})

/** Queue remote inventory scan — agent picks up on next heartbeat */
router.post('/:id/agent/scan', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await requireAssetDomain(req, res, id))) return
  const { enqueueScanCommand } = await import('../services/agentControl.js')
  const result = await enqueueScanCommand({
    assetId: id,
    requestedBy: req.user?.id || null,
    command: String((req.body || {}).command || 'scan') === 'rerun' ? 'rerun' : 'scan',
  })
  if (!result.ok) return fail(res, result.error, 404)
  return okMessage(res, result.message, result)
})

/** Agent snapshot history (session auth) */
router.get('/:id/agent/snapshots', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await requireAssetDomain(req, res, id))) return
  const limit = Math.min(Number(req.query.limit) || 20, 100)
  const rows = await all(`
    SELECT id, asset_id, serial_number, hostname, platform, matched_by, created_at, payload
    FROM asset_agent_snapshots WHERE asset_id = ?
    ORDER BY id DESC LIMIT ${limit}
  `, [id])
  return okList(res, rows)
})

function custodyReason(b: Record<string, unknown>): string | null {
  const raw = b.reason ?? b.note ?? b.notes
  if (raw == null) return null
  const s = String(raw).trim()
  return s || null
}

router.post('/', async (req, res) => {
  const b = req.body || {}
  if (!b.model_id || !b.status_id) {
    return fail(res, 'model_id and status_id are required')
  }
  if (!b.company_id && !b.legal_entity_id) {
    return fail(res, 'company_id (or legal_entity_id) is required to generate asset tag')
  }

  // Prefer explicit category; else take from model
  let categoryId = b.category_id ? Number(b.category_id) : null
  if (!categoryId) {
    const model = await get<{ category_id: number | null }>(
      `SELECT category_id FROM models WHERE id = ? AND deleted_at IS NULL`,
      [b.model_id],
    )
    categoryId = model?.category_id ? Number(model.category_id) : null
  }
  if (!categoryId) return fail(res, 'category_id (asset type) is required to generate asset tag')

  let domain
  try {
    domain = await resolveWriteDomainId(req.user?.permissions, b)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid domain'
    return fail(res, msg, /Forbidden/.test(msg) ? 403 : 400)
  }

  let assetTag: string
  try {
    assetTag = await allocateAssetTag({
      companyId: b.company_id ? Number(b.company_id) : null,
      legalEntityId: b.legal_entity_id ? Number(b.legal_entity_id) : null,
      categoryId,
    })
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Asset tag generation failed')
  }

  const oldTag = b.old_asset_tag != null && String(b.old_asset_tag).trim()
    ? String(b.old_asset_tag).trim()
    : null

  const ts = now()
  const mapLat = b.map_latitude != null && b.map_latitude !== '' ? Number(b.map_latitude) : null
  const mapLng = b.map_longitude != null && b.map_longitude !== '' ? Number(b.map_longitude) : null
  const mapAddr = b.map_address != null && String(b.map_address).trim()
    ? String(b.map_address).trim().slice(0, 500)
    : null

  const receivedCondition = b.received_condition != null && String(b.received_condition).trim()
    ? String(b.received_condition).trim()
    : null

  const hasAttrs = await tableHasColumn('assets', 'domain_attrs')
  const attrsJson = hasAttrs ? (parseDomainAttrs(b.domain_attrs) ? JSON.stringify(parseDomainAttrs(b.domain_attrs)) : null) : undefined
  const domainReady = await inventoryDomainColumnsReady()

  const info = await run(
    domainReady
      ? (hasAttrs
        ? `
    INSERT INTO assets (
      domain_id, asset_tag, old_asset_tag, name, serial, model_id, status_id, company_id, legal_entity_id, department_id, supplier_id,
      location_id, rtd_location_id, map_latitude, map_longitude, map_address,
      purchase_date, purchase_cost, order_number,
      warranty_months, asset_eol_date, notes, received_condition, domain_attrs, requestable, byod, next_audit_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
        : `
    INSERT INTO assets (
      domain_id, asset_tag, old_asset_tag, name, serial, model_id, status_id, company_id, legal_entity_id, department_id, supplier_id,
      location_id, rtd_location_id, map_latitude, map_longitude, map_address,
      purchase_date, purchase_cost, order_number,
      warranty_months, asset_eol_date, notes, received_condition, requestable, byod, next_audit_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
      : `
    INSERT INTO assets (
      asset_tag, old_asset_tag, name, serial, model_id, status_id, company_id, legal_entity_id, department_id, supplier_id,
      location_id, rtd_location_id, map_latitude, map_longitude, map_address,
      purchase_date, purchase_cost, order_number,
      warranty_months, asset_eol_date, notes, received_condition, requestable, byod, next_audit_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    domainReady
      ? (hasAttrs
        ? [
          domain.id, assetTag, oldTag, b.name || null, b.serial || null, b.model_id, b.status_id,
          b.company_id || null, b.legal_entity_id || null, b.department_id || null, b.supplier_id || null, b.location_id || b.rtd_location_id || null,
          b.rtd_location_id || null,
          Number.isFinite(mapLat as number) ? mapLat : null,
          Number.isFinite(mapLng as number) ? mapLng : null,
          mapAddr,
          b.purchase_date || null, b.purchase_cost || null,
          b.order_number || null, b.warranty_months || null, b.asset_eol_date || null, b.notes || null,
          receivedCondition, attrsJson,
          b.requestable ? 1 : 0, b.byod ? 1 : 0, b.next_audit_date || null, ts, ts,
        ]
        : [
          domain.id, assetTag, oldTag, b.name || null, b.serial || null, b.model_id, b.status_id,
          b.company_id || null, b.legal_entity_id || null, b.department_id || null, b.supplier_id || null, b.location_id || b.rtd_location_id || null,
          b.rtd_location_id || null,
          Number.isFinite(mapLat as number) ? mapLat : null,
          Number.isFinite(mapLng as number) ? mapLng : null,
          mapAddr,
          b.purchase_date || null, b.purchase_cost || null,
          b.order_number || null, b.warranty_months || null, b.asset_eol_date || null, b.notes || null,
          receivedCondition,
          b.requestable ? 1 : 0, b.byod ? 1 : 0, b.next_audit_date || null, ts, ts,
        ])
      : [
        assetTag, oldTag, b.name || null, b.serial || null, b.model_id, b.status_id,
        b.company_id || null, b.legal_entity_id || null, b.department_id || null, b.supplier_id || null, b.location_id || b.rtd_location_id || null,
        b.rtd_location_id || null,
        Number.isFinite(mapLat as number) ? mapLat : null,
        Number.isFinite(mapLng as number) ? mapLng : null,
        mapAddr,
        b.purchase_date || null, b.purchase_cost || null,
        b.order_number || null, b.warranty_months || null, b.asset_eol_date || null, b.notes || null,
        receivedCondition,
        b.requestable ? 1 : 0, b.byod ? 1 : 0, b.next_audit_date || null, ts, ts,
      ],
  )
  const id = Number(info.insertId)
  await logAction({ userId: req.user?.id, actionType: 'create', itemType: 'asset', itemId: id })
  notifyWorkflow({
    category: 'crud',
    event: 'asset.created',
    subject: `Asset created: ${assetTag}`,
    title: 'New asset created',
    intro: 'A new asset was added to the inventory.',
    fields: [
      { label: 'Asset tag', value: assetTag },
      { label: 'Old asset tag', value: oldTag || '—' },
      { label: 'Serial', value: String(b.serial || '—') },
      { label: 'Created by', value: actorLabel(req.user) },
    ],
    ctaPath: `/hardware/${id}`,
    itemType: 'asset',
    itemId: id,
  })
  return okMessage(res, 'Asset created successfully', await transformAsset(id), 201)
})

router.put('/:id', (req, res) => updateAsset(req, res))
router.patch('/:id', (req, res) => updateAsset(req, res))

async function updateAsset(req: import('express').Request, res: import('express').Response) {
  const id = Number(req.params.id)
  const scoped = await requireAssetDomain(req, res, id)
  if (!scoped) return
  const b = req.body || {}
  if (b.domain_id !== undefined || b.domain !== undefined || b.domain_code !== undefined) {
    try {
      const domain = await resolveWriteDomainId(req.user?.permissions, b)
      b.domain_id = domain.id
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid domain'
      return fail(res, msg, /Forbidden/.test(msg) ? 403 : 400)
    }
  }
  // asset_tag is system-generated and never editable after create
  const fields = [
    'name', 'serial', 'model_id', 'status_id', 'company_id', 'legal_entity_id', 'department_id', 'supplier_id',
    'location_id', 'rtd_location_id', 'map_latitude', 'map_longitude', 'map_address',
    'purchase_date', 'purchase_cost',
    'order_number', 'warranty_months', 'asset_eol_date', 'notes', 'received_condition', 'requestable', 'byod',
    'old_asset_tag', 'expected_checkin', 'next_audit_date',
    ...((await inventoryDomainColumnsReady()) ? (['domain_id'] as const) : []),
    ...((await tableHasColumn('assets', 'domain_attrs')) ? (['domain_attrs'] as const) : []),
  ] as const
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] !== undefined) {
      sets.push(`${f} = ?`)
      let v: unknown = b[f]
      if (typeof v === 'boolean') v = v ? 1 : 0
      if (f === 'domain_attrs') {
        const parsed = parseDomainAttrs(v)
        v = parsed ? JSON.stringify(parsed) : null
      }
      if ((f === 'map_latitude' || f === 'map_longitude') && (v === '' || v === null)) v = null
      else if ((f === 'map_latitude' || f === 'map_longitude') && v != null) {
        const n = Number(v)
        v = Number.isFinite(n) ? n : null
      }
      if (f === 'map_address' && v != null) {
        const s = String(v).trim()
        v = s ? s.slice(0, 500) : null
      }
      vals.push(v)
    }
  }
  if (!sets.length) return fail(res, 'No valid fields')
  vals.push(now(), id)
  await run(`UPDATE assets SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, vals)
  await logAction({ userId: req.user?.id, actionType: 'update', itemType: 'asset', itemId: id })
  return okMessage(res, 'Asset updated successfully', await transformAsset(id))
}

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const scoped = await requireAssetDomain(req, res, id)
  if (!scoped) return
  const existing = await transformAsset(id)
  if (!existing) return fail(res, 'Asset not found', 404)
  await run(`UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
  await logAction({ userId: req.user?.id, actionType: 'delete', itemType: 'asset', itemId: id })
  notifyWorkflow({
    category: 'crud',
    event: 'asset.deleted',
    subject: `Asset deleted: ${existing.asset_tag}`,
    title: 'Asset deleted',
    intro: 'An asset was removed from active inventory.',
    fields: [
      { label: 'Asset tag', value: String(existing.asset_tag || id) },
      { label: 'Deleted by', value: actorLabel(req.user) },
    ],
    ctaPath: '/hardware',
    itemType: 'asset',
    itemId: id,
  })
  return okMessage(res, 'Asset deleted successfully')
})

router.post('/:id/checkout', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await requireAssetDomain(req, res, id))) return
  const asset = await get<Record<string, unknown>>(`SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!asset) return fail(res, 'Asset not found', 404)
  if (asset.assigned_to) {
    return fail(res, 'Asset is already assigned. Unassign it before assigning to someone else.', 409)
  }
  const statusRow = await get<{ type?: string }>(
    `SELECT type FROM status_labels WHERE id = ?`,
    [asset.status_id],
  )
  if (statusRow && statusRow.type !== 'deployable') {
    return fail(res, 'Only in-stock (ready to assign) assets can be assigned', 422)
  }
  const b = req.body || {}
  const reason = custodyReason(b)
  const checkoutToType = b.checkout_to_type || b.assigned_type || 'user'
  const assignedTo = Number(
    b.assigned_employee || b.assigned_user || b.assigned_location || b.assigned_asset || b.assigned_to,
  )
  if (!assignedTo) return fail(res, 'Assign target is required')
  if (checkoutToType === 'employee') {
    const emp = await get(`SELECT id FROM employees WHERE id = ? AND deleted_at IS NULL`, [assignedTo])
    if (!emp) return fail(res, 'Employee not found', 404)
  }

  const statusId = b.status_id || asset.status_id
  const ts = now()
  await run(`
    UPDATE assets SET
      assigned_to = ?, assigned_type = ?, status_id = ?,
      expected_checkin = ?, last_checkout = ?,
      location_id = CASE WHEN ? = 'location' THEN ? ELSE location_id END,
      checkout_counter = checkout_counter + 1, updated_at = ?
    WHERE id = ?
  `, [
    assignedTo, checkoutToType, statusId,
    b.expected_checkin || null, ts,
    checkoutToType, checkoutToType === 'location' ? assignedTo : null,
    ts, id,
  ])

  await logAction({
    userId: req.user?.id,
    actionType: 'checkout',
    itemType: 'asset',
    itemId: id,
    targetType: checkoutToType,
    targetId: assignedTo,
    note: reason,
  })

  if (checkoutToType === 'user') {
    const needs = await get<{ require_acceptance: number }>(`
      SELECT c.require_acceptance FROM assets a
      JOIN models m ON m.id = a.model_id
      JOIN categories c ON c.id = m.category_id
      WHERE a.id = ?
    `, [id])
    if (needs?.require_acceptance) {
      await run(`
        INSERT INTO checkout_acceptances (checkoutable_id, checkoutable_type, assigned_to, created_at, updated_at)
        VALUES (?, 'asset', ?, ?, ?)
      `, [id, assignedTo, ts, ts])
    }
  }

  const assigneeEmail = await resolveAssigneeEmail(checkoutToType, assignedTo)
  const targetName = checkoutToType === 'employee'
    ? (await get<{ n: string }>(`SELECT CONCAT(first_name,' ',last_name,' (',employee_code,')') as n FROM employees WHERE id = ?`, [assignedTo]))?.n
    : checkoutToType === 'user'
      ? (await get<{ n: string }>(`SELECT CONCAT(first_name,' ',last_name) as n FROM users WHERE id = ?`, [assignedTo]))?.n
      : String(assignedTo)
  notifyWorkflow({
    category: 'custody',
    event: 'asset.assigned',
    subject: `Asset assigned: ${asset.asset_tag}`,
    title: 'Asset assigned',
    intro: 'An asset has been assigned to a user/employee.',
    fields: [
      { label: 'Asset tag', value: String(asset.asset_tag || id) },
      { label: 'Assigned to', value: String(targetName || assignedTo) },
      { label: 'Reason', value: reason || '—' },
      { label: 'Assigned by', value: actorLabel(req.user) },
    ],
    ctaPath: `/hardware/${id}`,
    itemType: 'asset',
    itemId: id,
    assigneeEmail,
    assigneeOnlyExtraNote: 'An IT asset has been assigned to you. Please take care of it and report issues promptly.',
  })

  return okMessage(res, 'Asset assigned successfully', await transformAsset(id))
})

router.post('/:id/checkin', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await requireAssetDomain(req, res, id))) return
  const asset = await get<Record<string, unknown>>(`SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!asset) return fail(res, 'Asset not found', 404)
  if (!asset.assigned_to) return fail(res, 'Asset is not assigned')

  const b = req.body || {}
  const reason = custodyReason(b)
  if (!reason) return fail(res, 'Reason is required to unassign')

  const prevTarget = Number(asset.assigned_to)
  const prevType = String(asset.assigned_type)
  const statusId = b.status_id || asset.status_id
  const locationId = b.location_id || asset.rtd_location_id || asset.location_id
  const ts = now()

  await run(`
    UPDATE assets SET
      assigned_to = NULL, assigned_type = NULL, status_id = ?,
      location_id = ?, expected_checkin = NULL, last_checkin = ?,
      checkin_counter = checkin_counter + 1, updated_at = ?
    WHERE id = ?
  `, [statusId, locationId, ts, ts, id])

  if (b.checkin_licenses !== false) {
    await run(`UPDATE license_seats SET asset_id = NULL, updated_at = ? WHERE asset_id = ?`, [ts, id])
  }

  await logAction({
    userId: req.user?.id,
    actionType: 'checkin',
    itemType: 'asset',
    itemId: id,
    targetType: prevType,
    targetId: prevTarget,
    locationId: locationId ? Number(locationId) : null,
    note: reason,
  })

  const prevEmail = await resolveAssigneeEmail(prevType, prevTarget)
  notifyWorkflow({
    category: 'custody',
    event: 'asset.unassigned',
    subject: `Asset unassigned: ${asset.asset_tag}`,
    title: 'Asset unassigned',
    intro: 'An asset has been returned to stock (unassigned).',
    fields: [
      { label: 'Asset tag', value: String(asset.asset_tag || id) },
      { label: 'Previous assignee id', value: String(prevTarget) },
      { label: 'Reason', value: reason },
      { label: 'Unassigned by', value: actorLabel(req.user) },
    ],
    ctaPath: `/hardware/${id}`,
    itemType: 'asset',
    itemId: id,
    assigneeEmail: prevEmail,
    assigneeOnlyExtraNote: 'An IT asset previously assigned to you has been unassigned / returned.',
  })

  return okMessage(res, 'Asset unassigned successfully', await transformAsset(id))
})

/** Replace assigned asset with another (checkin old + checkout new) for the same employee. */
router.post('/:id/replace', async (req, res) => {
  const oldId = Number(req.params.id)
  const b = req.body || {}
  const newId = Number(b.new_asset_id)
  const reason = custodyReason(b)
  if (!newId) return fail(res, 'new_asset_id is required')
  if (!reason) return fail(res, 'Reason is required to replace an asset')
  if (newId === oldId) return fail(res, 'Replacement asset must be different')
  if (!(await requireAssetDomain(req, res, oldId))) return
  if (!(await requireAssetDomain(req, res, newId))) return

  const oldAsset = await get<Record<string, unknown>>(`SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL`, [oldId])
  if (!oldAsset) return fail(res, 'Current asset not found', 404)
  if (!oldAsset.assigned_to || String(oldAsset.assigned_type) !== 'employee') {
    return fail(res, 'Current asset must be assigned to an employee')
  }
  const employeeId = Number(oldAsset.assigned_to)

  const newAsset = await get<Record<string, unknown>>(`SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL`, [newId])
  if (!newAsset) return fail(res, 'Replacement asset not found', 404)
  if (newAsset.assigned_to) return fail(res, 'Replacement asset is already assigned')

  const deployable = await get<{ type: string }>(`
    SELECT type FROM status_labels WHERE id = ?
  `, [newAsset.status_id])
  if (deployable && String(deployable.type) !== 'deployable') {
    return fail(res, 'Replacement asset must be in a deployable (In Stock) status')
  }

  const ts = now()
  const locationId = oldAsset.rtd_location_id || oldAsset.location_id || newAsset.location_id
  const statusId = oldAsset.status_id

  const { withTransaction } = await import('../db/index.js')
  await withTransaction(async (conn) => {
    await conn.query(`
      UPDATE assets SET
        assigned_to = NULL, assigned_type = NULL, status_id = ?,
        location_id = COALESCE(?, location_id), expected_checkin = NULL, last_checkin = ?,
        checkin_counter = checkin_counter + 1, updated_at = ?
      WHERE id = ?
    `, [statusId, locationId, ts, ts, oldId])

    await conn.query(`
      UPDATE license_seats SET asset_id = NULL, updated_at = ? WHERE asset_id = ?
    `, [ts, oldId])

    await conn.query(`
      INSERT INTO action_logs (
        user_id, action_type, target_id, target_type, item_id, item_type,
        location_id, note, log_meta, action_date, created_at, updated_at
      ) VALUES (?, 'replace_out', ?, 'employee', ?, 'asset', ?, ?, ?, ?, ?, ?)
    `, [
      req.user?.id ?? null, employeeId, oldId,
      locationId ? Number(locationId) : null, reason,
      JSON.stringify({ new_asset_id: newId }),
      ts, ts, ts,
    ])

    await conn.query(`
      UPDATE assets SET
        assigned_to = ?, assigned_type = 'employee', last_checkout = ?,
        checkout_counter = checkout_counter + 1, updated_at = ?
      WHERE id = ?
    `, [employeeId, ts, ts, newId])

    await conn.query(`
      INSERT INTO action_logs (
        user_id, action_type, target_id, target_type, item_id, item_type,
        location_id, note, log_meta, action_date, created_at, updated_at
      ) VALUES (?, 'replace_in', ?, 'employee', ?, 'asset', NULL, ?, ?, ?, ?, ?)
    `, [
      req.user?.id ?? null, employeeId, newId, reason,
      JSON.stringify({ old_asset_id: oldId }),
      ts, ts, ts,
    ])
  })

  const empEmail = await resolveAssigneeEmail('employee', employeeId)
  notifyWorkflow({
    category: 'custody',
    event: 'asset.replaced',
    subject: `Asset replaced for employee #${employeeId}`,
    title: 'Asset replaced',
    intro: 'An assigned asset was replaced with another asset for the same employee.',
    fields: [
      { label: 'Previous asset', value: String(oldAsset.asset_tag || oldId) },
      { label: 'New asset', value: String(newAsset.asset_tag || newId) },
      { label: 'Employee id', value: String(employeeId) },
      { label: 'Reason', value: reason },
      { label: 'Replaced by', value: actorLabel(req.user) },
    ],
    ctaPath: `/hardware/${newId}`,
    itemType: 'asset',
    itemId: newId,
    assigneeEmail: empEmail,
    assigneeOnlyExtraNote: 'Your assigned asset was replaced. Please collect / use the new asset listed below.',
  })

  return okMessage(res, 'Asset replaced successfully', {
    previous: await transformAsset(oldId),
    current: await transformAsset(newId),
  })
})

router.post('/:id/audit', async (req, res) => {
  const id = Number(req.params.id)
  const scoped = await requireAssetDomain(req, res, id)
  if (!scoped) return
  if (!(await transformAsset(id))) return fail(res, 'Asset not found', 404)
  const b = req.body || {}
  const ts = now()
  await run(`
    UPDATE assets SET
      last_audit_date = ?, next_audit_date = COALESCE(?, next_audit_date),
      location_id = COALESCE(?, location_id), updated_at = ?
    WHERE id = ?
  `, [ts, b.next_audit_date || null, b.location_id || null, ts, id])

  await logAction({
    userId: req.user?.id,
    actionType: 'audit',
    itemType: 'asset',
    itemId: id,
    locationId: b.location_id ? Number(b.location_id) : null,
    note: b.note || b.notes || null,
  })
  return okMessage(res, 'Asset audited successfully', await transformAsset(id))
})

router.post('/audit', async (req, res) => {
  const tag = req.body?.asset_tag
  if (!tag) return fail(res, 'asset_tag required')
  const row = await loadItemDomain('assets', 'asset_tag = ? AND deleted_at IS NULL', [tag])
  if (!row) return fail(res, 'Asset not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  const b = req.body || {}
  const ts = now()
  await run(`
    UPDATE assets SET last_audit_date = ?, next_audit_date = COALESCE(?, next_audit_date),
      location_id = COALESCE(?, location_id), updated_at = ?
    WHERE id = ?
  `, [ts, b.next_audit_date || null, b.location_id || null, ts, row.id])
  await logAction({ userId: req.user?.id, actionType: 'audit', itemType: 'asset', itemId: row.id, note: b.note || null })
  return okMessage(res, 'Asset audited successfully', await transformAsset(row.id))
})

router.post('/checkinbytag', async (req, res) => {
  const tag = req.body?.asset_tag
  if (!tag) return fail(res, 'asset_tag required')
  const row = await loadItemDomain('assets', 'asset_tag = ? AND deleted_at IS NULL', [tag])
  if (!row) return fail(res, 'Asset not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  const asset = await get<Record<string, unknown>>(`SELECT * FROM assets WHERE id = ?`, [row.id])
  if (!asset?.assigned_to) return fail(res, 'Asset is not assigned')
  const b = req.body || {}
  const reason = custodyReason(b) || 'Quickscan unassign'
  const prevTarget = Number(asset.assigned_to)
  const prevType = String(asset.assigned_type || '')
  const ts = now()
  await run(`
    UPDATE assets SET assigned_to = NULL, assigned_type = NULL, last_checkin = ?,
      location_id = COALESCE(?, location_id), checkin_counter = checkin_counter + 1, updated_at = ?
    WHERE id = ?
  `, [ts, b.location_id || asset.rtd_location_id, ts, row.id])
  await logAction({
    userId: req.user?.id,
    actionType: 'checkin',
    itemType: 'asset',
    itemId: row.id,
    targetType: prevType || null,
    targetId: prevTarget || null,
    note: reason,
  })
  return okMessage(res, 'Asset unassigned successfully', await transformAsset(row.id))
})

router.post('/:id/restore', async (req, res) => {
  const row = await loadItemDomain('assets', 'id = ?', [Number(req.params.id)])
  if (!row) return fail(res, 'Asset not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  await run(`UPDATE assets SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [now(), req.params.id])
  await logAction({ userId: req.user?.id, actionType: 'restore', itemType: 'asset', itemId: Number(req.params.id) })
  return okMessage(res, 'Asset restored', await transformAsset(Number(req.params.id)))
})

export default router
