import { get, run, now } from '../db/index.js'
import { allocateAssetTag } from './assetTag.js'
import { logAction } from './actionLog.js'
import { ensureAssetQr } from './assetQr.js'
import { domainIdForCode, inventoryDomainColumnsReady, tableHasColumn } from './domainAuth.js'
import { ensureP2pAssetColumns } from './p2pColumns.js'

const MAX_UNITS = 100

export type P2pUnit = {
  lineKey: string
  serial: string
  assetTag: string
  name: string
  description: string
  manufacturer: string
  model: string
  category: string
  unitPrice: number | null
  condition: string
  warrantyMonths: number | null
  companyId: number | null
  companyName: string
  statusId: number | null
  modelId: number | null
  categoryId: number | null
}

export type P2pHeader = {
  grnNumber: string
  receiptDate: string | null
  receivedBy: string
  location: string
  challanNumber: string
  remarks: string
  poNumber: string
  vendor: string
  department: string
  purchaseDate: string | null
  companyName: string
  companyId: number | null
  invoiceNumber: string
  invoiceDate: string | null
  invoiceTotal: number | null
}

export type P2pEnvelope = {
  header: P2pHeader
  units: P2pUnit[]
}

type Row = Record<string, unknown>

function asObj(v: unknown): Row {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
}

