/**
 * Wave 2.3 — read-only production preflight for typed location migrations.
 * Does not write.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

const PROD = 'ITAssetManagement_2026'
const STAGING = 'ITAssetManagement_2026_test'

async function q<T extends mysql.RowDataPacket>(conn: mysql.Connection, sql: string, params: unknown[] = []) {
  const [rows] = await conn.query<T[]>(sql, params)
  return rows
}

async function snap(database: string) {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    charset: 'utf8mb4',
  })
  try {
    const selected = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d
    const n = async (sql: string) => Number((await q<{ c: number }>(conn, sql))[0]?.c || 0)
    const has = async (t: string) =>
      n(`SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`.replace('?', `'${t}'`))
    const col = async (table: string, column: string) =>
      Number((await q<{ c: number }>(conn, `
        SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      `, [table, column]))[0]?.c)

    const hasLt = (await col('locations', 'location_type_id')) > 0
    const hasTypes = Number((await q<{ c: number }>(conn, `
      SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'location_types'
    `))[0]?.c) > 0

    return {
      selected,
      location_types_table: hasTypes,
      space_subtypes_table: Number((await q<{ c: number }>(conn, `
        SELECT COUNT(*) AS c FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'space_subtypes'
      `))[0]?.c) > 0,
      location_type_id: hasLt,
      space_subtype_id: (await col('locations', 'space_subtype_id')) > 0,
      external_code: (await col('locations', 'external_code')) > 0,
      locations_live: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL'),
      locations_deleted: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NOT NULL'),
      locations_total: await n('SELECT COUNT(*) AS c FROM locations'),
      parent_id_nonnull: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND parent_id IS NOT NULL'),
      location_id_checksum: await n('SELECT COALESCE(SUM(id),0) AS c FROM locations'),
      parent_id_checksum: await n('SELECT COALESCE(SUM(parent_id),0) AS c FROM locations'),
      type_count: hasTypes ? await n('SELECT COUNT(*) AS c FROM location_types') : 0,
      subtype_count: hasTypes
        ? await n('SELECT COUNT(*) AS c FROM space_subtypes')
        : 0,
      unspecified_live: hasLt && hasTypes
        ? await n(`SELECT COUNT(*) AS c FROM locations l JOIN location_types t ON t.id = l.location_type_id WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'`)
        : 0,
      untyped_live: hasLt
        ? await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND location_type_id IS NULL')
        : null,
      assets: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'),
      asset_min_id: Number((await q<{ c: number }>(conn, 'SELECT MIN(id) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c || 0),
      asset_max_id: Number((await q<{ c: number }>(conn, 'SELECT MAX(id) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c || 0),
      asset_location_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM assets WHERE deleted_at IS NULL'),
      asset_rtd_sum: await n('SELECT COALESCE(SUM(rtd_location_id),0) AS c FROM assets WHERE deleted_at IS NULL'),
      consumables: await n('SELECT COUNT(*) AS c FROM consumables WHERE deleted_at IS NULL'),
      accessories: await n('SELECT COUNT(*) AS c FROM accessories WHERE deleted_at IS NULL'),
      components: await n('SELECT COUNT(*) AS c FROM components WHERE deleted_at IS NULL'),
      cons_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM consumables WHERE deleted_at IS NULL'),
      acc_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM accessories WHERE deleted_at IS NULL'),
      comp_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM components WHERE deleted_at IS NULL'),
    }
  } finally {
    await conn.end()
  }
}

const production = await snap(PROD)
const staging = await snap(STAGING)
console.log(JSON.stringify({ production, staging }, null, 2))

if (String(production.selected).toLowerCase() !== PROD.toLowerCase()) {
  console.error('PREFLIGHT FAIL: production SELECT DATABASE mismatch')
  process.exit(1)
}
if (production.locations_live !== 187 || production.locations_deleted !== 7 || production.assets !== 1204) {
  console.error('PREFLIGHT FAIL: unexpected production counts')
  process.exit(1)
}
if (production.location_types_table || production.location_type_id) {
  console.error('PREFLIGHT FAIL: Wave 2.2 objects already on production')
  process.exit(1)
}
if (!production.external_code) {
  console.error('PREFLIGHT WARN: external_code missing on production (035 will add)')
}
if (
  staging.type_count !== 7
  || staging.subtype_count !== 6
  || staging.locations_live !== 187
  || staging.unspecified_live !== 187
  || staging.untyped_live !== 0
  || staging.assets !== 1204
) {
  console.error('PREFLIGHT FAIL: staging reference does not match Wave 2.2 expected results')
  process.exit(1)
}
console.log('WAVE 2.3 PREFLIGHT: PASS')
