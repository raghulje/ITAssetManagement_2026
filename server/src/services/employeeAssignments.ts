import { all, get } from '../db/index.js'
import {
  allowedDomainCodes,
  domainCodeForId,
  inventoryDomainClause,
  inventoryDomainColumnsReady,
  loadAssetDomains,
  scopedDomainCodes,
  tableHasColumn,
  type DomainCode,
} from './domainAuth.js'

export type AssignmentRow = {
  module: string
  module_label: string
  domain: { id: number | null; code: DomainCode; name: string }
  item_id: number
  item_name: string
  identifier: string | null
  status: string
  assigned_at: string | null
  assigned_by: string | null
  qty: number | null
  checkout_id: number | null
}

export type HistoryRow = {
  id: number
  action: string
  action_label: string
  module: string
  module_label: string
  domain: { id: number | null; code: DomainCode; name: string } | null
  item_id: number | null
  item_name: string | null
  identifier: string | null
  employee_id: number
  employee_name: string | null
  performed_by: string | null
  performed_by_id: number | null
  action_date: string | null
  note: string | null
}

const MODULE_LABEL: Record<string, string> = {
  asset: 'Asset',
  license: 'License',
  accessory: 'Accessory',
  consumable: 'Consumable',
  component: 'Component',
}

function actionLabel(action: string) {
  if (action === 'checkout') return 'Assigned'
  if (action === 'checkin') return 'Unassigned'
  if (action === 'replace_out') return 'Replaced (out)'
  if (action === 'replace_in') return 'Replaced (in)'
  return action
}

function moduleFromItemType(itemType: string) {
  if (itemType === 'asset') return 'asset'
  if (itemType === 'license') return 'license'
  if (itemType === 'accessory') return 'accessory'
  if (itemType === 'consumable') return 'consumable'
  if (itemType === 'component') return 'component'
  return itemType
}

async function domainObj(domainId: number | null | undefined): Promise<{ id: number | null; code: DomainCode; name: string }> {
  const domains = await loadAssetDomains()
  const code = domainId == null
    ? 'it'
    : (domains.find((d) => d.id === Number(domainId))?.code || 'it')
  const row = domains.find((d) => d.code === code)
  return {
    id: row?.id ?? domainId ?? null,
    code,
    name: row?.name || code.toUpperCase(),
  }
}

