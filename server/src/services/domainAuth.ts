import type { Request, Response } from 'express'
import { all, get } from '../db/index.js'
import { fail } from '../utils/response.js'
import { hasPermission, isTruthyPerm } from './permissions.js'

export const DOMAIN_CODES = ['it', 'admin'] as const
export type DomainCode = (typeof DOMAIN_CODES)[number]

export const DOMAIN_PERM: Record<DomainCode, string> = {
  it: 'domains.it',
  admin: 'domains.admin',
}

export type AssetDomainRow = {
  id: number
  name: string
  code: DomainCode
}

export type InventoryTable = 'assets' | 'licenses' | 'accessories' | 'consumables' | 'components'

export const INVENTORY_IMPORT_TYPES = ['asset', 'license', 'accessory', 'consumable', 'component'] as const
export type InventoryImportType = (typeof INVENTORY_IMPORT_TYPES)[number]

export const INVENTORY_ACTION_ITEM_TYPES = ['asset', 'license', 'accessory', 'consumable', 'component'] as const

const INVENTORY_VIEW_PERMS = [
  'assets.view',
  'licenses.view',
  'accessories.view',
  'consumables.view',
  'components.view',
  'people.view',
]

const UPLOADABLE_TABLE: Record<string, InventoryTable> = {
  asset: 'assets',
  license: 'licenses',
  accessory: 'accessories',
  consumable: 'consumables',
  component: 'components',
}

export function normalizeDomainCode(raw: unknown): DomainCode | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (s === 'it' || s === 'itam') return 'it'
  if (s === 'admin' || s === 'adm') return 'admin'
  return null
}

export function allowedDomainCodes(perms: Record<string, unknown> | null | undefined): DomainCode[] {
  const p = perms || {}
  if (isTruthyPerm(p.superuser) || isTruthyPerm(p.admin)) return ['it', 'admin']
  const out: DomainCode[] = []
  if (isTruthyPerm(p[DOMAIN_PERM.it])) out.push('it')
  if (isTruthyPerm(p[DOMAIN_PERM.admin])) out.push('admin')
  if (out.length) return out

  // Legacy ITAM users: module access without domain keys → IT only
  const hasInventoryAccess = INVENTORY_VIEW_PERMS.some((k) => hasPermission(p, k))
    || INVENTORY_VIEW_PERMS.some((k) => isTruthyPerm(p[k.replace('.view', '.create')]) || isTruthyPerm(p[k.replace('.view', '.edit')]))
  if (hasInventoryAccess) return ['it']
  return []
}

/** Intersection of allowed codes and an optional client-requested domain. Unauthorized request is ignored. */
export function scopedDomainCodes(
  allowed: DomainCode[],
  requested: unknown,
): DomainCode[] {
  const req = normalizeDomainCode(requested)
  if (!req) return allowed
  return allowed.includes(req) ? [req] : []
}

export function assertCanAccessDomain(allowed: DomainCode[], code: DomainCode | null): DomainCode {
  const resolved = code || (allowed.length === 1 ? allowed[0] : null)
  if (!resolved) throw new Error('Domain is required')
  if (!allowed.includes(resolved)) throw new Error(`Forbidden: no access to ${resolved.toUpperCase()} domain`)
  return resolved
}

/** Create/update: requested domain must be in scope. Single-domain users default to their domain. */
export function resolveWriteDomainCode(
  allowed: DomainCode[],
  requested: unknown,
  opts?: { required?: boolean },
): DomainCode {
  const req = normalizeDomainCode(requested)
  if (req) return assertCanAccessDomain(allowed, req)
  if (allowed.length === 1) return allowed[0]
  if (opts?.required === false && allowed.includes('it')) return 'it'
  throw new Error('Domain is required')
}

/**
 * Import write domain: single-domain roles are always forced server-side
 * (client cannot override). Super Admin / application Admin may select IT or ADMIN;
 * omitted domain defaults to IT for legacy import compatibility.
 */
export function resolveImportDomainCode(
  allowed: DomainCode[],
  requested: unknown,
): DomainCode {
  if (!allowed.length) throw new Error('Forbidden: no domain access')
  if (allowed.length === 1) return allowed[0]
  return resolveWriteDomainCode(allowed, requested, { required: false })
}

