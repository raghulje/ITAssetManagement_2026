/**
 * Wave 2.6 — location hierarchy backend (tree/path/move/archive).
 * Placement FKs on assets and inventory are never rewritten.
 */
import { all, get, run, now, limitSql } from '../db/index.js'
import {
  assembleLocationForest,
  archiveBlockers,
  assertLocationHierarchy,
  assertSpaceSubtypeUsage,
  buildLocationPath,
  compareHierarchyNodes,
  directChildrenOf,
  isLocationTypeCode,
  type HierarchyRow,
  type LocationTypeCode,
} from './locationFoundation.js'
import { logAction } from './actionLog.js'

export class LocationHierarchyError extends Error {
  status: number
  payload: unknown
  messages: string[]
  constructor(message: string | string[], status = 422, payload: unknown = null) {
    super(Array.isArray(message) ? message.join('; ') : message)
    this.status = status
    this.payload = payload
    this.messages = Array.isArray(message) ? message : [message]
  }
}

async function hasTypedLocationSchema() {
  const row = await get<{ c: number }>(`
    SELECT COUNT(*) as c FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'location_types'
  `)
  return Number(row?.c) > 0
}

const HIERARCHY_SQL = `
  SELECT l.id, l.name, l.parent_id, l.company_id, l.deleted_at,
    l.location_type_id, lt.code AS type_code, lt.name AS type_name, lt.is_space,
    l.space_subtype_id, ss.code AS subtype_code, ss.name AS subtype_name
  FROM locations l
  LEFT JOIN location_types lt ON lt.id = l.location_type_id
  LEFT JOIN space_subtypes ss ON ss.id = l.space_subtype_id
`

function mapRow(r: Record<string, unknown>): HierarchyRow {
  return {
    id: Number(r.id),
    name: String(r.name ?? ''),
    parent_id: r.parent_id == null ? null : Number(r.parent_id),
    company_id: r.company_id == null ? null : Number(r.company_id),
    deleted_at: (r.deleted_at as string | null) ?? null,
    location_type_id: r.location_type_id == null ? null : Number(r.location_type_id),
    type_code: r.type_code == null ? null : String(r.type_code),
    type_name: r.type_name == null ? null : String(r.type_name),
    space_subtype_id: r.space_subtype_id == null ? null : Number(r.space_subtype_id),
    subtype_code: r.subtype_code == null ? null : String(r.subtype_code),
    subtype_name: r.subtype_name == null ? null : String(r.subtype_name),
  }
}

export async function loadHierarchyRows(): Promise<HierarchyRow[]> {
  if (!(await hasTypedLocationSchema())) return []
  const rows = await all<Record<string, unknown>>(HIERARCHY_SQL)
  return rows.map(mapRow)
}

export async function ancestorIdsFrom(parentId: number | null): Promise<number[]> {
  const ids: number[] = []
  const seen = new Set<number>()
  let current = parentId
  while (current != null) {
    if (seen.has(current)) {
      ids.push(current)
      break
    }
    seen.add(current)
    ids.push(current)
    const row = await get<{ parent_id: number | null }>(`SELECT parent_id FROM locations WHERE id = ?`, [current])
    current = row?.parent_id != null ? Number(row.parent_id) : null
  }
  return ids
}

function blankToNull(value: unknown): unknown {
  if (value === '') return null
  return value
}