export async function listEmployeeAssignments(
  employeeId: number,
  perms: Record<string, unknown> | null | undefined,
  requestedDomain?: unknown,
): Promise<{ rows: AssignmentRow[]; summary: Record<string, number> }> {
  const allowed = allowedDomainCodes(perms)
  const scoped = scopedDomainCodes(allowed, requestedDomain)
  const emp = await get<{ email: string | null; personal_email: string | null }>(`
    SELECT email, personal_email FROM employees WHERE id = ? AND deleted_at IS NULL
  `, [employeeId])
  if (!emp) return { rows: [], summary: { total: 0, it: 0, admin: 0 } }

  const emails = [emp.email, emp.personal_email]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean)
  const emailPh = emails.length ? emails.map(() => '?').join(',') : null

  const assetClause = await inventoryDomainClause(perms, requestedDomain, 'a')
  const licClause = await inventoryDomainClause(perms, requestedDomain, 'l')
  const accClause = await inventoryDomainClause(perms, requestedDomain, 't')
  const consClause = await inventoryDomainClause(perms, requestedDomain, 't')
  const compClause = await inventoryDomainClause(perms, requestedDomain, 't')
  const domainReady = await inventoryDomainColumnsReady()
  const empSeat = await tableHasColumn('license_seats', 'assigned_employee_id')
  const empAcc = await tableHasColumn('accessories_checkout', 'assigned_employee_id')
  const empCons = await tableHasColumn('consumables_users', 'assigned_employee_id')
  const aDomain = domainReady ? 'a.domain_id' : 'NULL as domain_id'
  const lDomain = domainReady ? 'l.domain_id' : 'NULL as domain_id'
  const tDomain = domainReady ? 't.domain_id' : 'NULL as domain_id'

  const assets = await all<Record<string, unknown>>(`
    SELECT a.id, a.name, a.asset_tag, ${aDomain}, a.last_checkout,
      (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.updated_by) as assigned_by
    FROM assets a
    WHERE a.deleted_at IS NULL
      AND a.assigned_type = 'employee' AND a.assigned_to = ?
      ${assetClause.sql}
  `, [employeeId, ...assetClause.params])

  const licenses = await all<Record<string, unknown>>(`
    SELECT l.id, l.name, l.serial, ${lDomain}, ls.id as checkout_id, ls.updated_at as assigned_at
    FROM license_seats ls
    INNER JOIN licenses l ON l.id = ls.license_id AND l.deleted_at IS NULL
    WHERE (
      ${empSeat ? 'ls.assigned_employee_id = ?' : '0'}
      ${emailPh ? `OR ls.assigned_to IN (SELECT id FROM users WHERE deleted_at IS NULL AND LOWER(email) IN (${emailPh}))` : ''}
    )
      AND (ls.assigned_to IS NOT NULL ${empSeat ? 'OR ls.assigned_employee_id IS NOT NULL' : ''} OR ls.asset_id IS NOT NULL)
      ${licClause.sql}
  `, empSeat
    ? (emailPh ? [employeeId, ...emails, ...licClause.params] : [employeeId, ...licClause.params])
    : (emailPh ? [...emails, ...licClause.params] : licClause.params))

  const accessories = await all<Record<string, unknown>>(`
    SELECT t.id, t.name, t.model_number, ${tDomain}, ac.id as checkout_id, ac.created_at as assigned_at,
      ac.assigned_qty as qty,
      (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = ac.created_by) as assigned_by
    FROM accessories_checkout ac
    INNER JOIN accessories t ON t.id = ac.accessory_id AND t.deleted_at IS NULL
    WHERE (
      ${empAcc ? 'ac.assigned_employee_id = ? OR ' : ''}
      (ac.assigned_type = 'employee' AND ac.assigned_to = ?)
      ${emailPh ? `OR (ac.assigned_type = 'user' AND ac.assigned_to IN (SELECT id FROM users WHERE deleted_at IS NULL AND LOWER(email) IN (${emailPh})))` : ''}
    )
      ${accClause.sql}
  `, empAcc
    ? (emailPh ? [employeeId, employeeId, ...emails, ...accClause.params] : [employeeId, employeeId, ...accClause.params])
    : (emailPh ? [employeeId, ...emails, ...accClause.params] : [employeeId, ...accClause.params]))

  const consumables = await all<Record<string, unknown>>(`
    SELECT t.id, t.name, t.item_no, t.model_number, ${tDomain}, cu.id as checkout_id, cu.created_at as assigned_at,
      cu.assigned_qty as qty,
      (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = cu.created_by) as assigned_by
    FROM consumables_users cu
    INNER JOIN consumables t ON t.id = cu.consumable_id AND t.deleted_at IS NULL
    WHERE (
      ${empCons ? 'cu.assigned_employee_id = ?' : '0'}
      ${emailPh ? `OR cu.assigned_to IN (SELECT id FROM users WHERE deleted_at IS NULL AND LOWER(email) IN (${emailPh}))` : ''}
    )
      ${consClause.sql}
  `, empCons
    ? (emailPh ? [employeeId, ...emails, ...consClause.params] : [employeeId, ...consClause.params])
    : (emailPh ? [...emails, ...consClause.params] : consClause.params))

  const components = await all<Record<string, unknown>>(`
    SELECT t.id, t.name, t.serial, ${tDomain}, ca.id as checkout_id, ca.created_at as assigned_at,
      ca.assigned_qty as qty,
      a.asset_tag as identifier,
      (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = ca.created_by) as assigned_by
    FROM components_assets ca
    INNER JOIN components t ON t.id = ca.component_id AND t.deleted_at IS NULL
    INNER JOIN assets a ON a.id = ca.asset_id AND a.deleted_at IS NULL
    WHERE a.assigned_type = 'employee' AND a.assigned_to = ?
      ${compClause.sql}
  `, [employeeId, ...compClause.params])

  const rows: AssignmentRow[] = []

  for (const a of assets) {
    const domain = await domainObj(a.domain_id as number | null)
    if (!scoped.includes(domain.code)) continue
    rows.push({
      module: 'asset',
      module_label: 'Asset',
      domain,
      item_id: Number(a.id),
      item_name: String(a.name || a.asset_tag || 'Asset'),
      identifier: a.asset_tag != null ? String(a.asset_tag) : null,
      status: 'Assigned',
      assigned_at: a.last_checkout ? String(a.last_checkout) : null,
      assigned_by: a.assigned_by ? String(a.assigned_by) : null,
      qty: null,
      checkout_id: null,
    })
  }
  for (const l of licenses) {
    const domain = await domainObj(l.domain_id as number | null)
    if (!scoped.includes(domain.code)) continue
    rows.push({
      module: 'license',
      module_label: 'License',
      domain,
      item_id: Number(l.id),
      item_name: String(l.name || 'License'),
      identifier: l.serial != null ? String(l.serial) : null,
      status: 'Active',
      assigned_at: l.assigned_at ? String(l.assigned_at) : null,
      assigned_by: null,
      qty: 1,
      checkout_id: Number(l.checkout_id),
    })
  }
  for (const a of accessories) {
    const domain = await domainObj(a.domain_id as number | null)
    if (!scoped.includes(domain.code)) continue
    rows.push({
      module: 'accessory',
      module_label: 'Accessory',
      domain,
      item_id: Number(a.id),
      item_name: String(a.name || 'Accessory'),
      identifier: a.model_number != null ? String(a.model_number) : null,
      status: 'Assigned',
      assigned_at: a.assigned_at ? String(a.assigned_at) : null,
      assigned_by: a.assigned_by ? String(a.assigned_by) : null,
      qty: Number(a.qty || 1),
      checkout_id: Number(a.checkout_id),
    })
  }
  for (const c of consumables) {
    const domain = await domainObj(c.domain_id as number | null)
    if (!scoped.includes(domain.code)) continue
    rows.push({
      module: 'consumable',
      module_label: 'Consumable',
      domain,
      item_id: Number(c.id),
      item_name: String(c.name || 'Consumable'),
      identifier: (c.item_no || c.model_number) != null ? String(c.item_no || c.model_number) : null,
      status: 'Issued',
      assigned_at: c.assigned_at ? String(c.assigned_at) : null,
      assigned_by: c.assigned_by ? String(c.assigned_by) : null,
      qty: Number(c.qty || 1),
      checkout_id: Number(c.checkout_id),
    })
  }
  for (const c of components) {
    const domain = await domainObj(c.domain_id as number | null)
    if (!scoped.includes(domain.code)) continue
    rows.push({
      module: 'component',
      module_label: 'Component',
      domain,
      item_id: Number(c.id),
      item_name: String(c.name || 'Component'),
      identifier: c.identifier != null ? String(c.identifier) : (c.serial != null ? String(c.serial) : null),
      status: 'Assigned',
      assigned_at: c.assigned_at ? String(c.assigned_at) : null,
      assigned_by: c.assigned_by ? String(c.assigned_by) : null,
      qty: Number(c.qty || 1),
      checkout_id: Number(c.checkout_id),
    })
  }

  rows.sort((a, b) => String(b.assigned_at || '').localeCompare(String(a.assigned_at || '')))

  const summary = {
    total: rows.length,
    it: rows.filter((r) => r.domain.code === 'it').length,
    admin: rows.filter((r) => r.domain.code === 'admin').length,
  }
  return { rows, summary }
}

