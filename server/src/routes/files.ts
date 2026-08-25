import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { all, get, run, now } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { makeUploader, recordUpload, publicUrl, storageRoot, absolutePath } from '../services/uploads.js'
import { assertUploadableDomainAccess } from '../services/domainAuth.js'

const router = Router({ mergeParams: true })

const typeMap: Record<string, string> = {
  hardware: 'asset',
  assets: 'asset',
  asset: 'asset',
  users: 'user',
  user: 'user',
  licenses: 'license',
  license: 'license',
  license_invoices: 'license_invoice',
  license_invoice: 'license_invoice',
  accessories: 'accessory',
  maintenances: 'maintenance',
  maintenance: 'maintenance',
}

router.get('/:objectType/:id/files', async (req, res) => {
  const type = typeMap[req.params.objectType] || req.params.objectType
  if (!(await assertUploadableDomainAccess(req, res, type, Number(req.params.id)))) return
  const rows = await all(`
    SELECT id, filename, original_filename, mime_type, filesize, kind, created_at, disk_path
    FROM uploads WHERE uploadable_type = ? AND uploadable_id = ? AND deleted_at IS NULL
    ORDER BY id DESC
  `, [type, req.params.id])
  return okList(res, rows.map((r: Record<string, unknown>) => ({
    ...r,
    url: (String(r.kind) === 'image' || String(r.kind) === 'received')
      && String(r.disk_path).startsWith('public/')
      ? publicUrl(String(r.disk_path))
      : `/api/v1/files/${r.id}/download`,
  })))
})

router.post('/:objectType/:id/files', async (req, res) => {
  const type = typeMap[req.params.objectType] || req.params.objectType
  if (!(await assertUploadableDomainAccess(req, res, type, Number(req.params.id)))) return
  const rawKind = String(req.query.kind || req.body?.kind || 'file').toLowerCase()
  const allowed = new Set(['image', 'file', 'audit', 'invoice', 'po', 'other', 'signature', 'eula', 'received'])
  const kind = (allowed.has(rawKind) ? rawKind : 'file') as
    'image' | 'file' | 'audit' | 'invoice' | 'po' | 'other' | 'signature' | 'eula' | 'received'

  const subdir = (kind === 'image' || kind === 'received')
    ? (type === 'user' ? 'public/avatars' : 'public/assets')
    : kind === 'audit'
      ? 'private_uploads/audits'
      : `private_uploads/${
        type === 'asset' ? 'assets'
          : type === 'user' ? 'users'
            : type === 'license' ? 'licenses'
              : type === 'license_invoice' ? 'license_invoices'
                : 'maintenances'
      }`

  const upload = makeUploader(subdir, 'file')
  upload(req, res, async (err) => {
    if (err) return fail(res, err.message)
    if (!req.file) return fail(res, 'file required')
    const rel = path.relative(storageRoot, req.file.path).replace(/\\/g, '/')
    const uploadId = await recordUpload({
      type,
      id: Number(req.params.id),
      filename: req.file.filename,
      original: req.file.originalname,
      mime: req.file.mimetype,
      diskPath: rel,
      size: req.file.size,
      kind,
      userId: req.user?.id,
    })

    if (kind === 'image' && type === 'asset') {
      await run(`UPDATE assets SET image = ?, updated_at = ? WHERE id = ?`, [rel, now(), req.params.id])
    }
    if (kind === 'image' && type === 'user') {
      await run(`UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?`, [rel, now(), req.params.id])
    }

    const publicFileUrl = (kind === 'image' || kind === 'received')
      ? `/storage/${rel.replace(/^public\//, '')}`
      : null
    return okMessage(res, 'File uploaded', {
      id: uploadId,
      url: publicFileUrl || `/api/v1/files/${uploadId}/download`,
      disk_path: rel,
      filename: req.file.originalname,
      kind,
    }, 201)
  })
})

router.get('/files/:fileId/download', async (req, res) => {
  const row = await get<Record<string, unknown>>(`SELECT * FROM uploads WHERE id = ? AND deleted_at IS NULL`, [req.params.fileId])
  if (!row) return fail(res, 'File not found', 404)
  if (!(await assertUploadableDomainAccess(req, res, String(row.uploadable_type), Number(row.uploadable_id)))) return
  const abs = absolutePath(String(row.disk_path))
  if (!fs.existsSync(abs)) return fail(res, 'File missing on disk', 404)
  res.setHeader('Content-Type', String(row.mime_type || 'application/octet-stream'))
  res.setHeader('Content-Disposition', `inline; filename="${row.original_filename || row.filename}"`)
  return res.sendFile(abs)
})

router.delete('/files/:fileId', async (req, res) => {
  const row = await get<Record<string, unknown>>(`SELECT * FROM uploads WHERE id = ?`, [req.params.fileId])
  if (!row) return fail(res, 'File not found', 404)
  if (!(await assertUploadableDomainAccess(req, res, String(row.uploadable_type), Number(row.uploadable_id)))) return
  await run(`UPDATE uploads SET deleted_at = ? WHERE id = ?`, [now(), req.params.fileId])
  return okMessage(res, 'File deleted')
})

export default router
