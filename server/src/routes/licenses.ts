import { Router } from 'express'
import { all, get, run, now, limitSql } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { transformLicense } from '../services/transformers.js'
import { logAction } from '../services/actionLog.js'
import { actorLabel, notifyWorkflow, resolveAssigneeEmail } from '../services/notify.js'
import { computeSubscriptionEnd } from '../services/licenseSubscription.js'
import {
  appendInvoicePeriod,
  listLicenseInvoices,
  syncLicenseInvoiceSlots,
} from '../services/licenseInvoices.js'
import { assertRecordDomainAccess, inventoryDomainClause, inventoryDomainColumnsReady, loadItemDomain, resolveWriteDomainId, tableHasColumn } from '../services/domainAuth.js'
import { requireActiveEmployee } from '../services/employeeStatus.js'

const router = Router()

function normalizeLicenseBody(b: Record<string, unknown>) {
  const periodRaw = String(b.subscription_period || 'none').toLowerCase()
  const period = (['none', 'monthly', 'annual', 'custom'].includes(periodRaw)
    ? periodRaw
    : 'none') as 'none' | 'monthly' | 'annual' | 'custom'
  const customValue = b.subscription_custom_value != null && b.subscription_custom_value !== ''
    ? Number(b.subscription_custom_value)
    : null
  const customUnitRaw = String(b.subscription_custom_unit || 'months').toLowerCase()
  const customUnit = customUnitRaw === 'days' ? 'days' : 'months'
  const isRecurring = b.is_recurring === true || b.is_recurring === 1 || b.is_recurring === '1'
  const purchaseDate = b.purchase_date ? String(b.purchase_date).slice(0, 10) : null
  let cycles = b.subscription_cycles != null && b.subscription_cycles !== ''
    ? Number(b.subscription_cycles)
    : 1
  if (!Number.isFinite(cycles) || cycles < 1) cycles = 1
  cycles = Math.min(Math.floor(cycles), 120)
  if (period === 'none') cycles = 1

  let expiration = b.expiration_date ? String(b.expiration_date).slice(0, 10) : null
  // Recompute when period is set unless client sent an explicit override after we already computed
  if (period !== 'none' && purchaseDate) {
    const computed = computeSubscriptionEnd({
      startDate: purchaseDate,
      period,
      customValue,
      customUnit,
      cycles,
    })
    if (computed) expiration = computed
  }

  return {
    requested_by_employee_id: b.requested_by_employee_id
      ? Number(b.requested_by_employee_id)
      : null,
    subscription_period: period,
    subscription_custom_value: period === 'custom' && customValue && customValue > 0 ? customValue : null,
    subscription_custom_unit: period === 'custom' ? customUnit : null,
    subscription_cycles: cycles,
    is_recurring: isRecurring ? 1 : 0,
    purchase_date: purchaseDate,
    expiration_date: expiration,
  }
}

async function syncSlotsFromLicense(licenseId: number) {
  const lic = await get<{
    purchase_date: string | null
    subscription_period: string | null
    subscription_custom_value: number | null
    subscription_custom_unit: string | null
    subscription_cycles: number | null
  }>(`SELECT purchase_date, subscription_period, subscription_custom_value, subscription_custom_unit, subscription_cycles
      FROM licenses WHERE id = ? AND deleted_at IS NULL`, [licenseId])
  if (!lic) return
  await syncLicenseInvoiceSlots(licenseId, {
    startDate: lic.purchase_date,
    period: lic.subscription_period,
    customValue: lic.subscription_custom_value,
    customUnit: lic.subscription_custom_unit,
    cycles: lic.subscription_cycles,
  })
}

