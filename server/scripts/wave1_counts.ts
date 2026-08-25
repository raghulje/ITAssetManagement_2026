import { get } from '../src/db/index.js'

// Read-only count queries used to populate WAVE1_CLASSIFICATION_DATA_VALIDATION.md
const cats = await get<{ c: number }>('SELECT COUNT(*) as c FROM categories WHERE deleted_at IS NULL')
const models = await get<{ c: number }>('SELECT COUNT(*) as c FROM models WHERE deleted_at IS NULL')
const assets = await get<{ c: number }>('SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL')

const safeCats = await get<{ c: number }>("SELECT COUNT(*) as c FROM categories WHERE deleted_at IS NULL AND category_type='asset'")

const associatedModels = await get<{ c: number }>(
  `SELECT COUNT(*) as c
   FROM models m
   JOIN categories c ON c.id = m.category_id AND c.deleted_at IS NULL
   WHERE m.deleted_at IS NULL AND c.category_type='asset'`,
)

const assetsAuto = await get<{ c: number }>(
  `SELECT COUNT(*) as c
   FROM assets a
   JOIN models m ON m.id = a.model_id AND m.deleted_at IS NULL
   JOIN categories c ON c.id = m.category_id AND c.deleted_at IS NULL
   WHERE a.deleted_at IS NULL AND c.category_type='asset'`,
)

const assetsUnchanged = await get<{ c: number }>('SELECT COUNT(*) as c FROM assets WHERE deleted_at IS NULL AND model_id IS NULL')

const hasParentCol = await get<{ c: number }>(
  `SELECT COUNT(*) as c
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'categories'
     AND COLUMN_NAME = 'parent_id'`,
)

const nestedCats = hasParentCol && Number(hasParentCol.c) > 0
  ? await get<{ c: number }>('SELECT COUNT(*) as c FROM categories WHERE deleted_at IS NULL AND parent_id IS NOT NULL')
  : { c: 0 }

const maxDepthExisting = hasParentCol && Number(hasParentCol.c) > 0 ? 'unknown' : 0

const out = {
  categories_total: Number(cats?.c ?? 0),
  root_categories: hasParentCol && Number(hasParentCol.c) > 0 ? Number(cats?.c ?? 0) - Number(nestedCats?.c ?? 0) : Number(cats?.c ?? 0),
  nested_categories: Number(nestedCats?.c ?? 0),
  max_existing_category_depth: maxDepthExisting,
  categories_safely_mapped: Number(safeCats?.c ?? 0),
  categories_requiring_review: Number(cats?.c ?? 0) - Number(safeCats?.c ?? 0),
  categories_ambiguous_mapping: 0,
  models_total: Number(models?.c ?? 0),
  models_associated: Number(associatedModels?.c ?? 0),
  models_unclassified: Number(models?.c ?? 0) - Number(associatedModels?.c ?? 0),
  assets_total: Number(assets?.c ?? 0),
  assets_automatically_classified: Number(assetsAuto?.c ?? 0),
  assets_intentionally_left_unchanged: Number(assetsUnchanged?.c ?? 0),
  assets_requiring_review: Number(assets?.c ?? 0) - Number(assetsAuto?.c ?? 0) - Number(assetsUnchanged?.c ?? 0),
}

console.log(JSON.stringify(out, null, 2))

