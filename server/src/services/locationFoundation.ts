/**
 * Wave 2.2 / 2.6 — typed location hierarchy validation and tree assembly.
 * UNSPECIFIED is legacy-compatible: no strict parent matrix for UNSPECIFIED nodes.
 * Typed physical children cannot attach under UNSPECIFIED (Wave 2.6 hierarchy workflow).
 * SPACE subtype is optional. Non-SPACE must not have a subtype.
 * Ordering: location type, then name. No sort_order column.
 */

export const LOCATION_TYPE_CODES = [
  'UNSPECIFIED',
  'SITE',
  'BUILDING',
  'FLOOR',
  'ZONE',
  'DEPARTMENT_AREA',
  'SPACE',
] as const

export type LocationTypeCode = (typeof LOCATION_TYPE_CODES)[number]

export const PHYSICAL_TYPE_CODES = [
  'SITE',
  'BUILDING',
  'FLOOR',
  'ZONE',
  'DEPARTMENT_AREA',
  'SPACE',
] as const

export type PhysicalTypeCode = (typeof PHYSICAL_TYPE_CODES)[number]

export const SPACE_SUBTYPE_CODES = [
  'CABIN',
  'MEETING_ROOM',
  'SERVER_ROOM',
  'STORE_ROOM',
  'WORKSTATION',
  'OTHER',
] as const

export type SpaceSubtypeCode = (typeof SPACE_SUBTYPE_CODES)[number]

/** Child type → allowed parent types. `null` means root (no parent). */
export const ALLOWED_PARENT_TYPES: Record<Exclude<LocationTypeCode, 'UNSPECIFIED'>, ReadonlyArray<LocationTypeCode | null>> = {
  SITE: [null],
  BUILDING: ['SITE'],
  FLOOR: ['BUILDING', 'SITE'],
  ZONE: ['FLOOR'],
  DEPARTMENT_AREA: ['FLOOR'],
  SPACE: ['FLOOR', 'ZONE', 'DEPARTMENT_AREA'],
}

/** Deterministic tree order: type then name. No locations.sort_order column. */
export const TYPE_SORT_ORDER: Record<LocationTypeCode, number> = {
  SITE: 1,
  BUILDING: 2,
  FLOOR: 3,
  ZONE: 4,
  DEPARTMENT_AREA: 5,
  SPACE: 6,
  UNSPECIFIED: 99,
}

export function isLocationTypeCode(value: string): value is LocationTypeCode {
  return (LOCATION_TYPE_CODES as readonly string[]).includes(value)
}

export function isPhysicalTypeCode(value: string | null | undefined): value is PhysicalTypeCode {
  return value != null && (PHYSICAL_TYPE_CODES as readonly string[]).includes(value)
}

export function assertSpaceSubtypeUsage({
  typeCode,
  spaceSubtypeId,
}: {
  typeCode: LocationTypeCode
  spaceSubtypeId: number | null
}) {
  if (typeCode === 'SPACE') return
  if (spaceSubtypeId != null) {
    throw new Error('space_subtype_id is only valid when location type is SPACE')
  }
}

