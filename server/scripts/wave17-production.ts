/**
 * Wave 1.7 — production backup + apply 030–033 to ITAssetManagement_2026 only.
 * Requires WAVE17_CONFIRM_PRODUCTION=1.
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

if (process.env.WAVE17_CONFIRM_PRODUCTION !== '1') {
  console.error('Refusing: set WAVE17_CONFIRM_PRODUCTION=1 to run production migration')
  process.exit(2)
}

function runBin(bin: string, args: string[], outFile?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    const err: Buffer[] = []
    const outStream = outFile ? fs.createWriteStream(outFile) : null
    child.stdout.on('data', (d) => { if (outStream) outStream.write(d); else {/* drain */} })
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

async function applySql(conn: mysql.Connection, file: string) {
  const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
  assertProd(db)
  let sql = fs.readFileSync(file, 'utf8')
  if (/USE\s+`?[\w]+`?\s*;/i.test(sql)) {
    // strip any USE; must stay on current connection DB
    sql = sql.replace(/USE\s+`?[\w]+`?\s*;/gi, '')
  }
  if (/DROP\s+TABLE/i.test(sql)) throw new Error(`Refusing DROP TABLE in ${file}`)
  await conn.query(sql)
  return db
}

async function postBackfill(conn: mysql.Connection) {
  const types = await q<{ id: number; name: string; category_name: string; domain_name: string | null }>(conn, `
    SELECT at.id, at.name, c.name AS category_name, ad.name AS domain_name
    FROM asset_types at
    LEFT JOIN categories c ON c.id = at.category_id
    LEFT JOIN asset_domains ad ON ad.id = at.asset_domain_id
    WHERE at.deleted_at IS NULL ORDER BY at.name
  `)
  const domains = await q<{ id: number; name: string; code: string | null }>(conn, `
    SELECT id, name, code FROM asset_domains WHERE deleted_at IS NULL ORDER BY id
  `)
  const catDomain = (await q<{ with_d: number; null_d: number }>(conn, `
    SELECT SUM(domain_id IS NOT NULL) AS with_d, SUM(domain_id IS NULL) AS null_d
    FROM categories WHERE deleted_at IS NULL
  `))[0]
  const modelMap = (await q<{ with_t: number; null_t: number }>(conn, `
    SELECT SUM(asset_type_id IS NOT NULL) AS with_t, SUM(asset_type_id IS NULL) AS null_t
    FROM models WHERE deleted_at IS NULL
  `))[0]
  const chain = Number((await q<{ c: number }>(conn, `
    SELECT COUNT(*) AS c FROM assets a
    JOIN models m ON m.id = a.model_id AND m.deleted_at IS NULL
    JOIN asset_types at ON at.id = m.asset_type_id AND at.deleted_at IS NULL
    JOIN categories c ON c.id = at.category_id AND c.deleted_at IS NULL
    JOIN asset_domains d ON d.id = c.domain_id AND d.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
  `))[0]?.c)
  const unresolved = Number((await q<{ c: number }>(conn, `
    SELECT COUNT(*) AS c FROM assets a
    WHERE a.deleted_at IS NULL AND NOT EXISTS (
      SELECT 1 FROM models m
      JOIN asset_types at ON at.id = m.asset_type_id AND at.deleted_at IS NULL
      JOIN categories c ON c.id = at.category_id AND c.deleted_at IS NULL
      JOIN asset_domains d ON d.id = c.domain_id AND d.deleted_at IS NULL
      WHERE m.id = a.model_id AND m.deleted_at IS NULL
    )
  `))[0]?.c)
  return {
    domains,
    asset_types: types,
    categories_with_domain: Number(catDomain?.with_d),
    categories_null_domain: Number(catDomain?.null_d),
    models_with_asset_type: Number(modelMap?.with_t),
    models_null_asset_type: Number(modelMap?.null_t),
    assets_full_chain: chain,
    assets_unresolved: unresolved,
  }
}

