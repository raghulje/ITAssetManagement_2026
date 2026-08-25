/**
 * Wave 1.6 — clone live DB → approved test DB, then apply 030–033 on the clone only.
 * Never writes to ITAssetManagement_2026.
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

const SOURCE_DEFAULT = String(process.env.DB_NAME || '')
const TARGET = process.env.WAVE16_TARGET_DB || 'ITAssetManagement_2026_test'
const MYSQL_BIN = process.env.MYSQL_BIN
  || 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin'

const BLOCKED_EXACT = new Set(['itassetmanagement_2026', 'production', 'prod', 'live'])

export function isBlockedName(name: string) {
  return BLOCKED_EXACT.has(String(name || '').trim().toLowerCase())
}

export function isApprovedStagingName(name: string) {
  const n = String(name || '').trim()
  if (!n || isBlockedName(n)) return false
  return /test|staging|sandbox|development/i.test(n)
}

function assertCanWrite(dbName: string, label: string) {
  if (isBlockedName(dbName) || !isApprovedStagingName(dbName)) {
    throw new Error(`DATABASE SAFETY BLOCKER: refused write to ${label}=${dbName}`)
  }
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
  const col = async (table: string, column: string) => {
    const rows = await q<{ c: number }>(conn, `
      SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [table, column])
    return Number(rows[0]?.c) > 0
  }
  const tbl = async (table: string) => {
    const rows = await q<{ c: number }>(conn, `
      SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `, [table])
    return Number(rows[0]?.c) > 0
  }
  const cats = Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL'))[0]?.c)
  const models = Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL'))[0]?.c)
  const assets = Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c)
  const byType = await q<{ category_type: string; c: number }>(conn, `
    SELECT category_type, COUNT(*) AS c FROM categories WHERE deleted_at IS NULL GROUP BY category_type
  `)
  const assetMinMax = (await q<{ mn: number; mx: number; tags: number }>(conn, `
    SELECT MIN(id) AS mn, MAX(id) AS mx, COUNT(DISTINCT asset_tag) AS tags
    FROM assets WHERE deleted_at IS NULL
  `))[0]
  const noModel = Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND model_id IS NULL'))[0]?.c)
  return {
    database: db,
    tables: {
      asset_domains: await tbl('asset_domains'),
      asset_types: await tbl('asset_types'),
      categories_parent_id: await col('categories', 'parent_id'),
      categories_domain_id: await col('categories', 'domain_id'),
      models_asset_type_id: await col('models', 'asset_type_id'),
    },
    categories_total: cats,
    models_total: models,
    assets_total: assets,
    assets_without_model: noModel,
    categories_by_type: Object.fromEntries(byType.map((r) => [r.category_type, Number(r.c)])),
    asset_id_min: Number(assetMinMax?.mn),
    asset_id_max: Number(assetMinMax?.mx),
    distinct_asset_tags: Number(assetMinMax?.tags),
  }
}

async function postBackfill(conn: mysql.Connection) {
  const types = await q<{ id: number; name: string; category_name: string; domain_name: string | null }>(conn, `
    SELECT at.id, at.name, c.name AS category_name, ad.name AS domain_name
    FROM asset_types at
    LEFT JOIN categories c ON c.id = at.category_id
    LEFT JOIN asset_domains ad ON ad.id = at.asset_domain_id
    WHERE at.deleted_at IS NULL
    ORDER BY at.name
  `)
  const catDomain = (await q<{ with_d: number; null_d: number }>(conn, `
    SELECT
      SUM(domain_id IS NOT NULL) AS with_d,
      SUM(domain_id IS NULL) AS null_d
    FROM categories WHERE deleted_at IS NULL
  `))[0]
  const nested = Number((await q<{ c: number }>(conn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL AND parent_id IS NOT NULL'))[0]?.c)
  const modelMap = (await q<{ with_t: number; null_t: number }>(conn, `
    SELECT
      SUM(asset_type_id IS NOT NULL) AS with_t,
      SUM(asset_type_id IS NULL) AS null_t
    FROM models WHERE deleted_at IS NULL
  `))[0]
  const chain = Number((await q<{ c: number }>(conn, `
    SELECT COUNT(*) AS c
    FROM assets a
    JOIN models m ON m.id = a.model_id AND m.deleted_at IS NULL
    JOIN asset_types at ON at.id = m.asset_type_id AND at.deleted_at IS NULL
    JOIN categories c ON c.id = at.category_id AND c.deleted_at IS NULL
    JOIN asset_domains d ON d.id = c.domain_id AND d.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
  `))[0]?.c)
  const unresolved = Number((await q<{ c: number }>(conn, `
    SELECT COUNT(*) AS c
    FROM assets a
    WHERE a.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM models m
        JOIN asset_types at ON at.id = m.asset_type_id AND at.deleted_at IS NULL
        JOIN categories c ON c.id = at.category_id AND c.deleted_at IS NULL
        JOIN asset_domains d ON d.id = c.domain_id AND d.deleted_at IS NULL
        WHERE m.id = a.model_id AND m.deleted_at IS NULL
      )
  `))[0]?.c)
  return {
    asset_types: types,
    categories_with_domain: Number(catDomain?.with_d),
    categories_null_domain: Number(catDomain?.null_d),
    nested_categories: nested,
    models_with_asset_type: Number(modelMap?.with_t),
    models_null_asset_type: Number(modelMap?.null_t),
    assets_full_chain: chain,
    assets_unresolved: unresolved,
  }
}

async function applySqlFile(conn: mysql.Connection, file: string) {
  const db = (await q<{ d: string }>(conn, 'SELECT DATABASE() AS d'))[0]?.d || ''
  assertCanWrite(db, 'SELECT DATABASE()')
  let sql = fs.readFileSync(file, 'utf8')
  if (/USE\s+`?ITAssetManagement_2026`?/i.test(sql) && !/USE\s+`?ITAssetManagement_2026_test`?/i.test(sql)) {
    throw new Error(`Refusing SQL that targets live USE: ${file}`)
  }
  sql = sql.replace(/USE\s+`?[\w]+`?\s*;/gi, '')
  if (/DROP\s+TABLE/i.test(sql) && !/information_schema/i.test(sql)) {
    throw new Error(`Refusing SQL with DROP TABLE: ${file}`)
  }
  await conn.query(sql)
  return db
}

async function main() {
  const source = SOURCE_DEFAULT
  if (!source) throw new Error('DB_NAME missing in environment')
  assertCanWrite(TARGET, 'TARGET')
  if (source.toLowerCase() === TARGET.toLowerCase()) {
    throw new Error('DATABASE SAFETY BLOCKER: source and target are the same')
  }

  const log: Record<string, unknown> = {
    source,
    target: TARGET,
    source_written_to: false,
    mysql_bin: MYSQL_BIN,
  }

  const mysqlExe = path.join(MYSQL_BIN, 'mysql.exe')
  const dumpExe = path.join(MYSQL_BIN, 'mysqldump.exe')
  if (!fs.existsSync(mysqlExe) || !fs.existsSync(dumpExe)) {
    throw new Error(`MySQL CLI not found under ${MYSQL_BIN}`)
  }

  const admin = await mysql.createConnection(connOpts())
  try {
    const srcCheck = await q<{ c: number }>(admin, `
      SELECT COUNT(*) AS c FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?
    `, [source])
    if (!Number(srcCheck[0]?.c)) throw new Error(`Source schema not found: ${source}`)

    const exists = Number((await q<{ c: number }>(admin, `
      SELECT COUNT(*) AS c FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?
    `, [TARGET]))[0]?.c)
    if (exists && process.env.WAVE16_CLONE_OVERWRITE !== '1') {
      throw new Error(`Target ${TARGET} already exists. Set WAVE16_CLONE_OVERWRITE=1 to replace the test database only.`)
    }
    if (exists) {
      assertCanWrite(TARGET, 'DROP DATABASE')
      await admin.query(`DROP DATABASE \`${TARGET.replace(/`/g, '')}\``)
      log.dropped_existing_target = true
    }
    await admin.query(
      `CREATE DATABASE \`${TARGET.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    log.created_target = true
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
  console.log(`Dumping ${source} → ${TARGET} (CLI mysqldump; source is read-only)`)
  const dump = await runBin(dumpExe, dumpArgs)
  const restoreArgs = [
    `-h${process.env.DB_HOST || 'localhost'}`,
    `-P${process.env.DB_PORT || '3306'}`,
    `-u${process.env.DB_USER || 'root'}`,
    `-p${process.env.DB_PASSWORD || ''}`,
    TARGET,
  ]
  await runBin(mysqlExe, restoreArgs, dump)
  log.clone_bytes = dump.length
  log.clone_method = 'mysqldump | mysql'

  const srcConn = await mysql.createConnection(connOpts(source))
  const tgtConn = await mysql.createConnection(connOpts(TARGET))
  try {
    const srcDb = (await q<{ d: string }>(srcConn, 'SELECT DATABASE() AS d'))[0]?.d
    const tgtDb = (await q<{ d: string }>(tgtConn, 'SELECT DATABASE() AS d'))[0]?.d
    log.source_selected = srcDb
    log.target_selected = tgtDb
    if (isBlockedName(tgtDb || '') || !isApprovedStagingName(tgtDb || '')) {
      throw new Error(`DATABASE SAFETY BLOCKER after clone: DATABASE()=${tgtDb}`)
    }

    const baselineSource = await snapshot(srcConn)
    const baselineTarget = await snapshot(tgtConn)
    log.baseline_source = baselineSource
    log.baseline_target = baselineTarget

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
      const verified = (await q<{ d: string }>(tgtConn, 'SELECT DATABASE() AS d'))[0]?.d
      const entry: Record<string, unknown> = {
        file: name,
        target_database: verified,
        database_verified: isApprovedStagingName(verified || '') && !isBlockedName(verified || ''),
      }
      if (!entry.database_verified) {
        entry.status = 'STOPPED'
        entry.errors = 'DATABASE SAFETY BLOCKER'
        execution.push(entry)
        throw new Error(`Stopped before ${name}: DATABASE()=${verified}`)
      }
      try {
        await applySqlFile(tgtConn, path.join(mysqlDir, name))
        entry.status = 'APPLIED'
        entry.errors = null
        if (name.startsWith('030')) {
          after.after_030 = {
            asset_domains: Number((await q<{ c: number }>(tgtConn, `
              SELECT COUNT(*) AS c FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_domains'`))[0]?.c) > 0,
            asset_types: Number((await q<{ c: number }>(tgtConn, `
              SELECT COUNT(*) AS c FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_types'`))[0]?.c) > 0,
          }
        }
        if (name.startsWith('031')) {
          after.after_031 = {
            parent_id: Number((await q<{ c: number }>(tgtConn, `
              SELECT COUNT(*) AS c FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'parent_id'`))[0]?.c) > 0,
            domain_id: Number((await q<{ c: number }>(tgtConn, `
              SELECT COUNT(*) AS c FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'domain_id'`))[0]?.c) > 0,
            categories_total: Number((await q<{ c: number }>(tgtConn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL'))[0]?.c),
            nested: Number((await q<{ c: number }>(tgtConn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL AND parent_id IS NOT NULL'))[0]?.c),
          }
        }
        if (name.startsWith('032')) {
          after.after_032 = {
            asset_type_id: Number((await q<{ c: number }>(tgtConn, `
              SELECT COUNT(*) AS c FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'models' AND COLUMN_NAME = 'asset_type_id'`))[0]?.c) > 0,
            nullable: (await q<{ IS_NULLABLE: string }>(tgtConn, `
              SELECT IS_NULLABLE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'models' AND COLUMN_NAME = 'asset_type_id'`))[0]?.IS_NULLABLE,
            models_total: Number((await q<{ c: number }>(tgtConn, 'SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL'))[0]?.c),
            models_null_type: Number((await q<{ c: number }>(tgtConn, 'SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL AND asset_type_id IS NULL'))[0]?.c),
          }
        }
        if (name.startsWith('033')) {
          after.after_033 = await postBackfill(tgtConn)
        }
      } catch (e) {
        entry.status = 'FAILED'
        entry.errors = e instanceof Error ? e.message : String(e)
        execution.push(entry)
        throw e
      }
      execution.push(entry)
    }

    log.execution = execution
    log.after = after

    const srcAfter = await snapshot(srcConn)
    log.source_after_unchanged_tables = srcAfter.tables
    log.source_still_lacks_wave1_schema = !srcAfter.tables.asset_domains && !srcAfter.tables.models_asset_type_id
    log.integrity = {
      source_assets: baselineSource.assets_total,
      target_assets: Number((await q<{ c: number }>(tgtConn, 'SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'))[0]?.c),
      source_models: baselineSource.models_total,
      target_models: Number((await q<{ c: number }>(tgtConn, 'SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL'))[0]?.c),
      source_categories: baselineSource.categories_total,
      target_categories: Number((await q<{ c: number }>(tgtConn, 'SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL'))[0]?.c),
      source_asset_id_min: baselineSource.asset_id_min,
      target_asset_id_min: Number((await q<{ mn: number }>(tgtConn, 'SELECT MIN(id) AS mn FROM assets WHERE deleted_at IS NULL'))[0]?.mn),
      source_asset_id_max: baselineSource.asset_id_max,
      target_asset_id_max: Number((await q<{ mx: number }>(tgtConn, 'SELECT MAX(id) AS mx FROM assets WHERE deleted_at IS NULL'))[0]?.mx),
    }

    const outPath = path.join(serverRoot, '..', 'WAVE1_6_STAGING_RUN.json')
    fs.writeFileSync(outPath, JSON.stringify(log, null, 2))
    console.log(JSON.stringify({ ok: true, outPath, target: tgtDb, source_written_to: false }, null, 2))
  } finally {
    await srcConn.end()
    await tgtConn.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