export function assertLocationHierarchy({
  locationId,
  parentId,
  typeCode,
  parentTypeCode,
  parentIsSpace,
  ancestorIds,
  hasChildren,
}: {
  locationId: number | null
  parentId: number | null
  typeCode: LocationTypeCode
  parentTypeCode: LocationTypeCode | null
  parentIsSpace: boolean
  ancestorIds: number[]
  hasChildren: boolean
}) {
  if (parentId != null && locationId != null && parentId === locationId) {
    throw new Error('Location cannot be its own parent')
  }
  if (locationId != null && ancestorIds.includes(locationId)) {
    throw new Error('Cycle detected in location parentage')
  }
  if (parentId != null && parentIsSpace) {
    throw new Error('SPACE cannot contain child physical locations')
  }
  if (typeCode === 'SPACE' && hasChildren) {
    throw new Error('SPACE cannot contain child physical locations')
  }

  // Legacy UNSPECIFIED: skip parent-type matrix (I3 compatibility).
  if (typeCode === 'UNSPECIFIED') return

  if (parentId != null && parentTypeCode === 'UNSPECIFIED') {
    throw new Error('Typed physical child cannot be attached under UNSPECIFIED')
  }

  const allowed = ALLOWED_PARENT_TYPES[typeCode]
  const parentKey: LocationTypeCode | null = parentId == null ? null : parentTypeCode
  if (parentId != null && parentTypeCode == null) {
    throw new Error(`${typeCode} requires a typed parent location`)
  }
  if (!allowed.some((a) => a === parentKey)) {
    if (typeCode === 'SITE' && parentId == null) return
    const need = allowed
      .map((a) => (a == null ? 'no parent (root)' : a))
      .join(', ')
    throw new Error(`${typeCode} parent must be one of: ${need}`)
  }
}

export type HierarchyRow = {
  id: number
  name: string
  parent_id: number | null
  company_id: number | null
  deleted_at: string | null
  location_type_id: number | null
  type_code: string | null
  type_name: string | null
  space_subtype_id: number | null
  subtype_code: string | null
  subtype_name: string | null
}

export type LocationTreeNode = {
  id: number
  name: string
  parent_id: number | null
  company_id: number | null
  archived: boolean
  location_type_id: number | null
  location_type: { id: number; code: string; name: string } | null
  space_subtype_id: number | null
  space_subtype: { id: number; code: string; name: string } | null
  children: LocationTreeNode[]
}

export type LocationPathEntry = Omit<LocationTreeNode, 'children'>

function typeRank(code: string | null): number {
  if (code && isLocationTypeCode(code)) return TYPE_SORT_ORDER[code]
  return 50
}

export function compareHierarchyNodes(a: { type_code: string | null; name: string }, b: { type_code: string | null; name: string }) {
  const d = typeRank(a.type_code) - typeRank(b.type_code)
  if (d !== 0) return d
  return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
}

function toTreeNode(row: HierarchyRow): LocationTreeNode {
  return {
    id: row.id,
    name: row.name,
    parent_id: row.parent_id,
    company_id: row.company_id,
    archived: row.deleted_at != null,
    location_type_id: row.location_type_id,
    location_type: row.location_type_id && row.type_code
      ? { id: row.location_type_id, code: row.type_code, name: row.type_name || row.type_code }
      : null,
    space_subtype_id: row.space_subtype_id,
    space_subtype: row.space_subtype_id && row.subtype_code
      ? { id: row.space_subtype_id, code: row.subtype_code, name: row.subtype_name || row.subtype_code }
      : null,
    children: [],
  }
}

function walkAncestors(
  byId: Map<number, HierarchyRow>,
  startId: number,
): { ids: number[]; cycle: boolean } {
  const ids: number[] = []
  const seen = new Set<number>()
  let current: number | null = startId
  while (current != null) {
    if (seen.has(current)) return { ids, cycle: true }
    seen.add(current)
    ids.push(current)
    const row = byId.get(current)
    current = row?.parent_id ?? null
  }
  return { ids, cycle: false }
}

/** Walk parent chain from node to root. Detects cycles without infinite loops. */
export function buildLocationPath(
  rows: HierarchyRow[],
  nodeId: number,
  opts: { includeDeleted?: boolean } = {},
): { path: LocationPathEntry[]; cycle: boolean; found: boolean } {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const node = byId.get(nodeId)
  if (!node) return { path: [], cycle: false, found: false }
  if (!opts.includeDeleted && node.deleted_at != null) {
    return { path: [], cycle: false, found: false }
  }
  const { ids, cycle } = walkAncestors(byId, nodeId)
  const chain: HierarchyRow[] = []
  for (const id of ids) {
    const row = byId.get(id)
    if (!row) break
    if (!opts.includeDeleted && row.deleted_at != null && id !== nodeId) {
      return { path: [], cycle, found: true }
    }
    chain.push(row)
  }
  chain.reverse()
  return { path: chain.map((r) => { const n = toTreeNode(r); const { children: _c, ...rest } = n; return rest }), cycle, found: true }
}