export function domainRowCode(row: { code?: unknown; name?: unknown } | null | undefined): DomainCode {
  const fromCode = normalizeDomainCode(row?.code)
  if (fromCode) return fromCode
  const fromName = normalizeDomainCode(row?.name)
  if (fromName) return fromName
  return 'it'
}

/** NULL → IT. Unknown id throws (fail closed). Does not hit the database. */
export function domainCodeFromRows(id: number | null | undefined, domains: AssetDomainRow[]): DomainCode {
  if (id == null) return 'it'
  const hit = domains.find((d) => d.id === Number(id))
  if (!hit) throw new Error('Unknown domain')
  return hit.code
}

export async function loadAssetDomains(): Promise<AssetDomainRow[]> {
  const rows = await all<AssetDomainRow>(`
    SELECT id, name, code FROM asset_domains
    WHERE deleted_at IS NULL AND active = 1
    ORDER BY id ASC
  `)
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    code: domainRowCode(r),
  }))
}

export async function domainIdForCode(code: DomainCode): Promise<number | null> {
  const rows = await loadAssetDomains()
  const hit = rows.find((r) => r.code === code)
  return hit ? hit.id : null
}

export async function domainCodeForId(id: number | null | undefined): Promise<DomainCode> {
  if (id == null) return 'it'
  return domainCodeFromRows(id, await loadAssetDomains())
}

export type DomainSqlFilter = {
  sql: string
  params: unknown[]
  allowedCodes: DomainCode[]
  allowedIds: number[]
}

let inventoryDomainColCache: boolean | null = null
const columnCache = new Map<string, boolean>()

export async function tableHasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  const hit = columnCache.get(key)
  if (hit != null) return hit
  const row = await get<{ c: number }>(`
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
  `, [table, column])
  const ok = Number(row?.c) === 1
  if (ok) columnCache.set(key, true)
  return ok
}

/** True when assets.domain_id exists in the current database. Negative results are not cached so a live migrate takes effect after restart-less checks. */
export async function inventoryDomainColumnsReady(): Promise<boolean> {
  if (inventoryDomainColCache === true) return true
  const ok = await tableHasColumn('assets', 'domain_id')
  if (ok) inventoryDomainColCache = true
  else columnCache.delete('assets.domain_id')
  return ok
}

export function domainJoinSql(alias: string, ready: boolean) {
  return ready ? `LEFT JOIN asset_domains ad ON ad.id = ${alias}.domain_id` : ''
}

export function domainSelectFields(ready: boolean) {
  return ready
    ? 'ad.name as domain_name, ad.code as domain_code'
    : 'NULL as domain_name, NULL as domain_code'
}

export async function loadItemDomain(
  table: InventoryTable,
  whereSql: string,
  params: unknown[],
): Promise<{ id: number; domain_id: number | null } | undefined> {
  const ready = await inventoryDomainColumnsReady()
  const sql = ready
    ? `SELECT id, domain_id FROM ${table} WHERE ${whereSql}`
    : `SELECT id, CAST(NULL AS UNSIGNED) as domain_id FROM ${table} WHERE ${whereSql}`
  return get<{ id: number; domain_id: number | null }>(sql, params)
}

/**
 * SQL fragment restricting a table alias to the caller's allowed (and optionally requested) domains.
 * NULL domain_id is treated as IT for backward compatibility.
 * If the inventory domain column has not been migrated yet, no SQL filter is applied
 * so existing ITAM pages keep working.
 */
