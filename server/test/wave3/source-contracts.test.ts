import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from '../wave0/helpers/source.js'

describe('Wave 3 — Domain + People source contracts', () => {
  it('migrations 037–040 exist and are additive (no USE, no DROP TABLE)', () => {
    const files = [
      'src/db/mysql/037_asset_domain_admin_seed.sql',
      'src/db/mysql/038_inventory_domain_id.sql',
      'src/db/mysql/039_inventory_domain_it_backfill.sql',
      'src/db/mysql/040_checkout_assigned_employee.sql',
    ]
    for (const f of files) {
      const sql = readServerSource(f)
      assert.doesNotMatch(sql, /USE\s+`?[\w]+`?\s*;/i)
      assert.doesNotMatch(sql, /DROP\s+TABLE/i)
    }
    const seed = readServerSource('src/db/mysql/037_asset_domain_admin_seed.sql')
    assert.match(seed, /'ADMIN'/)
    assert.match(seed, /'admin'/)
    const cols = readServerSource('src/db/mysql/038_inventory_domain_id.sql')
    for (const table of ['assets', 'licenses', 'accessories', 'consumables', 'components']) {
      assert.match(cols, new RegExp(`ALTER TABLE \`${table}\` ADD COLUMN \`domain_id\``))
    }
    const backfill = readServerSource('src/db/mysql/039_inventory_domain_it_backfill.sql')
    assert.match(backfill, /UPDATE assets SET domain_id/)
    assert.match(backfill, /UPDATE licenses SET domain_id/)
    assert.match(backfill, /UPDATE accessories SET domain_id/)
    assert.match(backfill, /UPDATE consumables SET domain_id/)
    assert.match(backfill, /UPDATE components SET domain_id/)
  })

  it('permissions seed IT Asset Manager and Admin Asset Manager with domain keys', () => {
    const src = readServerSource('src/services/permissions.ts')
    assert.match(src, /Admin Asset Manager/)
    assert.match(src, /adminAssetManagerPerms/)
    assert.match(src, /domains\.it/)
    assert.match(src, /domains\.admin/)
    assert.match(src, /withDomainPerms\(allModulePerms\(\{ notifyOps: true \}\), \['it'\]\)/)
    assert.match(src, /withDomainPerms\(allModulePerms\(\{ notifyOps: true \}\), \['admin'\]\)/)
  })

  it('hardware list/create/update enforce domain', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /inventoryDomainClause/)
    assert.match(hw, /resolveWriteDomainId/)
    assert.match(hw, /requireAssetDomain/)
    assert.match(hw, /INSERT INTO assets \(\s*domain_id/)
  })

  it('licenses list/create/checkout enforce domain', () => {
    const lic = readServerSource('src/routes/licenses.ts')
    assert.match(lic, /inventoryDomainClause/)
    assert.match(lic, /resolveWriteDomainId/)
    assert.match(lic, /assertRecordDomainAccess/)
    assert.match(lic, /assigned_employee_id/)
  })

  it('qty modules list/create/checkout enforce domain', () => {
    const inv = readServerSource('src/routes/inventory.ts')
    assert.match(inv, /inventoryDomainClause/)
    assert.match(inv, /resolveWriteDomainId/)
    assert.match(inv, /assigned_employee_id/)
  })

  it('employees expose unified assignments and assignment-history APIs', () => {
    const emp = readServerSource('src/routes/employees.ts')
    assert.match(emp, /\/:id\/assignments/)
    assert.match(emp, /\/:id\/assignment-history/)
    assert.match(emp, /listEmployeeAssignments/)
    assert.match(emp, /listEmployeeAssignmentHistory/)
  })

  it('unified assignment read model covers five modules', () => {
    const src = readServerSource('src/services/employeeAssignments.ts')
    assert.match(src, /FROM assets a/)
    assert.match(src, /FROM license_seats ls/)
    assert.match(src, /FROM accessories_checkout ac/)
    assert.match(src, /FROM consumables_users cu/)
    assert.match(src, /FROM components_assets ca/)
    assert.match(src, /scoped\.includes\(domain\.code\)/)
    assert.match(src, /FROM action_logs al/)
  })

  it('frontend uses shared domain-aware forms and unified People view', () => {
    const emp = readServerSource('../client/src/pages/employees/Employees.tsx')
    assert.match(emp, /employeesApi\.assignments/)
    assert.match(emp, /employeesApi\.assignmentHistory/)
    assert.match(emp, /DomainFilter/)
    const form = readServerSource('../client/src/pages/assets/AssetForm.tsx')
    assert.match(form, /DomainSelect/)
    const lists = readServerSource('../client/src/pages/assets/AssetsList.tsx')
    assert.doesNotMatch(lists, /DomainFilter/)
    const roles = readServerSource('../client/src/pages/settings/RolesPermissions.tsx')
    assert.match(roles, /Admin Asset Manager/)
    assert.match(roles, /domains\.it/)
    assert.match(roles, /domains\.admin/)
  })
})
