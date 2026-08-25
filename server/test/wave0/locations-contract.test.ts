import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from './helpers/source.js'

describe('Wave 0 — Location references (must stay stable through Wave 2)', () => {
  it('location CRUD allowed fields keep legacy columns and additive type ids', () => {
    const users = readServerSource('src/routes/users.ts')
    assert.match(users, /'name', 'parent_id', 'company_id', 'address', 'city', 'state', 'country', 'zip', 'notes'/)
    assert.match(users, /'location_type_id', 'space_subtype_id'/)
  })

  it('asset list/facets filter location as location_id OR rtd_location_id', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /AND \(a\.location_id = \? OR a\.rtd_location_id = \?\)/)
  })

  it('create asset copies rtd_location_id into location_id when location_id omitted', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /b\.location_id \|\| b\.rtd_location_id \|\| null/)
    const b = { rtd_location_id: 8 as number | null, location_id: undefined as number | undefined }
    const locationId = b.location_id || b.rtd_location_id || null
    assert.equal(locationId, 8)
  })

  it('locations.parent_id is self-FK ON DELETE SET NULL (001_schema)', () => {
    const schema = readServerSource('src/db/mysql/001_schema.sql')
    assert.match(schema, /CONSTRAINT `fk_locations_parent` FOREIGN KEY \(`parent_id`\) REFERENCES `locations` \(`id`\) ON DELETE SET NULL/)
  })

  it('display location uses COALESCE(location_id, rtd_location_id)', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /COALESCE\(a\.location_id, a\.rtd_location_id\)/)
  })
})