router.get('/', async (req, res) => {
  const q = String(req.query.search || '').trim()
  let sql = `SELECT id FROM licenses WHERE deleted_at IS NULL`
  const params: unknown[] = []
  if (q) {
    sql += ' AND (name LIKE ? OR serial LIKE ?)'
    params.push(`%${q}%`, `%${q}%`)
  }
  if (req.query.company_id) {
    sql += ' AND company_id = ?'
    params.push(Number(req.query.company_id))
  }
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  sql += domain.sql
  params.push(...domain.params)
  sql += ' ORDER BY id DESC'
  const limit = Math.min(Number(req.query.limit) || 50, 500)
  const offset = Number(req.query.offset) || 0
  const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _count_q`, params)
  const total = Number(totalRow?.c || 0)
  const ids = await all<{ id: number }>(`${sql} ${limitSql(limit, offset)}`, params)
  const rows = (await Promise.all(ids.map((r) => transformLicense(r.id)))).filter(Boolean)
  return okList(res, rows, total)
})

router.put('/invoices/:invoiceId', async (req, res) => {
  const invoiceId = Number(req.params.invoiceId)
  const row = await get<{ id: number; license_id: number }>(`
    SELECT id, license_id FROM license_invoices WHERE id = ? AND deleted_at IS NULL
  `, [invoiceId])
  if (!row) return fail(res, 'Invoice period not found', 404)
  const lic = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [row.license_id])
  if (!lic) return fail(res, 'Invoice period not found', 404)
  if (!(await assertRecordDomainAccess(req, res, lic.domain_id))) return

  const b = req.body || {}
  const map: Record<string, unknown> = {}
  if (b.invoice_at !== undefined) {
    const raw = b.invoice_at == null || b.invoice_at === '' ? null : String(b.invoice_at).trim()
    map.invoice_at = raw ? raw.replace('T', ' ').slice(0, 19) : null
  }
  if (b.amount !== undefined) {
    map.amount = b.amount === null || b.amount === '' ? null : Number(b.amount)
  }
  if (b.notes !== undefined) map.notes = b.notes == null ? null : String(b.notes)
  if (b.period_start !== undefined && b.period_start) {
    map.period_start = String(b.period_start).slice(0, 10)
  }
  if (b.period_end !== undefined && b.period_end) {
    map.period_end = String(b.period_end).slice(0, 10)
  }

  const keys = Object.keys(map)
  if (!keys.length) return fail(res, 'No fields to update')
  await run(
    `UPDATE license_invoices SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    [...keys.map((k) => map[k]), now(), invoiceId],
  )
  await logAction({
    userId: req.user?.id,
    actionType: 'update',
    itemType: 'license',
    itemId: Number(row.license_id),
    note: `invoice #${invoiceId}`,
  })
  const invoices = await listLicenseInvoices(Number(row.license_id))
  const updated = invoices.find((r) => r.id === invoiceId)
  return okMessage(res, 'Invoice updated', updated)
})

router.delete('/invoices/:invoiceId', async (req, res) => {
  const invoiceId = Number(req.params.invoiceId)
  const row = await get<{ id: number; license_id: number }>(`
    SELECT id, license_id FROM license_invoices WHERE id = ? AND deleted_at IS NULL
  `, [invoiceId])
  if (!row) return fail(res, 'Invoice period not found', 404)
  const lic = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [row.license_id])
  if (!lic) return fail(res, 'Invoice period not found', 404)
  if (!(await assertRecordDomainAccess(req, res, lic.domain_id))) return
  await run(`UPDATE license_invoices SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), invoiceId])
  await run(`
    UPDATE uploads SET deleted_at = ? WHERE uploadable_type = 'license_invoice' AND uploadable_id = ? AND deleted_at IS NULL
  `, [now(), invoiceId])
  await logAction({
    userId: req.user?.id,
    actionType: 'delete',
    itemType: 'license',
    itemId: Number(row.license_id),
    note: `invoice #${invoiceId}`,
  })
  return okMessage(res, 'Invoice period deleted')
})

router.get('/:id', async (req, res) => {
  const row = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [req.params.id])
  if (!row) return fail(res, 'License not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  const lic = await transformLicense(Number(req.params.id))
  if (!lic) return fail(res, 'License not found', 404)
  return okItem(res, lic)
})

