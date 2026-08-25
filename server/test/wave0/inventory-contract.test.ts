import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from './helpers/source.js'

/** Remaining qty as computed in inventory.ts transform(): qty - SUM(assigned_qty). */
function remaining(qty: number, assignedSum: number) {
  return Number(qty) - (Number(assignedSum) || 0)
}

describe('Wave 0 — Inventory quantity + issue contracts', () => {
  it('remaining = qty − checked_out; available aliases remaining', () => {
    const src = readServerSource('src/routes/inventory.ts')
    assert.match(src, /const remaining = Number\(row\.qty\) - assigned/)
    assert.match(src, /available: remaining/)
    assert.equal(remaining(10, 3), 7)
    assert.equal(remaining(10, 0), 10)
    assert.equal(remaining(10, 10), 0)
  })

  it('checkout is rejected when assigned_qty exceeds remaining (current fail message)', () => {
    const src = readServerSource('src/routes/inventory.ts')
    assert.match(src, /if \(qty > item\.remaining\) return fail\(res, 'Insufficient quantity'\)/)
    const qty = 2
    const itemRemaining = remaining(10, 9)
    assert.equal(qty > itemRemaining, true)
  })

  it('consumable/accessory checkout target is assigned_to (user); component uses asset_id', () => {
    const src = readServerSource('src/routes/inventory.ts')
    assert.match(src, /INSERT INTO accessories_checkout[\s\S]*assigned_type, assigned_qty/)
    assert.match(src, /assignedEmployee \? 'employee' : 'user'/)
    assert.match(src, /fail\(res, 'assigned_to or assigned_employee_id required'\)/)
    assert.match(src, /INSERT INTO consumables_users \(consumable_id, assigned_to/)
    assert.match(src, /fail\(res, 'asset_id required'\)/)
  })

  it('default catalog qty on create is 1 and min_amt is 0 \(inventory POST\)', () => {
    const src = readServerSource('src/routes/inventory.ts')
    assert.match(src, /b\.qty \|\| 1/)
    assert.match(src, /b\.min_amt \|\| 0/)
  })

  it('list filters company_id and location_id on the catalog row \(not checkout rows\)', () => {
    const src = readServerSource('src/routes/inventory.ts')
    assert.match(src, /if \(req\.query\.company_id\)/)
    assert.match(src, /sql \+= ' AND company_id = \?'/)
    assert.match(src, /if \(req\.query\.location_id\)/)
    assert.match(src, /sql \+= ' AND location_id = \?'/)
  })
})
