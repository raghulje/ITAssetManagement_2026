import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from '../wave0/helpers/source.js'

/**
 * Wave 2.1 — Location regression contracts.
 * Captures CURRENT production behavior before typed hierarchy (Wave 2.2+).
 * Source-backed + pure behavioral helpers; no production DB access.
 */

/** Mirrors hardware.ts checkout location CASE WHEN. */
function checkoutLocationId(
  checkoutToType: string,
  assignedTo: number,
  currentLocationId: number | null,
): number | null {
  return checkoutToType === 'location' ? assignedTo : currentLocationId
}

/** Mirrors hardware.ts check-in: body.location_id || rtd || location. */
function checkinLocationId(
  bodyLocationId: number | null | undefined,
  rtd: number | null,
  location: number | null,
) {
  return bodyLocationId || rtd || location
}

/** Mirrors hardware.ts create: location_id || rtd_location_id || null. */
function createLocationId(body: { location_id?: number | null; rtd_location_id?: number | null }) {
  return body.location_id || body.rtd_location_id || null
}

/** Mirrors hardware.ts replace location for old-asset check-in side. */
function replaceLocationId(
  oldRtd: number | null,
  oldLoc: number | null,
  newLoc: number | null,
) {
  return oldRtd || oldLoc || newLoc
}

/** Exact list filter semantics (OR, not AND). */
function assetMatchesLocationFilter(
  asset: { location_id: number | null; rtd_location_id: number | null },
  filterId: number,
) {
  return asset.location_id === filterId || asset.rtd_location_id === filterId
}

/** Soft-delete contract: only locations.deleted_at is set; assets FKs untouched. */
function softDeleteLocationKeepsAssetFks(asset: { location_id: number; rtd_location_id: number }) {
  // Soft delete does not run UPDATE assets … — FKs remain pointing at soft-deleted row.
  return { location_id: asset.location_id, rtd_location_id: asset.rtd_location_id }
}

/** Display COALESCE(location_id, rtd_location_id) equivalent for join target. */
function coalesceDisplayLocationId(locationId: number | null, rtdId: number | null) {
  return locationId ?? rtdId
}

/** Global-name import resolution (first live match wins). */
function resolveLocationByGlobalName(
  rows: Array<{ id: number; name: string; deleted_at: string | null }>,
  name: string,
): number | null {
  if (!name) return null
  const live = rows.find((r) => r.name === name && r.deleted_at == null)
  return live ? live.id : null
}

