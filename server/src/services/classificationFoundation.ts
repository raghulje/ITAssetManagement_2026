export type ValidateAssetDomainInput = {
  name: unknown
  code?: unknown
}

export function validateAssetDomainCreateInput({ name, code }: ValidateAssetDomainInput): { name: string; code: string | null } {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) throw new Error('Asset domain name is required')

  let c: string | null = null
  if (code !== undefined) {
    if (code === null) c = null
    else if (typeof code === 'string') {
      const t = code.trim()
      c = t ? t : null
    }
  }

  // Keep it simple: alphanumerics plus dash/underscore.
  if (c && !/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/.test(c)) {
    throw new Error('Asset domain code is invalid')
  }

  return { name: n, code: c }
}

export function assertAssetDomainNotDuplicate({ exists }: { exists: boolean }) {
  if (exists) throw new Error('Asset domain already exists')
}

export function validateCategoryParenting({
  categoryId,
  parentId,
  parentParentId,
}: {
  // categoryId is optional for create-time validation (no existing row yet).
  categoryId?: number | null
  parentId: number
  parentParentId: number | null
}) {
  if (categoryId != null && parentId === categoryId) {
    throw new Error('Category cannot be its own parent')
  }
  if (parentParentId != null) {
    // If parent is already a child of this category → cycle. Otherwise it's 3rd-level nesting.
    if (categoryId != null && parentParentId === categoryId) {
      throw new Error('Cycle detected in category parentage')
    }
    throw new Error('Category nesting depth cannot exceed 1 level')
  }
}

export function validateModelAssetTypeAssociation({
  assetTypeId,
  assetTypeExists,
}: {
  assetTypeId: number | null
  assetTypeExists: boolean
}) {
  if (assetTypeId == null) return
  if (!Number.isInteger(assetTypeId) || assetTypeId <= 0) throw new Error('Invalid asset type id')
  if (!assetTypeExists) throw new Error('Asset type not found')
}

export type ClassificationFoundationTypes = {
  AssetType: unknown
  AssetDomain: unknown
}