export function assembleLocationForest(
  rows: HierarchyRow[],
  opts: {
    includeOperational?: boolean
    includeArchived?: boolean
    companyId?: number | null
    rootId?: number | null
  } = {},
): {
  trees: LocationTreeNode[]
  operational: LocationTreeNode[]
  duplicateIds: number[]
  cyclesDetected: boolean
} {
  const includeOperational = Boolean(opts.includeOperational)
  const includeArchived = Boolean(opts.includeArchived)
  const companyId = opts.companyId ?? null
  const rootId = opts.rootId ?? null

  const visible = rows.filter((r) => includeArchived || r.deleted_at == null)
  const byId = new Map(visible.map((r) => [r.id, r]))
  const seenOnce = new Set<number>()
  const duplicateIds: number[] = []
  for (const r of visible) {
    if (seenOnce.has(r.id)) duplicateIds.push(r.id)
    else seenOnce.add(r.id)
  }

  let cyclesDetected = false
  for (const r of visible) {
    const walk = walkAncestors(byId, r.id)
    if (walk.cycle) cyclesDetected = true
  }

  const physical = visible.filter((r) => isPhysicalTypeCode(r.type_code))
  const operationalRows = visible.filter((r) => !isPhysicalTypeCode(r.type_code))

  function companyAllowsSite(site: HierarchyRow): boolean {
    if (companyId == null) return true
    return Number(site.company_id) === Number(companyId)
  }

  const physicalById = new Map(physical.map((r) => [r.id, r]))
  const allowedPhysical = new Set<number>()
  if (rootId != null) {
    const root = physicalById.get(rootId)
    if (root) {
      const stack = [root.id]
      const visited = new Set<number>()
      while (stack.length) {
        const id = stack.pop()!
        if (visited.has(id)) {
          cyclesDetected = true
          continue
        }
        visited.add(id)
        allowedPhysical.add(id)
        for (const child of physical) {
          if (child.parent_id === id) stack.push(child.id)
        }
      }
      const siteId = walkAncestors(physicalById, rootId).ids.slice(-1)[0]
      const site = siteId != null ? physicalById.get(siteId) : undefined
      if (site?.type_code === 'SITE' && !companyAllowsSite(site)) {
        allowedPhysical.clear()
      }
    }
  } else {
    for (const row of physical) {
      const ancestors = walkAncestors(physicalById, row.id)
      if (ancestors.cycle) cyclesDetected = true
      const rootLoc = physicalById.get(ancestors.ids[ancestors.ids.length - 1] ?? row.id)
      const site = ancestors.ids
        .map((id) => physicalById.get(id))
        .find((n) => n?.type_code === 'SITE')
        ?? (row.type_code === 'SITE' ? row : undefined)
      if (site) {
        if (companyAllowsSite(site)) allowedPhysical.add(row.id)
      } else if (companyId == null) {
        allowedPhysical.add(row.id)
      }
    }
  }

  const nodes = new Map<number, LocationTreeNode>()
  for (const row of physical) {
    if (!allowedPhysical.has(row.id)) continue
    nodes.set(row.id, toTreeNode(row))
  }

  const assigned = new Set<number>()
  const sortedPhysical = [...physical].filter((r) => allowedPhysical.has(r.id)).sort(compareHierarchyNodes)
  for (const row of sortedPhysical) {
    const node = nodes.get(row.id)
    if (!node) continue
    const parent = row.parent_id != null ? nodes.get(row.parent_id) : undefined
    if (parent && parent.id !== node.id) {
      if (assigned.has(node.id)) {
        duplicateIds.push(node.id)
        continue
      }
      parent.children.push(node)
      assigned.add(node.id)
    }
  }
  for (const node of nodes.values()) {
    node.children.sort((a, b) => compareHierarchyNodes(
      { type_code: a.location_type?.code ?? null, name: a.name },
      { type_code: b.location_type?.code ?? null, name: b.name },
    ))
  }

  let trees: LocationTreeNode[]
  if (rootId != null) {
    const root = nodes.get(rootId)
    trees = root ? [root] : []
  } else {
    trees = [...nodes.values()]
      .filter((n) => !assigned.has(n.id))
      .sort((a, b) => compareHierarchyNodes(
        { type_code: a.location_type?.code ?? null, name: a.name },
        { type_code: b.location_type?.code ?? null, name: b.name },
      ))
  }

  const operational: LocationTreeNode[] = []
  if (includeOperational) {
    for (const row of operationalRows.sort(compareHierarchyNodes)) {
      if (companyId != null && row.company_id != null && Number(row.company_id) !== Number(companyId)) continue
      operational.push({ ...toTreeNode(row), children: [] })
    }
  }

  return { trees, operational, duplicateIds: [...new Set(duplicateIds)], cyclesDetected }
}

