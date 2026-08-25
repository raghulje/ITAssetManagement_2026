# Wave 1.5 — Migration Readiness & Dry-Run Review

**Status:** READINESS COMPLETE — **migrations not applied** to `ITAssetManagement_2026`.

This is **not Wave 2**. Location types, site hierarchy, and physical space work remain out of scope.

---

## 1. Verdict

| Question | Answer |
|---|---|
| Is the SQL additive and non-destructive to existing rows? | **Yes**, with caveats below. |
| Safe to apply on the current live DB now? | **No** — no confirmed staging clone; `mysqldump`/`mysql` not on PATH in this environment. |
| Repeatable? | **Mostly yes** via column/table guards + `schema_migrations` skip. |
| Wave 1 report “366 models / 1204 assets classified”? | **Prospective only** — `models.asset_type_id` **does not exist yet**. |
| Do the 20 review categories feed those 366/1204? | **No. Zero models and zero assets** sit on those 20 categories. |
| Wave 2? | **Do not start** until a staging apply + post-migration counts succeed. |

---

## 2. Correction to Wave 1 count language

Wave 1’s `wave1_counts.ts` **never read `asset_types` or `models.asset_type_id`**. Those objects are not in the live schema.

It counted:

- “Safely mapped categories” = `categories.category_type = 'asset'` → **7**
- “Requires review” = every other `category_type` → **20**
- “Models associated with Asset Type” = models whose **existing** `category_id` points at an **asset** category → **366**
- “Assets automatically classified” = assets whose model’s category is **asset** → **1204**

That is a **would-be backfill forecast**, not proof that 033 already ran.

Live schema flags (2026-08-24, connected DB `itassetmanagement_2026`):

- `categories.parent_id` — **absent**
- `models.asset_type_id` — **absent**
- tables `asset_domains` / `asset_types` — **absent**

---

## 3. How 7 / 20 / 366 / 1204 actually fit together

### Category split (27 root rows, depth 0)

| `category_type` | Count | Wave 1.5 class | 033 action |
|---|---|---|---|
| `asset` | 7 | SAFE AUTOMATIC | Set `domain_id` to IT; insert one `asset_types` row named like the category; backfill models |
| `accessory` | 7 | REQUIRES REVIEW | **No SQL change** |
| `consumable` | 5 | REQUIRES REVIEW | **No SQL change** |
| `component` | 4 | REQUIRES REVIEW | **No SQL change** |
| `license` | 4 | REQUIRES REVIEW | **No SQL change** |

SAFE AUTOMATIC category names (hardware): Desktop, Laptop, Mobile, Monitor, Other, Printer, Tablet.

REQUIRES REVIEW names are inventory/license catalogs (Bag/Sleeve, Toner, RAM, Software, …). They are **not** hardware `models`/`assets` parents in this dataset.

### Models (366) — none on review categories

| Model’s category type | Count |
|---|---|
| `asset` | **366** |
| accessory / consumable / component / license | **0** |
| `category_id` NULL | **0** |

033 will set `models.asset_type_id` **only** when the model’s category is `asset`. The 20 review categories **cannot** affect these 366 rows.

Per safe category (models / assets):

| Category | Models | Assets |
|---|---|---|
| Laptop | 297 | 1057 |
| Mobile | 29 | 80 |
| Printer | 21 | 30 |
| Desktop | 15 | 30 |
| Monitor | 4 | 7 |
| Other | 0 | 0 |
| Tablet | 0 | 0 |
| **Total** | **366** | **1204** |

Other and Tablet still get an `asset_types` row (1:1 with the category). No model/asset rows are updated for them.

### Assets (1204)

Every live asset joins `model` → `category` with `category_type = 'asset'`.

033 does **not** UPDATE `assets`. Classification of assets after Wave 1 is **inherited**: `asset.model_id` → `models.asset_type_id`. If 033 succeeds, all 1204 assets become classified **through those 366 models**, not through the 20 review categories.

---

## 4. File-by-file review

### 030 — `asset_domains` + `asset_types`

**Inserts/updates**

- CREATE TABLE IF NOT EXISTS `asset_domains`, `asset_types`
- ADD FKs if missing: `asset_types.category_id` → `categories` ON DELETE SET NULL; `asset_types.asset_domain_id` → `asset_domains` ON DELETE SET NULL
- Seed **one** domain: name `IT`, code `it` (skipped if name or code already exists)

**Repeatable:** Yes (IF NOT EXISTS + FK guards + seed WHERE NOT EXISTS).

**Risks**

- Unique `uk_asset_domains_code` on nullable `code` — MySQL allows multiple NULLs; seed uses `'it'`.
- `SET FOREIGN_KEY_CHECKS=0` only for the session of this file.

### 031 — `categories.parent_id`, `categories.domain_id`

**Inserts/updates:** ALTER ADD nullable columns + indexes + FKs (`parent_id` self-FK SET NULL; `domain_id` → `asset_domains` SET NULL). Existing 27 categories stay valid with NULL parent/domain.

**Repeatable:** Yes (information_schema guards).

**Compatibility:** Current max depth is 0; adding nullable `parent_id` does not rewrite hierarchy.

