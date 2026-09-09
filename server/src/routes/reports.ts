import { Router } from 'express'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import path from 'node:path'
import { all, get, run, now, limitSql } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { logAction } from '../services/actionLog.js'
import { transformAsset } from '../services/transformers.js'
import { recordUpload, storageRoot } from '../services/uploads.js'
import { actorLabel, notifyWorkflow, resolveAssigneeEmail } from '../services/notify.js'
import { actionLogDomainSql, assertRecordDomainAccess, inventoryDomainClause, loadItemDomain } from '../services/domainAuth.js'
import { ASSET_AGE_DATE_SQL } from '../utils/period.js'
import { ACTIVE_EMPLOYEE_SQL } from '../services/employeeStatus.js'

export const reportsRouter = Router()

reportsRouter.get('/activity', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500)
  const action = String(req.query.action_type || '')
  const itemType = String(req.query.item_type || '')
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  const params: unknown[] = []
  let where = 'WHERE al.deleted_at IS NULL'
  if (action) { where += ' AND al.action_type = ?'; params.push(action) }
  if (itemType) { where += ' AND al.item_type = ?'; params.push(itemType) }
  if (from) { where += ' AND DATE(al.action_date) >= ?'; params.push(from) }
  if (to) { where += ' AND DATE(al.action_date) <= ?'; params.push(to) }

  const domain = await actionLogDomainSql(req.user?.permissions, req.query.domain || req.query.domain_id, 'al')
  where += domain.sql
  params.push(...domain.params)

  const rows = await all(`
    SELECT al.*, u.username as admin,
      CASE
        WHEN al.item_type = 'asset' THEN (SELECT CONCAT(asset_tag, ' ', COALESCE(name,'')) FROM assets WHERE id = al.item_id)
        WHEN al.item_type = 'license' THEN (SELECT name FROM licenses WHERE id = al.item_id)
        WHEN al.item_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = al.item_id)
        ELSE CONCAT(COALESCE(al.item_type,''), '#', COALESCE(al.item_id,''))
      END as item_name,
      CASE
        WHEN al.target_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = al.target_id)
        WHEN al.target_type = 'employee' THEN (
          SELECT TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) FROM employees WHERE id = al.target_id
        )
        WHEN al.target_type = 'location' THEN (SELECT name FROM locations WHERE id = al.target_id)
        ELSE NULL
      END as target_name
    FROM action_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ${where}
    ORDER BY al.action_date DESC, al.id DESC
    ${limitSql(limit, 0)}
  `, params)
  return okList(res, rows)
})

reportsRouter.get('/hub', async (req, res) => {
  const count = async (sql: string, params: unknown[] = []) => Number((await get<{ c: number }>(sql, params))?.c || 0)
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const domainA = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const { countEolDue } = await import('../services/eolAlerts.js')
  return okItem(res, {
    audit_due: await count(`SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL AND next_audit_date IS NOT NULL AND DATE(next_audit_date) <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)${domain.sql}`, domain.params),
    checkin_due: await count(`SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL AND expected_checkin IS NOT NULL AND assigned_to IS NOT NULL${domain.sql}`, domain.params),
    eol_due: await countEolDue({ permissions: req.user?.permissions, domain: req.query.domain || req.query.domain_id }),
    pending_acceptance: await count(`
      SELECT COUNT(*) as c FROM checkout_acceptances ca
      JOIN assets a ON a.id = ca.checkoutable_id AND ca.checkoutable_type = 'asset'
      WHERE ca.accepted_at IS NULL AND ca.declined_at IS NULL AND ca.deleted_at IS NULL
        ${domainA.sql}
    `, domainA.params),
    licenses_exhausted: await count(`
      SELECT COUNT(*) as c FROM licenses l
      WHERE l.deleted_at IS NULL${domain.sql} AND (
        SELECT COUNT(*) FROM license_seats WHERE license_id=l.id AND (assigned_to IS NOT NULL OR asset_id IS NOT NULL)
      ) >= l.seats
    `, domain.params),
  })
})


reportsRouter.get('/audit', async (req, res) => {
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const ids = await all<{ id: number }>(`
    SELECT id FROM assets WHERE deleted_at IS NULL AND next_audit_date IS NOT NULL
      ${domain.sql}
    ORDER BY next_audit_date ASC
  `, domain.params)
  const rows = (await Promise.all(ids.map((r) => transformAsset(r.id)))).filter(Boolean)
  return okList(res, rows)
})

reportsRouter.get('/depreciation', async (req, res) => {
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const rows = await all(`
    SELECT a.id, a.asset_tag, a.name, a.purchase_cost, a.purchase_date,
      d.months as depreciation_months,
      ROUND(a.purchase_cost * GREATEST(0, 1 - (DATEDIFF(CURDATE(), a.purchase_date) / (d.months * 30.44))), 2) as book_value
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    LEFT JOIN depreciations d ON d.id = m.depreciation_id
    WHERE a.deleted_at IS NULL AND a.purchase_cost IS NOT NULL
      ${domain.sql}
  `, domain.params)
  return okList(res, rows)
})

reportsRouter.get('/licenses', async (req, res) => {
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'l')
  const rows = (await all<Record<string, unknown>>(`
    SELECT l.id, l.name, l.seats,
      (SELECT COUNT(*) FROM license_seats WHERE license_id = l.id AND (assigned_to IS NOT NULL OR asset_id IS NOT NULL)) as used,
      l.expiration_date, l.purchase_cost
    FROM licenses l WHERE l.deleted_at IS NULL${domain.sql}
  `, domain.params)).map((r) => ({
    ...r,
    remaining: Number(r.seats) - Number(r.used),
    used_percent: Math.round((Number(r.used) / Number(r.seats)) * 100),
  }))
  return okList(res, rows)
})

reportsRouter.get('/maintenances', async (req, res) => {
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const rows = await all(`
    SELECT m.*, a.asset_tag, s.name as supplier_name
    FROM maintenances m
    LEFT JOIN assets a ON a.id = m.asset_id
    LEFT JOIN suppliers s ON s.id = m.supplier_id
    WHERE m.deleted_at IS NULL
      ${domain.sql}
    ORDER BY m.start_date DESC
  `, domain.params)
  return okList(res, rows)
})