router.get('/:id/seats', async (req, res) => {
  const row = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [req.params.id])
  if (!row) return fail(res, 'License not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  const empCol = await tableHasColumn('license_seats', 'assigned_employee_id')
  const rows = await all(`
    SELECT ls.*,
      CASE WHEN ls.assigned_to IS NOT NULL THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = ls.assigned_to) END as user_name,
      ${empCol ? `CASE WHEN ls.assigned_employee_id IS NOT NULL THEN (
        SELECT TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) FROM employees WHERE id = ls.assigned_employee_id
      ) END as employee_name,` : 'NULL as employee_name,'}
      CASE WHEN ls.asset_id IS NOT NULL THEN (SELECT asset_tag FROM assets WHERE id = ls.asset_id) END as asset_tag
    FROM license_seats ls WHERE ls.license_id = ? ORDER BY ls.id ASC
  `, [req.params.id])
  return okList(res, rows)
})

router.get('/:id/invoices', async (req, res) => {
  const id = Number(req.params.id)
  const row = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [id])
  if (!row) return fail(res, 'License not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  if (!(await transformLicense(id))) return fail(res, 'License not found', 404)
  const rows = await listLicenseInvoices(id)
  return okList(res, rows)
})

router.post('/:id/invoices', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [id])
  if (!existing) return fail(res, 'License not found', 404)
  if (!(await assertRecordDomainAccess(req, res, existing.domain_id))) return
  if (!(await transformLicense(id))) return fail(res, 'License not found', 404)
  const row = await appendInvoicePeriod(id, req.user?.id)
  if (!row) return fail(res, 'Could not add invoice period (set purchase date + subscription period first)')
  await logAction({
    userId: req.user?.id,
    actionType: 'create',
    itemType: 'license',
    itemId: id,
    note: `invoice period #${row.period_index}`,
  })
  return okMessage(res, 'Invoice period added', row, 201)
})

