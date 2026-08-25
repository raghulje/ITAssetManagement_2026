import { get } from '../db/index.js'
import { nest } from '../utils/response.js'
import { classifyAssetAge } from '../utils/period.js'
import { publicAssetPageUrl } from './assetQr.js'
import { allowedDomainCodes, domainJoinSql, domainPayload, domainRowCode, domainSelectFields, inventoryDomainColumnsReady, tableHasColumn } from './domainAuth.js'

export async function transformAsset(id: number) {
  const domainReady = await inventoryDomainColumnsReady()
  const a = await get<Record<string, unknown>>(`
    SELECT a.*,
      m.name as model_name, m.model_number,
      c.name as category_name, c.id as category_id,
      mf.name as manufacturer_name, mf.id as manufacturer_id,
      s.name as status_name, s.type as status_type, s.color as status_color,
      co.name as company_name, co.code as company_code,
      le.code as legal_entity_code, le.name as legal_entity_name,
      dep.name as department_name,
      loc.name as location_name,
      rtd.name as rtd_location_name,
      sup.name as supplier_name,
      ${domainSelectFields(domainReady)},
      CASE
        WHEN a.assigned_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to)
        WHEN a.assigned_type = 'employee' THEN (
          SELECT CONCAT(first_name, ' ', last_name, ' (', employee_code, ')') FROM employees WHERE id = a.assigned_to
        )
        WHEN a.assigned_type = 'location' THEN (SELECT name FROM locations WHERE id = a.assigned_to)
        WHEN a.assigned_type = 'asset' THEN (SELECT CONCAT(asset_tag, ' ', COALESCE(name,'')) FROM assets WHERE id = a.assigned_to)
        WHEN a.assigned_to IS NOT NULL THEN COALESCE(
          (SELECT CONCAT(first_name, ' ', last_name, ' (', employee_code, ')') FROM employees WHERE id = a.assigned_to AND deleted_at IS NULL),
          (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to AND deleted_at IS NULL),
          (SELECT name FROM locations WHERE id = a.assigned_to),
          CONCAT('Assignee #', a.assigned_to)
        )
        ELSE NULL
      END as assigned_name
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
    LEFT JOIN status_labels s ON s.id = a.status_id
    LEFT JOIN companies co ON co.id = a.company_id
    LEFT JOIN legal_entities le ON le.id = a.legal_entity_id
    LEFT JOIN departments dep ON dep.id = a.department_id
    LEFT JOIN locations loc ON loc.id = a.location_id
    LEFT JOIN locations rtd ON rtd.id = a.rtd_location_id
    LEFT JOIN suppliers sup ON sup.id = a.supplier_id
    ${domainJoinSql('a', domainReady)}
    WHERE a.id = ? AND a.deleted_at IS NULL
  `, [id])

  if (!a) return null

  return {
    id: a.id,
    name: a.name,
    asset_tag: a.asset_tag,
    old_asset_tag: a.old_asset_tag || null,
    serial: a.serial,
    model: nest(a.model_id as number, a.model_name as string),
    model_number: a.model_number,
    status: nest(a.status_id as number, a.status_name as string, {
      status_type: a.status_type,
      status_meta: a.assigned_to ? 'deployed' : a.status_type,
    }),
    status_label: nest(a.status_id as number, a.status_name as string, {
      status_type: a.status_type,
    }),
    category: nest(a.category_id as number, a.category_name as string),
    manufacturer: nest(a.manufacturer_id as number, a.manufacturer_name as string),
    company: nest(a.company_id as number, a.company_name as string, { code: a.company_code || null }),
    legal_entity: nest(a.legal_entity_id as number, (a.legal_entity_code as string) || null, {
      code: a.legal_entity_code || null,
    }),
    department: nest(a.department_id as number, a.department_name as string),
    location: nest(a.location_id as number, a.location_name as string),
    rtd_location: nest(a.rtd_location_id as number, a.rtd_location_name as string),
    supplier: nest(a.supplier_id as number, a.supplier_name as string),
    domain: domainPayload(
      a.domain_id as number | null,
      domainRowCode({ code: a.domain_code, name: a.domain_name }),
      a.domain_name as string | null,
    ),
    assigned_to: a.assigned_to
      ? { id: a.assigned_to, name: a.assigned_name, type: a.assigned_type }
      : null,
    image: a.image || null,
    // Prefer /storage/<path under public/> so express.static(storage/public) serves it
    image_url: a.image
      ? `/storage/${String(a.image).replace(/\\/g, '/').replace(/^public\//, '')}`
      : null,
    qr_token: a.qr_token || null,
    // Always expose current public domain (ignore stale :PORT values stored in DB)
    qr_url: a.qr_token ? publicAssetPageUrl(String(a.qr_token)) : (a.qr_url || null),
    qr_image_path: a.qr_image_path || null,
    // express.static(/storage) mounts storage/public — strip leading public/
    qr_image_url: a.qr_image_path
      ? `/storage/${String(a.qr_image_path).replace(/\\/g, '/').replace(/^public\//, '')}`
      : null,
    label_printed_at: a.label_printed_at || null,
    label_print_count: Number(a.label_print_count || 0),
    last_agent_sync_at: a.last_agent_sync_at || null,
    agent_hostname: a.agent_hostname || null,
    purchase_date: a.purchase_date ? { date: a.purchase_date, formatted: a.purchase_date } : null,
    purchase_cost: a.purchase_cost,
    order_number: a.order_number,
    map_latitude: a.map_latitude != null ? Number(a.map_latitude) : null,
    map_longitude: a.map_longitude != null ? Number(a.map_longitude) : null,
    map_address: a.map_address || null,
    warranty_months: a.warranty_months,
    asset_eol_date: a.asset_eol_date
      ? { date: a.asset_eol_date, formatted: a.asset_eol_date }
      : null,
    notes: a.notes,
    received_condition: a.received_condition || null,
    domain_attrs: (() => {
      const raw = a.domain_attrs
      if (raw == null || raw === '') return null
      if (typeof raw === 'object') return raw
      try { return JSON.parse(String(raw)) } catch { return null }
    })(),
    requestable: Boolean(a.requestable),
    byod: Boolean(a.byod),
    expected_checkin: a.expected_checkin ? { date: a.expected_checkin, formatted: a.expected_checkin } : null,
    last_checkout: a.last_checkout,
    last_audit_date: a.last_audit_date,
    next_audit_date: a.next_audit_date ? { date: a.next_audit_date, formatted: a.next_audit_date } : null,
    created_at: a.created_at,
    updated_at: a.updated_at,
    /** New = purchased/created in current FY (Apr–Mar); Existing = older. */
    asset_age: classifyAssetAge(a.purchase_date, a.created_at),
    available_actions: {
      checkout: !a.assigned_to && a.status_type === 'deployable',
      checkin: Boolean(a.assigned_to),
      clone: true,
      restore: false,
      update: true,
      delete: true,
    },
  }
}