reportsRouter.get('/unaccepted', async (req, res) => {
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const rows = await all(`
    SELECT ca.*, a.asset_tag, a.name as asset_name,
      CONCAT(u.first_name, ' ', u.last_name) as user_name
    FROM checkout_acceptances ca
    JOIN assets a ON a.id = ca.checkoutable_id AND ca.checkoutable_type = 'asset'
    JOIN users u ON u.id = ca.assigned_to
    WHERE ca.accepted_at IS NULL AND ca.declined_at IS NULL AND ca.deleted_at IS NULL
      ${domain.sql}
  `, domain.params)
  return okList(res, rows)
})

reportsRouter.get('/accessories', async (req, res) => {
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const rows = (await all<Record<string, unknown>>(`
    SELECT a.id, a.name, a.qty,
      COALESCE((SELECT SUM(assigned_qty) FROM accessories_checkout WHERE accessory_id = a.id), 0) as checked_out,
      a.min_amt
    FROM accessories a WHERE a.deleted_at IS NULL${domain.sql}
  `, domain.params)).map((r) => ({
    ...r,
    remaining: Number(r.qty) - Number(r.checked_out),
  }))
  return okList(res, rows)
})

reportsRouter.get('/custom', async (req, res) => {
  const q = req.query
  const wanted = new Set(
    String(q.fields || 'asset_tag,name,serial,model,status,assigned_to,location,company,purchase_cost,purchase_date,notes')
      .split(',').map((f) => f.trim()).filter(Boolean),
  )

  const selectParts: string[] = ['a.id']
  if (wanted.has('asset_tag') || wanted.has('id')) selectParts.push('a.asset_tag')
  if (wanted.has('asset_name') || wanted.has('name')) selectParts.push('a.name as asset_name')
  if (wanted.has('serial')) selectParts.push('a.serial')
  if (wanted.has('model')) selectParts.push('m.name as model')
  if (wanted.has('model_number')) selectParts.push('m.model_number')
  if (wanted.has('category')) selectParts.push('cat.name as category')
  if (wanted.has('manufacturer')) selectParts.push('mf.name as manufacturer')
  if (wanted.has('status')) selectParts.push('s.name as status')
  if (wanted.has('company')) selectParts.push('co.name as company')
  if (wanted.has('supplier')) selectParts.push('sup.name as supplier')
  if (wanted.has('location')) selectParts.push('loc.name as location')
  if (wanted.has('rtd_location')) selectParts.push('rtd.name as rtd_location')
  if (wanted.has('purchase_date')) selectParts.push('a.purchase_date')
  if (wanted.has('purchase_cost')) selectParts.push('a.purchase_cost')
  if (wanted.has('order') || wanted.has('order_number')) selectParts.push('a.order_number')
  if (wanted.has('notes')) selectParts.push('a.notes')
  if (wanted.has('warranty')) selectParts.push('a.warranty_months')
  if (wanted.has('expected_checkin')) selectParts.push('a.expected_checkin')
  if (wanted.has('last_audit_date')) selectParts.push('a.last_audit_date')
  if (wanted.has('next_audit_date')) selectParts.push('a.next_audit_date')
  if (wanted.has('checkout_date')) selectParts.push('a.last_checkout as checkout_date')
  if (wanted.has('checkin_date')) selectParts.push('a.last_checkin as checkin_date')
  if (wanted.has('created_at')) selectParts.push('a.created_at')
  if (wanted.has('updated_at')) selectParts.push('a.updated_at')
  if (wanted.has('assigned_to') || wanted.has('username') || wanted.has('email') || wanted.has('employee_num')) {
    selectParts.push(`CASE
      WHEN a.assigned_type='user' THEN (SELECT CONCAT(first_name,' ',last_name) FROM users WHERE id=a.assigned_to)
      WHEN a.assigned_type='employee' THEN (SELECT CONCAT(first_name,' ',last_name,' (',employee_code,')') FROM employees WHERE id=a.assigned_to)
      WHEN a.assigned_type='location' THEN (SELECT name FROM locations WHERE id=a.assigned_to)
      WHEN a.assigned_type='asset' THEN (SELECT asset_tag FROM assets WHERE id=a.assigned_to)
      ELSE NULL END as assigned_to`)
    selectParts.push(`CASE WHEN a.assigned_type='user' THEN (SELECT username FROM users WHERE id=a.assigned_to) END as username`)
    selectParts.push(`CASE WHEN a.assigned_type='user' THEN (SELECT email FROM users WHERE id=a.assigned_to) END as email`)
    selectParts.push(`CASE WHEN a.assigned_type='user' THEN (SELECT employee_num FROM users WHERE id=a.assigned_to) END as employee_num`)
  }

  const where: string[] = []
  const params: unknown[] = []
  const deletedMode = String(q.deleted_assets || 'exclude')
  if (deletedMode === 'only_deleted') where.push('a.deleted_at IS NOT NULL')
  else if (deletedMode !== 'include_deleted') where.push('a.deleted_at IS NULL')

  if (q.exclude_archived === '1' || q.exclude_archived === 'true') {
    where.push(`(s.type IS NULL OR s.type <> 'archived')`)
  }
  if (q.assignment_status === 'assigned') where.push('a.assigned_to IS NOT NULL')
  if (q.assignment_status === 'unassigned') where.push('a.assigned_to IS NULL')

  const addIn = (col: string, raw: unknown) => {
    const vals = Array.isArray(raw) ? raw : raw ? String(raw).split(',') : []
    const ids = vals.map(Number).filter((n) => n > 0)
    if (ids.length) {
      where.push(`${col} IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
  }
  addIn('a.location_id', q.by_location_id)
  addIn('a.rtd_location_id', q.by_rtd_location_id)
  addIn('a.company_id', q.by_company_id)
  addIn('a.model_id', q.by_model_id)
  addIn('a.status_id', q.by_status_id)
  addIn('a.supplier_id', q.by_supplier_id)
  addIn('m.category_id', q.by_category_id)
  addIn('m.manufacturer_id', q.by_manufacturer_id)

  if (q.by_order_number) {
    where.push('a.order_number = ?')
    params.push(q.by_order_number)
  }

  const addDateRange = (col: string, fromKey: string, toKey: string) => {
    if (q[fromKey]) { where.push(`DATE(${col}) >= ?`); params.push(q[fromKey]) }
    if (q[toKey]) { where.push(`DATE(${col}) <= ?`); params.push(q[toKey]) }
  }
  addDateRange('a.purchase_date', 'purchase_from', 'purchase_to')
  addDateRange('a.created_at', 'created_from', 'created_to')
  addDateRange('a.last_checkout', 'checkout_from', 'checkout_to')
  addDateRange('a.last_checkin', 'checkin_from', 'checkin_to')
  addDateRange('a.expected_checkin', 'expected_checkin_from', 'expected_checkin_to')
  addDateRange('a.next_audit_date', 'next_audit_from', 'next_audit_to')
  addDateRange('a.last_audit_date', 'last_audit_from', 'last_audit_to')

  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, q.domain || q.domain_id, 'a')
  if (domain.sql) {
    where.push(domain.sql.replace(/^\s*AND\s+/i, ''))
    params.push(...domain.params)
  }

  const sql = `
    SELECT ${selectParts.join(', ')}
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    LEFT JOIN categories cat ON cat.id = m.category_id
    LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
    LEFT JOIN status_labels s ON s.id = a.status_id
    LEFT JOIN companies co ON co.id = a.company_id
    LEFT JOIN suppliers sup ON sup.id = a.supplier_id
    LEFT JOIN locations loc ON loc.id = a.location_id
    LEFT JOIN locations rtd ON rtd.id = a.rtd_location_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.id DESC
    ${limitSql(Number(q.limit) || 500, Number(q.offset) || 0)}
  `
  const rows = await all(sql, params)
  return okList(res, rows)
})

reportsRouter.get('/custom/export', async (req, res) => {
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const rows = await all(`
    SELECT a.asset_tag, a.name, a.serial, m.name as model, s.name as status, a.purchase_cost, a.purchase_date,
      loc.name as location, co.name as company
    FROM assets a
    LEFT JOIN models m ON m.id=a.model_id
    LEFT JOIN status_labels s ON s.id=a.status_id
    LEFT JOIN locations loc ON loc.id=a.location_id
    LEFT JOIN companies co ON co.id=a.company_id
    WHERE a.deleted_at IS NULL
      ${domain.sql}
    ORDER BY a.id
  `, domain.params)
  const headers = rows.length ? Object.keys(rows[0] as object) : ['asset_tag']
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const v = String((r as Record<string, unknown>)[h] ?? '')
      return `"${v.replace(/"/g, '""')}"`
    }).join(','))
  }
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="custom-asset-report.csv"')
  return res.send(lines.join('\n'))
})


