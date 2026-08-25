/**
 * Wave 4 — apply 034–036 (if missing) then 041–042 to the database the running app uses (DB_NAME).
 * Additive only. Snapshots inventory counts before and after.
 *
 * Production name requires:
 *   WAVE4_APPLY_LIVE=1
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const PROD = 'ITAssetManagement_2026'
const TARGET = process.env.WAVE4_TARGET_DB || process.env.DB_NAME || ''
const VERSIONS = [
  '034_location_types_and_space_subtypes',
  '035_locations_typed_columns_and_external_code',
  '036_locations_unspecified_backfill',
  '041_assets_domain_attrs_admin_categories',
  '042_locations_office_space',
]

function connOpts(database?: string) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4' as const,
    ...(database ? { database } : {}),
  }
}

async function q<T extends mysql.RowDataPacket>(conn: mysql.Connection, sql: string, params: unknown[] = []) {
  const [rows] = await conn.query<T[]>(sql, params)
  return rows
}

async function snapshot(conn: mysql.Connection) {
  const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d
  const n = async (sql: string) => Number((await q<{ c: number }>(conn, sql))[0]?.c || 0)
  const col = async (table: string, column: string) =>
    n(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`)
  return {
    database: db,
    assets: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'),
    licenses: await n('SELECT COUNT(*) AS c FROM licenses WHERE deleted_at IS NULL'),
    accessories: await n('SELECT COUNT(*) AS c FROM accessories WHERE deleted_at IS NULL'),
    consumables: await n('SELECT COUNT(*) AS c FROM consumables WHERE deleted_at IS NULL'),
    components: await n('SELECT COUNT(*) AS c FROM components WHERE deleted_at IS NULL'),
    locations: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL'),
    asset_id_sum: await n('SELECT COALESCE(SUM(id),0) AS c FROM assets'),
    asset_tag_count: await n('SELECT COUNT(DISTINCT asset_tag) AS c FROM assets WHERE deleted_at IS NULL'),
    domain_attrs: await col('assets', 'domain_attrs'),
    is_office: await col('locations', 'is_office'),
    floor_types: await n(`SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'location_types'`),
  }
}

async function applySql(conn: mysql.Connection, version: string) {
  const file = path.join(serverRoot, 'src/db/mysql', `${version}.sql`)
  let sql = fs.readFileSync(file, 'utf8')
  sql = sql.replace(/USE\s+`?[\w]+`?\s*;/gi, '')
  if (/DROP\s+TABLE/i.test(sql)) throw new Error(`Refusing DROP TABLE in ${version}`)
  await conn.query(sql)
}

async function main() {
  if (!TARGET) throw new Error('DB_NAME / WAVE4_TARGET_DB missing')
  const isProd = TARGET.toLowerCase() === PROD.toLowerCase()
  if (isProd && process.env.WAVE4_APPLY_LIVE !== '1') {
    throw new Error(
      `Refusing to write ${TARGET}. Re-run with WAVE4_APPLY_LIVE=1 after staging validation if you intend to apply 041-042 here.`,
    )
  }

  const conn = await mysql.createConnection(connOpts(TARGET))
  try {
    const selected = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d
    console.log(`SELECT DATABASE() => ${selected}`)
    if (String(selected).toLowerCase() !== TARGET.toLowerCase()) {
      throw new Error(`Session database ${selected} does not match target ${TARGET}`)
    }

    const before = await snapshot(conn)
    const applied: string[] = []
    const skipped: string[] = []
    for (const version of VERSIONS) {
      const exists = await q<{ id: number }>(conn, 'SELECT id FROM schema_migrations WHERE version = ? LIMIT 1', [version])
      if (exists.length) {
        skipped.push(version)
        continue
      }
      await applySql(conn, version)
      applied.push(version)
    }
    const after = await snapshot(conn)
    console.log(JSON.stringify({ target: TARGET, applied, skipped, before, after }, null, 2))

    if (after.assets !== before.assets) throw new Error('asset count changed')
    if (after.licenses !== before.licenses) throw new Error('license count changed')
    if (after.accessories !== before.accessories) throw new Error('accessories count changed')
    if (after.consumables !== before.consumables) throw new Error('consumables count changed')
    if (after.components !== before.components) throw new Error('components count changed')
    if (after.asset_id_sum !== before.asset_id_sum) throw new Error('asset ids changed')
    if (after.asset_tag_count !== before.asset_tag_count) throw new Error('asset tags changed')
    if (after.domain_attrs !== 1) throw new Error('assets.domain_attrs missing')
    if (after.is_office !== 1) throw new Error('locations.is_office missing')
    console.log('WAVE 4 apply: PASS')
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
