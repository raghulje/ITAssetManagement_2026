import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { allowedDomainCodes, scopedDomainCodes, type DomainCode } from '../../src/services/domainAuth.js'

type Row = { module: string; domain: { code: DomainCode } }

function keepInScope(rows: Row[], scoped: DomainCode[]) {
  return rows.filter((r) => scoped.includes(r.domain.code))
}

function summarize(rows: Row[]) {
  return {
    total: rows.length,
    it: rows.filter((r) => r.domain.code === 'it').length,
    admin: rows.filter((r) => r.domain.code === 'admin').length,
  }
}

const mixed: Row[] = [
  { module: 'asset', domain: { code: 'it' } },
  { module: 'license', domain: { code: 'it' } },
  { module: 'accessory', domain: { code: 'admin' } },
  { module: 'consumable', domain: { code: 'admin' } },
  { module: 'component', domain: { code: 'it' } },
]

describe('Wave 3 — Unified People assignments', () => {
  it('unified list covers all five modules', () => {
    const modules = [...new Set(mixed.map((r) => r.module))]
    assert.deepEqual(modules.sort(), ['accessory', 'asset', 'component', 'consumable', 'license'])
  })

  it('domain filter All / IT / ADMIN works for Super Admin', () => {
    const allowed = allowedDomainCodes({ superuser: '1' })
    const all = keepInScope(mixed, scopedDomainCodes(allowed, undefined))
    const it = keepInScope(mixed, scopedDomainCodes(allowed, 'it'))
    const admin = keepInScope(mixed, scopedDomainCodes(allowed, 'admin'))
    assert.deepEqual(summarize(all), { total: 5, it: 3, admin: 2 })
    assert.deepEqual(summarize(it), { total: 3, it: 3, admin: 0 })
    assert.deepEqual(summarize(admin), { total: 2, it: 0, admin: 2 })
  })

  it('IT user only sees IT employee assignments', () => {
    const scoped = scopedDomainCodes(allowedDomainCodes({ 'domains.it': '1', 'people.view': '1' }), 'admin')
    const rows = keepInScope(mixed, scoped)
    assert.equal(rows.length, 0)
    const itOnly = keepInScope(mixed, scopedDomainCodes(['it'], undefined))
    assert.ok(itOnly.every((r) => r.domain.code === 'it'))
    assert.equal(itOnly.length, 3)
  })

  it('Admin user only sees ADMIN employee assignments', () => {
    const rows = keepInScope(mixed, scopedDomainCodes(['admin'], undefined))
    assert.ok(rows.every((r) => r.domain.code === 'admin'))
    assert.equal(rows.length, 2)
  })

  it('Super Admin sees both domains', () => {
    const rows = keepInScope(mixed, scopedDomainCodes(['it', 'admin'], undefined))
    assert.equal(rows.length, mixed.length)
    assert.equal(summarize(rows).it, 3)
    assert.equal(summarize(rows).admin, 2)
  })
})