describe('Wave 2.1 — Location regression contracts', () => {
  it('TEST 1 — locations_crud_allowed_fields', () => {
    const users = readServerSource('src/routes/users.ts')
    assert.match(users, /'name', 'parent_id', 'company_id', 'address', 'city', 'state', 'country', 'zip', 'notes'/)
    assert.match(users, /'location_type_id', 'space_subtype_id'/)
  })

  it('TEST 2 — locations_parent_id_current_behavior', () => {
    const users = readServerSource('src/routes/users.ts')
    const schema = readServerSource('src/db/mysql/001_schema.sql')
    assert.match(users, /'parent_id'/)
    assert.match(schema, /CONSTRAINT `fk_locations_parent`/)
    // Wave 2.2: typed hierarchy is validated in locationFoundation; parent_id remains optional.
    assert.match(users, /assertLocationHierarchy/)
    assert.match(readServerSource('src/services/classificationFoundation.ts'), /validateCategoryParenting/)
  })

  it('TEST 3 — locations_soft_delete_keeps_asset_fk', () => {
    const crud = readServerSource('src/utils/crud.ts')
    const users = readServerSource('src/routes/users.ts')
    assert.match(crud, /UPDATE \$\{opts\.table\} SET deleted_at = \?, updated_at = \? WHERE id = \?/)
    assert.match(users, /UPDATE \$\{table\} SET deleted_at = \?, updated_at = \? WHERE id = \?/)
    // Soft path must not UPDATE assets or clear location_id / rtd_location_id.
    assert.doesNotMatch(crud, /UPDATE assets SET[\s\S]*location_id/)
    const kept = softDeleteLocationKeepsAssetFks({ location_id: 9, rtd_location_id: 9 })
    assert.equal(kept.location_id, 9)
    assert.equal(kept.rtd_location_id, 9)
    const schema = readServerSource('src/db/mysql/001_schema.sql')
    // Hard DELETE would SET NULL; soft delete does not trigger FK ON DELETE.
    assert.match(schema, /fk_assets_location[\s\S]*ON DELETE SET NULL/)
    assert.match(schema, /fk_assets_rtd_location[\s\S]*ON DELETE SET NULL/)
  })

  it('TEST 4 — asset_list_location_or_rtd', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /AND \(a\.location_id = \? OR a\.rtd_location_id = \?\)/)
    // Must be OR — matching either column; not AND.
    assert.equal(assetMatchesLocationFilter({ location_id: 9, rtd_location_id: 1 }, 9), true)
    assert.equal(assetMatchesLocationFilter({ location_id: 1, rtd_location_id: 9 }, 9), true)
    assert.equal(assetMatchesLocationFilter({ location_id: 1, rtd_location_id: 2 }, 9), false)
    assert.equal(
      assetMatchesLocationFilter({ location_id: 9, rtd_location_id: 9 }, 9) &&
        !(assetMatchesLocationFilter({ location_id: 9, rtd_location_id: 1 }, 9) === false),
      true,
    )
  })

  it('TEST 5 — asset_create_copies_rtd_to_location', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /b\.location_id \|\| b\.rtd_location_id \|\| null/)
    assert.equal(createLocationId({ rtd_location_id: 8 }), 8)
    assert.equal(createLocationId({ location_id: 3, rtd_location_id: 8 }), 3)
    assert.equal(createLocationId({}), null)
  })

  it('TEST 6 — checkout_location_overwrites_location_id', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(
      hw,
      /location_id = CASE WHEN \? = 'location' THEN \? ELSE location_id END/,
    )
    assert.equal(checkoutLocationId('location', 44, 10), 44)
  })

  it('TEST 7 — checkout_employee_preserves_location_id', () => {
    assert.equal(checkoutLocationId('employee', 99, 10), 10)
    assert.equal(checkoutLocationId('user', 5, 10), 10)
    assert.equal(checkoutLocationId('asset', 8, 10), 10)
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /ELSE location_id END/)
  })

  it('TEST 8 — checkin_prefers_rtd_then_location', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /b\.location_id \|\| asset\.rtd_location_id \|\| asset\.location_id/)
    assert.equal(checkinLocationId(12, 3, 9), 12)
    assert.equal(checkinLocationId(undefined, 3, 9), 3)
    assert.equal(checkinLocationId(undefined, null, 9), 9)
    assert.equal(checkinLocationId(null, null, 9), 9)
  })

  it('TEST 9 — replace_uses_rtd_location', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(
      hw,
      /const locationId = oldAsset\.rtd_location_id \|\| oldAsset\.location_id \|\| newAsset\.location_id/,
    )
    assert.equal(replaceLocationId(5, 9, 1), 5)
    assert.equal(replaceLocationId(null, 9, 1), 9)
    assert.equal(replaceLocationId(null, null, 1), 1)
  })

  it('TEST 10 — coalesce_display_location', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /COALESCE\(a\.location_id, a\.rtd_location_id\)/)
    assert.equal(coalesceDisplayLocationId(9, 1), 9)
    assert.equal(coalesceDisplayLocationId(null, 1), 1)
    assert.equal(coalesceDisplayLocationId(null, null), null)
  })

  it('TEST 11 — consumable_filter_location_id', () => {
    const inv = readServerSource('src/routes/inventory.ts')
    assert.match(inv, /if \(req\.query\.location_id\)/)
    assert.match(inv, /sql \+= ' AND location_id = \?'/)
    // Exact catalog location_id — no OR rtd, no descendants.
    assert.doesNotMatch(inv, /rtd_location_id/)
    assert.doesNotMatch(inv, /include_descendants|location_scope|subtree/)
  })

  it('TEST 12 — accessory_component_location_crud', () => {
    const inv = readServerSource('src/routes/inventory.ts')
    assert.match(
      inv,
      /INSERT INTO \$\{cfg\.table\} \((?:domain_id, )?name, category_id, company_id, legal_entity_id, location_id/,
    )
    assert.match(inv, /'name', 'category_id', 'company_id', 'legal_entity_id', 'location_id'/)
    assert.match(inv, /b\.location_id \|\| null/)
  })

  it('TEST 13 — import_location_by_global_name', () => {
    const eng = readServerSource('src/services/importEngine.ts')
    assert.match(
      eng,
      /SELECT id FROM \$\{table\} WHERE name = \? AND deleted_at IS NULL LIMIT 1/,
    )
    assert.match(
      eng,
      /SELECT id FROM locations WHERE name = \? AND deleted_at IS NULL LIMIT 1/,
    )
    // Global name: first match wins; no parent_id in WHERE.
    assert.doesNotMatch(eng, /WHERE name = \? AND parent_id/)
    const id = resolveLocationByGlobalName(
      [
        { id: 1, name: 'Chennai', deleted_at: null },
        { id: 2, name: 'Chennai', deleted_at: null },
      ],
      'Chennai',
    )
    assert.equal(id, 1)
  })

  it('TEST 14 — import_asset_sets_location_and_rtd', () => {
    const eng = readServerSource('src/services/importEngine.ts')
    assert.match(
      eng,
      /findOrCreateByName\('locations', cell\(row, map, 'location'\), \{ company_id: companyId \}\)/,
    )
    // INSERT sets both location_id and rtd_location_id to the same resolved locationId.
    assert.match(
      eng,
      /INSERT INTO assets \((?:domain_id, )?asset_tag, old_asset_tag, name, serial, model_id, status_id, company_id, location_id, rtd_location_id/,
    )
    assert.match(
      eng,
      /location_id=\?, rtd_location_id=COALESCE\(\?, rtd_location_id\)/,
    )
    // Params pass locationId twice for create/update (location + rtd).
    assert.match(eng, /companyId, locationId, locationId/)
  })

  it('TEST 15 — locations_selectlist_optional_companyId', () => {
    const crud = readServerSource('src/utils/crud.ts')
    assert.match(crud, /if \(req\.query\.companyId\)/)
    assert.match(crud, /sql \+= ' AND company_id = \?'/)
    // Without companyId: base query has no company filter.
    assert.match(
      crud,
      /let sql = `SELECT id, \$\{nameCol\} as text FROM \$\{table\} WHERE deleted_at IS NULL`/,
    )
  })

  it('TEST 16 — public_qr_shows_location_name', () => {
    const pub = readServerSource('src/routes/publicAssets.ts')
    assert.match(pub, /loc\.name as location_name/)
    assert.match(pub, /rtd\.name as rtd_location_name/)
    assert.match(pub, /location: asset\.location_name \|\| asset\.rtd_location_name/)
  })

  it('TEST 17 — assigned_type_location_enum', () => {
    const schema = readServerSource('src/db/mysql/001_schema.sql')
    assert.match(schema, /`assigned_type` ENUM\('user','location','asset','employee'\)/)
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /checkoutToType = b\.checkout_to_type \|\| b\.assigned_type \|\| 'user'/)
    assert.match(hw, /WHEN a\.assigned_type = 'location' THEN/)
    assert.ok(['user', 'location', 'asset', 'employee'].includes('location'))
  })
})
