import { get, all, run, now } from '../db/index.js'
import { fyStartYear } from '../utils/period.js'

/** Sanitize segment for tags: letters/digits only, uppercased. */
export function tagSegment(value: unknown, fallback: string, maxLen = 24): string {
  const raw = String(value ?? '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase()
    .slice(0, maxLen)
  return raw || fallback
}

/**
 * India FY tag segment (Apr–Mar): e.g. FY 2026-27 → "2026-27".
 * Used in CODE-TYPE-FY-#### tags so sequences reset each financial year.
 */
export function currentFyTagSegment(d = new Date()): string {
  const start = fyStartYear(d)
  return `${start}-${String(start + 1).slice(-2)}`
}

export async function resolveTagCodeParts(opts: {
  companyId?: number | null
  legalEntityId?: number | null
  categoryId?: number | null
}): Promise<{ code: string; type: string; prefix: string; fy: string }> {
  let code = 'ASSET'
  if (opts.legalEntityId) {
    const le = await get<{ code: string }>(
      `SELECT code FROM legal_entities WHERE id = ? AND deleted_at IS NULL`,
      [opts.legalEntityId],
    )
    if (le?.code) code = tagSegment(le.code, 'ASSET')
  }
  if (code === 'ASSET' && opts.companyId) {
    const co = await get<{ code: string | null; name: string }>(
      `SELECT code, name FROM companies WHERE id = ? AND deleted_at IS NULL`,
      [opts.companyId],
    )
    if (co?.code) code = tagSegment(co.code, 'ASSET')
    else if (co?.name) code = tagSegment(co.name, 'ASSET', 12)
  }

  let type = 'ASSET'
  if (opts.categoryId) {
    const cat = await get<{ name: string }>(
      `SELECT name FROM categories WHERE id = ? AND deleted_at IS NULL`,
      [opts.categoryId],
    )
    if (cat?.name) type = tagSegment(cat.name, 'ASSET', 16)
  }

  const fy = currentFyTagSegment()
  return { code, type, fy, prefix: `${code}-${type}-${fy}` }
}

/**
 * Next tag for prefix CODE-TYPE-FY → CODE-TYPE-FY-0001, CODE-TYPE-FY-0002, …
 * Example: MEMF-LAPTOP-2026-27-0001 (India FY Apr–Mar).
 * Sequence is scoped to the current FY so numbering restarts each year.
 * Looks at existing asset_tag values (including soft-deleted) to avoid reuse.
 */
export async function nextAssetTag(opts: {
  companyId?: number | null
  legalEntityId?: number | null
  categoryId?: number | null
}): Promise<{ asset_tag: string; prefix: string; sequence: number; fy: string }> {
  if (!opts.categoryId) throw new Error('category_id (asset type) is required to generate asset tag')
  if (!opts.companyId && !opts.legalEntityId) {
    throw new Error('company_id or legal_entity_id is required to generate asset tag')
  }

  const { prefix, fy } = await resolveTagCodeParts(opts)
  const like = `${prefix}-%`
  const rows = await all<{ asset_tag: string }>(
    `SELECT asset_tag FROM assets WHERE asset_tag LIKE ?`,
    [like],
  )

  let max = 0
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i')
  for (const r of rows) {
    const m = String(r.asset_tag || '').match(re)
    if (m) max = Math.max(max, Number(m[1]) || 0)
  }
  const sequence = max + 1
  const asset_tag = `${prefix}-${String(sequence).padStart(4, '0')}`
  return { asset_tag, prefix, sequence, fy }
}

/** Allocate a unique tag (retry if race). */
export async function allocateAssetTag(opts: {
  companyId?: number | null
  legalEntityId?: number | null
  categoryId?: number | null
}): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const { asset_tag } = await nextAssetTag(opts)
    const clash = await get<{ id: number }>(
      `SELECT id FROM assets WHERE asset_tag = ? LIMIT 1`,
      [asset_tag],
    )
    if (!clash) return asset_tag
  }
  throw new Error('Could not allocate a unique asset tag — try again')
}

/**
 * Move current asset_tag → old_asset_tag (when old is empty) and assign a new auto tag
 * CODE-TYPE-FY-#### from company/entity + asset type + current financial year.
 */