function text(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function pick(obj: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function asDate(v: unknown): string | null {
  const s = text(v)
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function asMoney(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function asId(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function asQty(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

function serialsOf(line: Row): string[] {
  const many = line.serials || line.serial_numbers || line.serialNumbers
  if (Array.isArray(many)) {
    return many.map((item) => text(item)).filter(Boolean)
  }
  const one = text(pick(line, 'serial', 'serial_number', 'serialNumber', 'serial_no'))
  return one ? [one] : []
}

function headerOf(root: Row, grn: Row, po: Row, invoice: Row): P2pHeader {
  const grnNumber = text(pick(grn, 'grn_number', 'grnNumber', 'number') ?? pick(root, 'grn_number', 'grnNumber'))
  const poNumber = text(
    pick(po, 'po_number', 'poNumber', 'number', 'order_number', 'orderNumber')
    ?? pick(root, 'po_number', 'poNumber', 'order_number', 'orderNumber', 'purchase_order', 'purchaseOrder'),
  )
  const invoiceNumber = text(
    pick(invoice, 'invoice_number', 'invoiceNumber', 'number')
    ?? pick(root, 'invoice_number', 'invoiceNumber'),
  )
  const receiptDate = asDate(
    pick(grn, 'receipt_date', 'receiptDate', 'received_date', 'receivedDate')
    ?? pick(root, 'receipt_date', 'receiptDate', 'received_date', 'receivedDate'),
  )
  const invoiceDate = asDate(
    pick(invoice, 'invoice_date', 'invoiceDate', 'date')
    ?? pick(root, 'invoice_date', 'invoiceDate'),
  )
  const purchaseDate = asDate(
    pick(po, 'purchase_date', 'purchaseDate', 'po_date', 'poDate', 'order_date', 'orderDate', 'date')
    ?? pick(root, 'purchase_date', 'purchaseDate'),
  ) || invoiceDate || receiptDate
  return {
    grnNumber,
    receiptDate,
    receivedBy: text(pick(grn, 'received_by', 'receivedBy') ?? pick(root, 'received_by', 'receivedBy')),
    location: text(pick(grn, 'location', 'delivery_address', 'deliveryAddress') ?? pick(root, 'location')),
    challanNumber: text(pick(grn, 'challan_number', 'challanNumber') ?? pick(root, 'challan_number', 'challanNumber')),
    remarks: text(pick(grn, 'remarks', 'notes') ?? pick(root, 'remarks')),
    poNumber,
    vendor: text(
      pick(po, 'vendor', 'vendor_name', 'vendorName', 'supplier', 'supplier_name')
      ?? pick(invoice, 'vendor', 'vendor_name', 'vendorName')
      ?? pick(root, 'vendor', 'vendor_name', 'vendorName', 'supplier'),
    ),
    department: text(pick(po, 'department', 'department_name') ?? pick(root, 'department', 'department_name')),
    purchaseDate,
    companyName: text(
      pick(root, 'company', 'company_name', 'companyName')
      ?? pick(po, 'company', 'company_name', 'companyName', 'entity', 'legal_entity'),
    ),
    companyId: asId(pick(root, 'company_id', 'companyId') ?? pick(po, 'company_id', 'companyId')),
    invoiceNumber,
    invoiceDate,
    invoiceTotal: asMoney(
      pick(invoice, 'invoice_grand_total', 'grand_total', 'grandTotal', 'total')
      ?? pick(root, 'invoice_total', 'invoiceTotal'),
    ),
  }
}

function linesOf(root: Row, grn: Row, po: Row): Row[] {
  const raw = root.assets || root.items || root.line_items || root.lineItems || root.lines
    || grn.lineItems || grn.line_items || grn.lines
    || po.lineItems || po.line_items || po.lines
  if (Array.isArray(raw)) return raw.filter((row) => row && typeof row === 'object') as Row[]
  const looksLikeAsset = text(pick(root, 'serial', 'serial_number', 'asset_tag', 'name', 'model', 'description', 'item_name'))
  return looksLikeAsset ? [root] : []
}

/** Accept snake_case or camelCase, one GRN envelope, a batch array, or a flat asset. */
export function normalizeP2pPayload(body: unknown): { envelopes: P2pEnvelope[]; error?: string } {
  const roots = Array.isArray(body) ? body : [body]
  const envelopes: P2pEnvelope[] = []
  for (const raw of roots) {
    const root = asObj(raw)
    if (!Object.keys(root).length) continue
    const grn = asObj(root.grn || root.grn_header || root.goods_receipt || root.goodsReceipt)
    const po = asObj(root.purchase_order || root.purchaseOrder || root.po)
    const invoice = asObj(root.invoice)
    const header = headerOf(root, grn, po, invoice)
    const headerKey = header.grnNumber || header.poNumber || header.invoiceNumber
    if (!headerKey) {
      return { envelopes, error: 'Each payload needs a GRN number, PO number, or invoice number' }
    }
    const lines = linesOf(root, grn, po)
    if (!lines.length) {
      return { envelopes, error: 'No asset or line items found. Send assets, items, or lineItems.' }
    }
    const units: P2pUnit[] = []
    lines.forEach((line, lineIndex) => {
      const description = text(pick(line, 'description', 'item_name', 'itemName', 'item'))
      const name = text(pick(line, 'name', 'item_name', 'itemName')) || description
      const model = text(pick(line, 'model', 'model_name', 'modelName'))
      const lineId = text(pick(line, 'id', 'line_id', 'lineId', 'po_line_item_id', 'poLineItemId'))
        || slug(description || name || model)
        || String(lineIndex + 1)
      const serials = serialsOf(line)
      const qty = asQty(pick(line, 'received_qty', 'receivedQty', 'quantity', 'qty'))
      let count = serials.length
      if (qty != null) count = Math.max(count, qty)
      if (qty == null && count === 0 && (name || model || description)) count = 1
      count = Math.min(MAX_UNITS, count)
      for (let unit = 0; unit < count; unit++) {
        units.push({
          lineKey: `${headerKey}|${lineId}|${unit + 1}`,
          serial: serials[unit] || '',
          assetTag: text(pick(line, 'asset_tag', 'assetTag')),
          name,
          description,
          manufacturer: text(pick(line, 'manufacturer', 'manufacturer_name', 'make', 'brand')),
          model: model || name || description,
          category: text(pick(line, 'category', 'asset_type', 'assetType', 'type')) || 'Laptop',
          unitPrice: asMoney(pick(line, 'unit_price', 'unitPrice', 'price', 'purchase_cost', 'purchaseCost')),
          condition: text(pick(line, 'condition', 'condition_label', 'conditionLabel', 'received_condition')),
          warrantyMonths: asQty(pick(line, 'warranty_months', 'warrantyMonths')),
          companyId: asId(pick(line, 'company_id', 'companyId')) || header.companyId,
          companyName: text(pick(line, 'company', 'company_name', 'companyName')) || header.companyName,
          statusId: asId(pick(line, 'status_id', 'statusId')),
          modelId: asId(pick(line, 'model_id', 'modelId')),
          categoryId: asId(pick(line, 'category_id', 'categoryId')),
        })
      }
    })
    if (!units.length) {
      return { envelopes, error: 'Line items were present but none had a received quantity' }
    }
    envelopes.push({ header, units })
  }
  if (!envelopes.length) return { envelopes, error: 'Empty payload' }
  return { envelopes }
}

async function ensureNamed(table: 'manufacturers' | 'suppliers', name: string) {
  const label = name.trim()
  if (!label) return null
  const live = await get<{ id: number }>(
    `SELECT id FROM ${table} WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [label],
  )
  if (live) {
    await run(`UPDATE ${table} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`, [now(), live.id])
    return Number(live.id)
  }
  const ts = now()
  const info = await run(
    `INSERT INTO ${table} (name, created_at, updated_at) VALUES (?, ?, ?)`,
    [label, ts, ts],
  )
  return Number(info.insertId)
}

async function ensureCategory(name: string) {
  const label = name.trim() || 'Laptop'
  const live = await get<{ id: number }>(
    `SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND category_type = 'asset' AND deleted_at IS NULL LIMIT 1`,
    [label],
  )
  if (live) return Number(live.id)
  const ts = now()
  const info = await run(
    `INSERT INTO categories (name, category_type, created_at, updated_at) VALUES (?, 'asset', ?, ?)`,
    [label, ts, ts],
  )
  return Number(info.insertId)
}

async function ensureModel(name: string, categoryId: number, manufacturerId: number | null) {
  const label = name.trim() || 'P2P Item'
  const live = await get<{ id: number }>(
    `SELECT id FROM models WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`,
    [label],
  )
  if (live) return Number(live.id)
  const ts = now()
  const info = await run(
    `INSERT INTO models (name, category_id, manufacturer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [label, categoryId, manufacturerId, ts, ts],
  )
  return Number(info.insertId)
}

async function resolveCompany(unit: P2pUnit) {
  if (unit.companyId) {
    const row = await get<{ id: number }>(
      `SELECT id FROM companies WHERE id = ? AND deleted_at IS NULL`,
      [unit.companyId],
    )
    if (row) return Number(row.id)
  }
  if (unit.companyName) {
    const row = await get<{ id: number }>(
      `SELECT id FROM companies WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`,
      [unit.companyName],
    )
    if (row) return Number(row.id)
  }
  const fallback = await get<{ id: number }>(
    `SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY id LIMIT 1`,
  )
  return fallback ? Number(fallback.id) : null
}

async function resolveDepartment(name: string) {
  if (!name) return null
  const row = await get<{ id: number }>(
    `SELECT id FROM departments WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`,
    [name],
  )
  return row ? Number(row.id) : null
}

async function resolveLocation(name: string) {
  if (!name) return null
  const row = await get<{ id: number }>(
    `SELECT id FROM locations WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL LIMIT 1`,
    [name],
  )
  return row ? Number(row.id) : null
}

async function deployableStatusId() {
  const row = await get<{ id: number }>(
    `SELECT id FROM status_labels WHERE deleted_at IS NULL AND type = 'deployable' ORDER BY default_label DESC, id LIMIT 1`,
  )
  if (row?.id) return Number(row.id)
  const any = await get<{ id: number }>(`SELECT id FROM status_labels WHERE deleted_at IS NULL ORDER BY id LIMIT 1`)
  return any?.id ? Number(any.id) : null
}

async function findExisting(unit: P2pUnit) {
  const byKey = await get<{ id: number; serial: string | null; name: string | null; p2p_line_key: string | null; model_id: number | null }>(`
    SELECT id, serial, name, p2p_line_key, model_id FROM assets
    WHERE deleted_at IS NULL AND p2p_line_key = ? LIMIT 1
  `, [unit.lineKey])
  if (byKey) return byKey
  if (unit.serial) {
    const bySerial = await get<{ id: number; serial: string | null; name: string | null; p2p_line_key: string | null; model_id: number | null }>(`
      SELECT id, serial, name, p2p_line_key, model_id FROM assets
      WHERE deleted_at IS NULL AND serial = ? ORDER BY id DESC LIMIT 1
    `, [unit.serial])
    if (bySerial) return bySerial
  }
  if (unit.assetTag) {
    const byTag = await get<{ id: number; serial: string | null; name: string | null; p2p_line_key: string | null; model_id: number | null }>(`
      SELECT id, serial, name, p2p_line_key, model_id FROM assets
      WHERE deleted_at IS NULL AND asset_tag = ? LIMIT 1
    `, [unit.assetTag])
    if (byTag) return byTag
  }
  return null
}

function purchaseNote(header: P2pHeader, unit: P2pUnit) {
  const bits = [
    header.grnNumber ? `GRN ${header.grnNumber}` : '',
    header.poNumber ? `PO ${header.poNumber}` : '',
    header.invoiceNumber ? `Invoice ${header.invoiceNumber}` : '',
    header.receivedBy ? `Received by ${header.receivedBy}` : '',
    header.challanNumber ? `Challan ${header.challanNumber}` : '',
    header.remarks,
    unit.description && unit.description !== unit.name ? unit.description : '',
  ].filter(Boolean)
  return bits.join(' · ').slice(0, 4000)
}

export type P2pAssetResult = {
  id: number
  asset_tag: string
  serial: string | null
  action: 'created' | 'updated'
  line_key: string
}

export async function consumeP2pGrn(body: unknown) {
  const normalized = normalizeP2pPayload(body)
  if (normalized.error) {
    return { ok: false as const, error: normalized.error, errors: [normalized.error], created: [] as P2pAssetResult[], updated: [] as P2pAssetResult[], grn_number: null, po_number: null, invoice_number: null }
  }
  await ensureP2pAssetColumns()
  const domainReady = await inventoryDomainColumnsReady()
  const domainId = domainReady ? await domainIdForCode('it') : null
  const hasManufacturer = await tableHasColumn('assets', 'manufacturer_id')
  const hasLocationText = await tableHasColumn('assets', 'location_text')
  const hasCondition = await tableHasColumn('assets', 'received_condition')
  const created: P2pAssetResult[] = []
  const updated: P2pAssetResult[] = []
  const errors: string[] = []

  for (const envelope of normalized.envelopes) {
    const { header } = envelope
    const supplierId = header.vendor ? await ensureNamed('suppliers', header.vendor) : null
    const departmentId = await resolveDepartment(header.department)
    const locationId = await resolveLocation(header.location)
    for (const unit of envelope.units) {
      try {
        const existing = await findExisting(unit)
        const manufacturerId = unit.manufacturer ? await ensureNamed('manufacturers', unit.manufacturer) : null
        const payload = JSON.stringify({ header, unit })
        if (existing) {
          await updateAsset({
            id: existing.id,
            header,
            unit,
            existing,
            supplierId,
            departmentId,
            locationId,
            manufacturerId,
            hasManufacturer,
            hasLocationText,
            hasCondition,
            payload,
          })
          const tag = await get<{ asset_tag: string; serial: string | null }>(
            `SELECT asset_tag, serial FROM assets WHERE id = ?`,
            [existing.id],
          )
          updated.push({
            id: existing.id,
            asset_tag: tag?.asset_tag || unit.assetTag,
            serial: tag?.serial || unit.serial || null,
            action: 'updated',
            line_key: unit.lineKey,
          })
          continue
        }
        const row = await createAsset({
          header,
          unit,
          supplierId,
          departmentId,
          locationId,
          manufacturerId,
          domainReady,
          domainId,
          hasManufacturer,
          hasLocationText,
          hasCondition,
          payload,
        })
        created.push(row)
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Could not save asset')
      }
    }
  }

  return {
    ok: errors.length === 0 || created.length + updated.length > 0,
    error: errors[0],
    errors,
    created,
    updated,
    grn_number: normalized.envelopes[0]?.header.grnNumber || null,
    po_number: normalized.envelopes[0]?.header.poNumber || null,
    invoice_number: normalized.envelopes[0]?.header.invoiceNumber || null,
  }
}

async function updateAsset(opts: {
  id: number
  header: P2pHeader
  unit: P2pUnit
  existing: { serial: string | null; name: string | null; p2p_line_key: string | null; model_id: number | null }
  supplierId: number | null
  departmentId: number | null
  locationId: number | null
  manufacturerId: number | null
  hasManufacturer: boolean
  hasLocationText: boolean
  hasCondition: boolean
  payload: string
}) {
  const sets = [
    'grn_number = COALESCE(?, grn_number)',
    'po_number = COALESCE(?, po_number)',
    'order_number = COALESCE(?, order_number)',
    'invoice_number = COALESCE(?, invoice_number)',
    'invoice_date = COALESCE(?, invoice_date)',
    'purchase_date = COALESCE(?, purchase_date)',
    'purchase_cost = COALESCE(?, purchase_cost)',
    'warranty_months = COALESCE(?, warranty_months)',
    'supplier_id = COALESCE(?, supplier_id)',
    'department_id = COALESCE(department_id, ?)',
    'p2p_payload = ?',
    'updated_at = ?',
  ]
  const vals: unknown[] = [
    opts.header.grnNumber || null,
    opts.header.poNumber || null,
    opts.header.poNumber || null,
    opts.header.invoiceNumber || null,
    opts.header.invoiceDate,
    opts.header.purchaseDate,
    opts.unit.unitPrice,
    opts.unit.warrantyMonths,
    opts.supplierId,
    opts.departmentId,
    opts.payload,
    now(),
  ]
  if (!text(opts.existing.serial) && opts.unit.serial) {
    sets.push('serial = ?')
    vals.push(opts.unit.serial)
  }
  if (!text(opts.existing.name) && opts.unit.name) {
    sets.push('name = ?')
    vals.push(opts.unit.name)
  }
  if (!opts.existing.p2p_line_key) {
    sets.push('p2p_line_key = ?')
    vals.push(opts.unit.lineKey)
  }
  if (!opts.existing.model_id && opts.unit.model) {
    const categoryId = opts.unit.categoryId || await ensureCategory(opts.unit.category)
    const modelId = opts.unit.modelId || await ensureModel(opts.unit.model, categoryId, opts.manufacturerId)
    sets.push('model_id = ?')
    vals.push(modelId)
  }
  if (opts.hasManufacturer && opts.manufacturerId) {
    sets.push('manufacturer_id = COALESCE(manufacturer_id, ?)')
    vals.push(opts.manufacturerId)
  }
  if (opts.locationId) {
    sets.push('location_id = COALESCE(location_id, ?)')
    vals.push(opts.locationId)
  } else if (opts.hasLocationText && opts.header.location) {
    sets.push('location_text = COALESCE(location_text, ?)')
    vals.push(opts.header.location.slice(0, 255))
  }
  if (opts.hasCondition && opts.unit.condition) {
    sets.push('received_condition = COALESCE(received_condition, ?)')
    vals.push(opts.unit.condition.slice(0, 191))
  }
  vals.push(opts.id)
  await run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, vals)
  await logAction({
    actionType: 'update',
    itemType: 'asset',
    itemId: opts.id,
    note: `Updated from P2P GRN ${opts.header.grnNumber || opts.header.poNumber || opts.header.invoiceNumber}`,
  }).catch(() => undefined)
}

async function createAsset(opts: {
  header: P2pHeader
  unit: P2pUnit
  supplierId: number | null
  departmentId: number | null
  locationId: number | null
  manufacturerId: number | null
  domainReady: boolean
  domainId: number | null
  hasManufacturer: boolean
  hasLocationText: boolean
  hasCondition: boolean
  payload: string
}): Promise<P2pAssetResult> {
  const companyId = await resolveCompany(opts.unit)
  if (!companyId) throw new Error('No company is configured, so an asset tag cannot be generated')
  const categoryId = opts.unit.categoryId || await ensureCategory(opts.unit.category)
  const modelId = opts.unit.modelId || await ensureModel(opts.unit.model || opts.unit.name || 'P2P Item', categoryId, opts.manufacturerId)
  const statusId = opts.unit.statusId || await deployableStatusId()
  if (!statusId) throw new Error('No asset status is configured')
  let assetTag = opts.unit.assetTag
  if (assetTag) {
    const clash = await get<{ id: number }>(`SELECT id FROM assets WHERE asset_tag = ? LIMIT 1`, [assetTag])
    if (clash) assetTag = ''
  }
  if (!assetTag) {
    assetTag = await allocateAssetTag({ companyId, categoryId })
  }
  const ts = now()
  const cols = [
    'asset_tag', 'name', 'serial', 'model_id', 'status_id', 'company_id', 'department_id', 'supplier_id',
    'location_id', 'purchase_date', 'purchase_cost', 'order_number', 'warranty_months', 'notes',
    'grn_number', 'invoice_number', 'invoice_date', 'po_number', 'p2p_line_key', 'p2p_payload',
    'requestable', 'byod', 'created_at', 'updated_at',
  ]
  const vals: unknown[] = [
    assetTag,
    opts.unit.name || opts.unit.model || null,
    opts.unit.serial || null,
    modelId,
    statusId,
    companyId,
    opts.departmentId,
    opts.supplierId,
    opts.locationId,
    opts.header.purchaseDate,
    opts.unit.unitPrice,
    opts.header.poNumber || null,
    opts.unit.warrantyMonths,
    purchaseNote(opts.header, opts.unit) || null,
    opts.header.grnNumber || null,
    opts.header.invoiceNumber || null,
    opts.header.invoiceDate,
    opts.header.poNumber || null,
    opts.unit.lineKey,
    opts.payload,
    0,
    0,
    ts,
    ts,
  ]
  if (opts.domainReady && opts.domainId) {
    cols.unshift('domain_id')
    vals.unshift(opts.domainId)
  }
  if (opts.hasManufacturer) {
    const at = cols.indexOf('model_id') + 1
    cols.splice(at, 0, 'manufacturer_id')
    vals.splice(at, 0, opts.manufacturerId)
  }
  if (opts.hasLocationText && !opts.locationId && opts.header.location) {
    cols.push('location_text')
    vals.push(opts.header.location.slice(0, 255))
  }
  if (opts.hasCondition && opts.unit.condition) {
    cols.push('received_condition')
    vals.push(opts.unit.condition.slice(0, 191))
  }
  const info = await run(
    `INSERT INTO assets (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    vals,
  )
  const id = Number(info.insertId)
  await ensureAssetQr(id).catch(() => undefined)
  await logAction({
    actionType: 'create',
    itemType: 'asset',
    itemId: id,
    note: `Created from P2P GRN ${opts.header.grnNumber || opts.header.poNumber || opts.header.invoiceNumber}`,
  }).catch(() => undefined)
  return {
    id,
    asset_tag: assetTag,
    serial: opts.unit.serial || null,
    action: 'created',
    line_key: opts.unit.lineKey,
  }
}

export function p2pPayloadExample() {
  return {
    grn: {
      grn_number: 'GRN-2026-001',
      receipt_date: '2026-11-03',
      received_by: 'Store User',
      location: 'Chennai HQ',
      challan_number: 'CH-12',
      remarks: 'Goods received',
    },
    purchase_order: {
      po_number: 'PO-2026-100',
      vendor: 'Apple India',
      department: 'IT',
      purchase_date: '2026-10-20',
      company: 'Refex',
    },
    invoice: {
      invoice_number: 'INV-8891',
      invoice_date: '2026-11-01',
      grand_total: 180000,
    },
    assets: [
      {
        serial: 'C02SERIAL01',
        name: 'MacBook Pro 14',
        manufacturer: 'Apple',
        model: 'MacBook Pro 14',
        category: 'Laptop',
        received_qty: 1,
        unit_price: 180000,
        condition: 'Good',
        warranty_months: 12,
      },
    ],
  }
}
