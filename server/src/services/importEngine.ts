import fs from 'node:fs'
import { parse } from 'csv-parse/sync'
import bcrypt from 'bcryptjs'
import { all, get, run, now } from '../db/index.js'
import { logAction } from './actionLog.js'
import { allocateAssetTag } from './assetTag.js'
import { ensureAssetQr } from './assetQr.js'
import {
  allowedDomainCodes,
  canAccessDomainId,
  INVENTORY_IMPORT_TYPES,
  inventoryDomainColumnsReady,
  loadAssetDomains,
  resolveImportDomainId,
  tableHasColumn,
  type AssetDomainRow,
} from './domainAuth.js'

export const IMPORT_FIELDS: Record<string, { key: string; label: string; required?: boolean; aliases?: string[]; sample?: boolean }[]> = {
  asset: [
    { key: 'name', label: 'Asset Name', aliases: ['assetname', 'name'] },
    { key: 'company', label: 'Company', aliases: ['companyname'] },
    { key: 'device_brand_serial', label: 'Device Brand and Serial Number Details', aliases: ['devicebrandandserialnumberdetails', 'brandserial'] },
    { key: 'old_asset_tag', label: 'Old asset tag', aliases: ['oldassettag'] },
    { key: 'serial', label: 'Serial', aliases: ['serialnumber', 'serial_number'] },
    { key: 'legal_entity', label: 'legal entity', aliases: ['legalentity', 'entity', 'entitycode'] },
    { key: 'entity_asset_tag', label: 'Entity Asset Tag', aliases: ['entityassettag'] },
    { key: 'manufacturer', label: 'Manufacturer', aliases: ['make', 'brand'] },
    { key: 'asset_tag', label: 'Asset Tag', sample: false, aliases: ['tag', 'assettag'] },
    { key: 'category', label: 'Asset Type', sample: false, aliases: ['asset_type', 'type', 'category'] },
    { key: 'model', label: 'Model', sample: false },
    { key: 'status', label: 'Status', sample: false },
    { key: 'location', label: 'Location', sample: false },
    { key: 'supplier', label: 'Supplier', sample: false, aliases: ['vendor'] },
    { key: 'purchase_date', label: 'Purchase Date', sample: false, aliases: ['purchasedate'] },
    { key: 'purchase_cost', label: 'Purchase Cost', sample: false, aliases: ['cost', 'purchasecost'] },
    { key: 'order_number', label: 'Purchase Order Number', sample: false, aliases: ['po', 'ponumber', 'ordernumber', 'purchaseordernumber'] },
    { key: 'notes', label: 'Notes', sample: false },
    { key: 'assigned_to', label: 'Assign to Username', sample: false, aliases: ['assigned', 'username', 'assignee'] },
  ],
  user: [
    { key: 'first_name', label: 'First Name', required: true, aliases: ['firstname', 'first'] },
    { key: 'last_name', label: 'Last Name', aliases: ['lastname', 'last'] },
    { key: 'username', label: 'Username', required: true },
    { key: 'email', label: 'Email' },
    { key: 'employee_num', label: 'Employee Number', aliases: ['employeenumber', 'empno', 'employee_id'] },
    { key: 'company', label: 'Company' },
    { key: 'location', label: 'Location' },
    { key: 'department', label: 'Department' },
    { key: 'jobtitle', label: 'Job Title', aliases: ['title', 'job_title'] },
    { key: 'phone', label: 'Phone' },
    { key: 'activated', label: 'Activated', aliases: ['active'] },
  ],
  accessory: [
    { key: 'name', label: 'Item Name', required: true, aliases: ['name', 'item'] },
    { key: 'category', label: 'Category', required: true },
    { key: 'qty', label: 'Qty', required: true, aliases: ['quantity', 'count'] },
    { key: 'min_amt', label: 'Min Qty', aliases: ['min', 'minqty', 'minimum'] },
    { key: 'company', label: 'Company' },
    { key: 'location', label: 'Location' },
    { key: 'model_number', label: 'Model Number', aliases: ['modelnumber', 'model'] },
    { key: 'purchase_cost', label: 'Purchase Cost', aliases: ['cost'] },
  ],
  consumable: [
    { key: 'name', label: 'Item Name', required: true, aliases: ['name', 'item'] },
    { key: 'category', label: 'Category', required: true },
    { key: 'qty', label: 'Qty', required: true, aliases: ['quantity', 'count'] },
    { key: 'min_amt', label: 'Min Qty', aliases: ['min', 'minqty'] },
    { key: 'company', label: 'Company' },
    { key: 'location', label: 'Location' },
    { key: 'model_number', label: 'Model Number', aliases: ['modelnumber'] },
    { key: 'purchase_cost', label: 'Purchase Cost', aliases: ['cost'] },
  ],
  component: [
    { key: 'name', label: 'Item Name', required: true, aliases: ['name', 'item'] },
    { key: 'category', label: 'Category', required: true },
    { key: 'qty', label: 'Qty', required: true, aliases: ['quantity', 'count'] },
    { key: 'min_amt', label: 'Min Qty', aliases: ['min', 'minqty'] },
    { key: 'company', label: 'Company' },
    { key: 'location', label: 'Location' },
    { key: 'model_number', label: 'Model Number', aliases: ['modelnumber'] },
    { key: 'serial', label: 'Serial' },
    { key: 'purchase_cost', label: 'Purchase Cost', aliases: ['cost'] },
  ],
  license: [
    { key: 'name', label: 'Software Name', required: true, aliases: ['software', 'product', 'license'] },
    { key: 'seats', label: 'Licenses', required: true, aliases: ['seats', 'licence', 'qty', 'quantity', 'count'] },
    { key: 'serial', label: 'Product Key', aliases: ['productkey', 'key', 'product_key'] },
    { key: 'company', label: 'Company' },
    { key: 'manufacturer', label: 'Manufacturer', aliases: ['vendor', 'oem'] },
    { key: 'expiration_date', label: 'Expiration Date', aliases: ['expires', 'expiry', 'expiration'] },
    { key: 'purchase_cost', label: 'Purchase Cost', aliases: ['cost'] },
  ],
  location: [
    { key: 'name', label: 'Name', required: true },
    { key: 'company', label: 'Company' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'country', label: 'Country' },
    { key: 'zip', label: 'Zip', aliases: ['postal', 'pincode'] },
  ],
  manufacturer: [{ key: 'name', label: 'Name', required: true }, { key: 'url', label: 'URL', aliases: ['website'] }],
  supplier: [
    { key: 'name', label: 'Name', required: true },
    { key: 'url', label: 'URL' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'contact', label: 'Contact' },
    { key: 'address', label: 'Address' },
    { key: 'notes', label: 'Notes' },
  ],
  model: [
    { key: 'name', label: 'Model Name', required: true, aliases: ['model', 'modelname'] },
    { key: 'model_number', label: 'Model Number', aliases: ['modelnumber', 'sku'] },
    { key: 'category', label: 'Category' },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'notes', label: 'Notes' },
  ],
  category: [
    { key: 'name', label: 'Name', required: true },
    { key: 'category_type', label: 'Type', required: true, aliases: ['type'] },
  ],
}

