/**
 * Wave 3 — apply 037–040 to the database the running app uses (DB_NAME).
 * Additive only. Snapshots counts/IDs/tags before and after.
 *
 * Production name requires:
 *   WAVE3_APPLY_LIVE=1
 *
 * Staging/test names apply without that flag.
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
const TARGET = process.env.WAVE3_TARGET_DB || process.env.DB_NAME || ''
const VERSIONS = [
  '037_asset_domain_admin_seed',
  '038_inventory_domain_id',
  '039_inventory_domain_it_backfill',
  '040_checkout_assigned_employee',
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
  const hasDomain = await col('assets', 'domain_id')
  const itId = hasDomain
    ? Number((await q<{ id: number }>(conn, `SELECT id FROM asset_domains WHERE code = 'it' AND deleted_at IS NULL LIMIT 1`))[0]?.id || 0)
    : 0
  return {
    database: db,
    assets: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'),
    licenses: await n('SELECT COUNT(*) AS c FROM licenses WHERE deleted_at IS NULL'),
    accessories: await n('SELECT COUNT(*) AS c FROM accessories WHERE deleted_at IS NULL'),
    consumables: await n('SELECT COUNT(*) AS c FROM consumables WHERE deleted_at IS NULL'),
    components: await n('SELECT COUNT(*) AS c FROM components WHERE deleted_at IS NULL'),
    asset_id_sum: await n('SELECT COALESCE(SUM(id),0) AS c FROM assets'),
    asset_tag_count: await n('SELECT COUNT(DISTINCT asset_tag) AS c FROM assets WHERE deleted_at IS NULL'),
    assigned_assets: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND assigned_to IS NOT NULL'),
    domain_col_assets: hasDomain,
    domain_col_licenses: await col('licenses', 'domain_id'),
    admin_domain: await n(`SELECT COUNT(*) AS c FROM asset_domains WHERE deleted_at IS NULL AND (code = 'admin' OR name = 'ADMIN')`),
    it_domain: await n(`SELECT COUNT(*) AS c FROM asset_domains WHERE deleted_at IS NULL AND (code = 'it' OR name = 'IT')`),
    assets_it: hasDomain
      ? await n(`SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND (domain_id = ${itId || 0} OR domain_id IS NULL)`)
      : null,
    assets_null_domain: hasDomain
      ? await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND domain_id IS NULL')
      : null,
    licenses_null_domain: hasDomain
      ? await n('SELECT COUNT(*) AS c FROM licenses WHERE deleted_at IS NULL AND domain_id IS NULL')
      : null,
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
  if (!TARGET) throw new Error('DB_NAME / WAVE3_TARGET_DB missing')
  const isProd = TARGET.toLowerCase() === PROD.toLowerCase()
  if (isProd && process.env.WAVE3_APPLY_LIVE !== '1') {
    throw new Error(
      `Refusing to write ${TARGET}. Re-run with WAVE3_APPLY_LIVE=1 after staging validation if you intend to apply 037-040 here.`,
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
    if (after.assigned_assets !== before.assigned_assets) throw new Error('asset assignments changed')
    if (after.domain_col_assets !== 1) throw new Error('assets.domain_id missing')
    if (after.domain_col_licenses !== 1) throw new Error('licenses.domain_id missing')
    if (after.it_domain < 1) throw new Error('IT domain missing')
    if (after.admin_domain < 1) throw new Error('ADMIN domain missing')
    if (after.assets_null_domain !== 0) throw new Error(`assets still NULL domain: ${after.assets_null_domain}`)
    if (after.licenses_null_domain !== 0) throw new Error(`licenses still NULL domain: ${after.licenses_null_domain}`)
    if (after.assets_it !== after.assets) throw new Error('not all existing assets resolved to IT')
    console.log('WAVE 3 apply: PASS')
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
