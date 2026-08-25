/**
 * Wave 2.2 — apply 034–036 ONLY to ITAssetManagement_2026_test.
 * Never writes to ITAssetManagement_2026.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const TARGET = process.env.WAVE22_TARGET_DB || 'ITAssetManagement_2026_test'
const PROD = 'ITAssetManagement_2026'
const VERSIONS = [
  '034_location_types_and_space_subtypes',
  '035_locations_typed_columns_and_external_code',
  '036_locations_unspecified_backfill',
]

function isStagingName(name: string) {
  const n = String(name || '').trim()
  if (!n) return false
  if (n.toLowerCase() === PROD.toLowerCase()) return false
  return /test|staging|sandbox/i.test(n)
}

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
  const has = async (table: string) =>
    n(`SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`)
  const col = async (table: string, column: string) =>
    n(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`)
  return {
    database: db,
    location_types: await has('location_types'),
    space_subtypes: await has('space_subtypes'),
    location_type_id: await col('locations', 'location_type_id'),
    space_subtype_id: await col('locations', 'space_subtype_id'),
    external_code: await col('locations', 'external_code'),
    type_count: (await has('location_types')) ? await n('SELECT COUNT(*) AS c FROM location_types') : 0,
    subtype_count: (await has('space_subtypes')) ? await n('SELECT COUNT(*) AS c FROM space_subtypes') : 0,
    locations_live: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL'),
    locations_deleted: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NOT NULL'),
    untyped_live: (await col('locations', 'location_type_id'))
      ? await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND location_type_id IS NULL')
      : null,
    unspecified_live: (await has('location_types'))
      ? await n(`SELECT COUNT(*) AS c FROM locations l JOIN location_types t ON t.id = l.location_type_id WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'`)
      : 0,
    assets: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'),
    asset_location_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM assets WHERE deleted_at IS NULL'),
    asset_rtd_sum: await n('SELECT COALESCE(SUM(rtd_location_id),0) AS c FROM assets WHERE deleted_at IS NULL'),
    consumables: await n('SELECT COUNT(*) AS c FROM consumables WHERE deleted_at IS NULL'),
    accessories: await n('SELECT COUNT(*) AS c FROM accessories WHERE deleted_at IS NULL'),
    components: await n('SELECT COUNT(*) AS c FROM components WHERE deleted_at IS NULL'),
    cons_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM consumables WHERE deleted_at IS NULL'),
    acc_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM accessories WHERE deleted_at IS NULL'),
    comp_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM components WHERE deleted_at IS NULL'),
  }
}

async function applySql(conn: mysql.Connection, version: string) {
  const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
  if (!isStagingName(db)) throw new Error(`DATABASE SAFETY BLOCKER: refused apply on ${db}`)
  const file = path.join(serverRoot, 'src/db/mysql', `${version}.sql`)
  let sql = fs.readFileSync(file, 'utf8')
  sql = sql.replace(/USE\s+`?[\w]+`?\s*;/gi, '')
  if (/DROP\s+TABLE/i.test(sql)) throw new Error(`Refusing DROP TABLE in ${version}`)
  await conn.query(sql)
}

async function main() {
  if (!isStagingName(TARGET)) {
    throw new Error(`DATABASE SAFETY BLOCKER: WAVE22_TARGET_DB=${TARGET}`)
  }

  const conn = await mysql.createConnection(connOpts(TARGET))
  try {
    const selected = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d
    console.log(`SELECT DATABASE() => ${selected}`)
    if (!isStagingName(String(selected))) {
      throw new Error(`DATABASE SAFETY BLOCKER: session is ${selected}`)
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

    const report = { target: TARGET, selected, applied, skipped, before, after }
    console.log(JSON.stringify(report, null, 2))

    if (after.locations_live !== before.locations_live) throw new Error('locations live count changed')
    if (after.locations_deleted !== before.locations_deleted) throw new Error('locations deleted count changed')
    if (after.assets !== before.assets) throw new Error('asset count changed')
    if (after.asset_location_sum !== before.asset_location_sum) throw new Error('assets.location_id changed')
    if (after.asset_rtd_sum !== before.asset_rtd_sum) throw new Error('assets.rtd_location_id changed')
    if (after.consumables !== before.consumables) throw new Error('consumables count changed')
    if (after.accessories !== before.accessories) throw new Error('accessories count changed')
    if (after.components !== before.components) throw new Error('components count changed')
    if (after.cons_loc_sum !== before.cons_loc_sum) throw new Error('consumables.location_id changed')
    if (after.acc_loc_sum !== before.acc_loc_sum) throw new Error('accessories.location_id changed')
    if (after.comp_loc_sum !== before.comp_loc_sum) throw new Error('components.location_id changed')
    if (after.location_types !== 1) throw new Error('location_types missing')
    if (after.space_subtypes !== 1) throw new Error('space_subtypes missing')
    if (after.location_type_id !== 1) throw new Error('locations.location_type_id missing')
    if (after.space_subtype_id !== 1) throw new Error('locations.space_subtype_id missing')
    if (after.external_code !== 1) throw new Error('locations.external_code missing')
    if (after.type_count !== 7) throw new Error(`expected 7 location types, got ${after.type_count}`)
    if (after.subtype_count !== 6) throw new Error(`expected 6 space subtypes, got ${after.subtype_count}`)
    if (after.untyped_live !== 0) throw new Error(`live locations still untyped: ${after.untyped_live}`)
    if (after.unspecified_live !== after.locations_live) {
      throw new Error(`expected all live locations UNSPECIFIED, got ${after.unspecified_live}/${after.locations_live}`)
    }
    console.log('WAVE 2.2 staging validation: PASS')
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