export function directChildrenOf(
  rows: HierarchyRow[],
  parentId: number,
  opts: { includeArchived?: boolean } = {},
): LocationTreeNode[] {
  return rows
    .filter((r) => r.parent_id === parentId && (opts.includeArchived || r.deleted_at == null))
    .sort(compareHierarchyNodes)
    .map((r) => ({ ...toTreeNode(r), children: [] }))
}

export type ArchiveDependencyCounts = {
  active_children: number
  asset_placements: number
  rtd_references: number
  inventory_records: number
  user_references: number
  department_references: number
}

export function archiveBlockers(counts: ArchiveDependencyCounts): { blocked: boolean; messages: string[]; counts: ArchiveDependencyCounts } {
  const messages: string[] = []
  if (counts.active_children > 0) messages.push(`${counts.active_children} active child locations`)
  if (counts.asset_placements > 0) messages.push(`${counts.asset_placements} asset placements`)
  if (counts.rtd_references > 0) messages.push(`${counts.rtd_references} RTD asset references`)
  if (counts.inventory_records > 0) messages.push(`${counts.inventory_records} inventory records`)
  if (counts.user_references > 0) messages.push(`${counts.user_references} user records`)
  if (counts.department_references > 0) messages.push(`${counts.department_references} department records`)
  return { blocked: messages.length > 0, messages, counts }
}

/** Exact placement: location_id OR rtd_location_id. No descendants. */
export function assetMatchesExactLocation(
  asset: { location_id: number | null; rtd_location_id: number | null },
  locationId: number,
) {
  return asset.location_id === locationId || asset.rtd_location_id === locationId
}

export function summarizeExactAssets(
  assets: Array<{ location_id: number | null; rtd_location_id: number | null }>,
  locationId: number,
) {
  const matched = assets.filter((a) => assetMatchesExactLocation(a, locationId))
  return {
    total: matched.length,
    placement_count: matched.filter((a) => a.location_id === locationId).length,
    rtd_count: matched.filter((a) => a.rtd_location_id === locationId).length,
    rows: matched,
  }
}

export function inventoryMatchesExactLocation(
  row: { location_id: number | null },
  locationId: number,
) {
  return row.location_id === locationId
}

/** Move updates only the moved node's parent_id. Placement FKs are unchanged. */
export function applyHierarchyMove<T extends { parent_id: number | null }>(
  node: T,
  newParentId: number | null,
): T {
  return { ...node, parent_id: newParentId }
}

export function placementFksUnchanged<T extends { location_id: number | null; rtd_location_id?: number | null }>(before: T, after: T) {
  return before.location_id === after.location_id && before.rtd_location_id === after.rtd_location_id
}
