import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { all, get, run, now, limitSql } from '../db/index.js'
import { fail, okItem, okList, okMessage } from '../utils/response.js'
import { transformUser, transformAsset } from '../services/transformers.js'
import { logAction } from '../services/actionLog.js'
import { makeCrudRouter, selectlist } from '../utils/crud.js'
import { nest } from '../utils/response.js'
import { inventoryDomainClause, tableHasColumn } from '../services/domainAuth.js'
import { getUserGroupIds, setUserGroups, syncUserPermissions } from '../services/permissions.js'
import {
  assertAssetDomainNotDuplicate,
  validateAssetDomainCreateInput,
  validateCategoryParenting,
  validateModelAssetTypeAssociation,
} from '../services/classificationFoundation.js'
import { assertLocationHierarchy, assertSpaceSubtypeUsage } from '../services/locationFoundation.js'
import {
  LocationHierarchyError,
  archiveLocation,
  getLocationChildren,
  getLocationPath,
  getLocationTree,
  getNodeAssets,
  getNodeInventory,
  listLocationTypes,
  listSpaceSubtypes,
  locationSelectlist,
  moveLocation,
  restoreLocation,
  validateLocationWrite,
  validateProposedParent,
} from '../services/locationHierarchy.js'

// Wave 2.1/2.2 source contracts: validators remain referenced from the locations router module.
void assertLocationHierarchy
void assertSpaceSubtypeUsage

export const usersRouter = Router()

usersRouter.get('/', async (req, res) => {
  const q = String(req.query.search || '').trim()
  let sql = `SELECT id FROM users WHERE deleted_at IS NULL`
  const params: unknown[] = []
  if (req.query.deleted === 'true' || req.query.status === 'deleted') {
    sql = `SELECT id FROM users WHERE deleted_at IS NOT NULL`
  }
  if (req.query.activated === '1') sql += ' AND activated = 1'
  if (req.query.activated === '0') sql += ' AND activated = 0'
  if (req.query.superadmins === 'true') sql += ` AND permissions LIKE '%superuser%'`
  if (req.query.admins === 'true') sql += ` AND (permissions LIKE '%"admin"%' OR permissions LIKE '%superuser%')`
  if (q) {
    sql += ` AND (first_name LIKE ? OR last_name LIKE ? OR username LIKE ? OR email LIKE ?)`
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }
  sql += ' ORDER BY id DESC'
  const limit = Math.min(Number(req.query.limit) || 50, 500)
  const offset = Number(req.query.offset) || 0
  const includeDeleted = req.query.deleted === 'true' || req.query.status === 'deleted'
  const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _count_q`, params)
  const total = Number(totalRow?.c || 0)
  const ids = await all<{ id: number }>(`${sql} ${limitSql(limit, offset)}`, params)
  const rows = (await Promise.all(ids.map((r) => transformUser(r.id, { includeDeleted })))).filter(Boolean)
  return okList(res, rows, total)
})

usersRouter.get('/selectlist', selectlist('users', `CONCAT(first_name, ' ', last_name)`))

usersRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const user = await transformUser(id) || await transformUser(id, { includeDeleted: true })
  if (!user) return fail(res, 'User not found', 404)
  const group_ids = await getUserGroupIds(id)
  return okItem(res, { ...user, group_ids })
})

usersRouter.get('/:id/assets', async (req, res) => {
  const { inventoryDomainClause } = await import('../services/domainAuth.js')
  const domain = await inventoryDomainClause(req.user?.permissions, req.query.domain || req.query.domain_id, '')
  const ids = await all<{ id: number }>(`
    SELECT id FROM assets WHERE assigned_type = 'user' AND assigned_to = ? AND deleted_at IS NULL
      ${domain.sql}
  `, [req.params.id, ...domain.params])
  const rows = (await Promise.all(ids.map((r) => transformAsset(r.id)))).filter(Boolean)
  return okList(res, rows)
})

usersRouter.post('/', async (req, res) => {
  const b = req.body || {}
  if (!b.username || !b.first_name || !b.last_name) return fail(res, 'username, first_name, last_name required')
  const exists = await get(`SELECT id FROM users WHERE username = ?`, [b.username])
  if (exists) return fail(res, 'Username already taken')
  const password = bcrypt.hashSync(b.password || 'password', 10)
  const extras: Record<string, string> = {}
  if (b.superuser || b.is_superuser) extras.superuser = '1'
  if (b.admin || b.is_admin) extras.admin = '1'
  const ts = now()
  const info = await run(`
    INSERT INTO users (first_name, last_name, username, email, password, employee_num, company_id, location_id, department_id, jobtitle, phone, activated, permissions, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    b.first_name, b.last_name, b.username, b.email || null, password, b.employee_num || null,
    b.company_id || null, b.location_id || null, b.department_id || null, b.jobtitle || null, b.phone || null,
    b.activated === false || b.activated === 0 ? 0 : 1, JSON.stringify(extras), b.notes || null, ts, ts,
  ])
  const id = Number(info.insertId)
  const groupIds: number[] = Array.isArray(b.group_ids) ? b.group_ids.map(Number) : []
  if (b.group_id != null) groupIds.push(Number(b.group_id))
  if (groupIds.length) {
    await setUserGroups(id, groupIds)
    if (Object.keys(extras).length) await syncUserPermissions(id, extras)
  } else if (Object.keys(extras).length) {
    await syncUserPermissions(id, extras)
  }
  await logAction({ userId: req.user?.id, actionType: 'create', itemType: 'user', itemId: id })
  const created = await transformUser(id)
  return okMessage(res, 'User created', { ...created, group_ids: await getUserGroupIds(id) }, 201)
})

usersRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!(await transformUser(id))) return fail(res, 'User not found', 404)
  const b = req.body || {}
  const fields = ['first_name', 'last_name', 'email', 'employee_num', 'company_id', 'location_id', 'department_id', 'jobtitle', 'phone', 'notes'] as const
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] !== undefined) {
      sets.push(`${f} = ?`)
      vals.push(b[f])
    }
  }
  if (b.activated !== undefined) {
    sets.push('activated = ?')
    vals.push(b.activated ? 1 : 0)
  }
  if (b.password) {
    sets.push('password = ?')
    vals.push(bcrypt.hashSync(b.password, 10))
  }
  const extras: Record<string, string> = {}
  if (b.superuser !== undefined || b.is_superuser !== undefined || b.admin !== undefined || b.is_admin !== undefined) {
    if (b.superuser || b.is_superuser) extras.superuser = '1'
    if (b.admin || b.is_admin) extras.admin = '1'
  }
  if (!sets.length && b.group_id === undefined && !Array.isArray(b.group_ids) && !Object.keys(extras).length) {
    return fail(res, 'No fields')
  }
  if (sets.length) {
    vals.push(now(), id)
    await run(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, vals)
  }
  if (Array.isArray(b.group_ids) || b.group_id != null) {
    const groupIds: number[] = Array.isArray(b.group_ids) ? b.group_ids.map(Number) : []
    if (b.group_id != null) groupIds.push(Number(b.group_id))
    await setUserGroups(id, groupIds)
  }
  if (Object.keys(extras).length || Array.isArray(b.group_ids) || b.group_id != null) {
    await syncUserPermissions(id, extras)
  }
  await logAction({ userId: req.user?.id, actionType: 'update', itemType: 'user', itemId: id })
  const updated = await transformUser(id)
  return okMessage(res, 'User updated', { ...updated, group_ids: await getUserGroupIds(id) })
})

