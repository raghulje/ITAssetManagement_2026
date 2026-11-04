import { Router } from 'express'
import { all, get, run, now, limitSql } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { logAction } from '../services/actionLog.js'
import { consultantLabel, ensureConsultants, nextConsultantCode } from '../services/consultants.js'

export const consultantsRouter = Router()

type ConsultantRow = {
  id: number
  consultant_code: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  company_name: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

function present(row: ConsultantRow) {
  return {
    ...row,
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    text: consultantLabel(row),
  }
}

consultantsRouter.use(async (_req, res, next) => {
  try {
    await ensureConsultants()
    next()
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Consultants are not available', 500)
  }
})

consultantsRouter.get('/selectlist', async (req, res) => {
  const q = String(req.query.search || '').trim()
  const params: unknown[] = []
  let sql = `
    SELECT id, CONCAT(first_name, ' ', last_name, ' (', consultant_code, ')') AS text
    FROM consultants
    WHERE deleted_at IS NULL
  `
  if (q) {
    sql += ` AND (
      first_name LIKE ? OR last_name LIKE ? OR consultant_code LIKE ? OR email LIKE ? OR company_name LIKE ?
    )`
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }
  sql += ' ORDER BY consultant_code ASC LIMIT 50'
  const results = await all(sql, params)
  return res.json({ results, pagination: { more: false } })
})

consultantsRouter.get('/', async (req, res) => {
  const q = String(req.query.search || '').trim()
  const deleted = req.query.deleted === 'true' || req.query.status === 'deleted'
  const params: unknown[] = []
  let sql = `SELECT * FROM consultants WHERE ${deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'}`
  if (q) {
    sql += ` AND (
      first_name LIKE ? OR last_name LIKE ? OR consultant_code LIKE ? OR email LIKE ? OR company_name LIKE ?
    )`
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }
  sql += ' ORDER BY id DESC'
  const limit = Math.min(Number(req.query.limit) || 200, 500)
  const offset = Number(req.query.offset) || 0
  const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _count_q`, params)
  const rows = await all<ConsultantRow>(`${sql} ${limitSql(limit, offset)}`, params)
  return okList(res, rows.map(present), Number(totalRow?.c || 0))
})

consultantsRouter.get('/:id', async (req, res) => {
  const row = await get<ConsultantRow>(`SELECT * FROM consultants WHERE id = ?`, [req.params.id])
  if (!row) return fail(res, 'Consultant not found', 404)
  return okItem(res, present(row))
})

consultantsRouter.post('/', async (req, res) => {
  const b = req.body || {}
  const first = String(b.first_name || '').trim()
  if (!first) return fail(res, 'First name is required')
  const ts = now()
  let code = ''
  let info: { insertId?: number } = {}
  for (let attempt = 0; attempt < 5; attempt++) {
    code = await nextConsultantCode()
    try {
      info = await run(`
        INSERT INTO consultants (consultant_code, first_name, last_name, email, phone, company_name, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        code,
        first,
        String(b.last_name || '').trim(),
        String(b.email || '').trim() || null,
        String(b.phone || '').trim() || null,
        String(b.company_name || '').trim() || null,
        String(b.notes || '').trim() || null,
        ts,
        ts,
      ])
      break
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      if (!/duplicate/i.test(message) || attempt === 4) {
        return fail(res, message || 'Could not create consultant', 500)
      }
    }
  }
  const id = Number(info.insertId)
  await logAction({
    userId: req.user?.id,
    actionType: 'create',
    itemType: 'consultant',
    itemId: id,
    note: code,
  })
  const row = await get<ConsultantRow>(`SELECT * FROM consultants WHERE id = ?`, [id])
  return okMessage(res, `Consultant ${code} created`, row ? present(row) : { id, consultant_code: code })
})

consultantsRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get<ConsultantRow>(`SELECT * FROM consultants WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!existing) return fail(res, 'Consultant not found', 404)
  const b = req.body || {}
  const first = String(b.first_name || '').trim()
  if (!first) return fail(res, 'First name is required')
  await run(`
    UPDATE consultants
    SET first_name=?, last_name=?, email=?, phone=?, company_name=?, notes=?, updated_at=?
    WHERE id=?
  `, [
    first,
    String(b.last_name || '').trim(),
    String(b.email || '').trim() || null,
    String(b.phone || '').trim() || null,
    String(b.company_name || '').trim() || null,
    String(b.notes || '').trim() || null,
    now(),
    id,
  ])
  const row = await get<ConsultantRow>(`SELECT * FROM consultants WHERE id = ?`, [id])
  return okMessage(res, 'Consultant updated', row ? present(row) : { id })
})

consultantsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get<{ id: number }>(`SELECT id FROM consultants WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!existing) return fail(res, 'Consultant not found', 404)
  await run(`UPDATE consultants SET deleted_at=?, updated_at=? WHERE id=?`, [now(), now(), id])
  return okMessage(res, 'Consultant deleted')
})
