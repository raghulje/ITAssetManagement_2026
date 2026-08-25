import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from '../wave0/helpers/source.js'
import { jsonRequest, startApp, type StartedApp } from '../wave0/helpers/http.js'
import { ALLOWED_PARENT_TYPES } from '../../src/services/locationFoundation.js'

describe('Wave 3 — Space Management contracts', () => {
  it('migration 041 adds domain_attrs and ADMIN categories without USE/DROP TABLE', () => {
    const sql = readServerSource('src/db/mysql/041_assets_domain_attrs_admin_categories.sql')
    assert.doesNotMatch(sql, /USE\s+`?[\w]+`?\s*;/i)
    assert.doesNotMatch(sql, /DROP\s+TABLE/i)
    assert.match(sql, /ADD COLUMN `domain_attrs` JSON NULL/)
    assert.match(sql, /SELECT 'Chair' AS name/)
    assert.match(sql, /d\.code = 'admin'/)
  })

  it('migration 042 adds office/floor/occupant columns additively', () => {
    const sql = readServerSource('src/db/mysql/042_locations_office_space.sql')
    assert.doesNotMatch(sql, /USE\s+`?[\w]+`?\s*;/i)
    assert.doesNotMatch(sql, /DROP\s+TABLE/i)
    assert.match(sql, /ADD COLUMN `is_office` TINYINT\(1\) NOT NULL DEFAULT 0/)
    assert.match(sql, /ADD COLUMN `seat_count`/)
    assert.match(sql, /ADD COLUMN `space_active`/)
    assert.match(sql, /ADD COLUMN `occupant_employee_id`/)
  })

  it('spaces router lists offices, creates floors and SPACE children, lists assets', () => {
    const src = readServerSource('src/routes/spaces.ts')
    assert.match(src, /spacesRouter\.get\('\/offices'/)
    assert.match(src, /spacesRouter\.post\('\/offices\/:id\/floors'/)
    assert.match(src, /spacesRouter\.post\('\/floors\/:id\/spaces'/)
    assert.match(src, /spacesRouter\.get\('\/spaces\/:id\/assets'/)
    assert.match(src, /inventoryDomainClause/)
    assert.match(src, /typeId\('FLOOR'\)/)
    assert.match(src, /typeId\('SPACE'\)/)
    assert.match(src, /subtypeId/)
  })

  it('FLOOR may sit under SITE for office locations', () => {
    assert.ok(ALLOWED_PARENT_TYPES.FLOOR.includes('SITE'))
    assert.ok(ALLOWED_PARENT_TYPES.SPACE.includes('FLOOR'))
  })

  it('location writes accept is_office and location form has the office checkbox', () => {
    const users = readServerSource('src/routes/users.ts')
    assert.match(users, /'is_office', 'seat_count', 'space_active', 'occupant_employee_id'/)
    assert.match(users, /applyOfficeWrite/)
    const form = readServerSource('../client/src/pages/settings/MasterData.tsx')
    assert.match(form, /This is an office location/)
    const layout = readServerSource('../client/src/layout/AppLayout.tsx')
    assert.match(layout, /Space Management/)
    const app = readServerSource('../client/src/App.tsx')
    assert.match(app, /path="\/spaces"/)
  })

  it('app mounts /spaces behind settings.view for reads and settings.edit for writes', () => {
    const app = readServerSource('src/app.ts')
    assert.match(app, /api\.use\('\/spaces', spacesRouter\)/)
    assert.match(app, /requirePerm\('settings\.view'\)/)
    assert.match(app, /requirePerm\('settings\.edit'\)/)
  })
})

describe('Wave 3 — Space Management HTTP (no DB)', () => {
  let app: StartedApp

  before(async () => {
    app = await startApp()
  })

  after(async () => {
    await app.close()
  })

  it('GET /api/v1/spaces/offices requires auth', async () => {
    const { status, body } = await jsonRequest(app.baseUrl, '/api/v1/spaces/offices')
    assert.equal(status, 401)
    assert.deepEqual(body, { status: 'error', messages: ['Unauthorized'], payload: null })
  })

  it('POST /api/v1/spaces/offices/1/floors requires auth', async () => {
    const { status } = await jsonRequest(app.baseUrl, '/api/v1/spaces/offices/1/floors', {
      method: 'POST',
      body: JSON.stringify({ name: 'Floor 1' }),
    })
    assert.equal(status, 401)
  })
})
