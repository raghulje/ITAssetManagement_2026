/**
 * Wave 2.3 — production backup + apply 034–036 ONLY to ITAssetManagement_2026.
 * Requires WAVE23_CONFIRM_PRODUCTION=1.
 * Does not run broad migrate; does not touch staging.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(serverRoot, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const PROD = 'ITAssetManagement_2026'
const MYSQL_BIN = process.env.MYSQL_BIN || 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin'
const VERSIONS = [
  '034_location_types_and_space_subtypes',
  '035_locations_typed_columns_and_external_code',
  '036_locations_unspecified_backfill',
]

if (process.env.WAVE23_CONFIRM_PRODUCTION !== '1') {
  console.error('Refusing: set WAVE23_CONFIRM_PRODUCTION=1 to run production migration')
  process.exit(2)
}

function runBin(bin: string, args: string[], outFile?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    const err: Buffer[] = []
    const outStream = outFile ? fs.createWriteStream(outFile) : null
    child.stdout.on('data', (d) => { if (outStream) outStream.write(d) })
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      outStream?.end()
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 4000)}`))
    })
  })
}

async function q<T extends mysql.RowDataPacket>(conn: mysql.Connection, sql: string, params: unknown[] = []) {
  const [rows] = await conn.query<T[]>(sql, params)
  return rows
}

function assertProd(db: string) {
  if (String(db).toLowerCase() !== PROD.toLowerCase()) {
    throw new Error(`DATABASE SAFETY BLOCKER: expected ${PROD}, got ${db}`)
  }
}

async function hasTable(conn: mysql.Connection, t: string) {
  return Number((await q<{ c: number }>(conn, `
    SELECT COUNT(*) AS c FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [t]))[0]?.c) > 0
}

async function hasCol(conn: mysql.Connection, table: string, col: string) {
  return Number((await q<{ c: number }>(conn, `
    SELECT COUNT(*) AS c FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [table, col]))[0]?.c) > 0
}

async function applySql(conn: mysql.Connection, version: string) {
  const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
  assertProd(db)
  const file = path.join(serverRoot, 'src/db/mysql', `${version}.sql`)
  let sql = fs.readFileSync(file, 'utf8')
  sql = sql.replace(/USE\s+`?[\w]+`?\s*;/gi, '')
  if (/DROP\s+TABLE/i.test(sql)) throw new Error(`Refusing DROP TABLE in ${version}`)
  await conn.query(sql)
  return db
}

async function integrity(conn: mysql.Connection) {
  const n = async (sql: string) => Number((await q<{ c: number }>(conn, sql))[0]?.c || 0)
  return {
    database: (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d,
    location_types: await hasTable(conn, 'location_types'),
    space_subtypes: await hasTable(conn, 'space_subtypes'),
    location_type_id: await hasCol(conn, 'locations', 'location_type_id'),
    space_subtype_id: await hasCol(conn, 'locations', 'space_subtype_id'),
    external_code: await hasCol(conn, 'locations', 'external_code'),
    type_count: await n('SELECT COUNT(*) AS c FROM location_types'),
    subtype_count: await n('SELECT COUNT(*) AS c FROM space_subtypes'),
    type_codes: (await q<{ code: string }>(conn, 'SELECT code FROM location_types ORDER BY hierarchy_level, code')).map((r) => r.code),
    subtype_codes: (await q<{ code: string }>(conn, 'SELECT code FROM space_subtypes ORDER BY code')).map((r) => r.code),
    locations_live: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL'),
    locations_deleted: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NOT NULL'),
    location_id_checksum: await n('SELECT COALESCE(SUM(id),0) AS c FROM locations'),
    parent_id_checksum: await n('SELECT COALESCE(SUM(parent_id),0) AS c FROM locations'),
    unspecified_live: await n(`
      SELECT COUNT(*) AS c FROM locations l
      JOIN location_types t ON t.id = l.location_type_id
      WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'
    `),
    untyped_live: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND location_type_id IS NULL'),
    assets: await n('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'),
    asset_min_id: Number((await q<{ c: number }>(conn, 'SELECT MIN(id) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c || 0),
    asset_max_id: Number((await q<{ c: number }>(conn, 'SELECT MAX(id) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c || 0),
    asset_location_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM assets WHERE deleted_at IS NULL'),
    asset_rtd_sum: await n('SELECT COALESCE(SUM(rtd_location_id),0) AS c FROM assets WHERE deleted_at IS NULL'),
    invalid_asset_location_fk: await n(`
      SELECT COUNT(*) AS c FROM assets a
      WHERE a.deleted_at IS NULL AND a.location_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = a.location_id)
    `),
    invalid_asset_rtd_fk: await n(`
      SELECT COUNT(*) AS c FROM assets a
      WHERE a.deleted_at IS NULL AND a.rtd_location_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = a.rtd_location_id)
    `),
    consumables: await n('SELECT COUNT(*) AS c FROM consumables WHERE deleted_at IS NULL'),
    accessories: await n('SELECT COUNT(*) AS c FROM accessories WHERE deleted_at IS NULL'),
    components: await n('SELECT COUNT(*) AS c FROM components WHERE deleted_at IS NULL'),
    cons_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM consumables WHERE deleted_at IS NULL'),
    acc_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM accessories WHERE deleted_at IS NULL'),
    comp_loc_sum: await n('SELECT COALESCE(SUM(location_id),0) AS c FROM components WHERE deleted_at IS NULL'),
  }
}

async function main() {
  const dumpExe = path.join(MYSQL_BIN, 'mysqldump.exe')
  if (!fs.existsSync(dumpExe)) throw new Error(`mysqldump not found: ${dumpExe}`)

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const backupDir = path.join(repoRoot, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupPath = path.join(backupDir, `ITAssetManagement_2026_pre_wave23_${stamp}.sql`)
  if (fs.existsSync(backupPath)) throw new Error(`Backup already exists: ${backupPath}`)

  const log: Record<string, unknown> = { production: PROD, backup_path: backupPath }

  console.log(`Creating backup → ${backupPath}`)
  await runBin(dumpExe, [
    `-h${process.env.DB_HOST || 'localhost'}`,
    `-P${process.env.DB_PORT || '3306'}`,
    `-u${process.env.DB_USER || 'root'}`,
    `-p${process.env.DB_PASSWORD || ''}`,
    '--single-transaction',
    '--routines',
    '--triggers',
    '--events',
    '--set-gtid-purged=OFF',
    PROD,
  ], backupPath)

  const stat = fs.statSync(backupPath)
  const head = fs.readFileSync(backupPath, { encoding: 'utf8', flag: 'r' }).slice(0, 8000)
  const backupOk = stat.size > 1000
    && /CREATE TABLE/i.test(head)
    && (/ITAssetManagement_2026/i.test(head) || /Database: itassetmanagement_2026/i.test(head) || /Table structure/i.test(head))
  log.backup = {
    path: backupPath,
    size_bytes: stat.size,
    status: backupOk ? 'OK' : 'FAILED',
    verification: backupOk
      ? 'non-zero file; contains CREATE TABLE / dump headers'
      : 'verification failed',
  }
  if (!backupOk) throw new Error('PRODUCTION MIGRATION BLOCKED — BACKUP VERIFICATION FAILED')

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: PROD,
    multipleStatements: true,
    charset: 'utf8mb4',
  })

  try {
    const selected = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
    assertProd(selected)
    log.database_verified = selected

    const beforeFlags = {
      location_types: await hasTable(conn, 'location_types'),
      space_subtypes: await hasTable(conn, 'space_subtypes'),
      location_type_id: await hasCol(conn, 'locations', 'location_type_id'),
      space_subtype_id: await hasCol(conn, 'locations', 'space_subtype_id'),
      external_code: await hasCol(conn, 'locations', 'external_code'),
    }
    log.pre_flags = beforeFlags
    if (beforeFlags.location_types || beforeFlags.space_subtypes || beforeFlags.location_type_id || beforeFlags.space_subtype_id) {
      throw new Error('PRODUCTION MIGRATION BLOCKED — UNEXPECTED PARTIAL WAVE 2.2 STATE')
    }

    const before = await integrity(conn).catch(async () => {
      // integrity expects type tables; capture baseline without them
      const n = async (sql: string) => Number((await q<{ c: number }>(conn, sql))[0]?.c || 0)
      return {
        database: selected,
        locations_live: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL'),
        locations_deleted: await n('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NOT NULL'),
        location_id_checksum: await n('SELECT COALESCE(SUM(id),0) AS c FROM locations'),
        parent_id_checksum: await n('SELECT COALESCE(SUM(parent_id),0) AS c FROM locations'),
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
    })
    log.before = before

    if ((before as { locations_live: number }).locations_live !== 187
      || (before as { locations_deleted: number }).locations_deleted !== 7
      || (before as { assets: number }).assets !== 1204) {
      throw new Error('PRODUCTION MIGRATION BLOCKED — unexpected baseline counts')
    }

    const steps: Record<string, unknown> = {}

    // 034
    {
      const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
      assertProd(db)
      await applySql(conn, VERSIONS[0])
      steps['034'] = {
        database: db,
        location_types: await hasTable(conn, 'location_types'),
        space_subtypes: await hasTable(conn, 'space_subtypes'),
        type_count: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM location_types'))[0]?.c),
        subtype_count: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM space_subtypes'))[0]?.c),
      }
      if ((steps['034'] as { type_count: number }).type_count !== 7
        || (steps['034'] as { subtype_count: number }).subtype_count !== 6) {
        throw new Error('034 validation failed')
      }
    }

    // 035
    {
      const hadExternal = beforeFlags.external_code
      const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
      assertProd(db)
      await applySql(conn, VERSIONS[1])
      steps['035'] = {
        database: db,
        location_type_id: await hasCol(conn, 'locations', 'location_type_id'),
        space_subtype_id: await hasCol(conn, 'locations', 'space_subtype_id'),
        external_code: await hasCol(conn, 'locations', 'external_code'),
        external_code_operation: hadExternal ? 'ALREADY PRESENT / NO-OP' : 'ADDED',
      }
      if (!(steps['035'] as { location_type_id: boolean }).location_type_id
        || !(steps['035'] as { space_subtype_id: boolean }).space_subtype_id
        || !(steps['035'] as { external_code: boolean }).external_code) {
        throw new Error('035 validation failed')
      }
    }

    // 036
    {
      const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
      assertProd(db)
      await applySql(conn, VERSIONS[2])
      const unspecified = Number((await q<{ c: number }>(conn, `
        SELECT COUNT(*) AS c FROM locations l
        JOIN location_types t ON t.id = l.location_type_id
        WHERE l.deleted_at IS NULL AND t.code = 'UNSPECIFIED'
      `))[0]?.c)
      const untyped = Number((await q<{ c: number }>(conn, `
        SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND location_type_id IS NULL
      `))[0]?.c)
      steps['036'] = {
        database: db,
        unspecified_live: unspecified,
        untyped_live: untyped,
        automatically_typed: 0,
      }
      if (unspecified !== 187 || untyped !== 0) throw new Error('036 validation failed')
    }

    log.steps = steps
    const after = await integrity(conn)
    log.after = after

    const b = before as Record<string, number>
    if (after.locations_live !== b.locations_live) throw new Error('locations live changed')
    if (after.locations_deleted !== b.locations_deleted) throw new Error('locations deleted changed')
    if (after.location_id_checksum !== b.location_id_checksum) throw new Error('location IDs changed')
    if (after.parent_id_checksum !== b.parent_id_checksum) throw new Error('parent_id changed')
    if (after.assets !== b.assets) throw new Error('assets count changed')
    if (after.asset_min_id !== b.asset_min_id || after.asset_max_id !== b.asset_max_id) throw new Error('asset id range changed')
    if (after.asset_location_sum !== b.asset_location_sum) throw new Error('asset location_id changed')
    if (after.asset_rtd_sum !== b.asset_rtd_sum) throw new Error('asset rtd_location_id changed')
    if (after.consumables !== b.consumables || after.accessories !== b.accessories || after.components !== b.components) {
      throw new Error('inventory counts changed')
    }
    if (after.cons_loc_sum !== b.cons_loc_sum || after.acc_loc_sum !== b.acc_loc_sum || after.comp_loc_sum !== b.comp_loc_sum) {
      throw new Error('inventory location sums changed')
    }
    if (after.type_count !== 7 || after.subtype_count !== 6) throw new Error('type seed counts wrong')
    if (after.unspecified_live !== 187 || after.untyped_live !== 0) throw new Error('backfill incomplete')
    if (after.invalid_asset_location_fk !== 0 || after.invalid_asset_rtd_fk !== 0) throw new Error('invalid asset location FKs')

    const expectedTypes = ['UNSPECIFIED', 'SITE', 'BUILDING', 'FLOOR', 'ZONE', 'DEPARTMENT_AREA', 'SPACE']
    const expectedSub = ['CABIN', 'MEETING_ROOM', 'OTHER', 'SERVER_ROOM', 'STORE_ROOM', 'WORKSTATION']
    if (JSON.stringify([...after.type_codes].sort()) !== JSON.stringify([...expectedTypes].sort())) {
      throw new Error(`type codes mismatch: ${after.type_codes.join(',')}`)
    }
    if (JSON.stringify(after.subtype_codes) !== JSON.stringify(expectedSub)) {
      throw new Error(`subtype codes mismatch: ${after.subtype_codes.join(',')}`)
    }

    log.status = 'SUCCESS'
    console.log(JSON.stringify(log, null, 2))
    console.log('WAVE 2.3 PRODUCTION MIGRATION: SUCCESS')
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