export async function transformUser(id: number, opts?: { includeDeleted?: boolean }) {
  const deletedClause = opts?.includeDeleted ? '' : ' AND u.deleted_at IS NULL'
  const u = await get<Record<string, unknown>>(`
    SELECT u.*, c.name as company_name, l.name as location_name, d.name as department_name,
      (SELECT COUNT(*) FROM assets WHERE assigned_type='user' AND assigned_to=u.id AND deleted_at IS NULL) as assets_count
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    LEFT JOIN locations l ON l.id = u.location_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?${deletedClause}
  `, [id])
  if (!u) return null
  const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions as string) : (u.permissions || {})
  return {
    id: u.id,
    avatar: null,
    name: `${u.first_name} ${u.last_name}`,
    first_name: u.first_name,
    last_name: u.last_name,
    username: u.username,
    email: u.email,
    employee_num: u.employee_num,
    jobtitle: u.jobtitle,
    phone: u.phone,
    notes: u.notes,
    activated: Boolean(u.activated),
    deleted: Boolean(u.deleted_at),
    company: nest(u.company_id as number, u.company_name as string),
    location: nest(u.location_id as number, u.location_name as string),
    department: nest(u.department_id as number, u.department_name as string),
    assets_count: u.assets_count,
    permissions: perms,
    domain_scope: {
      codes: allowedDomainCodes(perms as Record<string, unknown>),
      all: allowedDomainCodes(perms as Record<string, unknown>).length > 1,
    },
    available_actions: { update: !u.deleted_at, delete: !u.deleted_at, clone: true },
  }
}

