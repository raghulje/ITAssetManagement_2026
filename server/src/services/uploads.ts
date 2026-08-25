import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { run, now } from '../db/index.js'
import { logAction } from './actionLog.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const storageRoot = path.resolve(__dirname, '../../storage')

const dirs = [
  'public/assets',
  'public/avatars',
  'public/barcodes',
  'public/labels',
  'private_uploads/imports',
  'private_uploads/assets',
  'private_uploads/users',
  'private_uploads/licenses',
  'private_uploads/license_invoices',
  'private_uploads/signatures',
  'private_uploads/eula-pdfs',
  'private_uploads/audits',
  'private_uploads/maintenances',
]

for (const d of dirs) {
  fs.mkdirSync(path.join(storageRoot, d), { recursive: true })
}

function safeName(original: string) {
  return original.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
}

export function publicUrl(relPath: string) {
  return `/storage/${relPath.replace(/\\/g, '/')}`
}

export function makeUploader(subdir: string, field = 'file') {
  const dest = path.join(storageRoot, subdir)
  fs.mkdirSync(dest, { recursive: true })
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ''
      const base = path.basename(file.originalname, ext)
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(base)}${ext}`)
    },
  })
  return multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
  }).single(field)
}

export async function recordUpload(opts: {
  type: string
  id: number
  filename: string
  original: string
  mime?: string
  diskPath: string
  size?: number
  kind?: 'image' | 'file' | 'signature' | 'eula' | 'audit' | 'invoice' | 'po' | 'label' | 'other' | 'received'
  userId?: number
}) {
  const ts = now()
  const info = await run(`
    INSERT INTO uploads (uploadable_type, uploadable_id, filename, original_filename, mime_type, disk_path, filesize, kind, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    opts.type, opts.id, opts.filename, opts.original, opts.mime || null,
    opts.diskPath, opts.size || null, opts.kind || 'file', opts.userId || null, ts,
  ])
  await logAction({
    userId: opts.userId,
    actionType: 'uploaded',
    itemType: opts.type,
    itemId: opts.id,
    note: opts.original,
    meta: { upload_id: info.insertId, kind: opts.kind || 'file' },
  })
  return info.insertId
}

export function absolutePath(diskPath: string) {
  if (path.isAbsolute(diskPath)) return diskPath
  return path.join(storageRoot, diskPath)
}
