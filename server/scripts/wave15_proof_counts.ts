/**
 * Wave 1.5 — read-only proof of how Wave 1 counts were derived.
 * Does not apply migrations. Closes the pool and exits.
 */
import { get, all, getPool } from '../src/db/index.js'

type CountRow = { c: number }
type TypeRow = { category_type: string; c: number }
type NameRow = { id: number; name: string; category_type: string }

const dbName = await get<{ d: string }>('SELECT DATABASE() AS d')
const hasParent = await get<CountRow>(`
  SELECT COUNT(*) AS c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'parent_id'
`)
const hasAssetTypeCol = await get<CountRow>(`
  SELECT COUNT(*) AS c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'models' AND COLUMN_NAME = 'asset_type_id'
`)
const hasAssetTypesTable = await get<CountRow>(`
  SELECT COUNT(*) AS c FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_types'
`)
const hasDomainsTable = await get<CountRow>(`
  SELECT COUNT(*) AS c FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asset_domains'
`)

const catsByType = await all<TypeRow>(`
  SELECT category_type, COUNT(*) AS c
  FROM categories WHERE deleted_at IS NULL
  GROUP BY category_type ORDER BY category_type
`)
const cats = await all<NameRow>(`
  SELECT id, name, category_type FROM categories WHERE deleted_at IS NULL ORDER BY category_type, name
`)

const modelsByType = await all<TypeRow>(`
  SELECT COALESCE(c.category_type, '(no category)') AS category_type, COUNT(*) AS c
  FROM models m
  LEFT JOIN categories c ON c.id = m.category_id AND c.deleted_at IS NULL
  WHERE m.deleted_at IS NULL
  GROUP BY COALESCE(c.category_type, '(no category)')
  ORDER BY category_type
`)

const modelsOnReviewCats = await get<CountRow>(`
  SELECT COUNT(*) AS c
  FROM models m
  JOIN categories c ON c.id = m.category_id AND c.deleted_at IS NULL
  WHERE m.deleted_at IS NULL AND c.category_type <> 'asset'
`)

const modelsNullCategory = await get<CountRow>(`
  SELECT COUNT(*) AS c FROM models m
  WHERE m.deleted_at IS NULL AND m.category_id IS NULL
`)

const assetsByType = await all<TypeRow>(`
  SELECT COALESCE(c.category_type, '(no model/category)') AS category_type, COUNT(*) AS c
  FROM assets a
  LEFT JOIN models m ON m.id = a.model_id AND m.deleted_at IS NULL
  LEFT JOIN categories c ON c.id = m.category_id AND c.deleted_at IS NULL
  WHERE a.deleted_at IS NULL
  GROUP BY COALESCE(c.category_type, '(no model/category)')
  ORDER BY category_type
`)

const assetsOnReviewCats = await get<CountRow>(`
  SELECT COUNT(*) AS c
  FROM assets a
  JOIN models m ON m.id = a.model_id AND m.deleted_at IS NULL
  JOIN categories c ON c.id = m.category_id AND c.deleted_at IS NULL
  WHERE a.deleted_at IS NULL AND c.category_type <> 'asset'
`)

const modelsPerSafeCat = await all<{ id: number; name: string; models_c: number; assets_c: number }>(`
  SELECT c.id, c.name,
    (SELECT COUNT(*) FROM models m WHERE m.deleted_at IS NULL AND m.category_id = c.id) AS models_c,
    (SELECT COUNT(*) FROM assets a
       JOIN models m ON m.id = a.model_id AND m.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND m.category_id = c.id) AS assets_c
  FROM categories c
  WHERE c.deleted_at IS NULL AND c.category_type = 'asset'
  ORDER BY c.name
`)

const reviewCats = cats.filter((c) => c.category_type !== 'asset')

const out = {
  connected_database: dbName?.d ?? null,
  schema_applied: {
    categories_parent_id: Number(hasParent?.c) > 0,
    models_asset_type_id: Number(hasAssetTypeCol?.c) > 0,
    table_asset_types: Number(hasAssetTypesTable?.c) > 0,
    table_asset_domains: Number(hasDomainsTable?.c) > 0,
  },
  categories_by_type: Object.fromEntries(catsByType.map((r) => [r.category_type, Number(r.c)])),
  safe_automatic_categories: cats.filter((c) => c.category_type === 'asset').map((c) => ({ id: c.id, name: c.name })),
  requires_review_categories: reviewCats.map((c) => ({ id: c.id, name: c.name, category_type: c.category_type })),
  models_by_category_type: Object.fromEntries(modelsByType.map((r) => [r.category_type, Number(r.c)])),
  models_on_review_categories: Number(modelsOnReviewCats?.c ?? 0),
  models_with_null_category: Number(modelsNullCategory?.c ?? 0),
  assets_by_model_category_type: Object.fromEntries(assetsByType.map((r) => [r.category_type, Number(r.c)])),
  assets_on_review_categories: Number(assetsOnReviewCats?.c ?? 0),
  models_and_assets_per_safe_category: modelsPerSafeCat.map((r) => ({
    id: r.id,
    name: r.name,
    models: Number(r.models_c),
    assets: Number(r.assets_c),
  })),
  interpretation: {
    wave1_report_models_associated: 'PROSPECTIVE — counted models whose category_type is asset, not models.asset_type_id (column does not exist yet)',
    wave1_report_assets_classified: 'PROSPECTIVE — counted assets whose model category_type is asset, not an asset_types FK',
    review_categories_affect_models: Number(modelsOnReviewCats?.c ?? 0) === 0
      ? 'NONE — the 20 review categories currently have zero models'
      : 'UNEXPECTED — review categories have models; do not auto-backfill',
  },
}

console.log(JSON.stringify(out, null, 2))
await getPool().end()
process.exit(0)
