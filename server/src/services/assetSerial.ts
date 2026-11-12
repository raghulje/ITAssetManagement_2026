import { all, get } from '../db/index.js'
import { inventoryDomainClause } from './domainAuth.js'
import { transformAsset } from './transformers.js'

export function normalizeSerial(value: unknown) {
  const s = value == null ? '' : String(value).trim()
  return s ? s.toUpperCase() : ''
}

type Perms = Record<string, unknown> | null | undefined

/** Another live IT asset already using this serial. Empty serials are never a clash. */
export async function findItSerialClash(
  perms: Perms,
  serial: unknown,
  excludeId?: number,
) {
  const key = normalizeSerial(serial)
  if (!key) return null
  const domain = await inventoryDomainClause(perms, 'it', 'a')
  const params: unknown[] = [key]
  let exclude = ''
  if (excludeId && Number.isFinite(excludeId)) {
    exclude = ' AND a.id <> ?'
    params.push(excludeId)
  }
  params.push(...domain.params)
  const row = await get<{ id: number; asset_tag: string; name: string | null }>(`
    SELECT a.id, a.asset_tag, a.name
    FROM assets a
    WHERE a.deleted_at IS NULL
      AND a.serial IS NOT NULL
      AND TRIM(a.serial) <> ''
      AND UPPER(TRIM(a.serial)) = ?
      ${exclude}
      ${domain.sql}
    ORDER BY a.id
    LIMIT 1
  `, params)
  return row || null
}

export async function listItSerialDuplicates(perms: Perms) {
  const domain = await inventoryDomainClause(perms, 'it', 'a')
  const rows = await all<{ id: number; serial_key: string }>(`
    SELECT a.id, UPPER(TRIM(a.serial)) AS serial_key
    FROM assets a
    WHERE a.deleted_at IS NULL
      AND a.serial IS NOT NULL
      AND TRIM(a.serial) <> ''
      AND UPPER(TRIM(a.serial)) IN (
        SELECT serial_key FROM (
          SELECT UPPER(TRIM(a2.serial)) AS serial_key
          FROM assets a2
          WHERE a2.deleted_at IS NULL
            AND a2.serial IS NOT NULL
            AND TRIM(a2.serial) <> ''
            ${domain.sql.replaceAll('a.', 'a2.')}
          GROUP BY UPPER(TRIM(a2.serial))
          HAVING COUNT(*) > 1
        ) d
      )
      ${domain.sql}
    ORDER BY serial_key, a.id
  `, [...domain.params, ...domain.params])

  const bySerial = new Map<string, number[]>()
  for (const row of rows) {
    const ids = bySerial.get(row.serial_key) || []
    ids.push(row.id)
    bySerial.set(row.serial_key, ids)
  }

  const groups = []
  for (const [serial, ids] of bySerial) {
    const assets = (await Promise.all(ids.map((id) => transformAsset(id)))).filter(Boolean)
    if (assets.length < 2) continue
    groups.push({ serial, count: assets.length, assets })
  }
  const duplicate_assets = groups.reduce((n, g) => n + g.count, 0)
  return { groups, duplicate_serials: groups.length, duplicate_assets }
}
