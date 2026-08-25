import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from '../wave0/helpers/source.js'
import {
  assertAssetDomainNotDuplicate,
  validateAssetDomainCreateInput,
  validateCategoryParenting,
  validateModelAssetTypeAssociation,
} from '../../src/services/classificationFoundation.js'

describe('Wave 1 — Classification Foundation (contracts + unit validation)', () => {
  it('Asset Domain: validateAssetDomainCreateInput rejects empty name', () => {
    assert.throws(
      () => validateAssetDomainCreateInput({ name: '   ' }),
      /Asset domain name is required/,
    )
  })

  it('Asset Domain: validateAssetDomainCreateInput rejects invalid code', () => {
    assert.throws(
      () => validateAssetDomainCreateInput({ name: 'IT', code: 'bad code!' }),
      /Asset domain code is invalid/,
    )
  })

  it('Asset Domain: validateAssetDomainCreateInput accepts valid code', () => {
    const out = validateAssetDomainCreateInput({ name: 'IT', code: 'it' })
    assert.equal(out.name, 'IT')
    assert.equal(out.code, 'it')
  })

  it('Asset Domain: duplicates are rejected by assertAssetDomainNotDuplicate', () => {
    assert.doesNotThrow(() => assertAssetDomainNotDuplicate({ exists: false }))
    assert.throws(() => assertAssetDomainNotDuplicate({ exists: true }), /Asset domain already exists/)
  })

  it('Categories: subcategory under a root parent is allowed (parentParentId = null)', () => {
    assert.doesNotThrow(() => validateCategoryParenting({ categoryId: 10, parentId: 20, parentParentId: null }))
  })

  it('Categories: rejects self-parenting', () => {
    assert.throws(
      () => validateCategoryParenting({ categoryId: 10, parentId: 10, parentParentId: null }),
      /Category cannot be its own parent/,
    )
  })

  it('Categories: rejects cycle (parentParentId = categoryId)', () => {
    assert.throws(
      () => validateCategoryParenting({ categoryId: 10, parentId: 20, parentParentId: 10 }),
      /Cycle detected in category parentage/,
    )
  })

  it('Categories: rejects third-level nesting (parentParentId not null)', () => {
    assert.throws(
      () => validateCategoryParenting({ categoryId: 10, parentId: 20, parentParentId: 30 }),
      /Category nesting depth cannot exceed 1 level/,
    )
  })

  it('Models: asset_type_id association is optional (null is allowed)', () => {
    assert.doesNotThrow(() => validateModelAssetTypeAssociation({ assetTypeId: null, assetTypeExists: false }))
  })

  it('Models: rejects invalid asset_type_id values', () => {
    assert.throws(
      () => validateModelAssetTypeAssociation({ assetTypeId: 0, assetTypeExists: true }),
      /Invalid asset type id/,
    )
  })

  it('Models: rejects unknown asset_type_id references', () => {
    assert.throws(
      () => validateModelAssetTypeAssociation({ assetTypeId: 123, assetTypeExists: false }),
      /Asset type not found/,
    )
  })

  it('Backend wiring: routes/users.ts uses Wave 1 helper functions', () => {
    const users = readServerSource('src/routes/users.ts')

    assert.match(users, /validateAssetDomainCreateInput/)
    assert.match(users, /assertAssetDomainNotDuplicate/)
    assert.match(users, /validateCategoryParenting/)
    assert.match(users, /validateModelAssetTypeAssociation/)
  })
})

