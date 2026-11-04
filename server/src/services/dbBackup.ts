import mysql from 'mysql2'
import type { PoolConnection } from 'mysql2/promise'
import { getPool } from '../db/index.js'

export type BackupMode = 'data' | 'schema'

export class BackupCancelled extends Error {
  constructor() {
    super('Backup cancelled')
    this.name = 'BackupCancelled'
  }
}

type SqlSink = {
  write(chunk: string): Promise<void>
}

type CoreQuery = {
  query(sql: string): { stream(options?: { highWaterMark?: number }): AsyncIterable<Record<string, unknown>> }
  destroy(): void
}

type ColumnInfo = { name: string; extra: string }
type RoutineInfo = { name: string; kind: 'FUNCTION' | 'PROCEDURE' }

const BATCH_CHARS = 512 * 1024

function ident(name: string) {
  return mysql.escapeId(name)
}

function assertSqlName(name: string) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Unexpected name in the database backup')
  return name
}

/** A SQL literal for one cell. Strings use MySQL escaping; binary values use hex. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return `X'${Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('hex')}'`
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'NULL' : mysql.escape(value)
  if (typeof value === 'object') return mysql.escape(JSON.stringify(value))
  return mysql.escape(String(value))
}

function createStatement(row: Record<string, unknown>) {
  for (const value of Object.values(row)) {
    if (typeof value === 'string' && /^\s*CREATE\b/i.test(value)) return value.trim()
  }
  return ''
}

function withSemicolon(statement: string) {
  return `${statement.trim().replace(/;+\s*$/, '')};\n`
}

function delimiterBlock(statement: string) {
  const body = statement.trim().replace(/;+\s*$/, '')
  return `DELIMITER ;;\n${body};;\nDELIMITER ;\n`
}

async function queryRows(conn: PoolConnection, sql: string, params: unknown[] = []) {
  const [rows] = await conn.query(sql, params)
  return rows as Record<string, unknown>[]
}

async function forEachRow(
  conn: PoolConnection,
  sql: string,
  onRow: (row: Record<string, unknown>) => Promise<void>,
) {
  const core = (conn as unknown as { connection: CoreQuery }).connection
  const stream = core.query(sql).stream({ highWaterMark: 20 })
  try {
    for await (const row of stream) await onRow(row)
  } catch (err) {
    const readable = stream as { destroy?: () => void }
    readable.destroy?.()
    throw err
  }
}

async function columnsOf(conn: PoolConnection, schema: string, table: string): Promise<ColumnInfo[]> {
  const rows = await queryRows(conn, `
    SELECT COLUMN_NAME AS name, EXTRA AS extra
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [schema, table])
  return rows.map((row) => ({
    name: String(row.name || ''),
    extra: String(row.extra || ''),
  })).filter((column) => column.name && !/GENERATED/i.test(column.extra))
}

async function namesOf(conn: PoolConnection, sql: string, params: unknown[]) {
  const rows = await queryRows(conn, sql, params)
  return rows.map((row) => String(row.name || '')).filter(Boolean)
}

/**
 * Writes a SQL backup of the connected database.
 * `schema` creates the database and tables, then loads every row.
 * `data` loads rows into tables that already exist.
 */
