import { timingSafeEqual } from 'node:crypto'
import { Router, type Request } from 'express'
import { now, run } from '../db/index.js'
import { fail, okItem, okMessage } from '../utils/response.js'
import { consumeP2pGrn, normalizeP2pPayload, p2pPayloadExample } from '../services/p2pGrn.js'
import { ensureP2pAssetColumns } from '../services/p2pColumns.js'

const router = Router()

function presentedKey(req: Request) {
  const header = String(req.headers['x-p2p-key'] || req.headers['x-webhook-key'] || '')
  if (header.trim()) return header.trim()
  const auth = String(req.headers.authorization || '')
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  return String(req.query.key || '').trim()
}

function keyAuthorized(presented: string) {
  const expected = String(process.env.P2P_WEBHOOK_KEY || '').trim()
  if (!expected) return { ok: false as const, status: 503, message: 'P2P webhook key is not configured' }
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false as const, status: 401, message: 'Unauthorized webhook' }
  }
  return { ok: true as const }
}

function clipPayload(body: unknown) {
  try {
    const raw = JSON.stringify(body)
    if (raw.length <= 200000) return raw
    const keys = body && typeof body === 'object' ? Object.keys(body as object) : []
    return JSON.stringify({ truncated: true, bytes: raw.length, keys })
  } catch {
    return JSON.stringify({ truncated: true })
  }
}

async function rememberEvent(body: unknown, status: string, result: unknown) {
  try {
    await ensureP2pAssetColumns()
    const normalized = normalizeP2pPayload(body)
    const header = normalized.envelopes[0]?.header
    await run(`
      INSERT INTO p2p_grn_events (grn_number, po_number, invoice_number, status, payload, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      header?.grnNumber || null,
      header?.poNumber || null,
      header?.invoiceNumber || null,
      status,
      clipPayload(body),
      JSON.stringify(result),
      now(),
    ])
  } catch (e) {
    console.warn('[p2p-grn] event log failed', e instanceof Error ? e.message : e)
  }
}

/**
 * Inbound P2P GRN webhook.
 * POST /api/v1/webhooks/p2p/grn
 * Auth: header x-p2p-key, Authorization: Bearer, or ?key=
 */
router.get('/grn', (req, res) => {
  const auth = keyAuthorized(presentedKey(req))
  if (!auth.ok) return fail(res, auth.message, auth.status)
  return okItem(res, {
    endpoint: '/api/v1/webhooks/p2p/grn',
    method: 'POST',
    auth: 'Header x-p2p-key (or Authorization: Bearer, or ?key=)',
    behavior: 'Creates an asset for each received unit. Posts the same GRN again to update PO, invoice, and receipt fields. Matches an existing asset by P2P line, then serial, then asset tag.',
    example: p2pPayloadExample(),
  })
})

router.post('/grn', async (req, res) => {
  const auth = keyAuthorized(presentedKey(req))
  if (!auth.ok) return fail(res, auth.message, auth.status)
  try {
    const result = await consumeP2pGrn(req.body)
    if (result.error && !result.created.length && !result.updated.length) {
      await rememberEvent(req.body, 'rejected', result)
      return fail(res, result.error, 400, { example: p2pPayloadExample() })
    }
    await rememberEvent(req.body, 'consumed', result)
    const count = result.created.length + result.updated.length
    return okMessage(res, `GRN consumed: ${result.created.length} created, ${result.updated.length} updated`, {
      received: count,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
      grn_number: result.grn_number,
      po_number: result.po_number,
      invoice_number: result.invoice_number,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'GRN consumption failed'
    await rememberEvent(req.body, 'failed', { error: message })
    return fail(res, message, 500)
  }
})

export default router