usersRouter.delete('/:id', async (req, res) => {
  await run(`UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), req.params.id])
  await logAction({ userId: req.user?.id, actionType: 'delete', itemType: 'user', itemId: Number(req.params.id) })
  return okMessage(res, 'User deleted')
})

export const mastersRouter = Router()

/** Must be registered before makeCrudRouter mounts so these override default selectlists */
mastersRouter.get('/companies/selectlist', async (req, res) => {
  const q = String(req.query.search || '').trim()
  let sql = `
    SELECT id, name, code,
      CASE
        WHEN code IS NOT NULL AND TRIM(code) <> '' THEN CONCAT(name, ' (', code, ')')
        ELSE name
      END AS text
    FROM companies
    WHERE deleted_at IS NULL
  `
  const params: unknown[] = []
  if (q) {
    sql += ' AND (name LIKE ? OR code LIKE ?)'
    params.push(`%${q}%`, `%${q}%`)
  }
  sql += ' ORDER BY name ASC LIMIT 500'
  const results = await all(sql, params)
  return res.json({ results, pagination: { more: false } })
})

mastersRouter.get('/legal-entities/selectlist', async (req, res) => {
  const q = String(req.query.search || '').trim()
  const companyId = req.query.company_id ?? req.query.companyId
  let sql = `
    SELECT id, code, name, company_id,
      CASE
        WHEN name IS NOT NULL AND TRIM(name) <> '' AND name <> code
          THEN CONCAT(code, ' — ', name)
        ELSE code
      END AS text
    FROM legal_entities
    WHERE deleted_at IS NULL
  `
  const params: unknown[] = []
  if (companyId != null && String(companyId) !== '') {
    sql += ' AND company_id = ?'
    params.push(Number(companyId))
  }
  if (q) {
    sql += ' AND (code LIKE ? OR name LIKE ?)'
    params.push(`%${q}%`, `%${q}%`)
  }
  sql += ' ORDER BY code ASC LIMIT 500'
  const results = await all(sql, params)
  return res.json({ results, pagination: { more: false } })
})

mastersRouter.use('/companies', makeCrudRouter({
  table: 'companies',
  resource: 'company',
  searchable: ['name', 'code'],
  allowedFields: ['name', 'code', 'notes'],
  mapRow: (r) => ({ id: r.id, name: r.name, code: r.code, notes: r.notes }),
}))

mastersRouter.use('/legal-entities', makeCrudRouter({
  table: 'legal_entities',
  resource: 'legal_entity',
  searchable: ['code', 'name'],
  allowedFields: ['company_id', 'code', 'name', 'notes'],
  mapRow: async (row) => {
    const company = row.company_id
      ? await get<{ name: string; code: string | null }>(
        `SELECT name, code FROM companies WHERE id = ?`,
        [row.company_id],
      )
      : null
    return {
      id: row.id,
      company_id: row.company_id,
      code: row.code,
      name: row.name || row.code,
      notes: row.notes,
      company: nest(row.company_id as number, company?.name || null, { code: company?.code || null }),
    }
  },
}))

mastersRouter.use('/locations', (() => {
  const r = Router()
  const table = 'locations'
  const deletedClause = 'AND deleted_at IS NULL'
  const allowedFields = [
    'name', 'parent_id', 'company_id', 'address', 'city', 'state', 'country', 'zip', 'notes',
    'location_type_id', 'space_subtype_id',
    'is_office', 'seat_count', 'space_active', 'occupant_employee_id',
  ]
  let typedSchemaReady: boolean | null = null
  async function hasTypedLocationSchema() {
    if (typedSchemaReady != null) return typedSchemaReady
    const row = await get<{ c: number }>(`
      SELECT COUNT(*) as c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'location_types'
    `)
    typedSchemaReady = Number(row?.c) > 0
    return typedSchemaReady
  }

  async function mapLocationRow(row: Record<string, unknown>, perms?: Record<string, unknown> | null) {
    const domain = await inventoryDomainClause(perms, undefined, '')
    const countRow = await get<{ c: number }>(
      `SELECT COUNT(*) as c FROM assets WHERE location_id = ? AND deleted_at IS NULL${domain.sql}`,
      [row.id, ...domain.params],
    )
    const typed = await hasTypedLocationSchema()
    const type = typed && row.location_type_id
      ? await get<{ id: number; name: string; code: string }>(
        `SELECT id, name, code FROM location_types WHERE id = ?`,
        [row.location_type_id],
      )
      : null
    const subtype = typed && row.space_subtype_id
      ? await get<{ id: number; name: string; code: string }>(
        `SELECT id, name, code FROM space_subtypes WHERE id = ?`,
        [row.space_subtype_id],
      )
      : null
    const hasOffice = await tableHasColumn('locations', 'is_office')
    const hasSpaceActive = await tableHasColumn('locations', 'space_active')
    const floorType = typed && hasOffice
      ? await get<{ id: number }>(`SELECT id FROM location_types WHERE code = 'FLOOR' LIMIT 1`)
      : null
    const floors = floorType
      ? await all<{ id: number; space_active?: number }>(
        hasSpaceActive
          ? `SELECT id, COALESCE(space_active, 1) as space_active FROM locations WHERE parent_id = ? AND location_type_id = ? AND deleted_at IS NULL`
          : `SELECT id, 1 as space_active FROM locations WHERE parent_id = ? AND location_type_id = ? AND deleted_at IS NULL`,
        [row.id, floorType.id],
      )
      : []
    const occupant = row.occupant_employee_id
      ? await get<{ id: number; first_name: string; last_name: string; employee_code: string }>(
        `SELECT id, first_name, last_name, employee_code FROM employees WHERE id = ?`,
        [row.occupant_employee_id],
      )
      : null
    return {
      id: row.id,
      name: row.name,
      parent: nest(row.parent_id as number, null),
      company: nest(row.company_id as number, null),
      address: row.address,
      notes: row.notes,
      assets_count: Number(countRow?.c || 0),
      location_type_id: row.location_type_id ?? null,
      location_type: type ? { id: type.id, name: type.name, code: type.code } : null,
      space_subtype_id: row.space_subtype_id ?? null,
      space_subtype: subtype ? { id: subtype.id, name: subtype.name, code: subtype.code } : null,
      is_office: Boolean(row.is_office),
      seat_count: row.seat_count != null ? Number(row.seat_count) : null,
      space_active: row.space_active == null ? true : Boolean(Number(row.space_active)),
      occupant_employee_id: row.occupant_employee_id ?? null,
      occupant: occupant
        ? { id: occupant.id, name: `${occupant.first_name || ''} ${occupant.last_name || ''}`.trim(), employee_code: occupant.employee_code }
        : null,
      office: Boolean(row.is_office) ? 'Yes' : 'No',
      floors_total: floors.length,
      floors_active: floors.filter((f) => Number(f.space_active) !== 0).length,
      floors_inactive: floors.filter((f) => Number(f.space_active) === 0).length,
    }
  }

  function coerceBoolInt(v: unknown): number {
    return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0
  }

  async function applyOfficeWrite(b: Record<string, unknown>, existing: Record<string, unknown> | null) {
    if (b.is_office === undefined) return
    const on = coerceBoolInt(b.is_office) === 1
    b.is_office = on ? 1 : 0
    if (!on) return
    const typed = await hasTypedLocationSchema()
    if (!typed) return
    const parentId = b.parent_id !== undefined ? b.parent_id : existing?.parent_id
    if (parentId != null && parentId !== '') return
    if (b.location_type_id != null && b.location_type_id !== '') return
    const site = await get<{ id: number }>(`SELECT id FROM location_types WHERE code = 'SITE' LIMIT 1`)
    if (site?.id) b.location_type_id = site.id
  }

  function hierarchyFail(res: Parameters<typeof fail>[0], e: unknown) {
    if (e instanceof LocationHierarchyError) {
      return fail(res, e.messages, e.status, e.payload)
    }
    return fail(res, e instanceof Error ? e.message : 'Invalid location', 422)
  }

  // Wave 2.6 hierarchy contracts — register before /:id
  r.get('/tree', async (req, res) => {
    try {
      return okItem(res, await getLocationTree(req.query as Record<string, unknown>))
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.get('/validate-parent', async (req, res) => {
    try {
      const parentRaw = req.query.parent_id
      const parentId = parentRaw === undefined || parentRaw === '' || parentRaw === 'null'
        ? null
        : Number(parentRaw)
      const locationTypeId = req.query.location_type_id != null && String(req.query.location_type_id) !== ''
        ? Number(req.query.location_type_id)
        : null
      const typeCode = req.query.type != null ? String(req.query.type) : null
      return okItem(res, await validateProposedParent({
        locationId: null,
        parentId: Number.isFinite(parentId as number) ? parentId : null,
        locationTypeId: Number.isFinite(locationTypeId as number) ? locationTypeId : null,
        typeCode: typeCode as never,
      }))
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.get('/', async (req, res) => {
    const q = String(req.query.search || req.query.q || '').trim()
    let sql = `SELECT * FROM ${table} WHERE 1=1 ${deletedClause}`
    const params: unknown[] = []
    if (q) {
      sql += ' AND name LIKE ?'
      params.push(`%${q}%`)
    }
    sql += ' ORDER BY id DESC'
    const limit = Math.min(Number(req.query.limit) || 50, 500)
    const offset = Number(req.query.offset) || 0
    const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _count_q`, params)
    const total = Number(totalRow?.c || 0)
    const rows = await all<Record<string, unknown>>(`${sql} ${limitSql(limit, offset)}`, params)
    const mapped = await Promise.all(rows.map((row) => mapLocationRow(row, req.user?.permissions)))
    return okList(res, mapped, total)
  })

  r.get('/selectlist', async (req, res) => {
    const results = await locationSelectlist({
      search: String(req.query.search || ''),
      companyId: req.query.companyId ? Number(req.query.companyId) : undefined,
      limit: Number(req.query.limit) || 2000,
    })
    return res.json({ results, pagination: { more: false } })
  })

  r.get('/:id/path', async (req, res) => {
    try {
      return okItem(res, await getLocationPath(Number(req.params.id)))
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.get('/:id/children', async (req, res) => {
    try {
      const includeArchived = String(req.query.include_archived || '') === 'true' || req.query.include_archived === '1'
      return okItem(res, await getLocationChildren(Number(req.params.id), includeArchived))
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.get('/:id/validate-parent', async (req, res) => {
    try {
      const parentRaw = req.query.parent_id
      const parentId = parentRaw === undefined || parentRaw === '' || parentRaw === 'null'
        ? null
        : Number(parentRaw)
      return okItem(res, await validateProposedParent({
        locationId: Number(req.params.id),
        parentId: Number.isFinite(parentId as number) ? parentId : null,
      }))
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.get('/:id/assets', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 500)
      const offset = Number(req.query.offset) || 0
      const payload = await getNodeAssets(Number(req.params.id), limit, offset, req.user?.permissions)
      return res.json({
        total: payload.total,
        placement_count: payload.placement_count,
        rtd_count: payload.rtd_count,
        rows: payload.rows,
      })
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.get('/:id/inventory', async (req, res) => {
    try {
      return okItem(res, await getNodeInventory(Number(req.params.id), req.user?.permissions))
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.post('/:id/move', async (req, res) => {
    try {
      const b = req.body || {}
      const parentRaw = b.parent_id === undefined ? null : b.parent_id
      const parentId = parentRaw === null || parentRaw === '' ? null : Number(parentRaw)
      const result = await moveLocation(Number(req.params.id), parentId, req.user?.id)
      return okMessage(res, 'location moved', {
        ...result,
        node: result.node ? await mapLocationRow(result.node, req.user?.permissions) : null,
      })
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.post('/:id/archive', async (req, res) => {
    try {
      const result = await archiveLocation(Number(req.params.id), req.user?.id)
      return okMessage(res, 'location archived', result)
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.post('/:id/restore', async (req, res) => {
    try {
      const row = await restoreLocation(Number(req.params.id), req.user?.id)
      return okMessage(res, 'location restored', row ? await mapLocationRow(row, req.user?.permissions) : null)
    } catch (e) {
      return hierarchyFail(res, e)
    }
  })

  r.get('/:id', async (req, res) => {
    const row = await get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ? ${deletedClause}`, [req.params.id])
    if (!row) return fail(res, 'location not found', 404)
    return okItem(res, await mapLocationRow(row, req.user?.permissions))
  })

  r.post('/', async (req, res) => {
    const b = { ...(req.body || {}) } as Record<string, unknown>
    try {
      await applyOfficeWrite(b, null)
      await validateLocationWrite(b, null, null)
    } catch (e) {
      return hierarchyFail(res, e)
    }
    const typed = await hasTypedLocationSchema()
    const hasOffice = await tableHasColumn('locations', 'is_office')
    const fields = allowedFields.filter((f) => {
      if (!typed && (f === 'location_type_id' || f === 'space_subtype_id')) return false
      if (!hasOffice && ['is_office', 'seat_count', 'space_active', 'occupant_employee_id'].includes(f)) return false
      return b[f] !== undefined
    })
    if (!fields.length) return fail(res, 'No valid fields')
    const ts = now()
    const cols = [...fields, 'created_at', 'updated_at']
    const info = await run(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      [...fields.map((f) => b[f]), ts, ts],
    )
    await logAction({ userId: req.user?.id, actionType: 'create', itemType: 'location', itemId: Number(info.insertId) })
    const row = await get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [info.insertId])
    return okMessage(res, 'location created', row ? await mapLocationRow(row, req.user?.permissions) : null, 201)
  })

  async function doUpdate(req: { params: { id: string }; body: Record<string, unknown>; user?: { id?: number; permissions?: Record<string, unknown> } }, res: Parameters<typeof fail>[0]) {
    const existing = await get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ? ${deletedClause}`, [req.params.id])
    if (!existing) return fail(res, 'location not found', 404)
    const b = { ...(req.body || {}) } as Record<string, unknown>
    try {
      await applyOfficeWrite(b, existing)
    } catch (e) {
      return hierarchyFail(res, e)
    }
    const touchingHierarchy = ['parent_id', 'location_type_id', 'space_subtype_id'].some((k) => b[k] !== undefined)
    try {
      if (touchingHierarchy) await validateLocationWrite(b, Number(req.params.id), existing)
    } catch (e) {
      return hierarchyFail(res, e)
    }
    const typed = await hasTypedLocationSchema()
    const hasOffice = await tableHasColumn('locations', 'is_office')
    const fields = allowedFields.filter((f) => {
      if (!typed && (f === 'location_type_id' || f === 'space_subtype_id')) return false
      if (!hasOffice && ['is_office', 'seat_count', 'space_active', 'occupant_employee_id'].includes(f)) return false
      return b[f] !== undefined
    })
    if (!fields.length) return fail(res, 'No valid fields')
    const sets = fields.map((f) => `${f} = ?`).join(', ')
    await run(`UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ?`, [
      ...fields.map((f) => (b[f] === '' ? null : b[f])),
      now(),
      req.params.id,
    ])
    await logAction({ userId: req.user?.id, actionType: 'update', itemType: 'location', itemId: Number(req.params.id) })
    const row = await get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id])
    return okMessage(res, 'location updated', row ? await mapLocationRow(row, req.user?.permissions) : null)
  }

  r.put('/:id', (req, res) => { void doUpdate(req, res) })
  r.patch('/:id', (req, res) => { void doUpdate(req, res) })

  r.delete('/:id', async (req, res) => {
    const existing = await get(`SELECT id FROM ${table} WHERE id = ? ${deletedClause}`, [req.params.id])
    if (!existing) return fail(res, 'location not found', 404)
    await run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), req.params.id])
    await logAction({ userId: req.user?.id, actionType: 'delete', itemType: 'location', itemId: Number(req.params.id) })
    return okMessage(res, 'location deleted')
  })

  return r
})())

// Wave 2.6 — read-only type masters (no CRUD administration)
mastersRouter.get('/location-types', async (_req, res) => {
  const rows = await listLocationTypes()
  return okList(res, rows, rows.length)
})

mastersRouter.get('/space-subtypes', async (_req, res) => {
  const rows = await listSpaceSubtypes()
  return okList(res, rows, rows.length)
})

mastersRouter.use('/departments', makeCrudRouter({
  table: 'departments', resource: 'department', searchable: ['name'],
  allowedFields: ['name', 'company_id', 'location_id', 'notes'],
  mapRow: async (row) => {
    const company = row.company_id
      ? await get<{ name: string }>(`SELECT name FROM companies WHERE id = ?`, [row.company_id])
      : null
    return {
      id: row.id,
      name: row.name,
      company: nest(row.company_id as number, company?.name || null),
      company_id: row.company_id,
      location_id: row.location_id,
      notes: row.notes,
    }
  },
}))

mastersRouter.use('/manufacturers', makeCrudRouter({
  table: 'manufacturers', resource: 'manufacturer', searchable: ['name'],
  allowedFields: ['name', 'url', 'support_email', 'support_phone', 'notes'],
}))

mastersRouter.use('/suppliers', makeCrudRouter({
  table: 'suppliers', resource: 'supplier', searchable: ['name'],
  allowedFields: ['name', 'url', 'address', 'contact', 'email', 'phone', 'notes'],
}))

/** Asset types (Laptop / Desktop / …) — filter with ?category_type=asset */
mastersRouter.get('/categories/selectlist', async (req, res) => {
  const q = String(req.query.search || '').trim()
  const type = String(req.query.category_type || req.query.type || '').trim()
  let sql = `SELECT id, name as text, category_type, domain_id FROM categories WHERE deleted_at IS NULL`
  const params: unknown[] = []
  if (type) {
    sql += ' AND category_type = ?'
    params.push(type)
  }
  const domainRaw = req.query.domain_id || req.query.domain
  const { inventoryDomainClause, domainCodeForId } = await import('../services/domainAuth.js')
  let requested: unknown = domainRaw
  if (domainRaw != null && /^\d+$/.test(String(domainRaw).trim())) {
    try {
      requested = await domainCodeForId(Number(domainRaw))
    } catch {
      return res.json({ results: [], pagination: { more: false } })
    }
  }
  const clause = await inventoryDomainClause(req.user?.permissions, requested, '')
  sql += clause.sql
  params.push(...clause.params)
  if (q) {
    sql += ' AND name LIKE ?'
    params.push(`%${q}%`)
  }
  sql += ' ORDER BY name ASC LIMIT 500'
  const results = await all(sql, params)
  return res.json({ results, pagination: { more: false } })
})

mastersRouter.use('/categories', (() => {
  const r = Router()
  const table = 'categories'
  const deletedClause = 'AND deleted_at IS NULL'
  const allowedFields = [
    'name',
    'category_type',
    'require_acceptance',
    'checkin_email',
    'eula_text',
    'use_default_eula',
    // Wave 1 extensions (nullable, additive)
    'parent_id',
    'domain_id',
  ]

  function mapRow(row: Record<string, unknown>) {
    return {
      id: row.id,
      name: row.name,
      category_type: row.category_type,
      type: row.category_type,
      require_acceptance: Boolean(row.require_acceptance),
      parent_id: row.parent_id ?? null,
      domain_id: row.domain_id ?? null,
    }
  }

  r.get('/', async (req, res) => {
    const q = String(req.query.search || req.query.q || '').trim()
    let sql = `SELECT * FROM ${table} WHERE 1=1 ${deletedClause}`
    const params: unknown[] = []
    if (q) {
      sql += ` AND name LIKE ?`
      params.push(`%${q}%`)
    }
    sql += ' ORDER BY id DESC'
    const limit = Math.min(Number(req.query.limit) || 50, 500)
    const offset = Number(req.query.offset) || 0
    const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _count_q`, params)
    const total = Number(totalRow?.c || 0)
    const rows = await all<Record<string, unknown>>(`${sql} ${limitSql(limit, offset)}`, params)
    return okList(res, rows.map(mapRow), total)
  })

  r.get('/:id', async (req, res) => {
    const row = await get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ? ${deletedClause}`, [req.params.id])
    if (!row) return fail(res, 'category not found', 404)
    return okItem(res, mapRow(row))
  })

  async function validateParentingIfNeeded(b: Record<string, unknown>, categoryId: number | null) {
    const parentIdRaw = b.parent_id
    if (parentIdRaw === undefined || parentIdRaw === null || parentIdRaw === '') return

    const parentId = Number(parentIdRaw)
    if (!Number.isInteger(parentId)) throw new Error('Invalid parent category id')

    const parent = await get<{ parent_id: number | null }>(
      `SELECT parent_id FROM categories WHERE id = ? AND deleted_at IS NULL`,
      [parentId],
    )
    if (!parent) throw new Error('Parent category not found')

    validateCategoryParenting({
      categoryId,
      parentId,
      parentParentId: parent.parent_id ?? null,
    })
  }

  r.post('/', async (req, res) => {
    const b = req.body || {}
    // Treat empty strings as “not provided” (keeps this Wave 1 change additive / backward compatible).
    if (b.parent_id === '') b.parent_id = undefined
    if (b.domain_id === '') b.domain_id = undefined
    if ((b.domain_id == null || b.domain_id === undefined) && (b.domain || b.domain_code)) {
      const { domainIdForCode, normalizeDomainCode } = await import('../services/domainAuth.js')
      const code = normalizeDomainCode(b.domain || b.domain_code)
      if (code) b.domain_id = await domainIdForCode(code)
    }
    const fields = allowedFields.filter((f) => b[f] !== undefined)
    if (!fields.length) return fail(res, 'No valid fields')

    try {
      await validateParentingIfNeeded(b, null)
    } catch (e) {
      return fail(res, e instanceof Error ? e.message : 'Invalid parent category', 422)
    }

    const ts = now()
    const cols = [...fields, 'created_at', 'updated_at']
    const placeholders = cols.map(() => '?').join(',')
    const values = [...fields.map((f) => b[f]), ts, ts]
    const info = await run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, values)
    await logAction({ userId: req.user?.id, actionType: 'create', itemType: 'category', itemId: Number(info.insertId) })
    const row = await get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [info.insertId])
    return okMessage(res, 'category created', row ? mapRow(row) : null, 201)
  })

  async function doUpdate(req: any, res: any) {
    const existing = await get(`SELECT id FROM ${table} WHERE id = ? ${deletedClause}`, [req.params.id])
    if (!existing) return fail(res, 'category not found', 404)

    const b = req.body || {}
    if (b.parent_id === '') b.parent_id = undefined
    if (b.domain_id === '') b.domain_id = undefined
    const fields = allowedFields.filter((f) => b[f] !== undefined)
    if (!fields.length) return fail(res, 'No valid fields')

    const categoryId = Number(req.params.id)
    try {
      await validateParentingIfNeeded(b, categoryId)
    } catch (e) {
      return fail(res, e instanceof Error ? e.message : 'Invalid parent category', 422)
    }

    const sets = fields.map((f) => `${f} = ?`).join(', ')
    await run(`UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ?`, [
      ...fields.map((f) => b[f]),
      now(),
      req.params.id,
    ])
    await logAction({ userId: req.user?.id, actionType: 'update', itemType: 'category', itemId: Number(req.params.id) })
    return okMessage(res, 'category updated')
  }

  r.put('/:id', (req, res) => { void doUpdate(req, res) })
  r.patch('/:id', (req, res) => { void doUpdate(req, res) })

  r.delete('/:id', async (req, res) => {
    const existing = await get(`SELECT id FROM ${table} WHERE id = ? ${deletedClause}`, [req.params.id])
    if (!existing) return fail(res, 'category not found', 404)
    await run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), req.params.id])
    await logAction({ userId: req.user?.id, actionType: 'delete', itemType: 'category', itemId: Number(req.params.id) })
    return okMessage(res, 'category deleted')
  })

  return r
})())

mastersRouter.use('/asset-domains', (() => {
  const r = Router()
  const table = 'asset_domains'
  const deletedClause = 'AND deleted_at IS NULL'
  const searchable = ['name', 'code']

  function mapRow(row: Record<string, unknown>) {
    return {
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      active: row.active == null ? null : Boolean(row.active),
    }
  }

  r.get('/', async (req, res) => {
    const q = String(req.query.search || req.query.q || '').trim()
    let sql = `SELECT * FROM ${table} WHERE 1=1 ${deletedClause}`
    const params: unknown[] = []
    if (q) {
      sql += ` AND (${searchable.map((c) => `${c} LIKE ?`).join(' OR ')})`
      searchable.forEach(() => params.push(`%${q}%`))
    }
    sql += ' ORDER BY id DESC'
    const limit = Math.min(Number(req.query.limit) || 50, 500)
    const offset = Number(req.query.offset) || 0
    const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _count_q`, params)
    const total = Number(totalRow?.c || 0)
    const rows = await all<Record<string, unknown>>(`${sql} ${limitSql(limit, offset)}`, params)
    return okList(res, rows.map(mapRow), total)
  })

  r.get('/selectlist', async (req, res) => {
    const q = String(req.query.search || '').trim()
    let sql = `SELECT id, name as text, code FROM ${table} WHERE deleted_at IS NULL`
    const params: unknown[] = []
    if (q) {
      sql += ` AND (name LIKE ? OR code LIKE ?)`
      params.push(`%${q}%`, `%${q}%`)
    }
    sql += ' ORDER BY name ASC LIMIT 500'
    const results = await all<Record<string, unknown>>(sql, params)
    return res.json({ results, pagination: { more: false } })
  })

  r.get('/:id', async (req, res) => {
    const row = await get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ? ${deletedClause}`, [req.params.id])
    if (!row) return fail(res, 'asset domain not found', 404)
    return okItem(res, mapRow(row))
  })

  r.post('/', async (req, res) => {
    const b = req.body || {}
    try {
      const normalized = validateAssetDomainCreateInput({ name: b.name, code: b.code })
      const dup = await get(
        `SELECT id FROM ${table} WHERE deleted_at IS NULL AND (name = ? OR (? IS NOT NULL AND code = ?)) LIMIT 1`,
        [normalized.name, normalized.code, normalized.code],
      )
      assertAssetDomainNotDuplicate({ exists: Boolean(dup) })

      const ts = now()
      const info = await run(
        `INSERT INTO ${table} (name, code, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
        [normalized.name, normalized.code, ts, ts],
      )
      await logAction({ userId: req.user?.id, actionType: 'create', itemType: 'asset_domain', itemId: Number(info.insertId) })
      return okMessage(res, 'Asset domain created', { id: info.insertId }, 201)
    } catch (e) {
      return fail(res, e instanceof Error ? e.message : 'Asset domain create failed', 422)
    }
  })

  r.put('/:id', async (req, res) => {
    const b = req.body || {}
    const id = Number(req.params.id)
    try {
      const existing = await get<Record<string, unknown>>(
        `SELECT id, name, code FROM ${table} WHERE id = ? ${deletedClause}`,
        [id],
      )
      if (!existing) return fail(res, 'asset domain not found', 404)

      const nextNameInput = b.name !== undefined ? b.name : existing.name
      const nextCodeInput = b.code !== undefined ? b.code : (existing.code ?? null)

      const normalized = validateAssetDomainCreateInput({ name: nextNameInput, code: nextCodeInput })

      if (b.name !== undefined || b.code !== undefined) {
        const dup = await get(
          `SELECT id FROM ${table} WHERE deleted_at IS NULL AND id <> ? AND (name = ? OR (? IS NOT NULL AND code = ?)) LIMIT 1`,
          [id, normalized.name, normalized.code, normalized.code],
        )
        assertAssetDomainNotDuplicate({ exists: Boolean(dup) })
      }

      const fields: string[] = []
      const vals: unknown[] = []
      if (b.name !== undefined) { fields.push('name = ?'); vals.push(normalized.name) }
      if (b.code !== undefined) { fields.push('code = ?'); vals.push(normalized.code) }
      if (b.active !== undefined) { fields.push('active = ?'); vals.push(b.active ? 1 : 0) }
      if (!fields.length) return fail(res, 'No fields', 400)

      await run(`UPDATE ${table} SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`, [...vals, now(), id])
      await logAction({ userId: req.user?.id, actionType: 'update', itemType: 'asset_domain', itemId: id })
      return okMessage(res, 'Asset domain updated')
    } catch (e) {
      return fail(res, e instanceof Error ? e.message : 'Asset domain update failed', 422)
    }
  })

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id)
    const existing = await get(`SELECT id FROM ${table} WHERE id = ? ${deletedClause}`, [id])
    if (!existing) return fail(res, 'asset domain not found', 404)
    await run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
    await logAction({ userId: req.user?.id, actionType: 'delete', itemType: 'asset_domain', itemId: id })
    return okMessage(res, 'Asset domain deleted')
  })

  return r
})())

mastersRouter.use('/asset-types', (() => {
  const r = Router()
  const table = 'asset_types'
  const deletedClause = 'AND at.deleted_at IS NULL'

  function mapRow(row: Record<string, unknown>) {
    return {
      id: row.id,
      name: row.name,
      category_id: row.category_id ?? null,
      asset_domain_id: row.asset_domain_id ?? null,
      category: nest(row.category_id as number, row.category_name as string),
      domain: nest(row.asset_domain_id as number, row.domain_name as string),
    }
  }

  r.get('/selectlist', async (req, res) => {
    const q = String(req.query.search || '').trim()
    const categoryId = req.query.category_id ?? req.query.categoryId
    let sql = `
      SELECT id, name as text, category_id, asset_domain_id
      FROM ${table}
      WHERE deleted_at IS NULL
    `
    const params: unknown[] = []
    if (categoryId != null && String(categoryId) !== '') {
      sql += ' AND category_id = ?'
      params.push(Number(categoryId))
    }
    if (q) {
      sql += ' AND name LIKE ?'
      params.push(`%${q}%`)
    }
    sql += ' ORDER BY name ASC LIMIT 500'
    const results = await all<Record<string, unknown>>(sql, params)
    return res.json({ results, pagination: { more: false } })
  })

  r.get('/', async (req, res) => {
    const q = String(req.query.search || req.query.q || '').trim()
    let sql = `
      SELECT at.*, c.name as category_name, ad.name as domain_name
      FROM ${table} at
      LEFT JOIN categories c ON c.id = at.category_id
      LEFT JOIN asset_domains ad ON ad.id = at.asset_domain_id
      WHERE 1=1 ${deletedClause}
    `
    const params: unknown[] = []
    if (q) {
      sql += ' AND (at.name LIKE ?)'
      params.push(`%${q}%`)
    }
    sql += ' ORDER BY at.id DESC'
    const limit = Math.min(Number(req.query.limit) || 50, 500)
    const offset = Number(req.query.offset) || 0
    const totalRow = await get<{ c: number }>(`SELECT COUNT(*) as c FROM (${sql}) AS _count_q`, params)
    const total = Number(totalRow?.c || 0)
    const rows = await all<Record<string, unknown>>(`${sql} ${limitSql(limit, offset)}`, params)
    return okList(res, rows.map(mapRow), total)
  })

  r.get('/:id', async (req, res) => {
    const row = await get<Record<string, unknown>>(
      `
        SELECT at.*, c.name as category_name, ad.name as domain_name
        FROM ${table} at
        LEFT JOIN categories c ON c.id = at.category_id
        LEFT JOIN asset_domains ad ON ad.id = at.asset_domain_id
        WHERE at.id = ? AND at.deleted_at IS NULL
      `,
      [req.params.id],
    )
    if (!row) return fail(res, 'Asset type not found', 404)
    return okItem(res, mapRow(row))
  })

  r.post('/', async (req, res) => {
    const b = req.body || {}
    if (!b.name) return fail(res, 'name required')
    if (b.category_id == null) return fail(res, 'category_id required', 422)
    const categoryId = Number(b.category_id)
    const domainId = b.asset_domain_id == null ? null : Number(b.asset_domain_id)

    try {
      const category = await get('SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL', [categoryId])
      if (!category) return fail(res, 'category not found', 404)
      if (domainId != null) {
        const domain = await get('SELECT id FROM asset_domains WHERE id = ? AND deleted_at IS NULL', [domainId])
        if (!domain) return fail(res, 'asset domain not found', 404)
      }

      const dup = await get(`SELECT id FROM ${table} WHERE deleted_at IS NULL AND name = ? AND category_id = ? LIMIT 1`, [
        String(b.name).trim(),
        categoryId,
      ])
      if (dup) return fail(res, 'Asset type already exists', 409)

      const ts = now()
      const info = await run(
        `INSERT INTO ${table} (name, category_id, asset_domain_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [String(b.name).trim(), categoryId, domainId, ts, ts],
      )
      await logAction({ userId: req.user?.id, actionType: 'create', itemType: 'asset_type', itemId: Number(info.insertId) })
      return okMessage(res, 'Asset type created', { id: info.insertId }, 201)
    } catch (e) {
      return fail(res, e instanceof Error ? e.message : 'Asset type create failed', 422)
    }
  })

  r.put('/:id', async (req, res) => {
    const b = req.body || {}
    const id = Number(req.params.id)
    const existing = await get(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])
    if (!existing) return fail(res, 'Asset type not found', 404)

    const fields: string[] = []
    const vals: unknown[] = []
    const name = b.name !== undefined ? (b.name == null ? null : String(b.name).trim()) : undefined
    const categoryId = b.category_id !== undefined ? (b.category_id == null ? null : Number(b.category_id)) : undefined
    const domainId = b.asset_domain_id !== undefined ? (b.asset_domain_id == null ? null : Number(b.asset_domain_id)) : undefined

    if (name !== undefined) {
      if (!name) return fail(res, 'name required', 422)
      fields.push('name = ?')
      vals.push(name)
    }
    if (categoryId !== undefined) {
      if (categoryId == null) return fail(res, 'category_id required', 422)
      const category = await get('SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL', [categoryId])
      if (!category) return fail(res, 'category not found', 404)
      fields.push('category_id = ?')
      vals.push(categoryId)
    }
    if (domainId !== undefined) {
      if (domainId != null) {
        const domain = await get('SELECT id FROM asset_domains WHERE id = ? AND deleted_at IS NULL', [domainId])
        if (!domain) return fail(res, 'asset domain not found', 404)
      }
      fields.push('asset_domain_id = ?')
      vals.push(domainId)
    }
    if (!fields.length) return fail(res, 'No fields', 400)

    // Duplicate check when (name, category_id) change.
    const nextName = name !== undefined ? name : (await get(`SELECT name FROM ${table} WHERE id = ?`, [id]))?.name
    const nextCategoryId = categoryId !== undefined ? categoryId : (await get(`SELECT category_id FROM ${table} WHERE id = ?`, [id]))?.category_id
    const dup = await get(`SELECT id FROM ${table} WHERE deleted_at IS NULL AND id <> ? AND name = ? AND category_id = ? LIMIT 1`, [
      id,
      nextName,
      nextCategoryId,
    ])
    if (dup) return fail(res, 'Asset type already exists', 409)

    await run(`UPDATE ${table} SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`, [...vals, now(), id])
    await logAction({ userId: req.user?.id, actionType: 'update', itemType: 'asset_type', itemId: id })
    return okMessage(res, 'Asset type updated')
  })

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id)
    const existing = await get(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])
    if (!existing) return fail(res, 'Asset type not found', 404)
    await run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
    await logAction({ userId: req.user?.id, actionType: 'delete', itemType: 'asset_type', itemId: id })
    return okMessage(res, 'Asset type deleted')
  })

  return r
})())

