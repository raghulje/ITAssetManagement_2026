import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from '../wave0/helpers/source.js'
import {
  ALLOWED_PARENT_TYPES,
  LOCATION_TYPE_CODES,
  SPACE_SUBTYPE_CODES,
  assertLocationHierarchy,
  assertSpaceSubtypeUsage,
} from '../../src/services/locationFoundation.js'

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

describe('Wave 2.2 — Typed location foundation', () => {
  it('1. location type master exists in migration 034', () => {
    const sql = readServerSource('src/db/mysql/034_location_types_and_space_subtypes.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS `location_types`/)
  })

  it('2. required seed types exist', () => {
    const sql = readServerSource('src/db/mysql/034_location_types_and_space_subtypes.sql')
    for (const code of LOCATION_TYPE_CODES) {
      assert.match(sql, new RegExp(`'${code}'`))
    }
    assert.equal(LOCATION_TYPE_CODES.length, 7)
  })

  it('3. UNSPECIFIED exists', () => {
    assert.ok(LOCATION_TYPE_CODES.includes('UNSPECIFIED'))
    const sql = readServerSource('src/db/mysql/034_location_types_and_space_subtypes.sql')
    assert.match(sql, /'UNSPECIFIED'/)
  })

  it('4. SPACE exists', () => {
    assert.ok(LOCATION_TYPE_CODES.includes('SPACE'))
    const sql = readServerSource('src/db/mysql/034_location_types_and_space_subtypes.sql')
    assert.match(sql, /'SPACE'/)
    assert.match(sql, /`is_space` TINYINT\(1\) NOT NULL DEFAULT 0/)
  })

  it('5. required space subtypes exist', () => {
    const sql = readServerSource('src/db/mysql/034_location_types_and_space_subtypes.sql')
    assert.equal(SPACE_SUBTYPE_CODES.length, 6)
    for (const code of SPACE_SUBTYPE_CODES) {
      assert.match(sql, new RegExp(`'${code}'`))
    }
  })

  it('6. SPACE may accept subtype', () => {
    assert.doesNotThrow(() => assertSpaceSubtypeUsage({ typeCode: 'SPACE', spaceSubtypeId: 3 }))
  })

  it('7. Non-SPACE rejects subtype', () => {
    assert.throws(
      () => assertSpaceSubtypeUsage({ typeCode: 'SITE', spaceSubtypeId: 1 }),
      /space_subtype_id is only valid when location type is SPACE/,
    )
    assert.throws(
      () => assertSpaceSubtypeUsage({ typeCode: 'UNSPECIFIED', spaceSubtypeId: 1 }),
      /space_subtype_id is only valid when location type is SPACE/,
    )
  })

  it('8. SPACE subtype is optional (backward compatible)', () => {
    assert.doesNotThrow(() => assertSpaceSubtypeUsage({ typeCode: 'SPACE', spaceSubtypeId: null }))
  })

  it('9. SITE may be root', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'SITE', parentId: null, parentTypeCode: null }))
    assert.ok(ALLOWED_PARENT_TYPES.SITE.includes(null))
  })

  it('10. BUILDING requires SITE parent', () => {
    assert.throws(() => typed({ typeCode: 'BUILDING', parentId: null }), /BUILDING parent must be/)
    assert.doesNotThrow(() => typed({ typeCode: 'BUILDING', parentId: 1, parentTypeCode: 'SITE' }))
  })

  it('11. FLOOR requires BUILDING or SITE parent', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'FLOOR', parentId: 1, parentTypeCode: 'SITE' }))
    assert.doesNotThrow(() => typed({ typeCode: 'FLOOR', parentId: 2, parentTypeCode: 'BUILDING' }))
  })

  it('12. FLOOR may contain ZONE', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'ZONE', parentId: 3, parentTypeCode: 'FLOOR' }))
  })

  it('13. FLOOR may contain DEPARTMENT_AREA', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'DEPARTMENT_AREA', parentId: 3, parentTypeCode: 'FLOOR' }))
  })

  it('14. FLOOR may contain SPACE', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'SPACE', parentId: 3, parentTypeCode: 'FLOOR' }))
  })

  it('15. ZONE may contain SPACE', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'SPACE', parentId: 4, parentTypeCode: 'ZONE' }))
  })

  it('16. DEPARTMENT_AREA may contain SPACE', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'SPACE', parentId: 5, parentTypeCode: 'DEPARTMENT_AREA' }))
  })

  it('17. SPACE cannot contain child physical locations', () => {
    assert.throws(
      () => typed({ typeCode: 'UNSPECIFIED', parentId: 9, parentIsSpace: true }),
      /SPACE cannot contain child physical locations/,
    )
    assert.throws(
      () => typed({ typeCode: 'SPACE', parentId: 3, parentTypeCode: 'FLOOR', hasChildren: true }),
      /SPACE cannot contain child physical locations/,
    )
  })

  it('18. Self-parenting rejected', () => {
    assert.throws(
      () => typed({ typeCode: 'UNSPECIFIED', locationId: 7, parentId: 7 }),
      /Location cannot be its own parent/,
    )
  })

  it('19. Cycle rejected', () => {
    assert.throws(
      () => typed({ typeCode: 'SITE', locationId: 1, parentId: 2, parentTypeCode: 'BUILDING', ancestorIds: [2, 1] }),
      /Cycle detected in location parentage/,
    )
  })

  it('20. UNSPECIFIED legacy compatibility preserved', () => {
    assert.doesNotThrow(() => typed({ typeCode: 'UNSPECIFIED', parentId: null }))
    assert.doesNotThrow(() => typed({ typeCode: 'UNSPECIFIED', parentId: 9, parentTypeCode: 'SITE' }))
    // Wave 2.6: typed physical children cannot attach under UNSPECIFIED
    assert.throws(
      () => typed({ typeCode: 'SITE', parentId: 9, parentTypeCode: 'UNSPECIFIED' }),
      /Typed physical child cannot be attached under UNSPECIFIED/,
    )
  })

  it('backend wires locationFoundation validators', () => {
    const users = readServerSource('src/routes/users.ts')
    const hierarchy = readServerSource('src/services/locationHierarchy.ts')
    assert.match(users, /assertLocationHierarchy/)
    assert.match(users, /assertSpaceSubtypeUsage/)
    assert.match(hierarchy, /assertLocationHierarchy/)
    assert.match(hierarchy, /assertSpaceSubtypeUsage/)
  })

  it('external_code reconciliation is guarded', () => {
    const sql = readServerSource('src/db/mysql/035_locations_typed_columns_and_external_code.sql')
    assert.match(sql, /COLUMN_NAME = 'external_code'/)
    assert.match(sql, /ADD COLUMN `external_code` VARCHAR\(100\) NULL/)
  })

  it('backfill assigns UNSPECIFIED only (no name guessing)', () => {
    const sql = readServerSource('src/db/mysql/036_locations_unspecified_backfill.sql')
    assert.match(sql, /code = 'UNSPECIFIED'/)
    assert.doesNotMatch(sql, /LIKE '%Tower%'|LIKE '%Building%'/)
  })

  it('hardware location filter remains exact OR (no descendants)', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /AND \(a\.location_id = \? OR a\.rtd_location_id = \?\)/)
    assert.doesNotMatch(hw, /include_descendants|location_scope|WITH RECURSIVE/)
  })
})
