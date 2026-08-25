import { Router } from 'express'
import { all, get, run, now } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { inventoryDomainClause, tableHasColumn } from '../services/domainAuth.js'

export const spacesRouter = Router()

async function typeId(code: string): Promise<number | null> {
  const row = await get<{ id: number }>(`SELECT id FROM location_types WHERE code = ? LIMIT 1`, [code])
  return row?.id ? Number(row.id) : null
}

async function subtypeId(code: string): Promise<number | null> {
  const row = await get<{ id: number }>(`SELECT id FROM space_subtypes WHERE code = ? LIMIT 1`, [code])
  return row?.id ? Number(row.id) : null
}

async function officeReady() {
  return tableHasColumn('locations', 'is_office')
}

spacesRouter.get('/offices', async (_req, res) => {
  if (!(await officeReady())) return okList(res, [], 0)
  const rows = await all<Record<string, unknown>>(`
    SELECT l.*, c.name as company_name
    FROM locations l
    LEFT JOIN companies c ON c.id = l.company_id
    WHERE l.deleted_at IS NULL AND l.is_office = 1
    ORDER BY l.name ASC
  `)
  const floorId = await typeId('FLOOR')
  const mapped = await Promise.all(rows.map(async (row) => {
    const floors = floorId
      ? await all<{ space_active: number }>(
        `SELECT COALESCE(space_active,1) as space_active FROM locations WHERE parent_id = ? AND location_type_id = ? AND deleted_at IS NULL`,
        [row.id, floorId],
      )
      : []
    return {
      id: row.id,
      name: row.name,
      company: row.company_id ? { id: row.company_id, name: row.company_name } : null,
      address: row.address,
      floors_total: floors.length,
      floors_active: floors.filter((f) => Number(f.space_active) !== 0).length,
      floors_inactive: floors.filter((f) => Number(f.space_active) === 0).length,
    }
  }))
  return okList(res, mapped, mapped.length)
})

spacesRouter.get('/offices/:id', async (req, res) => {
  if (!(await officeReady())) return fail(res, 'Office columns not migrated', 400)
  const office = await get<Record<string, unknown>>(
    `SELECT * FROM locations WHERE id = ? AND deleted_at IS NULL AND is_office = 1`,
    [req.params.id],
  )
  if (!office) return fail(res, 'Office location not found', 404)
  const floorId = await typeId('FLOOR')
  const spaceId = await typeId('SPACE')
  const floors = floorId
    ? await all<Record<string, unknown>>(`
        SELECT * FROM locations
        WHERE parent_id = ? AND location_type_id = ? AND deleted_at IS NULL
        ORDER BY name ASC
      `, [office.id, floorId])
    : []
  const floorsOut = await Promise.all(floors.map(async (f) => {
    const spaces = spaceId
      ? await all<Record<string, unknown>>(`
          SELECT l.*, st.code as subtype_code, st.name as subtype_name,
            NULLIF(TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))), '') as occupant_name,
            e.employee_code as occupant_code
          FROM locations l
          LEFT JOIN space_subtypes st ON st.id = l.space_subtype_id
          LEFT JOIN employees e ON e.id = l.occupant_employee_id
          WHERE l.parent_id = ? AND l.location_type_id = ? AND l.deleted_at IS NULL
          ORDER BY l.name ASC
        `, [f.id, spaceId])
      : []
    const seats = spaces.reduce((n, s) => n + Number(s.seat_count || 0), 0)
    return {
      id: f.id,
      name: f.name,
      space_active: f.space_active == null ? true : Boolean(Number(f.space_active)),
      seat_count: Number(f.seat_count || seats || 0),
      spaces: spaces.map((s) => ({
        id: Number(s.id),
        name: String(s.name || ''),
        subtype: String(s.subtype_code || 'OTHER'),
        subtype_name: String(s.subtype_name || 'Other'),
        seat_count: s.seat_count != null ? Number(s.seat_count) : null,
        occupant_employee_id: s.occupant_employee_id != null ? Number(s.occupant_employee_id) : null,
        occupant_name: s.occupant_name ? String(s.occupant_name) : null,
        occupant_code: s.occupant_code ? String(s.occupant_code) : null,
        asset_count: 0,
      })),
    }
  }))
  const spaceIds = floorsOut.flatMap((f) => f.spaces.map((s) => s.id))
  if (spaceIds.length) {
    const placeholders = spaceIds.map(() => '?').join(',')
    const counts = await all<{ location_id: number; c: number }>(`
      SELECT location_id, COUNT(*) as c
      FROM assets
      WHERE deleted_at IS NULL AND location_id IN (${placeholders})
      GROUP BY location_id
    `, spaceIds)
    const map = new Map(counts.map((r) => [Number(r.location_id), Number(r.c)]))
    for (const f of floorsOut) {
      f.spaces = f.spaces.map((s) => ({ ...s, asset_count: map.get(s.id) || 0 }))
    }
  }
  return okItem(res, {
    id: office.id,
    name: office.name,
    address: office.address,
    floors: floorsOut,
    floors_total: floorsOut.length,
    floors_active: floorsOut.filter((f) => f.space_active).length,
    floors_inactive: floorsOut.filter((f) => !f.space_active).length,
  })
})

