/**
 * Wave 4 — apply 034–036 (if missing) then 041–042 ONLY to a staging/test database.
 * Never writes to ITAssetManagement_2026 (production).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const TARGET = process.env.WAVE4_TARGET_DB || process.env.WAVE3_TARGET_DB || 'ITAssetManagement_2026_test'
const PROD = 'ITAssetManagement_2026'
const VERSIONS = [
  '034_location_types_and_space_subtypes',
  '035_locations_typed_columns_and_external_code',
  '036_locations_unspecified_backfill',
  '041_assets_domain_attrs_admin_categories',
  '042_locations_office_space',
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
  const col = async (table: string, column: string) =>
    n(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`)
  const hasTypes = await n(`SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'location_types'`)
  const hasSubtypes = await n(`SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'space_subtypes'`)
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
    seat_count: await col('locations', 'seat_count'),
    space_active: await col('locations', 'space_active'),
    occupant_employee_id: await col('locations', 'occupant_employee_id'),
    floor_types: hasTypes ? await n(`SELECT COUNT(*) AS c FROM location_types WHERE code = 'FLOOR'`) : 0,
    space_types: hasTypes ? await n(`SELECT COUNT(*) AS c FROM location_types WHERE code = 'SPACE'`) : 0,
    cabin_subtype: hasSubtypes ? await n(`SELECT COUNT(*) AS c FROM space_subtypes WHERE code = 'CABIN'`) : 0,
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

async function proveSpaceCreate(conn: mysql.Connection) {
  const floorType = (await q<{ id: number }>(conn, `SELECT id FROM location_types WHERE code = 'FLOOR' LIMIT 1`))[0]?.id
  const spaceType = (await q<{ id: number }>(conn, `SELECT id FROM location_types WHERE code = 'SPACE' LIMIT 1`))[0]?.id
  const cabin = (await q<{ id: number }>(conn, `SELECT id FROM space_subtypes WHERE code = 'CABIN' LIMIT 1`))[0]?.id
  const siteType = (await q<{ id: number }>(conn, `SELECT id FROM location_types WHERE code = 'SITE' LIMIT 1`))[0]?.id
  if (!floorType || !spaceType || !cabin || !siteType) {
    throw new Error('FLOOR/SPACE/CABIN/SITE types missing after 034/042')
  }
  const stamp = `W4 ${Date.now()}`
  const [insOffice] = await conn.query<mysql.ResultSetHeader>(
    `INSERT INTO locations (name, is_office, location_type_id, created_at, updated_at) VALUES (?, 1, ?, NOW(), NOW())`,
    [`${stamp} Office`, siteType],
  )
  const officeId = Number(insOffice.insertId)
  const [insFloor] = await conn.query<mysql.ResultSetHeader>(
    `INSERT INTO locations (name, parent_id, location_type_id, seat_count, space_active, created_at, updated_at)
     VALUES (?, ?, ?, 8, 1, NOW(), NOW())`,
    [`${stamp} Floor 1`, officeId, floorType],
  )
  const floorId = Number(insFloor.insertId)
  const [insSpace] = await conn.query<mysql.ResultSetHeader>(
    `INSERT INTO locations (name, parent_id, location_type_id, space_subtype_id, seat_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, NOW(), NOW())`,
    [`${stamp} Cabin 01`, floorId, spaceType, cabin],
  )
  const spaceId = Number(insSpace.insertId)
  const offices = await nSafe(conn, `SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND is_office = 1 AND id = ${officeId}`)
  const floors = await nSafe(conn, `SELECT COUNT(*) AS c FROM locations WHERE parent_id = ${officeId} AND location_type_id = ${floorType} AND deleted_at IS NULL`)
  const spaces = await nSafe(conn, `SELECT COUNT(*) AS c FROM locations WHERE parent_id = ${floorId} AND location_type_id = ${spaceType} AND deleted_at IS NULL`)
  await conn.query(`UPDATE locations SET deleted_at = NOW(), updated_at = NOW() WHERE id IN (?, ?, ?)`, [spaceId, floorId, officeId])
  if (offices !== 1 || floors !== 1 || spaces !== 1) {
    throw new Error(`space create/list proof failed offices=${offices} floors=${floors} spaces=${spaces}`)
  }
  return { officeId, floorId, spaceId }
}

async function nSafe(conn: mysql.Connection, sql: string) {
  return Number((await q<{ c: number }>(conn, sql))[0]?.c || 0)
}

async function main() {
  if (!isStagingName(TARGET)) {
    throw new Error(`DATABASE SAFETY BLOCKER: WAVE4_TARGET_DB=${TARGET}`)
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
    const proof = await proveSpaceCreate(conn)
    const report = {
      target: TARGET,
      selected,
      production_database_modified: false,
      applied,
      skipped,
      before,
      after,
      space_create_list: proof,
    }
    console.log(JSON.stringify(report, null, 2))

    if (after.assets !== before.assets) throw new Error('asset count changed')
    if (after.licenses !== before.licenses) throw new Error('license count changed')
    if (after.accessories !== before.accessories) throw new Error('accessories count changed')
    if (after.consumables !== before.consumables) throw new Error('consumables count changed')
    if (after.components !== before.components) throw new Error('components count changed')
    if (after.asset_id_sum !== before.asset_id_sum) throw new Error('asset ids changed')
    if (after.asset_tag_count !== before.asset_tag_count) throw new Error('asset tags changed')
    if (after.domain_attrs !== 1) throw new Error('assets.domain_attrs missing')
    if (after.is_office !== 1) throw new Error('locations.is_office missing')
    if (after.floor_types < 1) throw new Error('FLOOR type missing')
    if (after.space_types < 1) throw new Error('SPACE type missing')
    if (after.cabin_subtype < 1) throw new Error('CABIN subtype missing')
    console.log('WAVE 4 staging validation: PASS')
    console.log('Production database modified: NO')
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