export async function writeDatabaseBackup(
  sink: SqlSink,
  mode: BackupMode,
  shouldStop: () => boolean = () => false,
): Promise<{ tables: number; rows: number }> {
  if (mode !== 'data' && mode !== 'schema') throw new Error('Choose a data backup or a schema backup')
  const conn = await getPool().getConnection()
  let committed = false
  let clean = true
  const stop = () => {
    if (shouldStop()) throw new BackupCancelled()
  }

  try {
    await conn.query("SET NAMES utf8mb4")
    await conn.query("SET time_zone = '+00:00'")
    await conn.query('SET SESSION sql_quote_show_create = 1')
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')

    const current = await queryRows(conn, 'SELECT DATABASE() AS db')
    const schema = assertSqlName(String(current[0]?.db || ''))
    const schemaInfo = await queryRows(conn, `
      SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation
      FROM information_schema.SCHEMATA
      WHERE SCHEMA_NAME = ?
    `, [schema])
    const charset = assertSqlName(String(schemaInfo[0]?.charset || 'utf8mb4'))
    const collation = assertSqlName(String(schemaInfo[0]?.collation || 'utf8mb4_unicode_ci'))

    const tables = await namesOf(conn, `
      SELECT TABLE_NAME AS name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `, [schema])
    const views = mode === 'schema'
      ? await namesOf(conn, `
        SELECT TABLE_NAME AS name
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW'
        ORDER BY TABLE_NAME
      `, [schema])
      : []
    const triggers = mode === 'schema'
      ? await namesOf(conn, `
        SELECT TRIGGER_NAME AS name
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = ?
        ORDER BY TRIGGER_NAME
      `, [schema])
      : []
    const routines: RoutineInfo[] = mode === 'schema'
      ? (await queryRows(conn, `
        SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS kind
        FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = ?
        ORDER BY ROUTINE_NAME
      `, [schema])).flatMap((row) => {
        const name = String(row.name || '')
        if (!name) return []
        return [{ name, kind: String(row.kind || '').toUpperCase() === 'FUNCTION' ? 'FUNCTION' as const : 'PROCEDURE' as const }]
      })
      : []
    const events = mode === 'schema'
      ? await namesOf(conn, `
        SELECT EVENT_NAME AS name
        FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = ?
        ORDER BY EVENT_NAME
      `, [schema])
      : []

    const generatedAt = new Date().toISOString()
    const intro = mode === 'schema'
      ? '-- Creates the database and every table, then loads every row.'
      : '-- Loads rows into tables that already exist. This file does not create the database or tables.'
    const header = [
      '-- Refex IT Asset Management backup',
      `-- Mode: ${mode === 'schema' ? 'database schema and data' : 'data only'}`,
      `-- Database: ${schema}`,
      `-- Generated: ${generatedAt}`,
      intro,
      '',
      'SET NAMES utf8mb4;',
      "SET time_zone = '+00:00';",
      'SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;',
      'SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;',
      "SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
      '',
    ]
    if (mode === 'schema') {
      header.push(
        `CREATE DATABASE IF NOT EXISTS ${ident(schema)} DEFAULT CHARACTER SET ${charset} COLLATE ${collation};`,
        `USE ${ident(schema)};`,
        '',
      )
    } else {
      header.push(`USE ${ident(schema)};`, '')
    }
    await sink.write(`${header.join('\n')}\n`)
    stop()

    if (mode === 'schema') {
      for (const event of events) await sink.write(`DROP EVENT IF EXISTS ${ident(event)};\n`)
      for (const routine of routines) await sink.write(`DROP ${routine.kind} IF EXISTS ${ident(routine.name)};\n`)
      for (const view of views) await sink.write(`DROP VIEW IF EXISTS ${ident(view)};\n`)
      for (const table of tables) await sink.write(`DROP TABLE IF EXISTS ${ident(table)};\n`)
      await sink.write('\n')

      for (const table of tables) {
        stop()
        const shown = await queryRows(conn, `SHOW CREATE TABLE ${ident(table)}`)
        const statement = createStatement(shown[0] || {})
        if (!statement) throw new Error(`Could not read the schema for ${table}`)
        await sink.write(`-- Table ${ident(table)}\n${withSemicolon(statement)}\n`)
      }
    }

    let rows = 0
    for (const table of tables) {
      stop()
      const columns = await columnsOf(conn, schema, table)
      await sink.write(`-- Data for ${ident(table)}\n`)
      if (!columns.length) {
        await sink.write(`-- ${ident(table)} has no stored columns\n\n`)
        continue
      }
      const selectList = columns.map((column) => ident(column.name)).join(', ')
      const insertHead = `INSERT INTO ${ident(table)} (${selectList}) VALUES\n`
      let batch: string[] = []
      let batchChars = 0
      let tableRows = 0
      const flush = async () => {
        if (!batch.length) return
        await sink.write(`${insertHead}${batch.join(',\n')};\n`)
        batch = []
        batchChars = 0
      }
      await forEachRow(conn, `SELECT ${selectList} FROM ${ident(table)}`, async (row) => {
        stop()
        const tuple = `(${columns.map((column) => sqlLiteral(row[column.name])).join(',')})`
        if (batch.length && batchChars + tuple.length > BATCH_CHARS) await flush()
        batch.push(tuple)
        batchChars += tuple.length
        tableRows += 1
        rows += 1
      })
      await flush()
      if (!tableRows) await sink.write(`-- ${ident(table)} is empty\n`)
      await sink.write('\n')
    }

    if (mode === 'schema') {
      for (const trigger of triggers) {
        stop()
        const shown = await queryRows(conn, `SHOW CREATE TRIGGER ${ident(trigger)}`)
        const statement = createStatement(shown[0] || {})
        if (statement) await sink.write(`-- Trigger ${ident(trigger)}\n${delimiterBlock(statement)}\n`)
      }
      for (const view of views) {
        stop()
        const shown = await queryRows(conn, `SHOW CREATE VIEW ${ident(view)}`)
        const statement = createStatement(shown[0] || {})
        if (statement) await sink.write(`-- View ${ident(view)}\n${withSemicolon(statement)}\n`)
      }
      for (const routine of routines) {
        stop()
        const shown = await queryRows(conn, `SHOW CREATE ${routine.kind} ${ident(routine.name)}`)
        const statement = createStatement(shown[0] || {})
        if (statement) await sink.write(`-- ${routine.kind} ${ident(routine.name)}\n${delimiterBlock(statement)}\n`)
      }
      for (const event of events) {
        stop()
        const shown = await queryRows(conn, `SHOW CREATE EVENT ${ident(event)}`)
        const statement = createStatement(shown[0] || {})
        if (statement) await sink.write(`-- Event ${ident(event)}\n${delimiterBlock(statement)}\n`)
      }
    }

    await sink.write([
      'SET SQL_MODE=@OLD_SQL_MODE;',
      'SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;',
      'SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;',
      `-- Tables: ${tables.length}`,
      `-- Rows: ${rows}`,
      '',
    ].join('\n'))

    await conn.query('COMMIT')
    committed = true
    return { tables: tables.length, rows }
  } catch (err) {
    clean = false
    throw err
  } finally {
    if (!committed) {
      try { await conn.query('ROLLBACK') } catch { clean = false }
    }
    const core = (conn as unknown as { connection: CoreQuery }).connection
    if (clean) conn.release()
    else {
      try { core.destroy() } catch { conn.release() }
    }
  }
}
