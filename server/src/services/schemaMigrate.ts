import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type SchemaMigrateResult = {
  applied: string[]
  skipped: string[]
  table_count: number
}

export type SchemaMigrateStatus = {
  pending: string[]
  applied: string[]
}

function mysqlMigrationsDir() {
  return path.join(__dirname, '../db/mysql')
}

/** Numbered files the admin button will apply (001 always re-runs and is omitted). */
export function listedMigrationVersions(): string[] {
  return fs.readdirSync(mysqlMigrationsDir())
    .filter((f) => f.endsWith('.sql') && /^\d{3}_/.test(f) && !f.startsWith('001'))
    .sort()
    .map((f) => f.replace(/\.sql$/, ''))
}

export async function listSchemaMigrationStatus(): Promise<SchemaMigrateStatus> {
  const versions = listedMigrationVersions()
  const { all } = await import('../db/index.js')
  let appliedRows: Array<{ version: string }> = []
  try {
    appliedRows = await all<{ version: string }>(`SELECT version FROM schema_migrations`)
  } catch {
    appliedRows = []
  }
  const appliedSet = new Set(appliedRows.map((r) => String(r.version)))
  const applied: string[] = []
  const pending: string[] = []
  for (const v of versions) {
    if (appliedSet.has(v)) applied.push(v)
    else pending.push(v)
  }
  return { pending, applied }
}

/** Apply pending SQL files under db/mysql (same logic as CLI migrate). */
export async function runPendingSchemaMigrations(): Promise<SchemaMigrateResult> {
  const host = process.env.DB_HOST || 'localhost'
  const port = Number(process.env.DB_PORT || 3306)
  const user = process.env.DB_USER || 'root'
  const password = process.env.DB_PASSWORD || ''
  const database = process.env.DB_NAME || 'ITAssetManagement_2026'

  const root = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
    charset: 'utf8mb4',
  })

  try {
    await root.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    await root.changeUser({ database })

    await root.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        version VARCHAR(191) NOT NULL,
        applied_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_schema_migrations_version (version)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `).catch(() => undefined)

    const dir = mysqlMigrationsDir()
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    const applied: string[] = []
    const skipped: string[] = []

    for (const file of files) {
      const versionName = file.replace(/\.sql$/, '')

      if (/^\d{3}_/.test(file) && !file.startsWith('001')) {
        const [rows] = await root.query<mysql.RowDataPacket[]>(
          `SELECT id FROM schema_migrations WHERE version = ? LIMIT 1`,
          [versionName],
        ).catch(() => [[] as mysql.RowDataPacket[]])
        if (rows.length) {
          skipped.push(versionName)
          continue
        }
      }

      let sql = fs.readFileSync(path.join(dir, file), 'utf8')
        .replace(/CREATE DATABASE[\s\S]*?;/i, '')
        .replace(/USE\s+`?[\w]+`?\s*;/gi, '')
      await root.query(sql)
      await root.query(
        `INSERT IGNORE INTO schema_migrations (version) VALUES (?)`,
        [versionName],
      ).catch(() => undefined)
      applied.push(versionName)
    }

    const [tables] = await root.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME as name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [database],
    )

    return { applied, skipped, table_count: tables.length }
  } finally {
    await root.end()
  }
}