export async function listEmployeeAssignmentHistory(
  employeeId: number,
  perms: Record<string, unknown> | null | undefined,
  requestedDomain?: unknown,
): Promise<HistoryRow[]> {
  const allowed = allowedDomainCodes(perms)
  const scoped = scopedDomainCodes(allowed, requestedDomain)
  const emp = await get<{
    email: string | null
    personal_email: string | null
    first_name: string | null
    last_name: string | null
  }>(`
    SELECT email, personal_email, first_name, last_name FROM employees WHERE id = ? AND deleted_at IS NULL
  `, [employeeId])
  if (!emp) return []

  const emails = [emp.email, emp.personal_email]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean)
  const employeeName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim()

  const userIds = emails.length
    ? await all<{ id: number }>(`
        SELECT id FROM users WHERE deleted_at IS NULL AND LOWER(email) IN (${emails.map(() => '?').join(',')})
      `, emails)
    : []
  const userIdList = userIds.map((u) => Number(u.id))

  const params: unknown[] = [employeeId, employeeId]
  let userTargetSql = ''
  if (userIdList.length) {
    userTargetSql = ` OR (al.target_type = 'user' AND al.target_id IN (${userIdList.map(() => '?').join(',')}))`
    params.push(...userIdList)
  }

  const domainReady = await inventoryDomainColumnsReady()
  const rows = await all<Record<string, unknown>>(`
    SELECT al.*, u.username as admin_username,
      CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) as admin_name,
      CASE
        WHEN al.item_type = 'asset' THEN (SELECT CONCAT(COALESCE(asset_tag,''), ' ', COALESCE(name,'')) FROM assets WHERE id = al.item_id)
        WHEN al.item_type = 'license' THEN (SELECT name FROM licenses WHERE id = al.item_id)
        WHEN al.item_type = 'accessory' THEN (SELECT name FROM accessories WHERE id = al.item_id)
        WHEN al.item_type = 'consumable' THEN (SELECT name FROM consumables WHERE id = al.item_id)
        WHEN al.item_type = 'component' THEN (SELECT name FROM components WHERE id = al.item_id)
        WHEN al.item_type = 'employee' THEN (
          SELECT TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) FROM employees WHERE id = al.item_id
        )
        ELSE CONCAT(COALESCE(al.item_type,''), '#', COALESCE(al.item_id,''))
      END as item_name,
      CASE
        WHEN al.item_type = 'asset' THEN (SELECT asset_tag FROM assets WHERE id = al.item_id)
        WHEN al.item_type = 'license' THEN (SELECT serial FROM licenses WHERE id = al.item_id)
        ELSE NULL
      END as identifier,
      ${domainReady ? `CASE
        WHEN al.item_type = 'asset' THEN (SELECT domain_id FROM assets WHERE id = al.item_id)
        WHEN al.item_type = 'license' THEN (SELECT domain_id FROM licenses WHERE id = al.item_id)
        WHEN al.item_type = 'accessory' THEN (SELECT domain_id FROM accessories WHERE id = al.item_id)
        WHEN al.item_type = 'consumable' THEN (SELECT domain_id FROM consumables WHERE id = al.item_id)
        WHEN al.item_type = 'component' THEN (SELECT domain_id FROM components WHERE id = al.item_id)
        ELSE NULL
      END as domain_id` : 'NULL as domain_id'}
    FROM action_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.deleted_at IS NULL
      AND (
        (al.target_type = 'employee' AND al.target_id = ?)
        OR (al.item_type = 'employee' AND al.item_id = ?)
        ${userTargetSql}
      )
    ORDER BY al.action_date DESC, al.id DESC
  `, params)

  const out: HistoryRow[] = []
  for (const r of rows) {
    const itemType = String(r.item_type || '')
    const module = moduleFromItemType(itemType)
    const isInventory = ['asset', 'license', 'accessory', 'consumable', 'component'].includes(module)
    let domain: HistoryRow['domain'] = null
    if (isInventory) {
      domain = await domainObj(r.domain_id as number | null)
      if (!domain || !scoped.includes(domain.code)) continue
    } else if (requestedDomain && normalizeRequested(requestedDomain)) {
      // Non-inventory employee events are shown unless a specific domain was requested
      continue
    }
    const adminName = String(r.admin_name || '').trim()
    out.push({
      id: Number(r.id),
      action: String(r.action_type || ''),
      action_label: actionLabel(String(r.action_type || '')),
      module,
      module_label: MODULE_LABEL[module] || module,
      domain,
      item_id: r.item_id != null ? Number(r.item_id) : null,
      item_name: r.item_name != null ? String(r.item_name).trim() : null,
      identifier: r.identifier != null ? String(r.identifier) : null,
      employee_id: employeeId,
      employee_name: employeeName || null,
      performed_by: adminName || (r.admin_username ? String(r.admin_username) : null),
      performed_by_id: r.user_id != null ? Number(r.user_id) : null,
      action_date: r.action_date ? String(r.action_date) : null,
      note: r.note != null ? String(r.note) : null,
    })
  }
  return out
}

function normalizeRequested(requested: unknown): boolean {
  return requested != null && String(requested).trim() !== '' && String(requested).toLowerCase() !== 'all'
}

export async function filterAssetIdsByDomain(
  ids: number[],
  perms: Record<string, unknown> | null | undefined,
  requestedDomain?: unknown,
) {
  if (!ids.length) return []
  const clause = await inventoryDomainClause(perms, requestedDomain, 'a')
  const rows = await all<{ id: number }>(`
    SELECT a.id FROM assets a
    WHERE a.id IN (${ids.map(() => '?').join(',')}) AND a.deleted_at IS NULL
      ${clause.sql}
  `, [...ids, ...clause.params])
  return rows.map((r) => Number(r.id))
}

export { domainCodeForId }