export async function transformLicense(id: number) {
  const domainReady = await inventoryDomainColumnsReady()
  const empCol = await tableHasColumn('license_seats', 'assigned_employee_id')
  const usedWhere = empCol
    ? '(assigned_to IS NOT NULL OR assigned_employee_id IS NOT NULL OR asset_id IS NOT NULL)'
    : '(assigned_to IS NOT NULL OR asset_id IS NOT NULL)'
  const l = await get<Record<string, unknown>>(`
    SELECT l.*, c.name as company_name, c.code as company_code,
      le.code as legal_entity_code,
      m.name as manufacturer_name, cat.name as category_name,
      ${domainSelectFields(domainReady)},
      e.first_name as requester_first, e.last_name as requester_last,
      e.employee_code as requester_code, e.email as requester_email,
      (SELECT COUNT(*) FROM license_seats WHERE license_id=l.id AND ${usedWhere}) as used,
      (
        SELECT COUNT(*) FROM license_invoices li
        WHERE li.license_id = l.id AND li.deleted_at IS NULL
      ) as invoice_slots,
      (
        SELECT COUNT(*) FROM license_invoices li
        WHERE li.license_id = l.id AND li.deleted_at IS NULL
          AND (
            li.invoice_at IS NOT NULL
            OR li.amount IS NOT NULL
            OR (li.notes IS NOT NULL AND TRIM(li.notes) <> '')
            OR EXISTS (
              SELECT 1 FROM uploads u
              WHERE u.uploadable_type = 'license_invoice' AND u.uploadable_id = li.id
                AND u.deleted_at IS NULL
            )
          )
      ) as invoices_recorded
    FROM licenses l
    LEFT JOIN companies c ON c.id = l.company_id
    LEFT JOIN legal_entities le ON le.id = l.legal_entity_id
    LEFT JOIN manufacturers m ON m.id = l.manufacturer_id
    LEFT JOIN categories cat ON cat.id = l.category_id
    LEFT JOIN employees e ON e.id = l.requested_by_employee_id AND e.deleted_at IS NULL
    ${domainJoinSql('l', domainReady)}
    WHERE l.id = ? AND l.deleted_at IS NULL
  `, [id])
  if (!l) return null
  const seats = Number(l.seats)
  const used = Number(l.used)
  const cycles = Math.max(1, Number(l.subscription_cycles) || 1)
  const period = String(l.subscription_period || 'none')
  const expectedFromCycles = period === 'none' ? 0 : cycles
  const slots = Number(l.invoice_slots || 0)
  const requesterName = l.requested_by_employee_id
    ? `${l.requester_first || ''} ${l.requester_last || ''}`.trim()
      + (l.requester_code ? ` (${l.requester_code})` : '')
    : null
  return {
    id: l.id,
    name: l.name,
    product_key: l.serial,
    seats,
    free_seats_count: seats - used,
    remaining: seats - used,
    company: nest(l.company_id as number, l.company_name as string, { code: l.company_code || null }),
    legal_entity: nest(l.legal_entity_id as number, (l.legal_entity_code as string) || null, {
      code: l.legal_entity_code || null,
    }),
    manufacturer: nest(l.manufacturer_id as number, l.manufacturer_name as string),
    category: nest(l.category_id as number, l.category_name as string),
    domain: domainPayload(
      l.domain_id as number | null,
      domainRowCode({ code: l.domain_code, name: l.domain_name }),
      l.domain_name as string | null,
    ),
    requested_by_employee: nest(l.requested_by_employee_id as number, requesterName, {
      email: l.requester_email || null,
      employee_code: l.requester_code || null,
    }),
    expiration_date: l.expiration_date ? { date: l.expiration_date, formatted: l.expiration_date } : null,
    subscription_period: period,
    subscription_custom_value: l.subscription_custom_value != null ? Number(l.subscription_custom_value) : null,
    subscription_custom_unit: l.subscription_custom_unit || null,
    subscription_cycles: cycles,
    is_recurring: Boolean(l.is_recurring),
    expected_invoice_count: Math.max(expectedFromCycles, slots),
    invoices_recorded: Number(l.invoices_recorded || 0),
    purchase_cost: l.purchase_cost,
    purchase_date: l.purchase_date ? { date: l.purchase_date, formatted: l.purchase_date } : null,
    notes: l.notes,
    available_actions: { checkout: seats - used > 0, checkin: used > 0, update: true, delete: true },
  }
}

export async function transformQtyItem(table: 'accessories' | 'consumables' | 'components', id: number) {
  const checkoutTable =
    table === 'accessories' ? 'accessories_checkout'
      : table === 'consumables' ? 'consumables_users'
        : 'components_assets'
  const qtyCol = table === 'components' ? 'assigned_qty' : 'assigned_qty'
  const fkCol = table === 'accessories' ? 'accessory_id' : table === 'consumables' ? 'consumable_id' : 'component_id'
  const domainReady = await inventoryDomainColumnsReady()

  const row = await get<Record<string, unknown>>(`
    SELECT t.*, cat.name as category_name, co.name as company_name, loc.name as location_name,
      ${domainSelectFields(domainReady)},
      COALESCE((SELECT SUM(${qtyCol}) FROM ${checkoutTable} WHERE ${fkCol} = t.id), 0) as checked_out
    FROM ${table} t
    LEFT JOIN categories cat ON cat.id = t.category_id
    LEFT JOIN companies co ON co.id = t.company_id
    LEFT JOIN locations loc ON loc.id = t.location_id
    ${domainJoinSql('t', domainReady)}
    WHERE t.id = ? AND t.deleted_at IS NULL
  `, [id])

  if (!row) return null
  const remaining = Number(row.qty) - Number(row.checked_out)
  return {
    id: row.id,
    name: row.name,
    category: nest(row.category_id as number, row.category_name as string),
    company: nest(row.company_id as number, row.company_name as string),
    location: nest(row.location_id as number, row.location_name as string),
    domain: domainPayload(
      row.domain_id as number | null,
      domainRowCode({ code: row.domain_code, name: row.domain_name }),
      row.domain_name as string | null,
    ),
    model_number: row.model_number,
    qty: row.qty,
    remaining,
    min_amt: row.min_amt,
    purchase_cost: row.purchase_cost,
    notes: row.notes,
    available_actions: { checkout: remaining > 0, checkin: Number(row.checked_out) > 0, update: true, delete: true },
  }
}
