import fs from 'node:fs'
import path from 'node:path'
import { elloDownloadRecording } from './ello.js'
import { absolutePath, storageRoot } from './uploads.js'

const RECORDING_DIR = 'private_uploads/battery_recordings'

function mimeFromName(filePath: string) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4'
  return 'audio/mpeg'
}

export async function ensureLocalCallRecording(opts: {
  issueId: number
  callId: number
  conversationId: string
  recordingUrl?: string | null
  existingPath?: string | null
}): Promise<{ path: string; mime: string; original_name: string } | null> {
  const existing = String(opts.existingPath || '').trim()
  if (existing) {
    const abs = absolutePath(existing)
    if (fs.existsSync(abs)) {
      return {
        path: existing.replace(/\\/g, '/'),
        mime: mimeFromName(existing),
        original_name: path.basename(existing),
      }
    }
  }
  const url = String(opts.recordingUrl || '').trim()
  if (!/^https?:\/\//i.test(url)) return null
  const downloaded = await elloDownloadRecording(url)
  if (!downloaded) return null
  const destDir = path.join(storageRoot, RECORDING_DIR)
  fs.mkdirSync(destDir, { recursive: true })
  const safeId = String(opts.conversationId || opts.callId).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)
  const filename = `${opts.issueId}-${opts.callId}-${safeId}${downloaded.ext}`
  const rel = `${RECORDING_DIR}/${filename}`
  fs.writeFileSync(path.join(storageRoot, rel), downloaded.buffer)
  return {
    path: rel,
    mime: downloaded.mime,
    original_name: filename,
  }
}
