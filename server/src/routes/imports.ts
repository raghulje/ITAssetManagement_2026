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
  const header = fields.map((f) => f.label).join(',')
  const sample = fields.map((f) => {
    if (f.key === 'asset_tag') return 'REF-1001'
    if (f.key === 'model') return 'Laptop Model'
    if (f.key === 'qty' || f.key === 'seats') return '10'
    if (f.key === 'username') return 'user.name'
    if (f.key === 'first_name') return 'First'
    if (f.key === 'last_name') return 'Last'
    if (f.key === 'name') return 'Sample Item'
    if (f.key === 'category') return 'Laptop'
    if (f.key === 'category_type') return 'asset'
    if (f.key === 'status') return 'In Stock'
    return ''
  }).join(',')
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
