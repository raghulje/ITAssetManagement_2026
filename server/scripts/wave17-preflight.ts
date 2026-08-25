/**
 * Wave 1.7 — read-only production preflight (no writes).
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const EXPECTED = 'ITAssetManagement_2026'

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || EXPECTED,
})

const [[db]] = await conn.query<mysql.RowDataPacket[]>('SELECT DATABASE() AS d')
const selected = String(db.d)

async function hasTable(t: string) {
  const [r] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT COUNT(*) AS c FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [t])
  return Number(r[0].c) > 0
}
async function hasCol(table: string, col: string) {
  const [r] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT COUNT(*) AS c FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [table, col])
  return Number(r[0].c) > 0
}

const state = {
  env_DB_NAME: process.env.DB_NAME,
  selected_database: selected,
  matches_expected: selected.toLowerCase() === EXPECTED.toLowerCase(),
  asset_domains: await hasTable('asset_domains'),
  asset_types: await hasTable('asset_types'),
  categories_parent_id: await hasCol('categories', 'parent_id'),
  categories_domain_id: await hasCol('categories', 'domain_id'),
  models_asset_type_id: await hasCol('models', 'asset_type_id'),
}

const [[cats]] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS c FROM categories WHERE deleted_at IS NULL')
const [byType] = await conn.query<mysql.RowDataPacket[]>(`
  SELECT category_type, COUNT(*) AS c FROM categories WHERE deleted_at IS NULL GROUP BY category_type
`)
const [assetCats] = await conn.query<mysql.RowDataPacket[]>(`
  SELECT id, name FROM categories WHERE deleted_at IS NULL AND category_type = 'asset' ORDER BY name
`)
const [[models]] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS c FROM models WHERE deleted_at IS NULL')
const [[assets]] = await conn.query<mysql.RowDataPacket[]>(`
  SELECT COUNT(*) AS c, MIN(id) AS mn, MAX(id) AS mx, COUNT(DISTINCT asset_tag) AS tags
  FROM assets WHERE deleted_at IS NULL
`)
const [[withModel]] = await conn.query<mysql.RowDataPacket[]>(`
  SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND model_id IS NOT NULL
`)
const [[noModel]] = await conn.query<mysql.RowDataPacket[]>(`
  SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL AND model_id IS NULL
`)

const partial = state.asset_domains || state.asset_types || state.categories_parent_id
  || state.categories_domain_id || state.models_asset_type_id
const allPresent = state.asset_domains && state.asset_types && state.categories_parent_id
  && state.categories_domain_id && state.models_asset_type_id
const nonePresent = !partial

let readiness: string
if (!state.matches_expected) readiness = 'BLOCKED_WRONG_DATABASE'
else if (allPresent) readiness = 'ALREADY_FULLY_APPLIED'
else if (partial) readiness = 'BLOCKED_UNEXPECTED_PARTIAL_WAVE1_STATE'
else readiness = 'READY_NOT_YET_APPLIED'

const out = {
  readiness,
  state,
  baseline: {
    categories_total: Number(cats.c),
    categories_by_type: Object.fromEntries(byType.map((r) => [r.category_type, Number(r.c)])),
    asset_category_names: assetCats.map((r) => ({ id: r.id, name: r.name })),
    models_total: Number(models.c),
    assets_total: Number(assets.c),
    asset_id_min: Number(assets.mn),
    asset_id_max: Number(assets.mx),
    distinct_asset_tags: Number(assets.tags),
    assets_with_model: Number(withModel.c),
    assets_without_model: Number(noModel.c),
  },
}

await conn.end()
console.log(JSON.stringify(out, null, 2))
if (readiness.startsWith('BLOCKED')) process.exit(2)