export async function validateLocationWrite(
  body: Record<string, unknown>,
  existingId: number | null,
  existing: Record<string, unknown> | null,
) {
  if (!(await hasTypedLocationSchema())) return
  const unspecified = await get<{ id: number; code: string; is_space: number }>(
    `SELECT id, code, is_space FROM location_types WHERE code = 'UNSPECIFIED' LIMIT 1`,
  )
  const typeIdRaw = body.location_type_id !== undefined
    ? blankToNull(body.location_type_id)
    : existing?.location_type_id ?? unspecified?.id ?? null
  const typeId = typeIdRaw == null ? null : Number(typeIdRaw)
  const typeRow = typeId
    ? await get<{ id: number; code: string; is_space: number }>(`SELECT id, code, is_space FROM location_types WHERE id = ?`, [typeId])
    : unspecified
  if (typeId != null && !typeRow) throw new LocationHierarchyError('Invalid location_type_id')
  const typeCode = (typeRow && isLocationTypeCode(String(typeRow.code)) ? String(typeRow.code) : 'UNSPECIFIED') as LocationTypeCode

  const parentRaw = body.parent_id !== undefined ? blankToNull(body.parent_id) : existing?.parent_id ?? null
  const parentId = parentRaw == null ? null : Number(parentRaw)
  if (parentRaw != null && !Number.isInteger(parentId)) throw new LocationHierarchyError('Invalid parent_id')

  let parentTypeCode: LocationTypeCode | null = null
  let parentIsSpace = false
  if (parentId != null) {
    const parent = await get<{ location_type_id: number | null; deleted_at: string | null }>(
      `SELECT location_type_id, deleted_at FROM locations WHERE id = ?`,
      [parentId],
    )
    if (!parent || parent.deleted_at != null) throw new LocationHierarchyError('Parent location not found')
    const pType = parent.location_type_id
      ? await get<{ code: string; is_space: number }>(`SELECT code, is_space FROM location_types WHERE id = ?`, [parent.location_type_id])
      : null
    if (pType && isLocationTypeCode(String(pType.code))) parentTypeCode = String(pType.code) as LocationTypeCode
    parentIsSpace = Boolean(pType?.is_space)
  }

  const subtypeRaw = body.space_subtype_id !== undefined
    ? blankToNull(body.space_subtype_id)
    : existing?.space_subtype_id ?? null
  const spaceSubtypeId = subtypeRaw == null ? null : Number(subtypeRaw)
  if (subtypeRaw != null) {
    if (spaceSubtypeId == null || !Number.isInteger(spaceSubtypeId) || spaceSubtypeId <= 0) {
      throw new LocationHierarchyError('Invalid space_subtype_id')
    }
    const st = await get(`SELECT id FROM space_subtypes WHERE id = ?`, [spaceSubtypeId])
    if (!st) throw new LocationHierarchyError('space_subtype_id not found')
  }

  const childCount = existingId
    ? Number((await get<{ c: number }>(
      `SELECT COUNT(*) as c FROM locations WHERE parent_id = ? AND deleted_at IS NULL`,
      [existingId],
    ))?.c || 0)
    : 0

  assertSpaceSubtypeUsage({ typeCode, spaceSubtypeId })
  assertLocationHierarchy({
    locationId: existingId,
    parentId,
    typeCode,
    parentTypeCode,
    parentIsSpace,
    ancestorIds: await ancestorIdsFrom(parentId),
    hasChildren: childCount > 0,
  })

  if (body.location_type_id === undefined && existingId == null && unspecified) {
    body.location_type_id = unspecified.id
  }
  if (body.parent_id !== undefined) body.parent_id = parentId
  if (body.space_subtype_id !== undefined) body.space_subtype_id = spaceSubtypeId
  if (body.location_type_id !== undefined) body.location_type_id = typeId ?? unspecified?.id ?? null
}

export async function getLocationTree(query: {
  company_id?: unknown
  root_id?: unknown
  include_operational?: unknown
  include_archived?: unknown
}) {
  const rows = await loadHierarchyRows()
  const companyId = query.company_id != null && String(query.company_id) !== ''
    ? Number(query.company_id)
    : null
  const rootId = query.root_id != null && String(query.root_id) !== ''
    ? Number(query.root_id)
    : null
  const includeOperational = String(query.include_operational || '') === 'true' || query.include_operational === '1'
  const includeArchived = String(query.include_archived || '') === 'true' || query.include_archived === '1'
  const forest = assembleLocationForest(rows, {
    companyId: Number.isFinite(companyId as number) ? companyId : null,
    rootId: Number.isFinite(rootId as number) ? rootId : null,
    includeOperational,
    includeArchived,
  })
  return {
    trees: forest.trees,
    operational: includeOperational ? forest.operational : undefined,
    meta: {
      cycles_detected: forest.cyclesDetected,
      ordering: 'type_then_name',
    },
  }
}

export async function getLocationPath(id: number, includeDeleted = false) {
  const rows = await loadHierarchyRows()
  const result = buildLocationPath(rows, id, { includeDeleted })
  if (!result.found) throw new LocationHierarchyError('location not found', 404)
  if (result.cycle) throw new LocationHierarchyError('Cycle detected in location parentage', 422)
  return { path: result.path }
}

export async function getLocationChildren(id: number, includeArchived = false) {
  const exists = await get(`SELECT id FROM locations WHERE id = ?`, [id])
  if (!exists) throw new LocationHierarchyError('location not found', 404)
  const rows = await loadHierarchyRows()
  return { children: directChildrenOf(rows, id, { includeArchived }) }
}

export async function validateProposedParent(opts: {
  locationId: number | null
  parentId: number | null
  typeCode?: LocationTypeCode | null
  locationTypeId?: number | null
}) {
  const existing = opts.locationId != null
    ? await get<Record<string, unknown>>(`SELECT * FROM locations WHERE id = ?`, [opts.locationId])
    : null
  if (opts.locationId != null && !existing) throw new LocationHierarchyError('location not found', 404)
  const body: Record<string, unknown> = { parent_id: opts.parentId }
  if (opts.locationTypeId != null) body.location_type_id = opts.locationTypeId
  if (opts.typeCode && !opts.locationTypeId) {
    const t = await get<{ id: number }>(`SELECT id FROM location_types WHERE code = ?`, [opts.typeCode])
    if (t) body.location_type_id = t.id
  }
  await validateLocationWrite(body, opts.locationId, existing ?? null)
  return { valid: true, parent_id: opts.parentId }
}

