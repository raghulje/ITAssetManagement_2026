# Wave 1 — Classification Data Validation

**Wave 1.5 correction:** Live schema still has **no** `asset_domains` / `asset_types` tables and **no** `models.asset_type_id`. Figures below are a **forecast** of 033 backfill, not applied results. See `WAVE1_5_MIGRATION_READINESS.md`.

## Summary of current data (count-based; no sensitive rows)
Counts are derived from the current production dataset using only existing fields:
- `categories.category_type` (to determine ITAM “asset side”)
- `models.category_id` / `assets.model_id` joins

### Categories
- Existing category count: `27`
- Root category count: `27`
- Existing nested category count (parent_id != NULL): `0` (column not present; all 27 are roots)
- Maximum existing category depth: `0`
- Categories safely mapped (`category_type = asset`): `7` — Desktop, Laptop, Mobile, Monitor, Other, Printer, Tablet
- Categories requiring review (accessory 7 + consumable 5 + component 4 + license 4): `20`
- Categories with ambiguous mapping: `0`

### Models
- Existing model count: `366`
- Models on the 7 asset categories (033 **would** set `asset_type_id`): `366`
- Models on the 20 review categories: `0`
- Models left unclassified after a successful 033: `0` (forecast)

### Assets
- Existing asset count: `1204`
- Assets whose model sits on an asset category (inherit type after 033; **no** `assets` UPDATE): `1204`
- Assets on review categories: `0`
- Assets requiring review: `0`
- Assets intentionally left unchanged (no model): `0`

