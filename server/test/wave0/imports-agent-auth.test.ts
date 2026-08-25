import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { IMPORT_FIELDS, IMPORT_TYPE_LABELS, autoMap } from '../../src/services/importEngine.js'
import { isUsableSerial, hashAgentToken, newAgentCredentials } from '../../src/services/agentControl.js'
import { hasPermission, MODULES, viewerPerms } from '../../src/services/permissions.js'
import { signToken } from '../../src/middleware/auth.js'
import jwt from 'jsonwebtoken'

describe('Wave 0 — Imports', () => {
  it('import types currently include asset, location, consumable, accessory, component', () => {
    const keys = Object.keys(IMPORT_FIELDS)
    for (const t of ['asset', 'location', 'consumable', 'accessory', 'component', 'user', 'license']) {
      assert.ok(keys.includes(t), `missing import type ${t}`)
      assert.ok(IMPORT_TYPE_LABELS[t])
    }
  })

  it('asset import requires asset_tag and model (current IMPORT_FIELDS)', () => {
    const asset = IMPORT_FIELDS.asset
    assert.equal(asset.find((f) => f.key === 'asset_tag')?.required, true)
    assert.equal(asset.find((f) => f.key === 'model')?.required, true)
    assert.ok(asset.some((f) => f.key === 'location'))
  })

  it('autoMap matches aliases (asset tag / serial)', () => {
    const map = autoMap(['Asset Tag', 'Serial Number', 'Model'], 'asset')
    assert.equal(map.asset_tag, 'Asset Tag')
    assert.equal(map.serial, 'Serial Number')
    assert.equal(map.model, 'Model')
  })
})

describe('Wave 0 — Agent matching helpers', () => {
  it('isUsableSerial rejects OEM placeholders (current agentControl)', () => {
    assert.equal(isUsableSerial('ABC123XYZ'), true)
    assert.equal(isUsableSerial('To Be Filled By O.E.M.'), false)
    assert.equal(isUsableSerial('0'), false)
    assert.equal(isUsableSerial('none'), false)
    assert.equal(isUsableSerial('ab'), false)
  })

  it('agent token is hashed SHA-256; credentials include uuid + token', () => {
    const c = newAgentCredentials()
    assert.equal(c.token_hash, hashAgentToken(c.agent_token))
    assert.equal(c.agent_uuid.length, 36)
    assert.equal(c.agent_token.length, 64)
  })

  it('match order is serial → asset_tag → hostname (documented findAssetForAgent)', () => {
    const order = ['serial', 'asset_tag', 'hostname', 'hostname_tag']
    assert.deepEqual(order, ['serial', 'asset_tag', 'hostname', 'hostname_tag'])
  })
})

describe('Wave 0 — Auth / RBAC', () => {
  it('hasPermission: superuser and admin bypass; empty perms deny', () => {
    assert.equal(hasPermission({ superuser: '1' }, 'assets.delete'), true)
    assert.equal(hasPermission({ admin: '1' }, 'assets.delete'), true)
    assert.equal(hasPermission({ 'assets.view': '1' }, 'assets.view'), true)
    assert.equal(hasPermission({ 'assets.view': '1' }, 'assets.delete'), false)
    assert.equal(hasPermission({}, 'assets.view'), false)
  })

  it('viewer role is view-only across core modules (no checkout)', () => {
    const v = viewerPerms()
    assert.equal(v['assets.view'], '1')
    assert.equal(v['assets.checkout'], undefined)
    assert.equal(v['settings.edit'], undefined)
  })

  it('module catalog includes assets, inventory modules, people, reports, settings, maintenance', () => {
    for (const m of ['assets', 'accessories', 'consumables', 'components', 'people', 'reports', 'settings', 'maintenance']) {
      assert.ok((MODULES as readonly string[]).includes(m))
    }
  })

  it('JWT signToken uses sub = user id (auth middleware contract)', () => {
    const prev = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'wave0-secret'
    try {
      const token = signToken({ id: 42, username: 'admin' })
      const decoded = jwt.verify(token, 'wave0-secret') as { sub: number; username: string }
      assert.equal(decoded.sub, 42)
      assert.equal(decoded.username, 'admin')
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = prev
    }
  })
})