export async function moveLocation(id: number, parentId: number | null, userId?: number | null) {
  const existing = await get<Record<string, unknown>>(`SELECT * FROM locations WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!existing) throw new LocationHierarchyError('location not found', 404)
  const oldParentId = existing.parent_id == null ? null : Number(existing.parent_id)
  await validateLocationWrite({ parent_id: parentId }, id, existing)
  await run(`UPDATE locations SET parent_id = ?, updated_at = ? WHERE id = ?`, [parentId, now(), id])
  await logAction({
    userId,
    actionType: 'LOCATION_MOVED',
    itemType: 'location',
    itemId: id,
    locationId: id,
    note: `Moved location ${existing.name}`,
    meta: {
      location_id: id,
      location_name: existing.name,
      old_parent_id: oldParentId,
      new_parent_id: parentId,
      location_type_id: existing.location_type_id ?? null,
    },
  })
  const path = await getLocationPath(id)
  const row = await get<Record<string, unknown>>(`SELECT * FROM locations WHERE id = ?`, [id])
  return { node: row, path: path.path, old_parent_id: oldParentId, new_parent_id: parentId }
}

export async function collectArchiveCounts(id: number) {
  const children = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM locations WHERE parent_id = ? AND deleted_at IS NULL`,
    [id],
  ))?.c || 0)
  const placements = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM assets WHERE location_id = ? AND deleted_at IS NULL`,
    [id],
  ))?.c || 0)
  const rtd = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM assets WHERE rtd_location_id = ? AND deleted_at IS NULL`,
    [id],
  ))?.c || 0)
  const consumables = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM consumables WHERE location_id = ? AND deleted_at IS NULL`,
    [id],
  ))?.c || 0)
  const accessories = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM accessories WHERE location_id = ? AND deleted_at IS NULL`,
    [id],
  ))?.c || 0)
  const components = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM components WHERE location_id = ? AND deleted_at IS NULL`,
    [id],
  ))?.c || 0)
  const users = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM users WHERE location_id = ? AND deleted_at IS NULL`,
    [id],
  ))?.c || 0)
  const departments = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM departments WHERE location_id = ? AND deleted_at IS NULL`,
    [id],
  ))?.c || 0)
  return archiveBlockers({
    active_children: children,
    asset_placements: placements,
    rtd_references: rtd,
    inventory_records: consumables + accessories + components,
    user_references: users,
    department_references: departments,
  })
}

export async function archiveLocation(id: number, userId?: number | null) {
  const existing = await get<Record<string, unknown>>(`SELECT * FROM locations WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!existing) throw new LocationHierarchyError('location not found', 404)
  const blockers = await collectArchiveCounts(id)
  if (blockers.blocked) {
    throw new LocationHierarchyError(
      [`Cannot archive location because:`, ...blockers.messages.map((m) => `- ${m}`)],
      422,
      { dependencies: blockers.counts },
    )
  }
  await run(`UPDATE locations SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
  await logAction({
    userId,
    actionType: 'LOCATION_ARCHIVED',
    itemType: 'location',
    itemId: id,
    locationId: id,
    note: `Archived location ${existing.name}`,
    meta: {
      location_id: id,
      location_name: existing.name,
      parent_id: existing.parent_id ?? null,
      location_type_id: existing.location_type_id ?? null,
    },
  })
  return { id, archived: true }
}

export async function restoreLocation(id: number, userId?: number | null) {
  const existing = await get<Record<string, unknown>>(`SELECT * FROM locations WHERE id = ? AND deleted_at IS NOT NULL`, [id])
  if (!existing) throw new LocationHierarchyError('location not found', 404)
  const parentId = existing.parent_id == null ? null : Number(existing.parent_id)
  if (parentId != null) {
    const parent = await get<{ id: number; deleted_at: string | null }>(
      `SELECT id, deleted_at FROM locations WHERE id = ?`,
      [parentId],
    )
    if (!parent || parent.deleted_at != null) {
      throw new LocationHierarchyError('Cannot restore: parent is missing or archived', 422)
    }
  }
  await validateLocationWrite({ parent_id: parentId }, id, { ...existing, deleted_at: null })
  await run(`UPDATE locations SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [now(), id])
  await logAction({
    userId,
    actionType: 'LOCATION_RESTORED',
    itemType: 'location',
    itemId: id,
    locationId: id,
    note: `Restored location ${existing.name}`,
    meta: {
      location_id: id,
      location_name: existing.name,
      parent_id: parentId,
      location_type_id: existing.location_type_id ?? null,
    },
  })
  return await get<Record<string, unknown>>(`SELECT * FROM locations WHERE id = ?`, [id])
}