export const maintenancesRouter = Router()

const MAINTENANCE_TYPES = new Set([
  'Maintenance',
  'Repair',
  'Upgrade',
  'Software Support',
  'Hardware Support',
])

async function requireMaintenanceAssetDomain(
  req: import('express').Request,
  res: import('express').Response,
  maintenanceId: number | string,
) {
  const m = await get<{ id: number; asset_id: number }>(
    `SELECT id, asset_id FROM maintenances WHERE id = ? AND deleted_at IS NULL`,
    [maintenanceId],
  )
  if (!m) {
    fail(res, 'Maintenance not found', 404)
    return null
  }
  const asset = await loadItemDomain('assets', 'id = ? AND deleted_at IS NULL', [m.asset_id])
  if (!asset) {
    fail(res, 'Maintenance not found', 404)
    return null
  }
  if (!(await assertRecordDomainAccess(req, res, asset.domain_id))) return null
  return m
}

maintenancesRouter.get('/', async (req, res) => {
  const assetId = req.query.asset_id ? Number(req.query.asset_id) : null
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const rows = await all(`
    SELECT m.*, a.asset_tag, a.name as asset_name, s.name as supplier_name
    FROM maintenances m
    LEFT JOIN assets a ON a.id = m.asset_id
    LEFT JOIN suppliers s ON s.id = m.supplier_id
    WHERE m.deleted_at IS NULL
      ${assetId ? 'AND m.asset_id = ?' : ''}
      ${domain.sql}
    ORDER BY m.id DESC
  `, assetId ? [assetId, ...domain.params] : domain.params)
  return okList(res, rows)
})

maintenancesRouter.get('/:id', async (req, res) => {
  const scoped = await requireMaintenanceAssetDomain(req, res, req.params.id)
  if (!scoped) return
  const row = await get(`
    SELECT m.*, a.asset_tag, a.name as asset_name, s.name as supplier_name
    FROM maintenances m
    LEFT JOIN assets a ON a.id = m.asset_id
    LEFT JOIN suppliers s ON s.id = m.supplier_id
    WHERE m.id = ? AND m.deleted_at IS NULL
  `, [req.params.id])
  if (!row) return fail(res, 'Maintenance not found', 404)
  return okItem(res, row)
})