router.post('/', async (req, res) => {
  const b = req.body || {}
  if (!b.name) return fail(res, 'name required')
  let domain
  try {
    domain = await resolveWriteDomainId(req.user?.permissions, b)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid domain'
    return fail(res, msg, /Forbidden/.test(msg) ? 403 : 400)
  }
  const seats = Number(b.seats) || 1
  const sub = normalizeLicenseBody(b)
  if (sub.subscription_period === 'custom' && !sub.subscription_custom_value) {
    return fail(res, 'Custom subscription requires a duration value')
  }
  const ts = now()
  const domainReady = await inventoryDomainColumnsReady()
  const info = await run(
    domainReady
      ? `
    INSERT INTO licenses (
      domain_id, name, serial, seats, company_id, legal_entity_id, manufacturer_id, category_id,
      requested_by_employee_id, expiration_date, subscription_period, subscription_custom_value,
      subscription_custom_unit, is_recurring, subscription_cycles, purchase_cost, purchase_date, notes, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
      : `
    INSERT INTO licenses (
      name, serial, seats, company_id, legal_entity_id, manufacturer_id, category_id,
      requested_by_employee_id, expiration_date, subscription_period, subscription_custom_value,
      subscription_custom_unit, is_recurring, subscription_cycles, purchase_cost, purchase_date, notes, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    domainReady
      ? [
        domain.id, b.name, b.product_key || b.serial || null, seats, b.company_id || null, b.legal_entity_id || null, b.manufacturer_id || null,
        b.category_id || null, sub.requested_by_employee_id, sub.expiration_date,
        sub.subscription_period, sub.subscription_custom_value, sub.subscription_custom_unit, sub.is_recurring,
        sub.subscription_cycles,
        b.purchase_cost || null, sub.purchase_date, b.notes || null, ts, ts,
      ]
      : [
        b.name, b.product_key || b.serial || null, seats, b.company_id || null, b.legal_entity_id || null, b.manufacturer_id || null,
        b.category_id || null, sub.requested_by_employee_id, sub.expiration_date,
        sub.subscription_period, sub.subscription_custom_value, sub.subscription_custom_unit, sub.is_recurring,
        sub.subscription_cycles,
        b.purchase_cost || null, sub.purchase_date, b.notes || null, ts, ts,
      ],
  )
  const id = Number(info.insertId)
  const BATCH = 200
  for (let offset = 0; offset < seats; offset += BATCH) {
    const n = Math.min(BATCH, seats - offset)
    const placeholders = Array(n).fill('(?, ?, ?)').join(', ')
    const vals: unknown[] = []
    for (let i = 0; i < n; i++) vals.push(id, ts, ts)
    await run(`INSERT INTO license_seats (license_id, created_at, updated_at) VALUES ${placeholders}`, vals)
  }
  await syncSlotsFromLicense(id)
  await logAction({ userId: req.user?.id, actionType: 'create', itemType: 'license', itemId: id })
  notifyWorkflow({
    category: 'inventory',
    event: 'license.created',
    subject: `License added: ${b.name}`,
    title: 'License added',
    intro: 'A new software license was added to the catalog.',
    fields: [
      { label: 'License', value: String(b.name) },
      { label: 'Seats', value: String(seats) },
      { label: 'Created by', value: actorLabel(req.user) },
    ],
    ctaPath: `/licenses/${id}`,
    itemType: 'license',
    itemId: id,
  })
  return okMessage(res, 'License created', await transformLicense(id), 201)
})

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const existingRow = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [id])
  if (!existingRow) return fail(res, 'License not found', 404)
  if (!(await assertRecordDomainAccess(req, res, existingRow.domain_id))) return
  if (!(await transformLicense(id))) return fail(res, 'License not found', 404)
  const b = req.body || {}
  const map: Record<string, unknown> = {}
  for (const f of ['name', 'company_id', 'legal_entity_id', 'manufacturer_id', 'category_id', 'purchase_cost', 'notes'] as const) {
    if (b[f] !== undefined) map[f] = b[f]
  }
  if ((b.domain_id !== undefined || b.domain !== undefined || b.domain_code !== undefined) && (await inventoryDomainColumnsReady())) {
    try {
      const domain = await resolveWriteDomainId(req.user?.permissions, b)
      map.domain_id = domain.id
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid domain'
      return fail(res, msg, /Forbidden/.test(msg) ? 403 : 400)
    }
  }
  if (b.product_key !== undefined || b.serial !== undefined) map.serial = b.product_key ?? b.serial

  const subTouched = [
    'subscription_period', 'subscription_custom_value', 'subscription_custom_unit',
    'subscription_cycles', 'is_recurring', 'purchase_date', 'expiration_date', 'requested_by_employee_id',
  ].some((k) => b[k] !== undefined)
  if (subTouched) {
    const existing = await get<Record<string, unknown>>(`SELECT * FROM licenses WHERE id = ?`, [id])
    const merged = {
      ...existing,
      ...b,
      purchase_date: b.purchase_date !== undefined ? b.purchase_date : existing?.purchase_date,
      expiration_date: b.expiration_date !== undefined ? b.expiration_date : existing?.expiration_date,
      subscription_period: b.subscription_period !== undefined ? b.subscription_period : existing?.subscription_period,
      subscription_custom_value: b.subscription_custom_value !== undefined
        ? b.subscription_custom_value
        : existing?.subscription_custom_value,
      subscription_custom_unit: b.subscription_custom_unit !== undefined
        ? b.subscription_custom_unit
        : existing?.subscription_custom_unit,
      subscription_cycles: b.subscription_cycles !== undefined
        ? b.subscription_cycles
        : existing?.subscription_cycles,
      is_recurring: b.is_recurring !== undefined ? b.is_recurring : existing?.is_recurring,
      requested_by_employee_id: b.requested_by_employee_id !== undefined
        ? b.requested_by_employee_id
        : existing?.requested_by_employee_id,
    }
    const sub = normalizeLicenseBody(merged)
    if (sub.subscription_period === 'custom' && !sub.subscription_custom_value) {
      return fail(res, 'Custom subscription requires a duration value')
    }
    Object.assign(map, sub)
  }

  const keys = Object.keys(map)
  if (keys.length) {
    await run(`UPDATE licenses SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [
      ...keys.map((k) => map[k]), now(), id,
    ])
  }
  if (b.seats !== undefined) {
    const currentRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM license_seats WHERE license_id = ?`, [id])
    const current = Number(currentRow?.c || 0)
    const target = Number(b.seats)
    const ts = now()
    if (target > current) {
      const add = target - current
      const BATCH = 200
      for (let offset = 0; offset < add; offset += BATCH) {
        const n = Math.min(BATCH, add - offset)
        const placeholders = Array(n).fill('(?, ?, ?)').join(', ')
        const vals: unknown[] = []
        for (let i = 0; i < n; i++) vals.push(id, ts, ts)
        await run(`INSERT INTO license_seats (license_id, created_at, updated_at) VALUES ${placeholders}`, vals)
      }
    } else if (target < current) {
      const free = await all<{ id: number }>(`
        SELECT id FROM license_seats
        WHERE license_id = ? AND assigned_to IS NULL AND asset_id IS NULL
        ORDER BY id DESC LIMIT ${current - target}
      `, [id])
      if (free.length) {
        await run(`DELETE FROM license_seats WHERE id IN (${free.map(() => '?').join(',')})`, free.map((r) => r.id))
      }
    }
    await run(`UPDATE licenses SET seats = ?, updated_at = ? WHERE id = ?`, [target, ts, id])
  }
  if (subTouched) await syncSlotsFromLicense(id)
  await logAction({ userId: req.user?.id, actionType: 'update', itemType: 'license', itemId: id })
  return okMessage(res, 'License updated', await transformLicense(id))
})