spacesRouter.post('/offices/:id/floors', async (req, res) => {
  if (!(await officeReady())) return fail(res, 'Office columns not migrated', 400)
  const office = await get<{ id: number; is_office: number; company_id: number | null }>(
    `SELECT id, is_office, company_id FROM locations WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
  )
  if (!office || !Number(office.is_office)) return fail(res, 'Not an office location', 422)
  const floorType = await typeId('FLOOR')
  if (!floorType) return fail(res, 'FLOOR location type is missing (apply migration 034)', 400)
  const siteType = await typeId('SITE')
  if (siteType) {
    const officeRow = await get<{ parent_id: number | null }>(
      `SELECT parent_id FROM locations WHERE id = ?`,
      [office.id],
    )
    if (officeRow?.parent_id == null) {
      await run(`UPDATE locations SET location_type_id = ? WHERE id = ?`, [siteType, office.id])
    }
  }
  const name = String(req.body?.name || '').trim()
  if (!name) return fail(res, 'Floor name is required')
  const ts = now()
  const info = await run(
    `INSERT INTO locations (name, parent_id, company_id, location_type_id, seat_count, space_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      office.id,
      office.company_id,
      floorType,
      req.body?.seat_count != null ? Number(req.body.seat_count) : null,
      req.body?.space_active === false || req.body?.space_active === 0 || req.body?.space_active === '0' ? 0 : 1,
      ts,
      ts,
    ],
  )
  return okMessage(res, 'Floor created', { id: Number(info.insertId) }, 201)
})

spacesRouter.patch('/floors/:id', async (req, res) => {
  const floorType = await typeId('FLOOR')
  const row = await get<{ id: number; location_type_id: number }>(
    `SELECT id, location_type_id FROM locations WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
  )
  if (!row || Number(row.location_type_id) !== floorType) return fail(res, 'Floor not found', 404)
  const sets: string[] = []
  const vals: unknown[] = []
  if (req.body?.name != null) { sets.push('name = ?'); vals.push(String(req.body.name).trim()) }
  if (req.body?.seat_count !== undefined) { sets.push('seat_count = ?'); vals.push(req.body.seat_count === '' || req.body.seat_count == null ? null : Number(req.body.seat_count)) }
  if (req.body?.space_active !== undefined) {
    sets.push('space_active = ?')
    vals.push(req.body.space_active === false || req.body.space_active === 0 || req.body.space_active === '0' ? 0 : 1)
  }
  if (!sets.length) return fail(res, 'No valid fields')
  vals.push(now(), row.id)
  await run(`UPDATE locations SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, vals)
  return okMessage(res, 'Floor updated', { id: row.id })
})

spacesRouter.post('/floors/:id/spaces', async (req, res) => {
  const floorType = await typeId('FLOOR')
  const spaceType = await typeId('SPACE')
  if (!spaceType) return fail(res, 'SPACE location type is missing (apply migration 034)', 400)
  const floor = await get<{ id: number; location_type_id: number; company_id: number | null }>(
    `SELECT id, location_type_id, company_id FROM locations WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
  )
  if (!floor || Number(floor.location_type_id) !== floorType) return fail(res, 'Floor not found', 404)
  const name = String(req.body?.name || '').trim()
  if (!name) return fail(res, 'Space name is required')
  const subtypeCode = String(req.body?.subtype || req.body?.space_subtype || 'OTHER').toUpperCase()
  const stId = await subtypeId(subtypeCode) || await subtypeId('OTHER')
  const ts = now()
  const info = await run(
    `INSERT INTO locations (name, parent_id, company_id, location_type_id, space_subtype_id, seat_count, occupant_employee_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      floor.id,
      floor.company_id,
      spaceType,
      stId,
      req.body?.seat_count != null ? Number(req.body.seat_count) : null,
      req.body?.occupant_employee_id ? Number(req.body.occupant_employee_id) : null,
      ts,
      ts,
    ],
  )
  return okMessage(res, 'Space created', { id: Number(info.insertId) }, 201)
})

