import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  allowedDomainCodes,
  assertCanAccessDomain,
  normalizeDomainCode,
  resolveWriteDomainCode,
  scopedDomainCodes,
} from '../../src/services/domainAuth.js'

describe('Wave 3 — Domain RBAC unit tests', () => {
  it('normalizeDomainCode accepts IT / ADMIN aliases', () => {
    assert.equal(normalizeDomainCode('IT'), 'it')
    assert.equal(normalizeDomainCode('admin'), 'admin')
    assert.equal(normalizeDomainCode('ADMIN'), 'admin')
    assert.equal(normalizeDomainCode('itam'), 'it')
    assert.equal(normalizeDomainCode('nope'), null)
  })

  it('Super Admin (superuser) can access both domains', () => {
    assert.deepEqual(allowedDomainCodes({ superuser: '1' }), ['it', 'admin'])
  })

  it('application Admin flag can access both domains', () => {
    assert.deepEqual(allowedDomainCodes({ admin: '1' }), ['it', 'admin'])
  })

  it('IT Asset Manager domain key can access only IT', () => {
    assert.deepEqual(allowedDomainCodes({ 'domains.it': '1', 'assets.view': '1' }), ['it'])
  })

  it('Admin Asset Manager domain key can access only ADMIN', () => {
    assert.deepEqual(allowedDomainCodes({ 'domains.admin': '1', 'assets.view': '1' }), ['admin'])
  })

  it('legacy module perms without domain keys resolve to IT', () => {
    assert.deepEqual(allowedDomainCodes({ 'assets.view': '1' }), ['it'])
  })

  it('unauthorized requested domain is ignored for list scope', () => {
    assert.deepEqual(scopedDomainCodes(['it'], 'admin'), [])
    assert.deepEqual(scopedDomainCodes(['it'], 'it'), ['it'])
    assert.deepEqual(scopedDomainCodes(['it', 'admin'], ''), ['it', 'admin'])
  })

  it('IT user cannot write ADMIN domain', () => {
    assert.throws(
      () => resolveWriteDomainCode(['it'], 'admin'),
      /Forbidden: no access to ADMIN domain/,
    )
  })

  it('Admin user cannot write IT domain', () => {
    assert.throws(
      () => resolveWriteDomainCode(['admin'], 'it'),
      /Forbidden: no access to IT domain/,
    )
  })

  it('single-domain user auto-applies their domain on create', () => {
    assert.equal(resolveWriteDomainCode(['it'], undefined), 'it')
    assert.equal(resolveWriteDomainCode(['admin'], null), 'admin')
  })

  it('multi-domain user must explicitly choose a domain', () => {
    assert.throws(() => resolveWriteDomainCode(['it', 'admin'], undefined), /Domain is required/)
  })

  it('assertCanAccessDomain rejects out-of-scope records', () => {
    assert.equal(assertCanAccessDomain(['it'], 'it'), 'it')
    assert.throws(() => assertCanAccessDomain(['it'], 'admin'), /Forbidden/)
  })

  it('IT Asset Manager cannot access ADMIN records (assignment/update/create)', () => {
    assert.throws(() => resolveWriteDomainCode(['it'], 'ADMIN'), /Forbidden/)
    assert.throws(() => assertCanAccessDomain(['it'], 'admin'), /Forbidden/)
  })

  it('Admin Asset Manager cannot access IT records', () => {
    assert.throws(() => resolveWriteDomainCode(['admin'], 'IT'), /Forbidden/)
    assert.throws(() => assertCanAccessDomain(['admin'], 'it'), /Forbidden/)
  })
})