router.delete('/:id', async (req, res) => {
  const row = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [req.params.id])
  if (!row) return fail(res, 'License not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  await run(`UPDATE licenses SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), req.params.id])
  await logAction({ userId: req.user?.id, actionType: 'delete', itemType: 'license', itemId: Number(req.params.id) })
  return okMessage(res, 'License deleted')
})

router.post('/:id/checkout', async (req, res) => {
  const id = Number(req.params.id)
  const licRow = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [id])
  if (!licRow) return fail(res, 'License not found', 404)
  if (!(await assertRecordDomainAccess(req, res, licRow.domain_id))) return
  const empCol = await tableHasColumn('license_seats', 'assigned_employee_id')
  const seat = await get<{ id: number }>(
    empCol
      ? `SELECT id FROM license_seats WHERE license_id = ? AND assigned_to IS NULL AND assigned_employee_id IS NULL AND asset_id IS NULL LIMIT 1`
      : `SELECT id FROM license_seats WHERE license_id = ? AND assigned_to IS NULL AND asset_id IS NULL LIMIT 1`,
    [id],
  )
  if (!seat) return fail(res, 'No free licenses available')
  const b = req.body || {}
  const assignedTo = b.assigned_to || b.assigned_user || null
  const assignedEmployee = b.assigned_employee_id || b.assigned_employee || (b.checkout_to_type === 'employee' ? b.assigned_to : null) || null
  const assetId = b.asset_id || null
  if (!assignedTo && !assignedEmployee && !assetId) return fail(res, 'User, employee or asset required')
  if (assignedEmployee) {
    const check = await requireActiveEmployee(Number(assignedEmployee))
    if (!check.ok) return fail(res, check.message, check.status)
  }
  if (empCol) {
    await run(`UPDATE license_seats SET assigned_to = ?, assigned_employee_id = ?, asset_id = ?, notes = ?, updated_at = ? WHERE id = ?`, [
      assignedEmployee ? null : assignedTo, assignedEmployee || null, assetId, b.note || null, now(), seat.id,
    ])
  } else {
    await run(`UPDATE license_seats SET assigned_to = ?, asset_id = ?, notes = ?, updated_at = ? WHERE id = ?`, [
      assignedTo, assetId, b.note || null, now(), seat.id,
    ])
  }
  await logAction({
    userId: req.user?.id, actionType: 'checkout', itemType: 'license', itemId: id,
    targetType: assignedEmployee ? 'employee' : assignedTo ? 'user' : 'asset',
    targetId: Number(assignedEmployee || assignedTo || assetId), note: b.note || null,
  })
  const lic = await transformLicense(id)
  const assigneeEmail = assignedTo ? await resolveAssigneeEmail('user', Number(assignedTo)) : null
  notifyWorkflow({
    category: 'custody',
    event: 'license.assigned',
    subject: `License assigned: ${lic?.name || id}`,
    title: 'License assigned',
    intro: 'A software license seat was assigned.',
    fields: [
      { label: 'License', value: String(lic?.name || id) },
      { label: 'Target', value: assignedTo ? `User #${assignedTo}` : `Asset #${assetId}` },
      { label: 'Assigned by', value: actorLabel(req.user) },
    ],
    ctaPath: `/licenses/${id}`,
    itemType: 'license',
    itemId: id,
    assigneeEmail,
    assigneeOnlyExtraNote: 'A software license has been assigned to you.',
  })
  return okMessage(res, 'License assigned', lic)
})

