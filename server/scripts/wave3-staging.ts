/**
 * Wave 3 — apply 037–040 ONLY to a staging/test database.
 * Never writes to ITAssetManagement_2026 (production).
 *
 * Default: apply pending migrations on ITAssetManagement_2026_test.
 * Optional clone: WAVE3_CLONE=1 dumps DB_NAME to TARGET first (TARGET must contain test or staging).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const TARGET = process.env.WAVE3_TARGET_DB || 'ITAssetManagement_2026_test'
const PROD = 'ITAssetManagement_2026'
const VERSIONS = [
  '037_asset_domain_admin_seed',
  '038_inventory_domain_id',
  '039_inventory_domain_it_backfill',
  '040_checkout_assigned_employee',
]
const MYSQL_BIN = process.env.MYSQL_BIN
  || 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin'

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

function runBin(bin: string, args: string[], stdin?: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    const out: Buffer[] = []
    const err: Buffer[] = []
    if (stdin) {
      child.stdin.write(stdin)
      child.stdin.end()
    }
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 2000)}`))
    })
  })
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
    assigned_assets: await n(`SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND assigned_to IS NOT NULL`),
    domain_col_assets: hasDomain,
    domain_col_licenses: await col('licenses', 'domain_id'),
    domain_col_accessories: await col('accessories', 'domain_id'),
    domain_col_consumables: await col('consumables', 'domain_id'),
    domain_col_components: await col('components', 'domain_id'),
    assigned_employee_licenses: await col('license_seats', 'assigned_employee_id'),
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
  const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
  if (!isStagingName(db)) throw new Error(`DATABASE SAFETY BLOCKER: refused apply on ${db}`)
  const file = path.join(serverRoot, 'src/db/mysql', `${version}.sql`)
  let sql = fs.readFileSync(file, 'utf8')
  sql = sql.replace(/USE\s+`?[\w]+`?\s*;/gi, '')
  if (/DROP\s+TABLE/i.test(sql)) throw new Error(`Refusing DROP TABLE in ${version}`)
  await conn.query(sql)
}

async function maybeClone() {
  if (process.env.WAVE3_CLONE !== '1') return { cloned: false }
  const source = String(process.env.DB_NAME || PROD)
  if (!isStagingName(TARGET)) throw new Error(`DATABASE SAFETY BLOCKER: WAVE3_TARGET_DB=${TARGET}`)
  if (source.toLowerCase() === TARGET.toLowerCase()) {
    throw new Error('DATABASE SAFETY BLOCKER: source and target are the same')
  }
  const mysqlExe = path.join(MYSQL_BIN, 'mysql.exe')
  const dumpExe = path.join(MYSQL_BIN, 'mysqldump.exe')
  if (!fs.existsSync(mysqlExe) || !fs.existsSync(dumpExe)) {
    throw new Error(`MySQL CLI not found under ${MYSQL_BIN}`)
  }
  const admin = await mysql.createConnection(connOpts())
  try {
    const exists = Number((await q<{ c: number }>(admin, `
      SELECT COUNT(*) AS c FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?
    `, [TARGET]))[0]?.c)
    if (exists && process.env.WAVE3_CLONE_OVERWRITE !== '1') {
      throw new Error(`Target ${TARGET} already exists. Set WAVE3_CLONE_OVERWRITE=1 to replace the test database only.`)
    }
    if (exists) {
      await admin.query(`DROP DATABASE \`${TARGET.replace(/`/g, '')}\``)
    }
    await admin.query(
      `CREATE DATABASE \`${TARGET.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
  } finally {
    await admin.end()
  }
  const dumpArgs = [
    `-h${process.env.DB_HOST || 'localhost'}`,
    `-P${process.env.DB_PORT || '3306'}`,
    `-u${process.env.DB_USER || 'root'}`,
    `-p${process.env.DB_PASSWORD || ''}`,
    '--single-transaction',
    '--routines',
    '--triggers',
    '--set-gtid-purged=OFF',
    source,
  ]
  const dump = await runBin(dumpExe, dumpArgs)
  const loadArgs = [
    `-h${process.env.DB_HOST || 'localhost'}`,
    `-P${process.env.DB_PORT || '3306'}`,
    `-u${process.env.DB_USER || 'root'}`,
    `-p${process.env.DB_PASSWORD || ''}`,
    TARGET,
  ]
  await runBin(mysqlExe, loadArgs, dump)
  return { cloned: true, source, target: TARGET }
}

async function main() {
  if (!isStagingName(TARGET)) {
    throw new Error(`DATABASE SAFETY BLOCKER: WAVE3_TARGET_DB=${TARGET}`)
  }
  const clone = await maybeClone()
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

    const report = {
      target: TARGET,
      selected,
      clone,
      production_database_modified: false,
      applied,
      skipped,
      before,
      after,
    }
    console.log(JSON.stringify(report, null, 2))

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
    if (after.domain_col_accessories !== 1) throw new Error('accessories.domain_id missing')
    if (after.domain_col_consumables !== 1) throw new Error('consumables.domain_id missing')
    if (after.domain_col_components !== 1) throw new Error('components.domain_id missing')
    if (after.it_domain < 1) throw new Error('IT domain missing')
    if (after.admin_domain < 1) throw new Error('ADMIN domain missing')
    if (after.assets_null_domain !== 0) throw new Error(`assets still NULL domain: ${after.assets_null_domain}`)
    if (after.licenses_null_domain !== 0) throw new Error(`licenses still NULL domain: ${after.licenses_null_domain}`)
    if (after.assets_it !== after.assets) throw new Error('not all existing assets resolved to IT')
    if (after.assigned_employee_licenses !== 1) throw new Error('license_seats.assigned_employee_id missing')
    console.log('WAVE 3 staging validation: PASS')
    console.log('Production database modified: NO')
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