export async function getNodeAssets(
  id: number,
  limit: number,
  offset: number,
  perms?: Record<string, unknown> | null,
) {
  const exists = await get(`SELECT id FROM locations WHERE id = ?`, [id])
  if (!exists) throw new LocationHierarchyError('location not found', 404)
  const { inventoryDomainClause } = await import('./domainAuth.js')
  const domain = await inventoryDomainClause(perms, undefined, '')
  const where = `deleted_at IS NULL AND (location_id = ? OR rtd_location_id = ?)${domain.sql}`
  const params = [id, id, ...domain.params]
  const total = Number((await get<{ c: number }>(`SELECT COUNT(*) as c FROM assets WHERE ${where}`, params))?.c || 0)
  const placement_count = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL AND location_id = ?${domain.sql}`,
    [id, ...domain.params],
  ))?.c || 0)
  const rtd_count = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL AND rtd_location_id = ?${domain.sql}`,
    [id, ...domain.params],
  ))?.c || 0)
  const rows = await all<Record<string, unknown>>(
    `SELECT id, asset_tag, name, location_id, rtd_location_id, assigned_type, assigned_to
     FROM assets WHERE ${where} ORDER BY id DESC ${limitSql(limit, offset)}`,
    params,
  )
  return { total, placement_count, rtd_count, rows }
}

async function inventoryGroup(table: string, id: number, perms?: Record<string, unknown> | null) {
  const { inventoryDomainClause } = await import('./domainAuth.js')
  const domain = await inventoryDomainClause(perms, undefined, '')
  const total = Number((await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM ${table} WHERE deleted_at IS NULL AND location_id = ?${domain.sql}`,
    [id, ...domain.params],
  ))?.c || 0)
  const rows = await all<Record<string, unknown>>(
    `SELECT id, name, qty, location_id FROM ${table} WHERE deleted_at IS NULL AND location_id = ?${domain.sql} ORDER BY name ASC`,
    [id, ...domain.params],
  )
  return { total, rows }
}

export async function getNodeInventory(id: number, perms?: Record<string, unknown> | null) {
  const exists = await get(`SELECT id FROM locations WHERE id = ?`, [id])
  if (!exists) throw new LocationHierarchyError('location not found', 404)
  const consumables = await inventoryGroup('consumables', id, perms)
  const accessories = await inventoryGroup('accessories', id, perms)
  const components = await inventoryGroup('components', id, perms)
  return {
    consumables,
    accessories,
    components,
    total: consumables.total + accessories.total + components.total,
  }
}

export async function listLocationTypes() {
  if (!(await hasTypedLocationSchema())) return []
  return all<{ id: number; name: string; code: string; hierarchy_level: number; is_space: number }>(`
    SELECT id, name, code, hierarchy_level, is_space
    FROM location_types
    WHERE is_active = 1
    ORDER BY hierarchy_level ASC, name ASC
  `)
}

export async function listSpaceSubtypes() {
  if (!(await hasTypedLocationSchema())) return []
  return all<{ id: number; name: string; code: string }>(`
    SELECT id, name, code
    FROM space_subtypes
    WHERE is_active = 1
    ORDER BY name ASC
  `)
}

/** Dropdown labels include ancestors so "Floor 1" is not ambiguous across offices. */
export async function locationSelectlist(opts: {
  search?: string
  companyId?: number
  limit?: number
}) {
  const q = String(opts.search || '').trim()
  const limit = Math.min(Math.max(Number(opts.limit) || 2000, 1), 2000)
  let sql = `
    SELECT l.id,
      TRIM(BOTH ' · ' FROM CONCAT_WS(' · ', ggp.name, gp.name, p.name, l.name)) AS text
    FROM locations l
    LEFT JOIN locations p ON p.id = l.parent_id AND p.deleted_at IS NULL
    LEFT JOIN locations gp ON gp.id = p.parent_id AND gp.deleted_at IS NULL
    LEFT JOIN locations ggp ON ggp.id = gp.parent_id AND ggp.deleted_at IS NULL
    WHERE l.deleted_at IS NULL
  `
  const params: unknown[] = []
  if (opts.companyId) {
    sql += ' AND l.company_id = ?'
    params.push(Number(opts.companyId))
  }
  if (q) {
    const like = `%${q}%`
    sql += ` AND (
      l.name LIKE ? OR p.name LIKE ? OR gp.name LIKE ? OR ggp.name LIKE ?
      OR CONCAT_WS(' · ', ggp.name, gp.name, p.name, l.name) LIKE ?
    )`
    params.push(like, like, like, like, like)
  }
  sql += ` ORDER BY text ASC LIMIT ${limit}`
  return all<{ id: number; text: string }>(sql, params)
}

export { compareHierarchyNodes, hasTypedLocationSchema }