async function main() {
  const dumpExe = path.join(MYSQL_BIN, 'mysqldump.exe')
  if (!fs.existsSync(dumpExe)) throw new Error(`mysqldump not found: ${dumpExe}`)

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const backupDir = path.join(repoRoot, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupPath = path.join(backupDir, `ITAssetManagement_2026_pre_wave1_${stamp}.sql`)
  if (fs.existsSync(backupPath)) throw new Error(`Backup already exists: ${backupPath}`)

  const log: Record<string, unknown> = { production: PROD, backup_path: backupPath }

  // Backup
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

    // Block if partial/full already
    const flags = {
      asset_domains: await hasTable(conn, 'asset_domains'),
      asset_types: await hasTable(conn, 'asset_types'),
      parent_id: await hasCol(conn, 'categories', 'parent_id'),
      domain_id: await hasCol(conn, 'categories', 'domain_id'),
      asset_type_id: await hasCol(conn, 'models', 'asset_type_id'),
    }
    log.pre_flags = flags
    if (Object.values(flags).some(Boolean)) {
      throw new Error('PRODUCTION MIGRATION BLOCKED — UNEXPECTED PARTIAL WAVE 1 STATE')
    }

    const baseline = {
      categories: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL'))[0]?.c),
      models: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL'))[0]?.c),
      assets: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c),
      asset_id_min: Number((await q<{ mn: number }>(conn, 'SELECT MIN(id) AS mn FROM assets WHERE deleted_at IS NULL'))[0]?.mn),
      asset_id_max: Number((await q<{ mx: number }>(conn, 'SELECT MAX(id) AS mx FROM assets WHERE deleted_at IS NULL'))[0]?.mx),
      tags: Number((await q<{ c: number }>(conn, 'SELECT COUNT(DISTINCT asset_tag) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c),
      assigned: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND assigned_to IS NOT NULL'))[0]?.c),
      with_location: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND (location_id IS NOT NULL OR rtd_location_id IS NOT NULL)'))[0]?.c),
    }
    log.baseline = baseline

    const mysqlDir = path.join(serverRoot, 'src/db/mysql')
    const files = [
      '030_classification_asset_domains_and_types.sql',
      '031_classification_categories_parent_domain.sql',
      '032_classification_models_asset_type_id.sql',
      '033_classification_safe_backfill.sql',
    ]
    const execution: Record<string, unknown>[] = []
    const after: Record<string, unknown> = {}

    for (const name of files) {
      const verified = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d
      const start = new Date().toISOString()
      const entry: Record<string, unknown> = {
        migration: name,
        database_verified: verified,
        start,
        status: 'PENDING',
        error: null,
      }
      assertProd(verified || '')
      try {
        await applySql(conn, path.join(mysqlDir, name))
        entry.end = new Date().toISOString()
        entry.status = 'APPLIED'

        if (name.startsWith('030')) {
          after.after_030 = {
            asset_domains: await hasTable(conn, 'asset_domains'),
            asset_types: await hasTable(conn, 'asset_types'),
          }
        }
        if (name.startsWith('031')) {
          after.after_031 = {
            parent_id: await hasCol(conn, 'categories', 'parent_id'),
            domain_id: await hasCol(conn, 'categories', 'domain_id'),
            categories: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL'))[0]?.c),
            nested: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL AND parent_id IS NOT NULL'))[0]?.c),
          }
        }
        if (name.startsWith('032')) {
          after.after_032 = {
            asset_type_id: await hasCol(conn, 'models', 'asset_type_id'),
            nullable: (await q<{ IS_NULLABLE: string }>(conn, `
              SELECT IS_NULLABLE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'models' AND COLUMN_NAME = 'asset_type_id'
            `))[0]?.IS_NULLABLE,
            models: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL'))[0]?.c),
            null_types: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL AND asset_type_id IS NULL'))[0]?.c),
          }
        }
        if (name.startsWith('033')) {
          after.after_033 = await postBackfill(conn)
        }
      } catch (e) {
        entry.end = new Date().toISOString()
        entry.status = 'FAILED'
        entry.error = e instanceof Error ? e.message : String(e)
        execution.push(entry)
        log.execution = execution
        log.after = after
        fs.writeFileSync(path.join(repoRoot, 'WAVE1_7_PRODUCTION_RUN.json'), JSON.stringify(log, null, 2))
        throw e
      }
      execution.push(entry)
    }

    const integrity = {
      categories: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL'))[0]?.c),
      models: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL'))[0]?.c),
      assets: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c),
      asset_id_min: Number((await q<{ mn: number }>(conn, 'SELECT MIN(id) AS mn FROM assets WHERE deleted_at IS NULL'))[0]?.mn),
      asset_id_max: Number((await q<{ mx: number }>(conn, 'SELECT MAX(id) AS mx FROM assets WHERE deleted_at IS NULL'))[0]?.mx),
      tags: Number((await q<{ c: number }>(conn, 'SELECT COUNT(DISTINCT asset_tag) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c),
      assigned: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND assigned_to IS NOT NULL'))[0]?.c),
      with_location: Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND (location_id IS NOT NULL OR rtd_location_id IS NOT NULL)'))[0]?.c),
    }

    log.execution = execution
    log.after = after
    log.integrity = integrity
    log.integrity_match =
      integrity.categories === baseline.categories
      && integrity.models === baseline.models
      && integrity.assets === baseline.assets
      && integrity.asset_id_min === baseline.asset_id_min
      && integrity.asset_id_max === baseline.asset_id_max
      && integrity.tags === baseline.tags
      && integrity.assigned === baseline.assigned
      && integrity.with_location === baseline.with_location

    fs.writeFileSync(path.join(repoRoot, 'WAVE1_7_PRODUCTION_RUN.json'), JSON.stringify(log, null, 2))
    console.log(JSON.stringify({
      ok: true,
      database: selected,
      backup_path: backupPath,
      backup_size_bytes: stat.size,
      integrity_match: log.integrity_match,
      after_033: after.after_033,
    }, null, 2))
  } finally {
    await conn.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
