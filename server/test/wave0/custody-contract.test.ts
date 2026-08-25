import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from './helpers/source.js'

/**
 * Captures hardware.ts checkout / checkin / replace rules as they exist today.
 * These are the contracts Wave 1+ must not silently change.
 */

const ASSIGNED_TYPES = ['user', 'location', 'asset', 'employee'] as const

function checkoutLocationId(
  checkoutToType: string,
  assignedTo: number,
  currentLocationId: number | null,
): number | null {
  // SQL: location_id = CASE WHEN checkoutToType = 'location' THEN assignedTo ELSE location_id END
  return checkoutToType === 'location' ? assignedTo : currentLocationId
}

function checkinLocationId(bodyLocationId: number | null | undefined, rtd: number | null, location: number | null) {
  // hardware.ts: b.location_id || asset.rtd_location_id || asset.location_id
  return bodyLocationId || rtd || location
}

function canCheckout(asset: { assigned_to: number | null; statusType?: string }) {
  if (asset.assigned_to) return { ok: false, status: 409, message: 'Asset is already assigned. Unassign it before assigning to someone else.' }
  if (asset.statusType && asset.statusType !== 'deployable') {
    return { ok: false, status: 422, message: 'Only in-stock (ready to assign) assets can be assigned' }
  }
  return { ok: true }
}

function canCheckin(asset: { assigned_to: number | null }, reason: string | null) {
  if (!asset.assigned_to) return { ok: false, message: 'Asset is not assigned' }
  if (!reason) return { ok: false, message: 'Reason is required to unassign' }
  return { ok: true }
}

function canReplace(oldAsset: { assigned_to: number | null; assigned_type: string | null }, newAsset: { assigned_to: number | null; statusType?: string }, newId: number, oldId: number, reason: string | null) {
  if (!newId) return { ok: false, message: 'new_asset_id is required' }
  if (!reason) return { ok: false, message: 'Reason is required to replace an asset' }
  if (newId === oldId) return { ok: false, message: 'Replacement asset must be different' }
  if (!oldAsset.assigned_to || String(oldAsset.assigned_type) !== 'employee') {
    return { ok: false, message: 'Current asset must be assigned to an employee' }
  }
  if (newAsset.assigned_to) return { ok: false, message: 'Replacement asset is already assigned' }
  if (newAsset.statusType && newAsset.statusType !== 'deployable') {
    return { ok: false, message: 'Replacement asset must be in a deployable (In Stock) status' }
  }
  return { ok: true }
}

describe('Wave 0 — Custody contracts (hardware checkout / checkin / replace)', () => {
  it('assigned_type enum currently supports user, location, asset, employee', () => {
    const schema = readServerSource('src/db/mysql/001_schema.sql')
    assert.match(schema, /`assigned_type` ENUM\('user','location','asset','employee'\)/)
    assert.deepEqual([...ASSIGNED_TYPES].sort(), ['asset', 'employee', 'location', 'user'])
  })

  it('checkout to location overwrites location_id; other targets leave it unchanged', () => {
    assert.equal(checkoutLocationId('location', 44, 10), 44)
    assert.equal(checkoutLocationId('employee', 99, 10), 10)
    assert.equal(checkoutLocationId('user', 5, 10), 10)
    assert.equal(checkoutLocationId('asset', 8, 10), 10)
  })

  it('checkout default type is user when body omits checkout_to_type (hardware.ts)', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /checkoutToType = b\.checkout_to_type \|\| b\.assigned_type \|\| 'user'/)
  })

  it('already assigned → 409; non-deployable → 422', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /Asset is already assigned\. Unassign it before assigning to someone else/)
    assert.match(hw, /fail\(res, 'Asset is already assigned[\s\S]*409/)
    assert.match(hw, /Only in-stock \(ready to assign\) assets can be assigned/)
    const busy = canCheckout({ assigned_to: 1, statusType: 'deployable' })
    assert.equal(busy.status, 409)
    const pending = canCheckout({ assigned_to: null, statusType: 'pending' })
    assert.equal(pending.status, 422)
    assert.equal(canCheckout({ assigned_to: null, statusType: 'deployable' }).ok, true)
  })

  it('checkin requires current assignment and a reason; restores rtd then location', () => {
    assert.equal(canCheckin({ assigned_to: null }, 'done').ok, false)
    assert.equal(canCheckin({ assigned_to: 1 }, null).ok, false)
    assert.equal(canCheckin({ assigned_to: 1 }, 'returned').ok, true)
    assert.equal(checkinLocationId(undefined, 3, 9), 3)
    assert.equal(checkinLocationId(12, 3, 9), 12)
    assert.equal(checkinLocationId(undefined, null, 9), 9)
  })

  it('replace is employee-only custody swap; new asset must be free and deployable', () => {
    const baseOld = { assigned_to: 7, assigned_type: 'employee' as const }
    assert.equal(canReplace(baseOld, { assigned_to: null, statusType: 'deployable' }, 2, 1, 'swap').ok, true)
    assert.equal(canReplace({ assigned_to: 7, assigned_type: 'user' }, { assigned_to: null }, 2, 1, 'swap').ok, false)
    assert.equal(canReplace(baseOld, { assigned_to: 1 }, 2, 1, 'swap').ok, false)
    assert.equal(canReplace(baseOld, { assigned_to: null }, 1, 1, 'swap').ok, false)
    assert.equal(canReplace(baseOld, { assigned_to: null }, 2, 1, null).ok, false)
  })

  it('checkout and checkin write action_type checkout / checkin (action_logs contract)', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    assert.match(hw, /actionType: 'checkout'/)
    assert.match(hw, /actionType: 'checkin'/)
    assert.match(hw, /'replace_out'/)
    assert.match(hw, /'replace_in'/)
  })
})