export async function inventoryDomainClause(
  perms: Record<string, unknown> | null | undefined,
  requested: unknown,
  alias = '',
): Promise<DomainSqlFilter> {
  const allowed = allowedDomainCodes(perms)
  const scoped = scopedDomainCodes(allowed, requested)
  if (!scoped.length) {
    return { sql: ' AND 1=0', params: [], allowedCodes: [], allowedIds: [] }
  }
  if (!(await inventoryDomainColumnsReady())) {
    return { sql: '', params: [], allowedCodes: scoped, allowedIds: [] }
  }
  const col = alias ? `${alias}.domain_id` : 'domain_id'
  const rows = await loadAssetDomains()
  const ids = rows.filter((r) => scoped.includes(r.code)).map((r) => r.id)
  const itId = rows.find((r) => r.code === 'it')?.id ?? null
  if (!ids.length) {
    return { sql: ' AND 1=0', params: [], allowedCodes: scoped, allowedIds: [] }
  }
  const ph = ids.map(() => '?').join(',')
  if (itId != null && scoped.includes('it')) {
    return {
      sql: ` AND (${col} IN (${ph}) OR ${col} IS NULL)`,
      params: ids,
      allowedCodes: scoped,
      allowedIds: ids,
    }
  }
  return {
    sql: ` AND ${col} IN (${ph})`,
    params: ids,
    allowedCodes: scoped,
    allowedIds: ids,
  }
}

/**
 * Filter action_logs so inventory-backed rows are domain-scoped.
 * Generic / system logs (other item_type, or item_id 0/NULL) remain visible.
 */
export async function actionLogDomainSql(
  perms: Record<string, unknown> | null | undefined,
  requested: unknown,
  alias = 'al',
): Promise<DomainSqlFilter> {
  const allowed = allowedDomainCodes(perms)
  const scoped = scopedDomainCodes(allowed, requested)
  if (!(await inventoryDomainColumnsReady())) {
    return { sql: '', params: [], allowedCodes: scoped, allowedIds: [] }
  }
  const asset = await inventoryDomainClause(perms, requested, '_da')
  const license = await inventoryDomainClause(perms, requested, '_dl')
  const accessory = await inventoryDomainClause(perms, requested, '_dx')
  const consumable = await inventoryDomainClause(perms, requested, '_dc')
  const component = await inventoryDomainClause(perms, requested, '_dp')
  const sql = ` AND (
    ${alias}.item_type NOT IN ('asset','license','accessory','consumable','component')
    OR ${alias}.item_id IS NULL
    OR ${alias}.item_id = 0
    OR (${alias}.item_type = 'asset' AND EXISTS (
      SELECT 1 FROM assets _da WHERE _da.id = ${alias}.item_id AND _da.deleted_at IS NULL${asset.sql}
    ))
    OR (${alias}.item_type = 'license' AND EXISTS (
      SELECT 1 FROM licenses _dl WHERE _dl.id = ${alias}.item_id AND _dl.deleted_at IS NULL${license.sql}
    ))
    OR (${alias}.item_type = 'accessory' AND EXISTS (
      SELECT 1 FROM accessories _dx WHERE _dx.id = ${alias}.item_id AND _dx.deleted_at IS NULL${accessory.sql}
    ))
    OR (${alias}.item_type = 'consumable' AND EXISTS (
      SELECT 1 FROM consumables _dc WHERE _dc.id = ${alias}.item_id AND _dc.deleted_at IS NULL${consumable.sql}
    ))
    OR (${alias}.item_type = 'component' AND EXISTS (
      SELECT 1 FROM components _dp WHERE _dp.id = ${alias}.item_id AND _dp.deleted_at IS NULL${component.sql}
    ))
  )`
  return {
    sql,
    params: [...asset.params, ...license.params, ...accessory.params, ...consumable.params, ...component.params],
    allowedCodes: scoped,
    allowedIds: asset.allowedIds,
  }
}

export async function resolveWriteDomainId(
  perms: Record<string, unknown> | null | undefined,
  body: Record<string, unknown>,
): Promise<{ id: number; code: DomainCode }> {
  const allowed = allowedDomainCodes(perms)
  const requested = body.domain_code ?? body.domain ?? body.domain_id
  let code: DomainCode
  const asId = Number(requested)
  if (requested != null && requested !== '' && Number.isFinite(asId) && asId > 0 && typeof requested !== 'string') {
    code = await domainCodeForId(asId)
    assertCanAccessDomain(allowed, code)
  } else if (typeof requested === 'number' || (typeof requested === 'string' && /^\d+$/.test(requested))) {
    code = await domainCodeForId(Number(requested))
    assertCanAccessDomain(allowed, code)
  } else {
    code = resolveWriteDomainCode(allowed, requested)
  }
  const id = await domainIdForCode(code)
  if (id == null) throw new Error(`Domain ${code.toUpperCase()} is not configured`)
  return { id, code }
}