maintenancesRouter.post('/', async (req, res) => {
  const b = req.body || {}
  if (!b.asset_id || !b.title) return fail(res, 'asset_id and title required')
  const parent = await loadItemDomain('assets', 'id = ? AND deleted_at IS NULL', [Number(b.asset_id)])
  if (!parent) return fail(res, 'Asset not found', 404)
  if (!(await assertRecordDomainAccess(req, res, parent.domain_id))) return
  const reason = String(b.note || '').trim()
  if (!reason) return fail(res, 'Reason / description is required')
  const type = String(b.asset_maintenance_type || 'Maintenance')
  if (!MAINTENANCE_TYPES.has(type)) return fail(res, 'Invalid maintenance type')
  const ts = now()
  const info = await run(`
    INSERT INTO maintenances (asset_id, supplier_id, asset_maintenance_type, title, start_date, completion_date, note, cost, is_warranty, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    b.asset_id, b.supplier_id || null, type, b.title,
    b.start_date || ts.slice(0, 10), b.completion_date || null, reason, b.cost || 0,
    b.is_warranty ? 1 : 0, req.user?.id || null, ts, ts,
  ])
  const maintenanceId = Number(info.insertId)
  await logAction({
    userId: req.user?.id,
    actionType: 'maintenance',
    itemType: 'asset',
    itemId: Number(b.asset_id),
    note: `${type}: ${String(b.title)} — ${reason}`,
    meta: { maintenance_id: maintenanceId, asset_maintenance_type: type, title: b.title },
  })
  await logAction({ userId: req.user?.id, actionType: 'create', itemType: 'maintenance', itemId: maintenanceId })
  const asset = await get<{ asset_tag: string; assigned_to: number | null; assigned_type: string | null }>(
    `SELECT asset_tag, assigned_to, assigned_type FROM assets WHERE id = ?`,
    [b.asset_id],
  )
  const assigneeEmail = await resolveAssigneeEmail(asset?.assigned_type, asset?.assigned_to ? Number(asset.assigned_to) : null)
  notifyWorkflow({
    category: 'maintenance',
    event: 'maintenance.created',
    subject: `Maintenance scheduled: ${b.title}`,
    title: 'Maintenance scheduled',
    intro: 'A maintenance record was created for an asset.',
    fields: [
      { label: 'Asset', value: String(asset?.asset_tag || b.asset_id) },
      { label: 'Title', value: String(b.title) },
      { label: 'Type', value: type },
      { label: 'Reason', value: reason },
      { label: 'Start date', value: String(b.start_date || ts.slice(0, 10)) },
      { label: 'Scheduled by', value: actorLabel(req.user) },
    ],
    ctaPath: `/hardware/${b.asset_id}`,
    itemType: 'maintenance',
    itemId: maintenanceId,
    assigneeEmail,
    assigneeOnlyExtraNote: 'Maintenance has been scheduled for an asset assigned to you.',
  })
  return okMessage(res, 'Maintenance created', { id: maintenanceId }, 201)
})

maintenancesRouter.put('/:id', async (req, res) => {
  const scoped = await requireMaintenanceAssetDomain(req, res, req.params.id)
  if (!scoped) return
  const b = req.body || {}
  if (b.note !== undefined && !String(b.note || '').trim()) {
    return fail(res, 'Reason / description is required')
  }
  if (b.asset_maintenance_type !== undefined && !MAINTENANCE_TYPES.has(String(b.asset_maintenance_type))) {
    return fail(res, 'Invalid maintenance type')
  }
  const existing = await get<{ asset_id: number; title: string; asset_maintenance_type: string; note: string | null }>(`
    SELECT asset_id, title, asset_maintenance_type, note FROM maintenances WHERE id = ? AND deleted_at IS NULL
  `, [req.params.id])
  if (!existing) return fail(res, 'Maintenance not found', 404)

  const fields = ['title', 'supplier_id', 'asset_maintenance_type', 'start_date', 'completion_date', 'note', 'cost', 'is_warranty'] as const
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] !== undefined) {
      sets.push(`${f} = ?`)
      vals.push(f === 'is_warranty' ? (b[f] ? 1 : 0) : f === 'note' ? String(b[f]).trim() : b[f])
    }
  }
  if (!sets.length) return fail(res, 'No fields')
  vals.push(now(), req.params.id)
  await run(`UPDATE maintenances SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, vals)

  const type = String(b.asset_maintenance_type ?? existing.asset_maintenance_type)
  const title = String(b.title ?? existing.title)
  const reason = String(b.note !== undefined ? b.note : existing.note || '').trim()
  await logAction({
    userId: req.user?.id,
    actionType: 'maintenance_update',
    itemType: 'asset',
    itemId: Number(existing.asset_id),
    note: `${type}: ${title} — ${reason}`,
    meta: { maintenance_id: Number(req.params.id), asset_maintenance_type: type, title },
  })
  notifyWorkflow({
    category: 'maintenance',
    event: 'maintenance.updated',
    subject: `Maintenance updated: ${title}`,
    title: 'Maintenance updated',
    intro: 'A maintenance record was updated.',
    fields: [
      { label: 'Asset id', value: String(existing.asset_id) },
      { label: 'Title', value: title },
      { label: 'Type', value: type },
      { label: 'Reason', value: reason },
      { label: 'Updated by', value: actorLabel(req.user) },
    ],
    ctaPath: `/hardware/${existing.asset_id}`,
    itemType: 'maintenance',
    itemId: Number(req.params.id),
  })
  return okMessage(res, 'Maintenance updated')
})

maintenancesRouter.post('/:id/complete', async (req, res) => {
  const scoped = await requireMaintenanceAssetDomain(req, res, req.params.id)
  if (!scoped) return
  const row = await get<{ asset_id: number; title: string }>(
    `SELECT asset_id, title FROM maintenances WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
  )
  await run(`UPDATE maintenances SET completion_date = ?, updated_at = ? WHERE id = ?`, [
    req.body?.completion_date || now().slice(0, 10), now(), req.params.id,
  ])
  if (row) {
    notifyWorkflow({
      category: 'maintenance',
      event: 'maintenance.completed',
      subject: `Maintenance completed: ${row.title}`,
      title: 'Maintenance completed',
      intro: 'A maintenance record was marked complete.',
      fields: [
        { label: 'Asset id', value: String(row.asset_id) },
        { label: 'Title', value: String(row.title) },
        { label: 'Completed by', value: actorLabel(req.user) },
      ],
      ctaPath: `/hardware/${row.asset_id}`,
      itemType: 'maintenance',
      itemId: Number(req.params.id),
    })
  }
  return okMessage(res, 'Maintenance completed')
})

maintenancesRouter.delete('/:id', async (req, res) => {
  const scoped = await requireMaintenanceAssetDomain(req, res, req.params.id)
  if (!scoped) return
  await run(`UPDATE maintenances SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), req.params.id])
  return okMessage(res, 'Maintenance deleted')
})

export const dashboardRouter = Router()

