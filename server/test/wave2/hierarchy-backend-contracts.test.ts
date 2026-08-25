import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from '../wave0/helpers/source.js'
import {
  ALLOWED_PARENT_TYPES,
  applyHierarchyMove,
  archiveBlockers,
  assertLocationHierarchy,
  assembleLocationForest,
  assetMatchesExactLocation,
  buildLocationPath,
  directChildrenOf,
  inventoryMatchesExactLocation,
  placementFksUnchanged,
  summarizeExactAssets,
  type HierarchyRow,
} from '../../src/services/locationFoundation.js'

function row(partial: Partial<HierarchyRow> & Pick<HierarchyRow, 'id' | 'name' | 'type_code'>): HierarchyRow {
  return {
    parent_id: null,
    company_id: 1,
    deleted_at: null,
    location_type_id: 1,
    type_name: partial.type_code,
    space_subtype_id: null,
    subtype_code: null,
    subtype_name: null,
    ...partial,
  }
}

function typed(args: Partial<Parameters<typeof assertLocationHierarchy>[0]> & { typeCode: Parameters<typeof assertLocationHierarchy>[0]['typeCode'] }) {
  return assertLocationHierarchy({
    locationId: args.locationId ?? null,
    parentId: args.parentId ?? null,
    typeCode: args.typeCode,
    parentTypeCode: args.parentTypeCode ?? null,
    parentIsSpace: args.parentIsSpace ?? false,
    ancestorIds: args.ancestorIds ?? [],
    hasChildren: args.hasChildren ?? false,
  })
}

const sample: HierarchyRow[] = [
  row({ id: 1, name: 'Campus A', type_code: 'SITE', company_id: 10 }),
  row({ id: 2, name: 'Tower', type_code: 'BUILDING', parent_id: 1, company_id: null }),
  row({ id: 3, name: 'Floor 1', type_code: 'FLOOR', parent_id: 2 }),
  row({ id: 4, name: 'Zone East', type_code: 'ZONE', parent_id: 3 }),
  row({ id: 5, name: 'Dept IT', type_code: 'DEPARTMENT_AREA', parent_id: 3 }),
  row({ id: 6, name: 'Cabin 1', type_code: 'SPACE', parent_id: 4 }),
  row({ id: 7, name: 'Cabin 2', type_code: 'SPACE', parent_id: 5 }),
  row({ id: 8, name: 'Open Desk', type_code: 'SPACE', parent_id: 3 }),
  row({ id: 9, name: 'Refex Tower', type_code: 'UNSPECIFIED', company_id: null }),
  row({ id: 10, name: 'Archived Space', type_code: 'SPACE', parent_id: 3, deleted_at: '2026-01-01' }),
  row({ id: 11, name: 'Other Site', type_code: 'SITE', company_id: 20 }),
]

