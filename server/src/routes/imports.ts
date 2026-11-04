import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { all, get, run, now } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import {
  IMPORT_FIELDS, IMPORT_TYPE_LABELS, parseCsvFile, autoMap, processImport,
} from '../services/importEngine.js'
import { makeUploader, storageRoot } from '../services/uploads.js'

const router = Router()
const uploadCsv = makeUploader('private_uploads/imports', 'file')

router.get('/fields/:type', (req, res) => {
  const type = req.params.type
  const fields = IMPORT_FIELDS[type]
  if (!fields) return fail(res, 'Unknown import type', 404)
  return okItem(res, { type, fields, types: Object.keys(IMPORT_FIELDS) })
})

router.get('/types', (_req, res) => okItem(res, {
  types: Object.keys(IMPORT_FIELDS),
  labels: IMPORT_TYPE_LABELS,
}))

router.get('/', async (_req, res) => {
  const rows = await all(`SELECT * FROM imports ORDER BY id DESC`)
  return okList(res, rows)
})

router.get('/sample/:type', (req, res) => {
  const type = String(req.params.type || 'asset')
  const fields = IMPORT_FIELDS[type]
  if (!fields) return fail(res, 'Unknown type')
  const sampleFields = fields.filter((f) => f.sample !== false)
  const examples: Record<string, string> = {
    asset_tag: 'MEMF-LAPTOP-2026-27-0001',
    entity_asset_tag: 'MEMF-LAPTOP-2026-27-0001',
    name: type === 'asset' ? 'MacBook Pro 14' : 'Sample Item',
    company: 'Refex',
    device_brand_serial: 'MacBook Pro 14 - C02SERIAL01',
    old_asset_tag: 'OLD-100',
    serial: 'C02SERIAL01',
    legal_entity: 'MEMF',
    manufacturer: 'Apple',
    model: 'Laptop Model',
    department: 'Information Technology',
    location: 'Chennai HQ',
    category: 'Laptop',
    category_type: 'asset',
    status: 'In Stock',
    assigned_to: 'EMP001',
    supplier: 'Apple Authorised',
    purchase_date: '2026-04-01',
    purchase_cost: '60800',
    order_number: 'PO-2026-00123',
    warranty_months: '12',
    asset_eol_date: '2029-04-01',
    notes: 'Imported asset',
    processor: 'Apple M3',
    ram: '16 GB',
    storage: '512 GB',
    os: 'macOS',
    mac_address: '00-11-22-33-44-55',
    ip_address: '10.0.0.21',
    color: 'Silver',
    material: 'Aluminium',
    condition: 'New',
    map_address: 'Chennai',
    map_latitude: '13.0827',
    map_longitude: '80.2707',
    grn_number: 'GRN-1001',
    invoice_number: 'INV-1001',
    invoice_date: '2026-04-02',
    domain: 'it',
    qty: '10',
    seats: '10',
    username: 'user.name',
    first_name: 'First',
    last_name: 'Last',
  }
  const csvCell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  const header = sampleFields.map((f) => csvCell(f.label)).join(',')
  const sample = sampleFields.map((f) => csvCell(examples[f.key] || '')).join(',')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="sample-${type}.csv"`)
  return res.send(`${header}\n${sample}\n`)
})

router.get('/:id', async (req, res) => {
  const row = await get(`SELECT * FROM imports WHERE id = ?`, [req.params.id])
  if (!row) return fail(res, 'Import not found', 404)
  return okItem(res, row)
})

router.post('/', (req, res) => {
  uploadCsv(req, res, async (err) => {
    if (err) return fail(res, err.message)
    if (!req.file) return fail(res, 'CSV file required (field name: file)')
    try {
      const abs = req.file.path
      const { headers, firstRow } = parseCsvFile(abs)
      const importType = String(req.body?.import_type || req.body?.['import-type'] || 'asset')
      const relPath = path.relative(storageRoot, abs).replace(/\\/g, '/')
      const ts = now()
      const mappings = autoMap(headers, importType)
      const info = await run(`
        INSERT INTO imports (name, file_path, import_type, filesize, field_map, header_row, first_row, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `, [
        req.file.originalname, relPath, importType, req.file.size,
        JSON.stringify(mappings), JSON.stringify(headers), JSON.stringify(firstRow),
        req.user?.id || null, ts, ts,
      ])
      return okMessage(res, 'File uploaded', {
        id: info.insertId,
        name: req.file.originalname,
        import_type: importType,
        header_row: headers,
        first_row: firstRow,
        suggested_mappings: mappings,
        fields: IMPORT_FIELDS[importType] || [],
      }, 201)
    } catch (e) {
      return fail(res, e instanceof Error ? e.message : 'Upload failed')
    }
  })
})

router.post('/process/:id', async (req, res) => {
  const imp = await get<Record<string, unknown>>(`SELECT * FROM imports WHERE id = ?`, [req.params.id])
  if (!imp) return fail(res, 'Import not found', 404)
  if (!imp.file_path) return fail(res, 'Import has no file')

  const type = String(req.body?.['import-type'] || req.body?.import_type || imp.import_type || 'asset')
  // Accept either {field: header} or legacy {header: field} via column-mappings
  let mappings: Record<string, string> = {}
  if (req.body?.mappings && typeof req.body.mappings === 'object') {
    mappings = req.body.mappings
  } else if (req.body?.['column-mappings'] && typeof req.body['column-mappings'] === 'object') {
    // flip csvHeader -> field to field -> csvHeader
    for (const [header, field] of Object.entries(req.body['column-mappings'] as Record<string, string>)) {
      mappings[field] = header
    }
  } else if (imp.field_map) {
    mappings = typeof imp.field_map === 'string' ? JSON.parse(imp.field_map as string) : imp.field_map as Record<string, string>
  }

  const abs = path.isAbsolute(String(imp.file_path))
    ? String(imp.file_path)
    : path.join(storageRoot, String(imp.file_path))

  if (!fs.existsSync(abs)) return fail(res, 'Import file missing on disk', 404)

  try {
    const result = await processImport({
      importId: Number(imp.id),
      type,
      mappings,
      updateExisting: Boolean(req.body?.['import-update'] || req.body?.import_update),
      userId: req.user?.id,
      filePath: abs,
      permissions: req.user?.permissions,
      domain: req.body?.domain ?? req.body?.domain_code ?? req.body?.domain_id,
    })
    return okMessage(res, 'Import processed', result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Process failed'
    const status = /Forbidden/i.test(msg) ? 403 : /Domain is required|Invalid domain|Unknown domain/i.test(msg) ? 400 : 500
    return fail(res, msg, status)
  }
})

router.delete('/:id', async (req, res) => {
  const imp = await get<Record<string, unknown>>(`SELECT * FROM imports WHERE id = ?`, [req.params.id])
  if (!imp) return fail(res, 'Import not found', 404)
  if (imp.file_path) {
    const abs = path.join(storageRoot, String(imp.file_path))
    if (fs.existsSync(abs)) fs.unlinkSync(abs)
  }
  await run(`DELETE FROM imports WHERE id = ?`, [req.params.id])
  return okMessage(res, 'Import deleted')
})

export default router