dashboardRouter.get('/', async (req, res) => {
  const companyId = req.query.company_id ? Number(req.query.company_id) : null
  const locationId = req.query.location_id ? Number(req.query.location_id) : null
  const search = String(req.query.search || req.query.q || '').trim()

  const count = async (sql: string, params: unknown[] = []) => {
    const row = await get<{ c: number }>(sql, params)
    return Number(row?.c || 0)
  }

  const assetClauses = ['a.deleted_at IS NULL']
  const assetParams: unknown[] = []
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const domainFrag = domain.sql.replace(/^\s*AND\s+/i, '').trim()
  if (domainFrag) assetClauses.push(domainFrag)
  assetParams.push(...domain.params)
  if (companyId) {
    assetClauses.push('a.company_id = ?')
    assetParams.push(companyId)
  }
  if (locationId) {
    assetClauses.push('(a.location_id = ? OR a.rtd_location_id = ?)')
    assetParams.push(locationId, locationId)
  }
  if (search) {
    assetClauses.push('(a.asset_tag LIKE ? OR a.name LIKE ? OR a.serial LIKE ? OR CAST(a.id AS CHAR) = ?)')
    assetParams.push(`%${search}%`, `%${search}%`, `%${search}%`, search)
  }
  const periodFrom = String(req.query.period_from || req.query.purchase_from || '').trim()
  const periodTo = String(req.query.period_to || req.query.purchase_to || '').trim()
  if (periodFrom) {
    assetClauses.push(`${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} >= ?`)
    assetParams.push(periodFrom)
  }
  if (periodTo) {
    assetClauses.push(`${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} <= ?`)
    assetParams.push(periodTo)
  }
  const assetWhere = assetClauses.join(' AND ')

  const invClauses = ['deleted_at IS NULL']
  const invParams: unknown[] = []
  const invDomain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const invDomainT = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 't')
  const invDomainL = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'l')
  const invFrag = invDomain.sql.replace(/^\s*AND\s+/i, '').trim()
  if (invFrag) invClauses.push(invFrag)
  invParams.push(...invDomain.params)
  if (companyId) {
    invClauses.push('company_id = ?')
    invParams.push(companyId)
  }
  const licWhere = invClauses.join(' AND ')
  const qtyClauses = [...invClauses]
  const qtyParams = [...invParams]
  if (locationId) {
    qtyClauses.push('location_id = ?')
    qtyParams.push(locationId)
  }
  const qtyWhere = qtyClauses.join(' AND ')
  const qtyAssignedExtra = `${companyId ? ' AND t.company_id = ?' : ''}${locationId ? ' AND t.location_id = ?' : ''}`
  const qtyAssignedParams = [
    ...invDomainT.params,
    ...(companyId ? [companyId] : []),
    ...(locationId ? [locationId] : []),
  ]

  const { countEolDue } = await import('../services/eolAlerts.js')

  const accessoryAssigned = await count(`
    SELECT COALESCE(SUM(ac.assigned_qty),0) as c
    FROM accessories_checkout ac
    JOIN accessories t ON t.id = ac.accessory_id
    WHERE t.deleted_at IS NULL${invDomainT.sql}${qtyAssignedExtra}
  `, qtyAssignedParams)
  const consumableAssigned = await count(`
    SELECT COALESCE(SUM(cu.assigned_qty),0) as c
    FROM consumables_users cu
    JOIN consumables t ON t.id = cu.consumable_id
    WHERE t.deleted_at IS NULL${invDomainT.sql}${qtyAssignedExtra}
  `, qtyAssignedParams)
  const componentAssigned = await count(`
    SELECT COALESCE(SUM(ca.assigned_qty),0) as c
    FROM components_assets ca
    JOIN components t ON t.id = ca.component_id
    WHERE t.deleted_at IS NULL${invDomainT.sql}${qtyAssignedExtra}
  `, qtyAssignedParams)

  const accessoryQty = await count(`SELECT COALESCE(SUM(qty),0) as c FROM accessories WHERE ${qtyWhere}`, qtyParams)
  const consumableQty = await count(`SELECT COALESCE(SUM(qty),0) as c FROM consumables WHERE ${qtyWhere}`, qtyParams)
  const componentQty = await count(`SELECT COALESCE(SUM(qty),0) as c FROM components WHERE ${qtyWhere}`, qtyParams)

  const licenseSeats = await count(
    `SELECT COALESCE(SUM(seats),0) as c FROM licenses WHERE ${licWhere}`,
    invParams,
  )
  const licenseAssigned = await count(`
    SELECT COUNT(*) as c FROM license_seats ls
    JOIN licenses l ON l.id = ls.license_id
    WHERE l.deleted_at IS NULL${invDomainL.sql}${companyId ? ' AND l.company_id = ?' : ''}
      AND (ls.assigned_to IS NOT NULL OR ls.asset_id IS NOT NULL)
  `, companyId ? [...invDomainL.params, companyId] : invDomainL.params)

  return okItem(res, {
    assets: await count(`SELECT COUNT(*) as c FROM assets a WHERE ${assetWhere}`, assetParams),
    licenses: await count(`SELECT COUNT(*) as c FROM licenses WHERE ${licWhere}`, invParams),
    accessories: await count(`SELECT COUNT(*) as c FROM accessories WHERE ${qtyWhere}`, qtyParams),
    consumables: await count(`SELECT COUNT(*) as c FROM consumables WHERE ${qtyWhere}`, qtyParams),
    components: await count(`SELECT COUNT(*) as c FROM components WHERE ${qtyWhere}`, qtyParams),
    users: await count(`SELECT COUNT(*) as c FROM users WHERE deleted_at IS NULL`),
    employees: await count(`SELECT COUNT(*) as c FROM employees WHERE deleted_at IS NULL`),
    employees_active: await count(`SELECT COUNT(*) as c FROM employees WHERE deleted_at IS NULL AND ${ACTIVE_EMPLOYEE_SQL}`),
    employees_inactive: await count(`SELECT COUNT(*) as c FROM employees WHERE deleted_at IS NULL AND NOT ${ACTIVE_EMPLOYEE_SQL}`),
    deployed: await count(
      `SELECT COUNT(*) as c FROM assets a WHERE ${assetWhere} AND a.assigned_to IS NOT NULL`,
      assetParams,
    ),
    rtd: await count(
      `SELECT COUNT(*) as c FROM assets a
       JOIN status_labels s ON s.id = a.status_id
       WHERE ${assetWhere} AND a.assigned_to IS NULL AND s.type = 'deployable'`,
      assetParams,
    ),
    pending: await count(
      `SELECT COUNT(*) as c FROM assets a
       JOIN status_labels s ON s.id = a.status_id
       WHERE ${assetWhere} AND s.type = 'pending'`,
      assetParams,
    ),
    audit_due: await count(
      `SELECT COUNT(*) as c FROM assets a
       WHERE ${assetWhere}
         AND a.next_audit_date IS NOT NULL
         AND DATE(a.next_audit_date) <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)`,
      assetParams,
    ),
    eol_due: await countEolDue({
      companyId,
      locationId,
      search: search || undefined,
      permissions: req.user?.permissions,
      domain: req.query.domain || req.query.domain_id,
    }),
    accessories_assigned: accessoryAssigned,
    accessories_available: Math.max(0, accessoryQty - accessoryAssigned),
    consumables_assigned: consumableAssigned,
    consumables_available: Math.max(0, consumableQty - consumableAssigned),
    components_assigned: componentAssigned,
    components_available: Math.max(0, componentQty - componentAssigned),
    licenses_seats: licenseSeats,
    licenses_assigned: licenseAssigned,
    licenses_available: Math.max(0, licenseSeats - licenseAssigned),
  })
})