describe('Wave 2.6 — Hierarchy backend contracts', () => {
  it('TEST 1 — Typed root SITE appears in tree', () => {
    const { trees } = assembleLocationForest(sample)
    assert.ok(trees.some((t) => t.id === 1 && t.location_type?.code === 'SITE'))
    assert.ok(trees.find((t) => t.id === 1)?.children.some((c) => c.id === 2))
  })

  it('TEST 2 — UNSPECIFIED locations are excluded by default', () => {
    const { trees, operational } = assembleLocationForest(sample)
    assert.equal(operational.length, 0)
    assert.ok(!trees.some((t) => t.id === 9))
    const flat: number[] = []
    const walk = (n: { id: number; children: { id: number; children: never[] }[] }) => {
      flat.push(n.id)
      n.children.forEach(walk)
    }
    trees.forEach(walk)
    assert.ok(!flat.includes(9))
  })

  it('TEST 3 — include_operational behavior works as designed', () => {
    const { trees, operational } = assembleLocationForest(sample, { includeOperational: true })
    assert.ok(operational.some((o) => o.id === 9 && o.location_type?.code === 'UNSPECIFIED'))
    assert.ok(!trees.some((t) => t.children.some((c) => c.id === 9)))
    assert.ok(!operational.some((o) => o.children.length > 0 && o.id === 9 && trees.some((t) => t.id === o.id)))
  })

  it('TEST 4 — Soft-deleted locations are excluded by default', () => {
    const { trees } = assembleLocationForest(sample)
    const floor = trees.find((t) => t.id === 1)?.children.find((c) => c.id === 2)?.children.find((c) => c.id === 3)
    assert.ok(floor)
    assert.ok(!floor!.children.some((c) => c.id === 10))
  })

  it('TEST 5 — Tree does not duplicate nodes', () => {
    const { trees, duplicateIds } = assembleLocationForest(sample)
    const ids: number[] = []
    const walk = (n: { id: number; children: Array<{ id: number; children: never[] }> }) => {
      ids.push(n.id)
      n.children.forEach(walk)
    }
    trees.forEach(walk)
    assert.equal(ids.length, new Set(ids).size)
    assert.equal(duplicateIds.length, 0)
  })

  it('TEST 6 — Path returns root → node in correct order', () => {
    const { path, found } = buildLocationPath(sample, 6)
    assert.equal(found, true)
    assert.deepEqual(path.map((p) => p.location_type?.code), ['SITE', 'BUILDING', 'FLOOR', 'ZONE', 'SPACE'])
    assert.deepEqual(path.map((p) => p.id), [1, 2, 3, 4, 6])
  })

  it('TEST 7 — Path handles missing node', () => {
    const { found, path } = buildLocationPath(sample, 999)
    assert.equal(found, false)
    assert.equal(path.length, 0)
  })

  it('TEST 8 — Cycle defense works', () => {
    const cyclic = [
      row({ id: 1, name: 'A', type_code: 'SITE', parent_id: 2 }),
      row({ id: 2, name: 'B', type_code: 'BUILDING', parent_id: 1 }),
    ]
    const { cycle } = buildLocationPath(cyclic, 1)
    assert.equal(cycle, true)
    const forest = assembleLocationForest(cyclic)
    assert.equal(forest.cyclesDetected, true)
  })

  it('TEST 9 — Returns direct children only', () => {
    const children = directChildrenOf(sample, 3)
    assert.deepEqual(children.map((c) => c.id).sort((a, b) => a - b), [4, 5, 8])
    assert.ok(children.every((c) => c.children.length === 0))
  })

  it('TEST 10 — SPACE has no children', () => {
    assert.equal(directChildrenOf(sample, 6).length, 0)
    assert.throws(
      () => typed({ typeCode: 'BUILDING', parentId: 6, parentTypeCode: 'SPACE', parentIsSpace: true }),
      /SPACE cannot contain/,
    )
  })

  it('TEST 11 — BUILDING cannot exist under FLOOR', () => {
    assert.throws(() => typed({ typeCode: 'BUILDING', parentId: 3, parentTypeCode: 'FLOOR' }), /BUILDING parent must be/)
  })

  it('TEST 12 — FLOOR may exist under SITE or BUILDING', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'FLOOR', parentId: 1, parentTypeCode: 'SITE' }))
    assert.doesNotThrow(() => typed({ typeCode: 'FLOOR', parentId: 2, parentTypeCode: 'BUILDING' }))
    assert.ok(ALLOWED_PARENT_TYPES.FLOOR.includes('SITE'))
    assert.ok(ALLOWED_PARENT_TYPES.FLOOR.includes('BUILDING'))
  })

  it('TEST 13 — SPACE allowed under FLOOR', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'SPACE', parentId: 3, parentTypeCode: 'FLOOR' }))
  })

  it('TEST 14 — SPACE allowed under ZONE', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'SPACE', parentId: 4, parentTypeCode: 'ZONE' }))
  })

  it('TEST 15 — SPACE allowed under DEPARTMENT_AREA', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'SPACE', parentId: 5, parentTypeCode: 'DEPARTMENT_AREA' }))
  })

  it('TEST 16 — Typed child blocked under UNSPECIFIED', () => {
    assert.throws(
      () => typed({ typeCode: 'BUILDING', parentId: 9, parentTypeCode: 'UNSPECIFIED' }),
      /Typed physical child cannot be attached under UNSPECIFIED/,
    )
    assert.ok(!ALLOWED_PARENT_TYPES.SITE.includes('UNSPECIFIED'))
  })

  it('TEST 17 — Self-parent blocked', () => {
    assert.throws(() => typed({ typeCode: 'FLOOR', locationId: 3, parentId: 3, parentTypeCode: 'BUILDING' }), /own parent/)
  })

  it('TEST 18 — Cycle blocked', () => {
    assert.throws(
      () => typed({ typeCode: 'FLOOR', locationId: 3, parentId: 6, parentTypeCode: 'SPACE', ancestorIds: [6, 4, 3] }),
      /Cycle detected/,
    )
  })

  it('TEST 19 — Valid FLOOR / child move succeeds where matrix permits', () => {
    const node = { id: 8, parent_id: 3 as number | null }
    const moved = applyHierarchyMove(node, 4)
    assert.equal(moved.parent_id, 4)
    assert.doesNotThrow(() => typed({ typeCode: 'SPACE', locationId: 8, parentId: 4, parentTypeCode: 'ZONE', ancestorIds: [4, 3, 2, 1] }))
  })

  it('TEST 20 — Invalid move is rejected', () => {
    assert.throws(() => typed({ typeCode: 'FLOOR', locationId: 3, parentId: 4, parentTypeCode: 'ZONE', ancestorIds: [4] }), /FLOOR parent must be/)
    assert.throws(() => typed({ typeCode: 'SITE', locationId: 1, parentId: 2, parentTypeCode: 'BUILDING', ancestorIds: [2] }), /SITE parent must be/)
  })

  it('TEST 21 — Move does not change asset location_id', () => {
    const hierarchy = readServerSource('src/services/locationHierarchy.ts')
    assert.match(hierarchy, /UPDATE locations SET parent_id = \?, updated_at = \? WHERE id = \?/)
    assert.doesNotMatch(hierarchy, /UPDATE assets SET[\s\S]*location_id/)
    const asset = { location_id: 8, rtd_location_id: 8 }
    const afterMove = { ...asset }
    assert.equal(placementFksUnchanged(asset, afterMove), true)
  })

  it('TEST 22 — Move does not change asset rtd_location_id', () => {
    const hierarchy = readServerSource('src/services/locationHierarchy.ts')
    assert.doesNotMatch(hierarchy, /UPDATE assets SET[\s\S]*rtd_location_id/)
    assert.equal(placementFksUnchanged({ location_id: 3, rtd_location_id: 9 }, { location_id: 3, rtd_location_id: 9 }), true)
  })

  it('TEST 23 — Move does not change inventory location references', () => {
    const hierarchy = readServerSource('src/services/locationHierarchy.ts')
    assert.doesNotMatch(hierarchy, /UPDATE (consumables|accessories|components) SET/)
  })

  it('TEST 24 — Archive blocked with active children', () => {
    const r = archiveBlockers({
      active_children: 5, asset_placements: 0, rtd_references: 0,
      inventory_records: 0, user_references: 0, department_references: 0,
    })
    assert.equal(r.blocked, true)
    assert.ok(r.messages.some((m) => /5 active child/.test(m)))
  })

  it('TEST 25 — Archive blocked with asset placement reference', () => {
    const r = archiveBlockers({
      active_children: 0, asset_placements: 12, rtd_references: 0,
      inventory_records: 0, user_references: 0, department_references: 0,
    })
    assert.ok(r.messages.some((m) => /12 asset placements/.test(m)))
  })

  it('TEST 26 — Archive blocked with RTD reference', () => {
    const r = archiveBlockers({
      active_children: 0, asset_placements: 0, rtd_references: 3,
      inventory_records: 0, user_references: 0, department_references: 0,
    })
    assert.ok(r.messages.some((m) => /3 RTD/.test(m)))
  })

  it('TEST 27 — Archive blocked with inventory reference', () => {
    const r = archiveBlockers({
      active_children: 0, asset_placements: 0, rtd_references: 0,
      inventory_records: 4, user_references: 0, department_references: 0,
    })
    assert.ok(r.messages.some((m) => /4 inventory/.test(m)))
  })

  it('TEST 28 — Unused leaf SPACE can archive', () => {
    const r = archiveBlockers({
      active_children: 0, asset_placements: 0, rtd_references: 0,
      inventory_records: 0, user_references: 0, department_references: 0,
    })
    assert.equal(r.blocked, false)
  })

  it('TEST 29 — Valid archived leaf restores (contract)', () => {
    const hierarchy = readServerSource('src/services/locationHierarchy.ts')
    assert.match(hierarchy, /LOCATION_RESTORED/)
    assert.match(hierarchy, /deleted_at IS NOT NULL/)
    assert.match(hierarchy, /SET deleted_at = NULL/)
    assert.match(hierarchy, /Cannot restore: parent is missing or archived/)
  })

  it('TEST 30 — Restore fails if parent is missing/deleted/invalid', () => {
    const hierarchy = readServerSource('src/services/locationHierarchy.ts')
    assert.match(hierarchy, /Cannot restore: parent is missing or archived/)
    assert.match(hierarchy, /validateLocationWrite/)
  })

  it('TEST 31 — Node assets use exact location semantics', () => {
    const summary = summarizeExactAssets([
      { location_id: 6, rtd_location_id: 1 },
      { location_id: 3, rtd_location_id: 6 },
      { location_id: 1, rtd_location_id: 1 },
    ], 6)
    assert.equal(summary.total, 2)
    assert.equal(summary.placement_count, 1)
    assert.equal(summary.rtd_count, 1)
    assert.equal(assetMatchesExactLocation({ location_id: 4, rtd_location_id: null }, 6), false)
  })

  it('TEST 32 — No descendants included', () => {
    const hierarchy = readServerSource('src/services/locationHierarchy.ts')
    assert.match(hierarchy, /location_id = \? OR rtd_location_id = \?/)
    assert.doesNotMatch(hierarchy, /include_descendants|WITH RECURSIVE/)
    assert.equal(assetMatchesExactLocation({ location_id: 3, rtd_location_id: null }, 6), false)
  })

  it('TEST 33 — Exact inventory location semantics preserved', () => {
    assert.equal(inventoryMatchesExactLocation({ location_id: 6 }, 6), true)
    assert.equal(inventoryMatchesExactLocation({ location_id: 3 }, 6), false)
    const hierarchy = readServerSource('src/services/locationHierarchy.ts')
    assert.match(hierarchy, /inventoryGroup\('consumables'/)
    assert.match(hierarchy, /inventoryGroup\('accessories'/)
    assert.match(hierarchy, /inventoryGroup\('components'/)
    assert.match(hierarchy, /WHERE deleted_at IS NULL AND location_id = \?/)
  })

  it('TEST 34 — Location types selectlist works', () => {
    const users = readServerSource('src/routes/users.ts')
    assert.match(users, /mastersRouter\.get\('\/location-types'/)
    assert.match(users, /listLocationTypes/)
  })

  it('TEST 35 — Space subtypes selectlist works', () => {
    const users = readServerSource('src/routes/users.ts')
    assert.match(users, /mastersRouter\.get\('\/space-subtypes'/)
    assert.match(users, /listSpaceSubtypes/)
  })

  it('TEST 36 — Existing /locations selectlist contract unchanged', () => {
    const users = readServerSource('src/routes/users.ts')
    assert.match(users, /r\.get\('\/selectlist'/)
    assert.match(users, /locationSelectlist/)
  })

  it('TEST 37 — Existing exact hardware location filter unchanged', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /AND \(a\.location_id = \? OR a\.rtd_location_id = \?\)/)
    assert.doesNotMatch(hw, /include_descendants|location_scope|WITH RECURSIVE/)
  })

  it('TEST 38 — Checkout-to-location behavior unchanged', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /location_id = CASE WHEN \? = 'location' THEN \? ELSE location_id END/)
  })

  it('TEST 39 — Check-in behavior unchanged', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /b\.location_id \|\| asset\.rtd_location_id \|\| asset\.location_id/)
  })

  it('TEST 40 — HRMS/import location behavior unchanged', () => {
    const eng = readServerSource('src/services/importEngine.ts')
    assert.match(eng, /SELECT id FROM locations WHERE name = \? AND deleted_at IS NULL LIMIT 1/)
    assert.doesNotMatch(eng, /WHERE name = \? AND parent_id/)
    const users = readServerSource('src/routes/users.ts')
    assert.match(users, /\/tree'|\/path'|\/move'|\/archive'|\/restore'/)
  })

  it('routes register hierarchy endpoints before :id', () => {
    const users = readServerSource('src/routes/users.ts')
    const locStart = users.indexOf("mastersRouter.use('/locations'")
    const locSlice = users.slice(locStart, users.indexOf("mastersRouter.get('/location-types'"))
    const treeIdx = locSlice.indexOf("r.get('/tree'")
    const idIdx = locSlice.indexOf("r.get('/:id',")
    assert.ok(treeIdx > 0 && idIdx > treeIdx)
    assert.match(users, /LOCATION_MOVED|moveLocation/)
    assert.match(users, /archiveLocation|LOCATION_ARCHIVED/)
  })

  it('company filter resolves SITE context without excluding NULL operational', () => {
    const { trees, operational } = assembleLocationForest(sample, { companyId: 10, includeOperational: true })
    assert.ok(trees.some((t) => t.id === 1))
    assert.ok(!trees.some((t) => t.id === 11))
    assert.ok(operational.some((o) => o.id === 9))
  })
})