spacesRouter.post('/floors/:id/workstations', async (req, res) => {
  const floorType = await typeId('FLOOR')
  const spaceType = await typeId('SPACE')
  const stId = await subtypeId('WORKSTATION')
  if (!spaceType || !stId) return fail(res, 'SPACE / WORKSTATION types are missing (apply migration 034)', 400)
  const floor = await get<{ id: number; location_type_id: number; company_id: number | null; seat_count: number | null }>(
    `SELECT id, location_type_id, company_id, seat_count FROM locations WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
  )
  if (!floor || Number(floor.location_type_id) !== floorType) return fail(res, 'Floor not found', 404)
  const count = Math.min(Math.max(Math.floor(Number(req.body?.count) || 0), 1), 200)
  const prefix = String(req.body?.prefix || 'Seat').trim() || 'Seat'
  const existing = await all<{ name: string }>(`
    SELECT l.name
    FROM locations l
    WHERE l.parent_id = ? AND l.location_type_id = ? AND l.space_subtype_id = ? AND l.deleted_at IS NULL
  `, [floor.id, spaceType, stId])
  const used = new Set(existing.map((r) => String(r.name || '').toLowerCase()))
  const width = Math.max(2, String(existing.length + count).length)
  const ts = now()
  const created: number[] = []
  let seq = 1
  while (created.length < count && seq <= count + existing.length + 50) {
    const name = `${prefix} ${String(seq).padStart(width, '0')}`
    seq += 1
    if (used.has(name.toLowerCase())) continue
    used.add(name.toLowerCase())
    const info = await run(
      `INSERT INTO locations (name, parent_id, company_id, location_type_id, space_subtype_id, seat_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [name, floor.id, floor.company_id, spaceType, stId, ts, ts],
    )
    created.push(Number(info.insertId))
  }
  return okMessage(res, `Created ${created.length} seating record(s)`, { count: created.length, ids: created }, 201)
})

spacesRouter.patch('/spaces/:id', async (req, res) => {
  const spaceType = await typeId('SPACE')
  const row = await get<{ id: number; location_type_id: number; space_subtype_id: number | null }>(
    `SELECT id, location_type_id, space_subtype_id FROM locations WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
  )
  if (!row || Number(row.location_type_id) !== spaceType) return fail(res, 'Space not found', 404)
  const sets: string[] = []
  const vals: unknown[] = []
  if (req.body?.name != null) { sets.push('name = ?'); vals.push(String(req.body.name).trim()) }
  if (req.body?.seat_count !== undefined) { sets.push('seat_count = ?'); vals.push(req.body.seat_count === '' || req.body.seat_count == null ? null : Number(req.body.seat_count)) }
  if (req.body?.occupant_employee_id !== undefined) {
    const occupantId = req.body.occupant_employee_id === '' || req.body.occupant_employee_id == null
      ? null
      : Number(req.body.occupant_employee_id)
    if (occupantId) {
      const emp = await get<{ id: number; first_name: string | null; last_name: string | null }>(
        `SELECT id, first_name, last_name FROM employees WHERE id = ? AND deleted_at IS NULL`,
        [occupantId],
      )
      if (!emp) return fail(res, 'Employee not found', 422)
      const subtype = await get<{ code: string }>(
        `SELECT code FROM space_subtypes WHERE id = ?`,
        [row.space_subtype_id],
      )
      const code = String(subtype?.code || '').toUpperCase()
      if (code === 'CABIN' || code === 'WORKSTATION') {
        const taken = await get<{ name: string; floor_name: string | null }>(`
          SELECT l.name, f.name as floor_name
          FROM locations l
          LEFT JOIN locations f ON f.id = l.parent_id
          LEFT JOIN space_subtypes st ON st.id = l.space_subtype_id
          WHERE l.deleted_at IS NULL
            AND l.id <> ?
            AND l.occupant_employee_id = ?
            AND st.code IN ('CABIN', 'WORKSTATION')
          LIMIT 1
        `, [row.id, occupantId])
        if (taken) {
          const empName = [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() || 'This employee'
          const where = [taken.floor_name, taken.name].filter(Boolean).join(' · ')
          return fail(res, `${empName} already occupies ${where}. Unassign that space first.`)
        }
      }
    }
    sets.push('occupant_employee_id = ?')
    vals.push(occupantId)
  }
  if (req.body?.subtype || req.body?.space_subtype) {
    const stId = await subtypeId(String(req.body.subtype || req.body.space_subtype).toUpperCase())
    if (stId) { sets.push('space_subtype_id = ?'); vals.push(stId) }
  }
  if (!sets.length) return fail(res, 'No valid fields')
  vals.push(now(), row.id)
  await run(`UPDATE locations SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, vals)
  return okMessage(res, 'Space updated', { id: row.id })
})