export async function migrateAssetTagsToOld(): Promise<{
  migrated: number
  skipped: number
  failed: number
  errors: string[]
}> {
  const rows = await all<{
    id: number
    asset_tag: string | null
    old_asset_tag: string | null
    company_id: number | null
    legal_entity_id: number | null
    category_id: number | null
  }>(`
    SELECT a.id, a.asset_tag, a.old_asset_tag, a.company_id, a.legal_entity_id,
      m.category_id
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    WHERE a.deleted_at IS NULL
      AND a.asset_tag IS NOT NULL AND TRIM(a.asset_tag) != ''
      AND (a.old_asset_tag IS NULL OR TRIM(a.old_asset_tag) = '')
    ORDER BY a.id ASC
  `)

  let migrated = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []
  const ts = now()

  for (const row of rows) {
    const legacy = String(row.asset_tag || '').trim()
    if (!legacy) {
      skipped += 1
      continue
    }
    if (!row.category_id || (!row.company_id && !row.legal_entity_id)) {
      failed += 1
      if (errors.length < 25) {
        errors.push(`#${row.id} (${legacy}): missing company/entity or asset type`)
      }
      continue
    }
    try {
      const newTag = await allocateAssetTag({
        companyId: row.company_id,
        legalEntityId: row.legal_entity_id,
        categoryId: Number(row.category_id),
      })
      await run(`
        UPDATE assets
        SET old_asset_tag = ?, asset_tag = ?, updated_at = ?
        WHERE id = ?
      `, [legacy, newTag, ts, row.id])
      migrated += 1
    } catch (e) {
      failed += 1
      if (errors.length < 25) {
        errors.push(`#${row.id} (${legacy}): ${e instanceof Error ? e.message : 'failed'}`)
      }
    }
  }

  return { migrated, skipped, failed, errors }
}

/**
 * Regenerate Asset Tag to CODE-TYPE-FY-#### (e.g. MEMF-LAPTOP-2026-27-0001).
 * Does NOT change old_asset_tag — existing Old Asset Tag values stay as-is.
 * Skips rows already matching the current FY auto-tag pattern for their company/type.
 */
export async function regenerateAssetTagsKeepOld(): Promise<{
  regenerated: number
  skipped: number
  failed: number
  fy: string
  errors: string[]
}> {
  const fy = currentFyTagSegment()
  const rows = await all<{
    id: number
    asset_tag: string | null
    company_id: number | null
    legal_entity_id: number | null
    category_id: number | null
  }>(`
    SELECT a.id, a.asset_tag, a.company_id, a.legal_entity_id, m.category_id
    FROM assets a
    LEFT JOIN models m ON m.id = a.model_id
    WHERE a.deleted_at IS NULL
    ORDER BY a.id ASC
  `)

  let regenerated = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []
  const ts = now()

  for (const row of rows) {
    const current = String(row.asset_tag || '').trim()
    if (!row.category_id || (!row.company_id && !row.legal_entity_id)) {
      failed += 1
      if (errors.length < 25) {
        errors.push(`#${row.id} (${current || '—'}): missing company/entity or asset type`)
      }
      continue
    }

    try {
      const { prefix } = await resolveTagCodeParts({
        companyId: row.company_id,
        legalEntityId: row.legal_entity_id,
        categoryId: Number(row.category_id),
      })
      const alreadyOk = new RegExp(
        `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`,
        'i',
      ).test(current)
      if (alreadyOk) {
        skipped += 1
        continue
      }

      const newTag = await allocateAssetTag({
        companyId: row.company_id,
        legalEntityId: row.legal_entity_id,
        categoryId: Number(row.category_id),
      })
      await run(`
        UPDATE assets
        SET asset_tag = ?, updated_at = ?
        WHERE id = ?
      `, [newTag, ts, row.id])
      regenerated += 1
    } catch (e) {
      failed += 1
      if (errors.length < 25) {
        errors.push(`#${row.id} (${current || '—'}): ${e instanceof Error ? e.message : 'failed'}`)
      }
    }
  }

  return { regenerated, skipped, failed, fy, errors }
}