export const IMPORT_TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  user: 'Users',
  accessory: 'Accessories',
  consumable: 'Consumables',
  component: 'Components',
  license: 'Licenses',
  location: 'Locations',
  manufacturer: 'Manufacturers',
  supplier: 'Suppliers',
  model: 'Models',
  category: 'Categories',
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function cell(row: Record<string, string>, map: Record<string, string>, field: string) {
  const header = map[field]
  if (!header) return ''
  return String(row[header] ?? '').trim()
}

async function findOrCreateByName(table: string, name: string, extra: Record<string, unknown> = {}) {
  if (!name) return null
  const live = await get<{ id: number }>(`SELECT id FROM ${table} WHERE name = ? AND deleted_at IS NULL LIMIT 1`, [name])
  if (live) return live.id
  const ts = now()
  const cols = ['name', ...Object.keys(extra), 'created_at', 'updated_at']
  const vals = [name, ...Object.values(extra), ts, ts]
  try {
    const info = await run(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      vals,
    )
    return info.insertId
  } catch {
    const again = await get<{ id: number }>(`SELECT id FROM ${table} WHERE name = ? LIMIT 1`, [name])
    return again?.id ?? null
  }
}

function splitBrandSerial(value: string) {
  const text = value.trim()
  const idx = text.lastIndexOf(' - ')
  if (idx <= 0) return { brand: text, serial: '' }
  return { brand: text.slice(0, idx).trim(), serial: text.slice(idx + 3).trim() }
}