router.post('/:id/checkin', async (req, res) => {
  const id = Number(req.params.id)
  const licRow = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [id])
  if (!licRow) return fail(res, 'License not found', 404)
  if (!(await assertRecordDomainAccess(req, res, licRow.domain_id))) return
  const empCol = await tableHasColumn('license_seats', 'assigned_employee_id')
  const seatId = req.body?.seat_id
  let seat: { id: number } | undefined
  if (seatId) {
    seat = await get<{ id: number }>(`SELECT id FROM license_seats WHERE id = ? AND license_id = ?`, [seatId, id])
  } else {
    seat = await get<{ id: number }>(empCol
      ? `SELECT id FROM license_seats WHERE license_id = ? AND (assigned_to IS NOT NULL OR assigned_employee_id IS NOT NULL OR asset_id IS NOT NULL) LIMIT 1`
      : `SELECT id FROM license_seats WHERE license_id = ? AND (assigned_to IS NOT NULL OR asset_id IS NOT NULL) LIMIT 1`, [id])
  }
  if (!seat) return fail(res, 'No assigned license found')
  const seatRow = await get<{ assigned_to: number | null }>(`SELECT assigned_to FROM license_seats WHERE id = ?`, [seat.id])
  const prevUser = seatRow?.assigned_to ? Number(seatRow.assigned_to) : null
  if (empCol) {
    await run(`UPDATE license_seats SET assigned_to = NULL, assigned_employee_id = NULL, asset_id = NULL, notes = NULL, updated_at = ? WHERE id = ?`, [now(), seat.id])
  } else {
    await run(`UPDATE license_seats SET assigned_to = NULL, asset_id = NULL, notes = NULL, updated_at = ? WHERE id = ?`, [now(), seat.id])
  }
  await logAction({ userId: req.user?.id, actionType: 'checkin', itemType: 'license', itemId: id })
  const lic = await transformLicense(id)
  const assigneeEmail = prevUser ? await resolveAssigneeEmail('user', prevUser) : null
  notifyWorkflow({
    category: 'custody',
    event: 'license.unassigned',
    subject: `License unassigned: ${lic?.name || id}`,
    title: 'License unassigned',
    intro: 'A software license seat was returned.',
    fields: [
      { label: 'License', value: String(lic?.name || id) },
      { label: 'Unassigned by', value: actorLabel(req.user) },
    ],
    ctaPath: `/licenses/${id}`,
    itemType: 'license',
    itemId: id,
    assigneeEmail,
    assigneeOnlyExtraNote: 'A software license previously assigned to you has been unassigned.',
  })
  return okMessage(res, 'License unassigned', lic)
})

export default router
