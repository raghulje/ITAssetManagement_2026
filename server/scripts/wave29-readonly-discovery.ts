/**
 * Wave 2.9 — READ-ONLY production discovery for hierarchy seeding policy.
 * SELECT only. No INSERT/UPDATE/DELETE.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  })
  const q = async <T = Record<string, unknown>>(sql: string) => {
    const [rows] = await conn.query(sql)
    return rows as T[]
  }

  const out = {
    db: await q('SELECT DATABASE() AS db'),
    live: await q('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL'),
    soft: await q('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NOT NULL'),
    byType: await q(`
      SELECT COALESCE(lt.code,'NULL') AS code, COUNT(*) AS cnt
      FROM locations l
      LEFT JOIN location_types lt ON lt.id = l.location_type_id
      WHERE l.deleted_at IS NULL
      GROUP BY lt.code
      ORDER BY cnt DESC`),
    typed: await q(`
      SELECT COUNT(*) AS c FROM locations l
      JOIN location_types lt ON lt.id = l.location_type_id
      WHERE l.deleted_at IS NULL AND lt.code <> 'UNSPECIFIED'`),
    parents: await q('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND parent_id IS NOT NULL'),
    companies: await q('SELECT COUNT(*) AS c FROM companies WHERE deleted_at IS NULL'),
    assets: await q('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'),
    sums: await q(`
      SELECT SUM(location_id) AS sum_loc, SUM(rtd_location_id) AS sum_rtd,
             SUM(CASE WHEN location_id IS NULL THEN 1 ELSE 0 END) AS null_loc
      FROM assets WHERE deleted_at IS NULL`),
    topLoc: await q(`
      SELECT l.id, l.name, COUNT(a.id) AS asset_cnt
      FROM locations l
      LEFT JOIN assets a ON a.location_id = l.id AND a.deleted_at IS NULL
      WHERE l.deleted_at IS NULL
      GROUP BY l.id, l.name
      ORDER BY asset_cnt DESC
      LIMIT 12`),
    topRtd: await q(`
      SELECT l.id, l.name, COUNT(a.id) AS rtd_cnt
      FROM locations l
      LEFT JOIN assets a ON a.rtd_location_id = l.id AND a.deleted_at IS NULL
      WHERE l.deleted_at IS NULL
      GROUP BY l.id, l.name
      ORDER BY rtd_cnt DESC
      LIMIT 5`),
    withCo: await q('SELECT COUNT(*) AS c FROM locations WHERE deleted_at IS NULL AND company_id IS NOT NULL'),
    coRows: await q('SELECT id, name, company_id FROM locations WHERE deleted_at IS NULL AND company_id IS NOT NULL LIMIT 10'),
    inv: await q(`
      SELECT
        (SELECT COUNT(*) FROM consumables WHERE deleted_at IS NULL) AS cons,
        (SELECT COUNT(*) FROM accessories WHERE deleted_at IS NULL) AS acc,
        (SELECT COUNT(*) FROM components WHERE deleted_at IS NULL) AS comp`),
    invTopCons: await q(`
      SELECT location_id, COUNT(*) AS c FROM consumables
      WHERE deleted_at IS NULL GROUP BY location_id ORDER BY c DESC LIMIT 5`),
    coSample: await q('SELECT id, name FROM companies WHERE deleted_at IS NULL ORDER BY id LIMIT 20'),
    types: await q('SELECT id, code, name FROM location_types ORDER BY id'),
  }

  console.log(JSON.stringify(out, null, 2))
  await conn.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