function ymdLocal(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmdLocal(value: string): Date | null {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setHours(12, 0, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

function addDaysLocal(d: Date, n: number) {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

/** Daily assignment trend window. Long periods (FY) clip to the last 14 days of the range. */
function assignmentTrendWindow(periodFrom: string, periodTo: string): { from: Date; to: Date } {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const fromP = parseYmdLocal(periodFrom)
  const toP = parseYmdLocal(periodTo)
  if (!fromP && !toP) {
    return { from: addDaysLocal(today, -13), to: today }
  }
  let from = fromP || toP as Date
  let to = toP || today
  if (to > today) to = today
  if (from > to) from = to
  const span = Math.round((to.getTime() - from.getTime()) / 86400000) + 1
  if (span > 31) {
    const clipped = addDaysLocal(to, -13)
    from = clipped < from ? from : clipped
  }
  return { from, to }
}

dashboardRouter.get('/charts', async (req, res) => {
  const companyId = req.query.company_id ? Number(req.query.company_id) : null
  const locationId = req.query.location_id ? Number(req.query.location_id) : null
  const periodFrom = String(req.query.period_from || req.query.purchase_from || '').trim()
  const periodTo = String(req.query.period_to || req.query.purchase_to || '').trim()
  const { inventoryDomainClause, tableHasColumn } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const clauses = ['a.deleted_at IS NULL']
  const params: unknown[] = []
  const domainFrag = domain.sql.replace(/^\s*AND\s+/i, '').trim()
  if (domainFrag) clauses.push(domainFrag)
  params.push(...domain.params)
  if (companyId) {
    clauses.push('a.company_id = ?')
    params.push(companyId)
  }
  if (locationId) {
    clauses.push('(a.location_id = ? OR a.rtd_location_id = ?)')
    params.push(locationId, locationId)
  }
  const trendWhere = clauses.join(' AND ')
  const trendParams = [...params]
  if (periodFrom) {
    clauses.push(`${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} >= ?`)
    params.push(periodFrom)
  }
  if (periodTo) {
    clauses.push(`${ASSET_AGE_DATE_SQL} IS NOT NULL AND ${ASSET_AGE_DATE_SQL} <= ?`)
    params.push(periodTo)
  }
  const where = clauses.join(' AND ')
  const hasAssetType = await tableHasColumn('models', 'asset_type_id')

  const statusRows = await all<{ label: string; value: number }>(`
    SELECT
      CASE
        WHEN a.assigned_to IS NOT NULL THEN 'Assigned'
        WHEN s.type = 'deployable' THEN 'In stock'
        WHEN s.type = 'pending' THEN 'Pending'
        WHEN s.type = 'undeployable' THEN 'Not deployable'
        ELSE COALESCE(NULLIF(s.name, ''), 'Other')
      END AS label,
      COUNT(*) AS value
    FROM assets a
    LEFT JOIN status_labels s ON s.id = a.status_id
    WHERE ${where}
    GROUP BY label
    ORDER BY value DESC
  `, params)

  const typeRows = await all<{ label: string; value: number }>(`
    SELECT COALESCE(${hasAssetType ? 'NULLIF(at.name, \'\'), ' : ''}NULLIF(c.name, ''), 'Unspecified') AS label,
      COUNT(*) AS value
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    LEFT JOIN categories c ON c.id = m.category_id
    ${hasAssetType ? 'LEFT JOIN asset_types at ON at.id = m.asset_type_id' : ''}
    WHERE ${where}
    GROUP BY label
    ORDER BY value DESC
    LIMIT 8
  `, params)

  const companyRows = await all<{ label: string; value: number }>(`
    SELECT COALESCE(NULLIF(co.name, ''), 'No company') AS label, COUNT(*) AS value
    FROM assets a
    LEFT JOIN companies co ON co.id = a.company_id
    WHERE ${where}
    GROUP BY label
    ORDER BY value DESC
    LIMIT 6
  `, params)

  const window = assignmentTrendWindow(periodFrom, periodTo)
  const trendFrom = ymdLocal(window.from)
  const trendTo = ymdLocal(window.to)
  const trendRaw = await all<{ day: string; assigned: number; returned: number }>(`
    SELECT DATE(al.action_date) AS day,
      SUM(CASE WHEN al.action_type = 'checkout' THEN 1 ELSE 0 END) AS assigned,
      SUM(CASE WHEN al.action_type = 'checkin' THEN 1 ELSE 0 END) AS returned
    FROM action_logs al
    INNER JOIN assets a ON a.id = al.item_id AND a.deleted_at IS NULL
    WHERE al.deleted_at IS NULL
      AND al.item_type = 'asset'
      AND al.action_type IN ('checkout', 'checkin')
      AND DATE(al.action_date) >= ?
      AND DATE(al.action_date) <= ?
      AND ${trendWhere}
    GROUP BY DATE(al.action_date)
    ORDER BY day ASC
  `, [trendFrom, trendTo, ...trendParams])
  const byDay = new Map(trendRaw.map((r) => [String(r.day).slice(0, 10), r]))
  const trend: Array<{ day: string; assigned: number; returned: number }> = []
  const cursor = new Date(window.from)
  while (cursor.getTime() <= window.to.getTime()) {
    const key = ymdLocal(cursor)
    const hit = byDay.get(key)
    trend.push({
      day: key,
      assigned: Number(hit?.assigned || 0),
      returned: Number(hit?.returned || 0),
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return okItem(res, {
    status: statusRows.map((r) => ({ label: r.label, value: Number(r.value) })),
    types: typeRows.map((r) => ({ label: r.label, value: Number(r.value) })),
    companies: companyRows.map((r) => ({ label: r.label, value: Number(r.value) })),
    trend,
  })
})

export const settingsRouter = Router()

settingsRouter.get('/', async (_req, res) => {
  const row = await get(`SELECT * FROM settings WHERE id = 1`)
  return okItem(res, row)
})

settingsRouter.get('/notifications', async (_req, res) => {
  const { notificationAdminSnapshot } = await import('../services/notificationConfig.js')
  return okItem(res, await notificationAdminSnapshot())
})

settingsRouter.put('/notifications', async (req, res) => {
  const { saveNotificationConfig, notificationAdminSnapshot } = await import('../services/notificationConfig.js')
  const b = req.body || {}
  await saveNotificationConfig({
    email_notifications: b.email_notifications,
    extra_ops_emails: b.extra_ops_emails,
    eol_to_it_asset_manager: b.eol_to_it_asset_manager,
    workflow_to_ops_roles: b.workflow_to_ops_roles,
  })
  if (b.alert_email !== undefined) {
    await run(`UPDATE settings SET alert_email = ?, updated_at = ? WHERE id = 1`, [
      b.alert_email ? String(b.alert_email).trim() : null,
      now(),
    ])
  }
  return okMessage(res, 'Notification settings saved', await notificationAdminSnapshot())
})

settingsRouter.put('/', async (req, res) => {
  const b = req.body || {}
  await run(`
    UPDATE settings SET
      site_name = COALESCE(?, site_name),
      full_multiple_companies_support = COALESCE(?, full_multiple_companies_support),
      default_currency = COALESCE(?, default_currency),
      date_display_format = COALESCE(?, date_display_format),
      alert_email = COALESCE(?, alert_email),
      updated_at = ?
    WHERE id = 1
  `, [
    b.site_name ?? null,
    b.full_multiple_companies_support !== undefined ? (b.full_multiple_companies_support ? 1 : 0) : null,
    b.default_currency ?? null,
    b.date_display_format ?? null,
    b.alert_email ?? null,
    now(),
  ])
  return okMessage(res, 'Settings updated', await get(`SELECT * FROM settings WHERE id = 1`))
})

/** SAML SP values to paste into RefexOne portal. */
settingsRouter.get('/saml', async (_req, res) => {
  const { samlEnabled, idpConfigured, samlSpConfig, samlPortalFields } = await import('../services/saml.js')
  return okItem(res, {
    enabled: samlEnabled(),
    idp_configured: idpConfigured(),
    button_label: process.env.SAML_BUTTON_LABEL || 'RefexOne SSO',
    ...samlSpConfig(),
    portal_fields: samlPortalFields(),
    env_hint: {
      SAML_ENABLED: 'true',
      SAML_IDP_ENTRY_POINT: 'SSO URL from RefexOne IdP metadata',
      SAML_IDP_CERT: 'X.509 cert from RefexOne IdP metadata (PEM or base64)',
      SAML_IDP_SLO_URL: 'optional IdP logout URL',
      SAML_AUTO_PROVISION: 'false (set true to auto-create App Users on first SSO)',
      PUBLIC_APP_URL: 'https://asset.refexone.com',
    },
  })
})

/** Pending vs already-applied numbered SQL files (admin / settings.view). */
settingsRouter.get('/migrations', async (_req, res) => {
  try {
    const { listSchemaMigrationStatus } = await import('../services/schemaMigrate.js')
    return okItem(res, await listSchemaMigrationStatus())
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Could not list migrations', 500)
  }
})

/** Apply pending SQL files from server/src/db/mysql (admin / settings.edit). */
settingsRouter.post('/run-migrations', async (req, res) => {
  try {
    const { runPendingSchemaMigrations } = await import('../services/schemaMigrate.js')
    const result = await runPendingSchemaMigrations()
    await logAction({
      userId: req.user?.id,
      actionType: 'run_migrations',
      itemType: 'settings',
      itemId: 1,
      note: `Applied ${result.applied.length}; skipped ${result.skipped.length}`,
      meta: result,
    })
    const appliedLabel = result.applied.length
      ? result.applied.join(', ')
      : 'none'
    return okMessage(
      res,
      `Schema migrations complete — applied: ${appliedLabel}; skipped ${result.skipped.length} already applied.`,
      result,
    )
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Schema migration failed', 500)
  }
})

/** Seed office floors / cabins / Admin-domain inventory (idempotent). */
settingsRouter.post('/seed-admin-spaces', async (req, res) => {
  try {
    const { seedAdminSpaces } = await import('../../scripts/seed-admin-spaces.js')
    const result = await seedAdminSpaces()
    await logAction({
      userId: req.user?.id,
      actionType: 'seed_admin_spaces',
      itemType: 'settings',
      itemId: 1,
      note: `Floors +${result.new_this_run.floors}, spaces +${result.new_this_run.spaces}, assets +${result.new_this_run.assets}`,
      meta: result,
    })
    return okMessage(
      res,
      `Office & Admin inventory seed complete — new floors ${result.new_this_run.floors}, spaces ${result.new_this_run.spaces}, assets ${result.new_this_run.assets}, qty items ${result.new_this_run.qty}.`,
      result,
    )
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Office seed failed', 500)
  }
})

/** Move legacy asset_tag → old_asset_tag and assign new CODE-TYPE-FY-#### tags. */
settingsRouter.post('/migrate-asset-tags', async (req, res) => {
  try {
    const { migrateAssetTagsToOld } = await import('../services/assetTag.js')
    const result = await migrateAssetTagsToOld()
    await logAction({
      userId: req.user?.id,
      actionType: 'migrate_asset_tags',
      itemType: 'settings',
      itemId: 1,
      note: `Migrated ${result.migrated}; failed ${result.failed}`,
    })
    return okMessage(
      res,
      `Asset tags migrated — ${result.migrated} updated, ${result.failed} failed, ${result.skipped} skipped.`,
      result,
    )
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Asset tag migration failed', 500)
  }
})

/** Regenerate Asset Tag to CODE-TYPE-FY-####; leave Old Asset Tag unchanged. */
settingsRouter.post('/regenerate-asset-tags', async (req, res) => {
  try {
    const { regenerateAssetTagsKeepOld } = await import('../services/assetTag.js')
    const result = await regenerateAssetTagsKeepOld()
    await logAction({
      userId: req.user?.id,
      actionType: 'regenerate_asset_tags',
      itemType: 'settings',
      itemId: 1,
      note: `FY ${result.fy}: regenerated ${result.regenerated}; failed ${result.failed}; skipped ${result.skipped}`,
    })
    return okMessage(
      res,
      `Asset tags regenerated for FY ${result.fy} — ${result.regenerated} updated, ${result.failed} failed, ${result.skipped} already current.`,
      result,
    )
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Asset tag regeneration failed', 500)
  }
})

/** Clear all asset QR tokens/URLs/images so Print Label remints against current PUBLIC_APP_URL. */
settingsRouter.post('/reset-qr', async (req, res) => {
  try {
    const { resetAllAssetQr } = await import('../services/assetQr.js')
    const result = await resetAllAssetQr()
    await logAction({
      userId: req.user?.id,
      actionType: 'reset_qr',
      itemType: 'settings',
      itemId: 1,
      note: `Cleared QR on ${result.cleared} asset(s); removed ${result.files_removed} file(s)`,
    })
    return okMessage(
      res,
      `QR reset complete — ${result.cleared} asset(s) cleared, ${result.files_removed} file(s) removed. Print Label again to mint new codes.`,
      result,
    )
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'QR reset failed', 500)
  }
})

export const accountRouter = Router()

accountRouter.get('/assets', async (req, res) => {
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const ids = await all<{ id: number }>(`
    SELECT id FROM assets WHERE assigned_type = 'user' AND assigned_to = ? AND deleted_at IS NULL
      ${domain.sql}
  `, [req.user!.id, ...domain.params])
  const rows = (await Promise.all(ids.map((r) => transformAsset(r.id)))).filter(Boolean)
  return okList(res, rows)
})

accountRouter.get('/requested', async (req, res) => {
  const rows = await all(`
    SELECT * FROM checkout_requests WHERE user_id = ? AND deleted_at IS NULL
  `, [req.user!.id])
  return okList(res, rows)
})

accountRouter.get('/accept', async (req, res) => {
  const rows = await all(`
    SELECT ca.*, a.asset_tag, a.name as asset_name
    FROM checkout_acceptances ca
    JOIN assets a ON a.id = ca.checkoutable_id
    WHERE ca.assigned_to = ? AND ca.accepted_at IS NULL AND ca.declined_at IS NULL AND ca.deleted_at IS NULL
  `, [req.user!.id])
  return okList(res, rows)
})

accountRouter.post('/accept/:id', async (req, res) => {
  const decision = String(req.body?.asset_acceptance || req.body?.decision || 'accepted')
  const note = req.body?.note || null
  const row = await get<Record<string, unknown>>(`
    SELECT * FROM checkout_acceptances WHERE id = ? AND assigned_to = ? AND deleted_at IS NULL
  `, [req.params.id, req.user!.id])
  if (!row) return fail(res, 'Acceptance not found', 404)

  const ts = now()
  if (decision === 'declined') {
    await run(`UPDATE checkout_acceptances SET declined_at = ?, note = ?, updated_at = ? WHERE id = ?`, [ts, note, ts, req.params.id])
    await logAction({ userId: req.user!.id, actionType: 'declined', itemType: row.checkoutable_type as string, itemId: Number(row.checkoutable_id), note })
    return okMessage(res, 'Asset declined')
  }

  let signatureFilename: string | null = null
  if (req.body?.signature_output || req.body?.signature) {
    const b64 = String(req.body.signature_output || req.body.signature).replace(/^data:image\/\w+;base64,/, '')
    const buf = Buffer.from(b64, 'base64')
    const filename = `siglog-${req.params.id}-${Date.now()}.png`
    const rel = path.join('private_uploads', 'signatures', filename).replace(/\\/g, '/')
    const abs = path.join(storageRoot, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, buf)
    signatureFilename = filename
    await recordUpload({
      type: 'acceptance',
      id: Number(req.params.id),
      filename,
      original: filename,
      mime: 'image/png',
      diskPath: rel,
      size: buf.length,
      kind: 'signature',
      userId: req.user!.id,
    })
  }

  await run(`
    UPDATE checkout_acceptances SET accepted_at = ?, signature_filename = COALESCE(?, signature_filename), note = ?, updated_at = ?
    WHERE id = ?
  `, [ts, signatureFilename, note, ts, req.params.id])
  await logAction({
    userId: req.user!.id,
    actionType: 'accepted',
    itemType: row.checkoutable_type as string,
    itemId: Number(row.checkoutable_id),
    note: note || 'EULA accepted',
  })
  return okMessage(res, 'Asset accepted', { signature: signatureFilename })
})

accountRouter.post('/accept/:id/decline', async (req, res) => {
  req.body = { ...(req.body || {}), asset_acceptance: 'declined' }
  // reuse logic
  const ts = now()
  await run(`UPDATE checkout_acceptances SET declined_at = ?, note = ?, updated_at = ? WHERE id = ? AND assigned_to = ?`, [
    ts, req.body?.note || null, ts, req.params.id, req.user!.id,
  ])
  await logAction({ userId: req.user!.id, actionType: 'declined', itemType: 'asset', note: req.body?.note || null })
  return okMessage(res, 'Asset declined')
})


accountRouter.put('/profile', async (req, res) => {
  const b = req.body || {}
  await run(`
    UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
      email = COALESCE(?, email), phone = COALESCE(?, phone), updated_at = ?
    WHERE id = ?
  `, [b.first_name ?? null, b.last_name ?? null, b.email ?? null, b.phone ?? null, now(), req.user!.id])
  return okMessage(res, 'Profile updated')
})

accountRouter.put('/password', async (req, res) => {
  const { current_password, password } = req.body || {}
  if (!password) return fail(res, 'password required')
  const user = await get<{ password: string }>(`SELECT password FROM users WHERE id = ?`, [req.user!.id])
  if (!user) return fail(res, 'User not found', 404)
  if (current_password && !bcrypt.compareSync(current_password, user.password)) {
    return fail(res, 'Current password incorrect')
  }
  await run(`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`, [
    bcrypt.hashSync(password, 10), now(), req.user!.id,
  ])
  return okMessage(res, 'Password updated')
})

export const requestsRouter = Router()

requestsRouter.get('/', async (_req, res) => {
  const rows = await all(`
    SELECT cr.*, CONCAT(u.first_name, ' ', u.last_name) as user_name, u.username
    FROM checkout_requests cr
    JOIN users u ON u.id = cr.user_id
    WHERE cr.deleted_at IS NULL
    ORDER BY cr.id DESC
  `)
  return okList(res, rows)
})

requestsRouter.post('/', async (req, res) => {
  const b = req.body || {}
  if (!b.requestable_id) return fail(res, 'requestable_id required')
  const ts = now()
  const info = await run(`
    INSERT INTO checkout_requests (user_id, requestable_id, requestable_type, quantity, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [req.user!.id, b.requestable_id, b.requestable_type || 'asset', b.quantity || 1, ts, ts])
  return okMessage(res, 'Request submitted', { id: info.insertId }, 201)
})

requestsRouter.get('/requestable', async (req, res) => {
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const domainA = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, 'a')
  const ids = await all<{ id: number }>(`
    SELECT id FROM assets WHERE deleted_at IS NULL AND requestable = 1 AND assigned_to IS NULL
      ${domain.sql}
  `, domain.params)
  const more = await all<{ id: number }>(`
    SELECT a.id FROM assets a
    JOIN status_labels s ON s.id = a.status_id
    WHERE a.deleted_at IS NULL AND a.assigned_to IS NULL AND s.type = 'deployable'
      ${domainA.sql}
  `, domainA.params)
  const allIds = [...new Set([...ids, ...more].map((r) => r.id))]
  const rows = (await Promise.all(allIds.map((id) => transformAsset(id)))).filter(Boolean)
  return okList(res, rows)
})