spacesRouter.get('/spaces/:id/assets', async (req, res) => {
  const id = Number(req.params.id)
  const assetDomain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const accDomain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const consDomain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const compDomain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const rows = await all<Record<string, unknown>>(`
    SELECT a.id, a.asset_tag, a.name, a.assigned_to, a.assigned_type, m.name as model_name,
      CASE
        WHEN a.assigned_type = 'user' THEN (SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = a.assigned_to)
        WHEN a.assigned_type = 'employee' THEN (
          SELECT CONCAT(first_name, ' ', last_name, ' (', employee_code, ')') FROM employees WHERE id = a.assigned_to
        )
        WHEN a.assigned_type = 'location' THEN (SELECT name FROM locations WHERE id = a.assigned_to)
        ELSE NULL
      END as assigned_name
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    WHERE a.deleted_at IS NULL AND (a.location_id = ? OR a.rtd_location_id = ?)
      ${assetDomain.sql}
    ORDER BY a.id DESC LIMIT 200
  `, [id, id, ...assetDomain.params])
  const acc = await all<Record<string, unknown>>(`SELECT id, name, 'accessory' as module FROM accessories WHERE deleted_at IS NULL AND location_id = ?${accDomain.sql} LIMIT 100`, [id, ...accDomain.params])
  const cons = await all<Record<string, unknown>>(`SELECT id, name, 'consumable' as module FROM consumables WHERE deleted_at IS NULL AND location_id = ?${consDomain.sql} LIMIT 100`, [id, ...consDomain.params])
  const comps = await all<Record<string, unknown>>(`SELECT id, name, 'component' as module FROM components WHERE deleted_at IS NULL AND location_id = ?${compDomain.sql} LIMIT 100`, [id, ...compDomain.params])
  return okList(res, [
    ...rows.map((r) => ({
      id: r.id,
      name: r.name,
      identifier: r.asset_tag,
      module: 'asset',
      model: r.model_name || null,
      assigned_to: r.assigned_to || null,
      assigned_type: r.assigned_type || null,
      assigned_name: r.assigned_name || null,
      tag: r.assigned_type === 'location' && Number(r.assigned_to) === id
        ? 'cabin'
        : r.assigned_type === 'employee' || r.assigned_type === 'user'
          ? 'occupant'
          : 'untagged',
    })),
    ...acc,
    ...cons,
    ...comps,
  ])
})

spacesRouter.delete('/floors/:id', async (req, res) => {
  const type = await typeId('FLOOR')
  const row = await get<{ id: number; location_type_id: number }>(
    `SELECT id, location_type_id FROM locations WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
  )
  if (!row || Number(row.location_type_id) !== type) return fail(res, 'Floor not found', 404)
  await run(`UPDATE locations SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), row.id])
  return okMessage(res, 'Deleted')
})

spacesRouter.delete('/spaces/:id', async (req, res) => {
  const type = await typeId('SPACE')
  const row = await get<{ id: number; location_type_id: number }>(
    `SELECT id, location_type_id FROM locations WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
  )
  if (!row || Number(row.location_type_id) !== type) return fail(res, 'Space not found', 404)
  await run(`UPDATE locations SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), row.id])
  return okMessage(res, 'Deleted')
})