async function resolveModel(name: string, categoryId?: number | null, manufacturerId?: number | null) {
  if (!name) return null
  const m = await get<{ id: number; category_id: number | null; manufacturer_id: number | null }>(
    `SELECT id, category_id, manufacturer_id FROM models WHERE name = ? AND deleted_at IS NULL LIMIT 1`,
    [name],
  )
  if (m) {
    if (categoryId && !m.category_id) {
      await run(`UPDATE models SET category_id = ?, updated_at = ? WHERE id = ?`, [categoryId, now(), m.id])
    }
    if (manufacturerId && !m.manufacturer_id) {
      await run(`UPDATE models SET manufacturer_id = ?, updated_at = ? WHERE id = ?`, [manufacturerId, now(), m.id])
    }
    return m.id
  }
  let catId = categoryId || null
  if (!catId) {
    const cat = await get<{ id: number }>(`SELECT id FROM categories WHERE category_type='asset' AND deleted_at IS NULL LIMIT 1`)
    catId = cat?.id || null
  }
  const ts = now()
  const info = await run(
    `INSERT INTO models (name, category_id, manufacturer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [name, catId, manufacturerId || null, ts, ts],
  )
  return info.insertId
}

async function resolveLegalEntity(codeOrName: string) {
  const label = codeOrName.trim()
  if (!label) return null
  const row = await get<{ id: number }>(
    `SELECT id FROM legal_entities WHERE deleted_at IS NULL AND (code = ? OR name = ?) LIMIT 1`,
    [label, label],
  )
  return row?.id ? Number(row.id) : null
}

async function resolveStatus(name: string) {
  if (!name) {
    const d = await get<{ id: number }>(`SELECT id FROM status_labels WHERE default_label=1 AND deleted_at IS NULL LIMIT 1`)
    return d?.id || 1
  }
  const s = await get<{ id: number }>(`SELECT id FROM status_labels WHERE name = ? AND deleted_at IS NULL LIMIT 1`, [name])
  if (s) return s.id
  const ts = now()
  const info = await run(
    `INSERT INTO status_labels (name, type, created_at, updated_at) VALUES (?, 'deployable', ?, ?)`,
    [name, ts, ts],
  )
  return info.insertId
}

async function ensureCategory(name: string, categoryType: string, ts: string) {
  let cat = await get<{ id: number }>(
    `SELECT id FROM categories WHERE name=? AND category_type=? AND deleted_at IS NULL LIMIT 1`,
    [name, categoryType],
  )
  if (cat) return cat.id
  const info = await run(
    `INSERT INTO categories (name, category_type, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [name, categoryType, ts, ts],
  )
  return Number(info.insertId)
}

async function insertLicenseRows(licenseId: number, count: number, ts: string) {
  const BATCH = 200
  for (let offset = 0; offset < count; offset += BATCH) {
    const n = Math.min(BATCH, count - offset)
    const placeholders = Array(n).fill('(?, ?, ?)').join(', ')
    const vals: unknown[] = []
    for (let i = 0; i < n; i++) vals.push(licenseId, ts, ts)
    await run(`INSERT INTO license_seats (license_id, created_at, updated_at) VALUES ${placeholders}`, vals)
  }
}

async function syncLicenseCount(licenseId: number, target: number, ts: string) {
  const currentRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM license_seats WHERE license_id = ?`, [licenseId])
  const current = Number(currentRow?.c || 0)
  if (target > current) {
    await insertLicenseRows(licenseId, target - current, ts)
  } else if (target < current) {
    const free = await all<{ id: number }>(`
      SELECT id FROM license_seats
      WHERE license_id = ? AND assigned_to IS NULL AND asset_id IS NULL
      ORDER BY id DESC
      LIMIT ${current - target}
    `, [licenseId])
    if (free.length) {
      await run(
        `DELETE FROM license_seats WHERE id IN (${free.map(() => '?').join(',')})`,
        free.map((r) => r.id),
      )
    }
  }
  await run(`UPDATE licenses SET seats = ?, updated_at = ? WHERE id = ?`, [target, ts, licenseId])
}

export function parseCsvFile(filePath: string) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[]
  const headers = records.length ? Object.keys(records[0]) : []
  return { headers, rows: records, firstRow: records[0] || {} }
}

export function autoMap(headers: string[], type: string) {
  const fields = IMPORT_FIELDS[type] || []
  const map: Record<string, string> = {}
  const used = new Set<string>()

  for (const f of fields) {
    const candidates = [f.key, f.label, ...(f.aliases || [])].map(norm)
    const hit = headers.find((h) => {
      if (used.has(h)) return false
      const nh = norm(h)
      return candidates.includes(nh)
    })
    if (hit) {
      map[f.key] = hit
      used.add(hit)
    }
  }
  return map
}

export async function processImport(opts: {
  importId: number
  type: string
  mappings: Record<string, string>
  updateExisting?: boolean
  userId?: number
  filePath: string
  permissions?: Record<string, unknown>
  domain?: unknown
}) {
  const { rows } = parseCsvFile(opts.filePath)
  const errors: { row: number; message: string }[] = []
  let created = 0
  let updated = 0
  const ts = now()
  const map = opts.mappings

  const inventoryType = (INVENTORY_IMPORT_TYPES as readonly string[]).includes(opts.type)
  const domainReady = inventoryType ? await inventoryDomainColumnsReady() : false
  const domainRows: AssetDomainRow[] = domainReady ? await loadAssetDomains() : []
  let importDomainId: number | null = null
  let importDomainCode: string | null = null
  if (inventoryType && domainReady) {
    const resolved = await resolveImportDomainId(opts.permissions, opts.domain)
    importDomainId = resolved.id
    importDomainCode = resolved.code
  }

  const assertTouch = (domainId: number | null | undefined) => {
    if (!domainReady) return
    if (!canAccessDomainId(allowedDomainCodes(opts.permissions), domainId, domainRows)) {
      throw new Error('Forbidden: no access to record domain')
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2
    try {
      if (opts.type === 'asset') {
        const brandSerial = splitBrandSerial(cell(row, map, 'device_brand_serial'))
        const serial = cell(row, map, 'serial') || brandSerial.serial
        const manufacturerName = cell(row, map, 'manufacturer')
        const assetName = cell(row, map, 'name')
        const modelName = cell(row, map, 'model') || brandSerial.brand || manufacturerName || assetName
        const explicitTag = cell(row, map, 'entity_asset_tag') || cell(row, map, 'asset_tag')
        const oldTag = cell(row, map, 'old_asset_tag')
        if (!assetName && !serial && !explicitTag && !oldTag && !modelName) {
          throw new Error('Asset Name, serial, or asset tag is required')
        }
        const categoryName = cell(row, map, 'category')
        let categoryId: number | null = null
        if (categoryName) categoryId = await ensureCategory(categoryName, 'asset', ts)
        const manufacturerId = manufacturerName ? await findOrCreateByName('manufacturers', manufacturerName) : null
        const modelId = modelName ? await resolveModel(modelName, categoryId, manufacturerId) : null
        if (!categoryId && modelId) {
          const m = await get<{ category_id: number | null }>(`SELECT category_id FROM models WHERE id = ?`, [modelId])
          categoryId = m?.category_id ? Number(m.category_id) : null
        }
        if (!categoryId) {
          const fallback = await get<{ id: number }>(
            `SELECT id FROM categories WHERE category_type='asset' AND deleted_at IS NULL ORDER BY id LIMIT 1`,
          )
          categoryId = fallback?.id ? Number(fallback.id) : null
        }
        const statusId = await resolveStatus(cell(row, map, 'status'))
        const companyId = await findOrCreateByName('companies', cell(row, map, 'company'))
        const legalEntityId = await resolveLegalEntity(cell(row, map, 'legal_entity'))
        const locationId = await findOrCreateByName('locations', cell(row, map, 'location'), { company_id: companyId })
        const supplierId = await findOrCreateByName('suppliers', cell(row, map, 'supplier'))
        const matchTag = explicitTag || oldTag
        const existing = matchTag
          ? await get<{ id: number; domain_id?: number | null }>(
            domainReady
              ? `SELECT id, domain_id FROM assets WHERE deleted_at IS NULL AND (asset_tag = ? OR old_asset_tag = ?) LIMIT 1`
              : `SELECT id FROM assets WHERE deleted_at IS NULL AND (asset_tag = ? OR old_asset_tag = ?) LIMIT 1`,
            [matchTag, matchTag],
          )
          : serial
            ? await get<{ id: number; domain_id?: number | null }>(
              domainReady
                ? `SELECT id, domain_id FROM assets WHERE deleted_at IS NULL AND serial = ? LIMIT 1`
                : `SELECT id FROM assets WHERE deleted_at IS NULL AND serial = ? LIMIT 1`,
              [serial],
            )
            : undefined
        const cost = cell(row, map, 'purchase_cost') ? Number(cell(row, map, 'purchase_cost')) : null
        const hasAssetMfr = await tableHasColumn('assets', 'manufacturer_id')
        if (existing && opts.updateExisting) {
          assertTouch(existing.domain_id)
          await run(`
            UPDATE assets SET name=COALESCE(?, name), serial=COALESCE(?, serial), model_id=COALESCE(?, model_id), status_id=?,
              company_id=COALESCE(?, company_id), legal_entity_id=COALESCE(?, legal_entity_id),
              location_id=COALESCE(?, location_id), rtd_location_id=COALESCE(?, rtd_location_id),
              supplier_id=COALESCE(?, supplier_id), purchase_date=COALESCE(NULLIF(?,''), purchase_date),
              purchase_cost=COALESCE(?, purchase_cost), order_number=COALESCE(NULLIF(?,''), order_number),
              notes=COALESCE(?, notes), old_asset_tag=COALESCE(?, old_asset_tag), updated_at=?, deleted_at=NULL
              ${hasAssetMfr ? ', manufacturer_id=COALESCE(?, manufacturer_id)' : ''}
            WHERE id=?
          `, [
            assetName || null, serial || null, modelId, statusId, companyId, legalEntityId, locationId, locationId,
            supplierId, cell(row, map, 'purchase_date'), cost, cell(row, map, 'order_number'), cell(row, map, 'notes') || null,
            oldTag || null, ts,
            ...(hasAssetMfr ? [manufacturerId] : []),
            existing.id,
          ])
          await ensureAssetQr(existing.id).catch(() => undefined)
          updated++
        } else if (existing) {
          throw new Error(`Asset ${explicitTag || oldTag || serial} already exists`)
        } else {
          if (!companyId && !legalEntityId) throw new Error('Company or legal entity is required to generate the asset tag')
          if (!categoryId) throw new Error('asset type/category is required to generate asset tag')
          if (!modelId) throw new Error('A model, device brand, or asset name is required')
          let newTag = explicitTag
          if (newTag) {
            const clash = await get<{ id: number }>(`SELECT id FROM assets WHERE asset_tag = ? LIMIT 1`, [newTag])
            if (clash) throw new Error(`Asset tag ${newTag} already exists`)
          } else {
            newTag = await allocateAssetTag({
              companyId,
              legalEntityId,
              categoryId,
            })
          }
          const info = await run(
            domainReady
              ? `
            INSERT INTO assets (domain_id, asset_tag, old_asset_tag, name, serial, model_id, status_id, company_id, legal_entity_id, location_id, rtd_location_id, supplier_id,
              purchase_date, purchase_cost, order_number, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?,''), ?, NULLIF(?,''), ?, ?, ?)
          `
              : `
            INSERT INTO assets (asset_tag, old_asset_tag, name, serial, model_id, status_id, company_id, legal_entity_id, location_id, rtd_location_id, supplier_id,
              purchase_date, purchase_cost, order_number, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?,''), ?, NULLIF(?,''), ?, ?, ?)
          `,
            domainReady
              ? [
                importDomainId, newTag, oldTag || null, assetName || modelName, serial || null, modelId, statusId, companyId, legalEntityId, locationId, locationId,
                supplierId, cell(row, map, 'purchase_date'), cost, cell(row, map, 'order_number'), cell(row, map, 'notes') || null, ts, ts,
              ]
              : [
                newTag, oldTag || null, assetName || modelName, serial || null, modelId, statusId, companyId, legalEntityId, locationId, locationId,
                supplierId, cell(row, map, 'purchase_date'), cost, cell(row, map, 'order_number'), cell(row, map, 'notes') || null, ts, ts,
              ],
          )
          const newId = Number(info.insertId)
          if (hasAssetMfr && manufacturerId) {
            await run(`UPDATE assets SET manufacturer_id = ? WHERE id = ?`, [manufacturerId, newId])
          }
          await ensureAssetQr(newId).catch(() => undefined)
          created++
          const username = cell(row, map, 'assigned_to')
          if (username) {
            const user = await get<{ id: number }>(`SELECT id FROM users WHERE username = ? AND deleted_at IS NULL`, [username])
            if (user) {
              await run(`UPDATE assets SET assigned_to=?, assigned_type='user', last_checkout=?, checkout_counter=checkout_counter+1 WHERE id=?`,
                [user.id, ts, newId])
            }
          }
        }
      } else if (opts.type === 'user') {
        const username = cell(row, map, 'username')
        const first = cell(row, map, 'first_name')
        if (!username || !first) throw new Error('username and first_name required')
        const companyId = await findOrCreateByName('companies', cell(row, map, 'company'))
        const locationId = await findOrCreateByName('locations', cell(row, map, 'location'))
        const departmentId = await findOrCreateByName('departments', cell(row, map, 'department'), { company_id: companyId })
        const existing = await get<{ id: number }>(`SELECT id FROM users WHERE username = ? LIMIT 1`, [username])
        const activated = !['0', 'false', 'no', 'n'].includes(cell(row, map, 'activated').toLowerCase())
        if (existing && opts.updateExisting) {
          await run(`
            UPDATE users SET first_name=?, last_name=?, email=?, employee_num=?, company_id=?, location_id=?, department_id=?,
              jobtitle=?, phone=?, activated=?, updated_at=?, deleted_at=NULL WHERE id=?
          `, [
            first, cell(row, map, 'last_name') || '', cell(row, map, 'email') || null, cell(row, map, 'employee_num') || null,
            companyId, locationId, departmentId, cell(row, map, 'jobtitle') || null, cell(row, map, 'phone') || null,
            activated ? 1 : 0, ts, existing.id,
          ])
          updated++
        } else if (existing) {
          throw new Error(`Username ${username} already exists`)
        } else {
          await run(`
            INSERT INTO users (first_name, last_name, username, email, password, employee_num, company_id, location_id, department_id, jobtitle, phone, activated, permissions, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
          `, [
            first, cell(row, map, 'last_name') || '', username, cell(row, map, 'email') || null, bcrypt.hashSync('Welcome@2026', 10),
            cell(row, map, 'employee_num') || null, companyId, locationId, departmentId,
            cell(row, map, 'jobtitle') || null, cell(row, map, 'phone') || null, activated ? 1 : 0, ts, ts,
          ])
          created++
        }
      } else if (opts.type === 'accessory' || opts.type === 'consumable' || opts.type === 'component') {
        const table = opts.type === 'accessory' ? 'accessories' : opts.type === 'consumable' ? 'consumables' : 'components'
        const name = cell(row, map, 'name')
        const catName = cell(row, map, 'category')
        const qty = Number(cell(row, map, 'qty') || 1)
        if (!name || !catName) throw new Error('name and category required')
        if (!Number.isFinite(qty) || qty < 0) throw new Error('qty must be a non-negative number')
        const catId = await ensureCategory(catName, opts.type, ts)
        const companyId = await findOrCreateByName('companies', cell(row, map, 'company'))
        const locationId = await findOrCreateByName('locations', cell(row, map, 'location'))
        const minAmt = Number(cell(row, map, 'min_amt') || 0) || 0
        const modelNumber = cell(row, map, 'model_number') || null
        const purchaseCost = cell(row, map, 'purchase_cost') ? Number(cell(row, map, 'purchase_cost')) : null
        const existing = await get<{ id: number; domain_id?: number | null }>(
          domainReady
            ? `SELECT id, domain_id FROM ${table} WHERE name = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`
            : `SELECT id FROM ${table} WHERE name = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
          [name],
        )
        if (existing && opts.updateExisting) {
          assertTouch(existing.domain_id)
          if (table === 'components') {
            await run(`
              UPDATE components SET category_id=?, company_id=?, location_id=?, model_number=?, qty=?, min_amt=?, purchase_cost=?, serial=?, updated_at=?, deleted_at=NULL
              WHERE id=?
            `, [catId, companyId, locationId, modelNumber, qty, minAmt, purchaseCost, cell(row, map, 'serial') || null, ts, existing.id])
          } else {
            await run(`
              UPDATE ${table} SET category_id=?, company_id=?, location_id=?, model_number=?, qty=?, min_amt=?, purchase_cost=?, updated_at=?, deleted_at=NULL
              WHERE id=?
            `, [catId, companyId, locationId, modelNumber, qty, minAmt, purchaseCost, ts, existing.id])
          }
          updated++
        } else if (existing && !opts.updateExisting) {
          throw new Error(`${opts.type} "${name}" already exists`)
        } else if (table === 'components') {
          await run(
            domainReady
              ? `INSERT INTO components (domain_id, name, category_id, company_id, location_id, model_number, qty, min_amt, purchase_cost, serial, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              : `INSERT INTO components (name, category_id, company_id, location_id, model_number, qty, min_amt, purchase_cost, serial, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            domainReady
              ? [importDomainId, name, catId, companyId, locationId, modelNumber, qty, minAmt, purchaseCost, cell(row, map, 'serial') || null, ts, ts]
              : [name, catId, companyId, locationId, modelNumber, qty, minAmt, purchaseCost, cell(row, map, 'serial') || null, ts, ts],
          )
          created++
        } else if (table === 'accessories') {
          await run(
            domainReady
              ? `INSERT INTO accessories (domain_id, name, category_id, company_id, location_id, model_number, qty, min_amt, purchase_cost, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              : `INSERT INTO accessories (name, category_id, company_id, location_id, model_number, qty, min_amt, purchase_cost, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            domainReady
              ? [importDomainId, name, catId, companyId, locationId, modelNumber, qty, minAmt, purchaseCost, ts, ts]
              : [name, catId, companyId, locationId, modelNumber, qty, minAmt, purchaseCost, ts, ts],
          )
          created++
        } else {
          await run(
            domainReady
              ? `INSERT INTO consumables (domain_id, name, category_id, company_id, location_id, model_number, qty, min_amt, purchase_cost, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              : `INSERT INTO consumables (name, category_id, company_id, location_id, model_number, qty, min_amt, purchase_cost, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            domainReady
              ? [importDomainId, name, catId, companyId, locationId, modelNumber, qty, minAmt, purchaseCost, ts, ts]
              : [name, catId, companyId, locationId, modelNumber, qty, minAmt, purchaseCost, ts, ts],
          )
          created++
        }
      } else if (opts.type === 'license') {
        const name = cell(row, map, 'name')
        const seats = Number(cell(row, map, 'seats') || 1)
        if (!name) throw new Error('name required')
        if (!Number.isFinite(seats) || seats < 1) throw new Error('Licenses count must be at least 1')
        const companyId = await findOrCreateByName('companies', cell(row, map, 'company'))
        const manufacturerId = await findOrCreateByName('manufacturers', cell(row, map, 'manufacturer'))
        const existing = await get<{ id: number; domain_id?: number | null }>(
          domainReady
            ? `SELECT id, domain_id FROM licenses WHERE name = ? AND deleted_at IS NULL LIMIT 1`
            : `SELECT id FROM licenses WHERE name = ? AND deleted_at IS NULL LIMIT 1`,
          [name],
        )
        if (existing && opts.updateExisting) {
          assertTouch(existing.domain_id)
          await run(`
            UPDATE licenses SET serial=?, company_id=?, manufacturer_id=?, expiration_date=NULLIF(?,''), purchase_cost=?, updated_at=?, deleted_at=NULL
            WHERE id=?
          `, [
            cell(row, map, 'serial') || null, companyId, manufacturerId,
            cell(row, map, 'expiration_date'), cell(row, map, 'purchase_cost') ? Number(cell(row, map, 'purchase_cost')) : null,
            ts, existing.id,
          ])
          await syncLicenseCount(existing.id, seats, ts)
          updated++
        } else if (existing) {
          throw new Error(`License "${name}" already exists`)
        } else {
          const info = await run(
            domainReady
              ? `INSERT INTO licenses (domain_id, name, serial, seats, company_id, manufacturer_id, expiration_date, purchase_cost, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, NULLIF(?,''), ?, ?, ?)`
              : `INSERT INTO licenses (name, serial, seats, company_id, manufacturer_id, expiration_date, purchase_cost, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, NULLIF(?,''), ?, ?, ?)`,
            domainReady
              ? [
                importDomainId, name, cell(row, map, 'serial') || null, seats, companyId, manufacturerId,
                cell(row, map, 'expiration_date'), cell(row, map, 'purchase_cost') ? Number(cell(row, map, 'purchase_cost')) : null, ts, ts,
              ]
              : [
                name, cell(row, map, 'serial') || null, seats, companyId, manufacturerId,
                cell(row, map, 'expiration_date'), cell(row, map, 'purchase_cost') ? Number(cell(row, map, 'purchase_cost')) : null, ts, ts,
              ],
          )
          await insertLicenseRows(Number(info.insertId), seats, ts)
          created++
        }
      } else if (opts.type === 'location') {
        const name = cell(row, map, 'name')
        if (!name) throw new Error('name required')
        const companyId = await findOrCreateByName('companies', cell(row, map, 'company'))
        const existing = await get<{ id: number }>(`SELECT id FROM locations WHERE name = ? AND deleted_at IS NULL LIMIT 1`, [name])
        if (existing && opts.updateExisting) {
          await run(`
            UPDATE locations SET company_id=?, address=?, city=?, state=?, country=?, zip=?, updated_at=?, deleted_at=NULL WHERE id=?
          `, [
            companyId, cell(row, map, 'address') || null, cell(row, map, 'city') || null,
            cell(row, map, 'state') || null, cell(row, map, 'country') || null, cell(row, map, 'zip') || null, ts, existing.id,
          ])
          updated++
        } else if (existing) {
          throw new Error(`Location "${name}" already exists`)
        } else {
          await run(`
            INSERT INTO locations (name, company_id, address, city, state, country, zip, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            name, companyId, cell(row, map, 'address') || null, cell(row, map, 'city') || null,
            cell(row, map, 'state') || null, cell(row, map, 'country') || null, cell(row, map, 'zip') || null, ts, ts,
          ])
          created++
        }
      } else if (opts.type === 'manufacturer') {
        const name = cell(row, map, 'name')
        if (!name) throw new Error('name required')
        const existing = await get<{ id: number }>(`SELECT id FROM manufacturers WHERE name = ? AND deleted_at IS NULL LIMIT 1`, [name])
        if (existing && opts.updateExisting) {
          await run(`UPDATE manufacturers SET url=?, updated_at=?, deleted_at=NULL WHERE id=?`, [
            cell(row, map, 'url') || null, ts, existing.id,
          ])
          updated++
        } else if (existing) {
          throw new Error(`Manufacturer "${name}" already exists`)
        } else {
          await run(`INSERT INTO manufacturers (name, url, created_at, updated_at) VALUES (?, ?, ?, ?)`, [
            name, cell(row, map, 'url') || null, ts, ts,
          ])
          created++
        }
      } else if (opts.type === 'supplier') {
        const name = cell(row, map, 'name')
        if (!name) throw new Error('name required')
        const existing = await get<{ id: number }>(`SELECT id FROM suppliers WHERE name = ? AND deleted_at IS NULL LIMIT 1`, [name])
        if (existing && opts.updateExisting) {
          await run(`
            UPDATE suppliers SET url=?, email=?, phone=?, contact=?, address=?, notes=?, updated_at=?, deleted_at=NULL WHERE id=?
          `, [
            cell(row, map, 'url') || null,
            cell(row, map, 'email') || null,
            cell(row, map, 'phone') || null,
            cell(row, map, 'contact') || null,
            cell(row, map, 'address') || null,
            cell(row, map, 'notes') || null,
            ts, existing.id,
          ])
          updated++
        } else if (existing) {
          throw new Error(`Supplier ${name} already exists`)
        } else {
          await run(`
            INSERT INTO suppliers (name, url, email, phone, contact, address, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            name,
            cell(row, map, 'url') || null,
            cell(row, map, 'email') || null,
            cell(row, map, 'phone') || null,
            cell(row, map, 'contact') || null,
            cell(row, map, 'address') || null,
            cell(row, map, 'notes') || null,
            ts, ts,
          ])
          created++
        }
      } else if (opts.type === 'model') {
        const name = cell(row, map, 'name')
        if (!name) throw new Error('name required')
        const categoryName = cell(row, map, 'category')
        const manufacturerName = cell(row, map, 'manufacturer')
        let categoryId: number | null = null
        if (categoryName) {
          categoryId = await ensureCategory(categoryName, 'asset', ts)
        } else {
          const cat = await get<{ id: number }>(`SELECT id FROM categories WHERE category_type='asset' AND deleted_at IS NULL LIMIT 1`)
          categoryId = cat?.id ?? null
        }
        const manufacturerId = manufacturerName
          ? await findOrCreateByName('manufacturers', manufacturerName)
          : null
        const existing = await get<{ id: number }>(`SELECT id FROM models WHERE name = ? AND deleted_at IS NULL LIMIT 1`, [name])
        if (existing && opts.updateExisting) {
          await run(`
            UPDATE models SET model_number=?, category_id=?, manufacturer_id=?, notes=?, updated_at=?, deleted_at=NULL WHERE id=?
          `, [
            cell(row, map, 'model_number') || null,
            categoryId,
            manufacturerId,
            cell(row, map, 'notes') || null,
            ts, existing.id,
          ])
          updated++
        } else if (existing) {
          throw new Error(`Model ${name} already exists`)
        } else {
          await run(`
            INSERT INTO models (name, model_number, category_id, manufacturer_id, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            name,
            cell(row, map, 'model_number') || null,
            categoryId,
            manufacturerId,
            cell(row, map, 'notes') || null,
            ts, ts,
          ])
          created++
        }
      } else if (opts.type === 'category') {
        const name = cell(row, map, 'name')
        const category_type = cell(row, map, 'category_type') || 'asset'
        if (!name) throw new Error('name required')
        const existing = await get<{ id: number }>(
          `SELECT id FROM categories WHERE name = ? AND category_type = ? AND deleted_at IS NULL LIMIT 1`,
          [name, category_type],
        )
        if (existing && opts.updateExisting) {
          await run(`UPDATE categories SET updated_at=?, deleted_at=NULL WHERE id=?`, [ts, existing.id])
          updated++
        } else if (existing) {
          throw new Error(`Category "${name}" (${category_type}) already exists`)
        } else {
          await run(`INSERT INTO categories (name, category_type, created_at, updated_at) VALUES (?, ?, ?, ?)`, [name, category_type, ts, ts])
          created++
        }
      } else {
        throw new Error(`Unsupported import type: ${opts.type}`)
      }
    } catch (e) {
      errors.push({ row: rowNum, message: e instanceof Error ? e.message : String(e) })
    }
  }

  await run(`
    UPDATE imports SET status=?, row_count=?, error_count=?, error_log=?, field_map=?, updated_at=? WHERE id=?
  `, [
    errors.length && !created && !updated ? 'failed' : errors.length ? 'completed_with_errors' : 'completed',
    created + updated,
    errors.length,
    JSON.stringify(errors.slice(0, 200)),
    JSON.stringify(map),
    ts,
    opts.importId,
  ])

  await logAction({
    userId: opts.userId,
    actionType: 'import',
    itemType: 'import',
    itemId: opts.importId,
    note: `${opts.type}: +${created} ~${updated} !${errors.length}`,
  })

  return { created, updated, errors, total_rows: rows.length, domain: importDomainCode }
}