mastersRouter.use('/statuslabels', makeCrudRouter({
  table: 'status_labels', resource: 'statuslabel', searchable: ['name'],
  allowedFields: ['name', 'type', 'color', 'show_in_nav', 'default_label', 'notes'],
}))

mastersRouter.use('/depreciations', makeCrudRouter({
  table: 'depreciations', resource: 'depreciation', searchable: ['name'], softDelete: false,
  allowedFields: ['name', 'months', 'depreciation_min'],
}))

mastersRouter.use('/models', (() => {
  const r = Router()
  r.get('/selectlist', async (req, res) => {
    const q = String(req.query.search || '').trim()
    const categoryId = req.query.category_id ?? req.query.categoryId
    let sql = `SELECT id, name as text, category_id FROM models WHERE deleted_at IS NULL`
    const params: unknown[] = []
    if (categoryId != null && String(categoryId) !== '') {
      sql += ' AND category_id = ?'
      params.push(Number(categoryId))
    }
    if (q) {
      sql += ' AND (name LIKE ? OR model_number LIKE ?)'
      params.push(`%${q}%`, `%${q}%`)
    }
    sql += ' ORDER BY name ASC LIMIT 500'
    const results = await all(sql, params)
    return res.json({ results, pagination: { more: false } })
  })
  r.get('/', async (req, res) => {
    const q = String(req.query.search || '').trim()
    let sql = `
      SELECT m.*, c.name as category_name, mf.name as manufacturer_name,
        (SELECT COUNT(*) FROM assets WHERE model_id = m.id AND deleted_at IS NULL) as assets_count
      FROM models m
      LEFT JOIN categories c ON c.id = m.category_id
      LEFT JOIN manufacturers mf ON mf.id = m.manufacturer_id
      WHERE m.deleted_at IS NULL
    `
    const params: unknown[] = []
    if (q) {
      sql += ' AND (m.name LIKE ? OR m.model_number LIKE ?)'
      params.push(`%${q}%`, `%${q}%`)
    }
    sql += ' ORDER BY m.id DESC'
    const rows = (await all<Record<string, unknown>>(sql, params)).map((row) => ({
      id: row.id,
      name: row.name,
      model_number: row.model_number,
      category: nest(row.category_id as number, row.category_name as string),
      manufacturer: nest(row.manufacturer_id as number, row.manufacturer_name as string),
      assets_count: row.assets_count,
    }))
    return okList(res, rows)
  })
  r.get('/:id', async (req, res) => {
    const row = await get(`SELECT * FROM models WHERE id = ? AND deleted_at IS NULL`, [req.params.id])
    if (!row) return fail(res, 'Model not found', 404)
    return okItem(res, row)
  })
  r.post('/', async (req, res) => {
    const b = req.body || {}
    if (!b.name) return fail(res, 'name required')
    const ts = now()
    if (b.asset_type_id === '') b.asset_type_id = undefined
    const hasAssetTypeField = b.asset_type_id !== undefined
    const assetTypeId = b.asset_type_id
    if (hasAssetTypeField) {
      try {
        const normalizedId = assetTypeId === null || assetTypeId === undefined ? null : Number(assetTypeId)
        const assetTypeExists = normalizedId == null
          ? true
          : Boolean(await get('SELECT id FROM asset_types WHERE id = ? AND deleted_at IS NULL', [normalizedId]))
        validateModelAssetTypeAssociation({ assetTypeId: normalizedId, assetTypeExists })
      } catch (e) {
        return fail(res, e instanceof Error ? e.message : 'Invalid asset_type_id', 422)
      }
    }

    const info = hasAssetTypeField
      ? await run(
        `
          INSERT INTO models
            (name, model_number, category_id, manufacturer_id, depreciation_id, asset_type_id, eol, notes, requestable, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          b.name,
          b.model_number || null,
          b.category_id || null,
          b.manufacturer_id || null,
          b.depreciation_id || null,
          assetTypeId === null || assetTypeId === undefined ? null : Number(assetTypeId),
          b.eol || null,
          b.notes || null,
          b.requestable ? 1 : 0,
          ts,
          ts,
        ],
      )
      : await run(
        `
          INSERT INTO models
            (name, model_number, category_id, manufacturer_id, depreciation_id, eol, notes, requestable, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          b.name,
          b.model_number || null,
          b.category_id || null,
          b.manufacturer_id || null,
          b.depreciation_id || null,
          b.eol || null,
          b.notes || null,
          b.requestable ? 1 : 0,
          ts,
          ts,
        ],
      )
    return okMessage(res, 'Model created', { id: info.insertId }, 201)
  })
  r.put('/:id', async (req, res) => {
    const b = req.body || {}
    const fields = ['name', 'model_number', 'category_id', 'manufacturer_id', 'depreciation_id', 'asset_type_id', 'eol', 'notes'] as const
    const sets: string[] = []
    const vals: unknown[] = []

    if (b.asset_type_id === '') b.asset_type_id = undefined
    if (b.asset_type_id !== undefined) {
      const normalizedId = b.asset_type_id === null ? null : Number(b.asset_type_id)
      try {
        const assetTypeExists = normalizedId == null
          ? true
          : Boolean(await get('SELECT id FROM asset_types WHERE id = ? AND deleted_at IS NULL', [normalizedId]))
        validateModelAssetTypeAssociation({ assetTypeId: normalizedId, assetTypeExists })
      } catch (e) {
        return fail(res, e instanceof Error ? e.message : 'Invalid asset_type_id', 422)
      }
      // Ensure DB always gets INT|null (avoid passing string).
      b.asset_type_id = normalizedId
    }

    for (const f of fields) {
      if (b[f] !== undefined) {
        sets.push(`${f} = ?`)
        vals.push(b[f])
      }
    }
    if (!sets.length) return fail(res, 'No fields')
    vals.push(now(), req.params.id)
    await run(`UPDATE models SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, vals)
    return okMessage(res, 'Model updated')
  })
  r.delete('/:id', async (req, res) => {
    await run(`UPDATE models SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), req.params.id])
    return okMessage(res, 'Model deleted')
  })
  return r
})())

mastersRouter.use('/fields', makeCrudRouter({
  table: 'custom_fields', resource: 'field', searchable: ['name'], softDelete: false,
  allowedFields: ['name', 'db_column', 'format', 'element', 'field_values', 'show_in_email'],
}))

mastersRouter.use('/fieldsets', makeCrudRouter({
  table: 'custom_fieldsets', resource: 'fieldset', searchable: ['name'], softDelete: false,
  allowedFields: ['name'],
}))