export async function resolveImportDomainId(
  perms: Record<string, unknown> | null | undefined,
  requested: unknown,
): Promise<{ id: number; code: DomainCode }> {
  const allowed = allowedDomainCodes(perms)
  if (!allowed.length) throw new Error('Forbidden: no domain access')
  if (allowed.length === 1) {
    const code = allowed[0]
    const id = await domainIdForCode(code)
    if (id == null) throw new Error(`Domain ${code.toUpperCase()} is not configured`)
    return { id, code }
  }
  if (requested == null || requested === '') {
    const id = await domainIdForCode('it')
    if (id == null) throw new Error('Domain IT is not configured')
    return { id, code: 'it' }
  }
  return resolveWriteDomainId(perms, { domain: requested })
}

export function canAccessDomainId(
  allowedCodes: DomainCode[],
  recordDomainId: number | null | undefined,
  domains: AssetDomainRow[],
): boolean {
  if (recordDomainId == null) return allowedCodes.includes('it')
  const hit = domains.find((d) => d.id === Number(recordDomainId))
  if (!hit) return false
  return allowedCodes.includes(hit.code)
}

export async function assertRecordDomainAccess(
  req: Request,
  res: Response,
  domainId: number | null | undefined,
): Promise<boolean> {
  if (!(await inventoryDomainColumnsReady())) return true
  const allowed = allowedDomainCodes(req.user?.permissions)
  let code: DomainCode
  try {
    code = await domainCodeForId(domainId)
  } catch {
    fail(res, 'Forbidden: unknown domain', 403)
    return false
  }
  if (allowed.includes(code)) return true
  fail(res, `Forbidden: no access to ${code.toUpperCase()} domain`, 403)
  return false
}

/** Authorize file/attachment access from the parent domain-owned entity. Users have no inventory domain. */
export async function assertUploadableDomainAccess(
  req: Request,
  res: Response,
  uploadableType: string,
  uploadableId: number,
): Promise<boolean> {
  const t = String(uploadableType || '').toLowerCase()
  if (t === 'user') return true
  if (!(await inventoryDomainColumnsReady())) return true

  if (t === 'license_invoice') {
    const inv = await get<{ license_id: number }>(
      `SELECT license_id FROM license_invoices WHERE id = ? AND deleted_at IS NULL`,
      [uploadableId],
    )
    if (!inv) {
      fail(res, 'Not found', 404)
      return false
    }
    const lic = await loadItemDomain('licenses', 'id = ? AND deleted_at IS NULL', [Number(inv.license_id)])
    if (!lic) {
      fail(res, 'Not found', 404)
      return false
    }
    return assertRecordDomainAccess(req, res, lic.domain_id)
  }

  if (t === 'maintenance') {
    const m = await get<{ asset_id: number }>(
      `SELECT asset_id FROM maintenances WHERE id = ? AND deleted_at IS NULL`,
      [uploadableId],
    )
    if (!m) {
      fail(res, 'Not found', 404)
      return false
    }
    const asset = await loadItemDomain('assets', 'id = ? AND deleted_at IS NULL', [Number(m.asset_id)])
    if (!asset) {
      fail(res, 'Not found', 404)
      return false
    }
    return assertRecordDomainAccess(req, res, asset.domain_id)
  }

  const table = UPLOADABLE_TABLE[t]
  if (!table) return true
  const row = await loadItemDomain(table, 'id = ? AND deleted_at IS NULL', [uploadableId])
  if (!row) {
    fail(res, 'Not found', 404)
    return false
  }
  return assertRecordDomainAccess(req, res, row.domain_id)
}

export function domainErrorStatus(message: string): number {
  if (/Forbidden/i.test(message) || /Unknown domain/i.test(message)) return 403
  return 400
}

export function domainPayload(id: number | null | undefined, code: DomainCode, name?: string | null) {
  if (id == null && !code) return null
  return {
    id: id ?? null,
    code,
    name: name || code.toUpperCase(),
  }
}