**Depends on:** 030 (`asset_domains` must exist before `fk_categories_domain`).

### 032 — `models.asset_type_id`

**Inserts/updates:** nullable INT + index + FK to `asset_types` ON DELETE SET NULL.

**Repeatable:** Yes.

**Depends on:** 030 (`asset_types` table).

Existing 366 models remain valid with NULL until 033.

### 033 — safe backfill

**Updates (forecast)**

1. `categories.domain_id` → IT domain id, **only** `category_type = 'asset'` AND `domain_id IS NULL` → **7 rows**.
2. INSERT `asset_types` one per those 7 categories (`name` = category name, `category_id` = category id, `asset_domain_id` = that domain). Other/Tablet included even with 0 models.
3. UPDATE `models.asset_type_id` where NULL, category exists, and category is `asset` → **366 rows**.

**Does not**

- Touch accessory/consumable/component/license categories
- UPDATE `assets`
- Guess Admin/Facilities domains
- Nest categories

**Repeatable:** INSERT guarded by NOT EXISTS; UPDATE only `asset_type_id IS NULL`. Safe to re-run if `schema_migrations` did not skip it; if skipped by the runner, it will not re-execute.

**Depends on:** 030, 031, 032.

---

## 5. Foreign keys, indexes, existing data

| Object | Compatible? |
|---|---|
| Existing categories / models / assets rows | Yes — new columns nullable; no DELETE |
| `fk_*` ON DELETE SET NULL | Preferable to CASCADE; deleting a type/domain nulls FKs, does not delete models |
| Unique `(asset_types.name, category_id)` | Fine for 1:1 backfill |
| Live data orphans | None found: 0 models without category; 0 assets off non-asset categories |

---

## 6. Repeatability vs one-time

| Layer | Behavior |
|---|---|
| `npm run migrate` | Numbered files except `001` skipped if `schema_migrations.version` exists. **001 always re-executes** (existing runner quirk — CREATE IF NOT EXISTS, not Wave 1 specific). |
| SQL internals | Idempotent guards; 033 backfill is “fill NULLs / missing types”, not a wipe. |

Do **not** paste these files into a mysql session that might `USE ITAssetManagement_2026` after pointing at a clone.

**Wave 1.5 SQL change:** hardcoded `USE \`ITAssetManagement_2026\`` was **removed** from 030–033. The Node migrator already strips `USE`; the mysql CLI does **not**. Leaving `USE` in the files would make a staging session jump back to production.

---

## 7. Staging / backup / rollback (do this before production)

`mysqldump` and `mysql` were **not** on PATH in this Cursor environment, so a clone was **not** created here. Perform the following on a machine with the MySQL client:

```text
Production  ITAssetManagement_2026
     │
     ▼
mysqldump (schema + data)  →  backup file  (retain until Wave 1 is verified)
     │
     ▼
CREATE DATABASE ITAssetManagement_2026_wave15_test
     │
     ▼
Restore dump into that database
     │
     ▼
DB_NAME=ITAssetManagement_2026_wave15_test  npm run migrate
     (applies 030–033 only if 001–029 already in schema_migrations)
     │
     ▼
Validation queries (section 8)
     │
     ▼
npm test  &&  npm run test:wave1   (59 tests; they do not require the clone)
     │
     ▼
Approve production migrate
```

**Rollback (if production apply goes wrong)**

1. Prefer restore from the dump taken immediately before migrate (full DB).
2. Additive rollback without restore (only if no wanted data in new tables):
   - `ALTER TABLE models DROP FOREIGN KEY fk_models_asset_type, DROP COLUMN asset_type_id;`
   - `ALTER TABLE categories DROP FOREIGN KEY fk_categories_parent, DROP FOREIGN KEY fk_categories_domain, DROP COLUMN parent_id, DROP COLUMN domain_id;`
   - `DROP TABLE asset_types; DROP TABLE asset_domains;`
   - Delete `schema_migrations` rows `030_*` … `033_*`
3. Do not DROP production `categories` / `models` / `assets`.

---

## 8. Post-staging validation queries (expected)

```sql
SELECT COUNT(*) FROM asset_domains WHERE deleted_at IS NULL;           -- 1 (IT)
SELECT COUNT(*) FROM asset_types WHERE deleted_at IS NULL;             -- 7
SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL AND domain_id IS NOT NULL; -- 7
SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL AND parent_id IS NOT NULL; -- 0
SELECT COUNT(*) FROM models WHERE deleted_at IS NULL AND asset_type_id IS NOT NULL; -- 366
SELECT COUNT(*) FROM models WHERE deleted_at IS NULL AND asset_type_id IS NULL;     -- 0
-- assets inherit via model; should be 1204
SELECT COUNT(*) FROM assets a
  JOIN models m ON m.id = a.model_id
  WHERE a.deleted_at IS NULL AND m.asset_type_id IS NOT NULL;
```

---

## 9. Wave 2 readiness after this review

**NOT READY to implement Wave 2.**

**READY to stage Wave 1 migrations** once a `*_test` clone exists and the section 8 counts match.

Production apply is a **human-approved** step after that clone succeeds — not done in this pass.
