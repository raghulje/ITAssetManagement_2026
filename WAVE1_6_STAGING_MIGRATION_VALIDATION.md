# Wave 1.6 — Staging Migration Validation

# 1. Objective

Create a full clone of the live-like database into an approved test database, apply Wave 1 migrations **030–033 only on the clone**, validate schema/backfill/runtime/regression, and decide production migration readiness — **without modifying** `ITAssetManagement_2026`.

# 2. Database Safety Verification

| Field | Value |
|---|---|
| SOURCE DATABASE | `ITAssetManagement_2026` (`SELECT DATABASE()` → `itassetmanagement_2026`) |
| TARGET DATABASE | `ITAssetManagement_2026_test` (`SELECT DATABASE()` → `itassetmanagement_2026_test`) |
| SOURCE WRITTEN TO | **NO** |
| TARGET WRITTEN TO | **YES** (clone restore + 030–033 + disposable smoke records, cleaned up) |
| LIVE DATABASE PROTECTION STATUS | **HELD** — source still lacks `asset_domains`, `asset_types`, `categories.parent_id`, `categories.domain_id`, `models.asset_type_id` after the run |

Write guard: every SQL apply called `SELECT DATABASE()` and refused blocked exact names (`ITAssetManagement_2026`, `production`, `prod`, `live`).

# 3. Clone Method

**CLI** — MySQL Server 8.0 tools (found under `C:\Program Files\MySQL\MySQL Server 8.0\bin`, not previously on PATH):

1. `CREATE DATABASE ITAssetManagement_2026_test`
2. `mysqldump --single-transaction --routines --triggers` of source (read-only)
3. Pipe restore into target via `mysql.exe ITAssetManagement_2026_test`

Orchestrator: `server/scripts/wave16-staging.ts`  
Overwrite of existing test DB required explicit `WAVE16_CLONE_OVERWRITE=1`.

# 4. Clone Validation

| Check | Result |
|---|---|
| Clone size | ~5.0 MB dump |
| Categories | 27 = 27 |
| Models | 366 = 366 |
| Assets | 1204 = 1204 |
| Asset id range | min 9 / max 1212 both sides |
| Distinct asset tags | 1204 both sides |
| Pre-migration Wave 1 objects on clone | **absent** (matches source) |
| FULL OR PARTIAL | **FULL** |

# 5. Pre-Migration Baseline (clone)

- Total categories: **27** (root 27, nested 0, max depth 0)
- Asset categories: **7**
- Non-asset: accessory 7, consumable 5, component 4, license 4 (**20**)
- Models: **366** (all on asset categories)
- Assets: **1204** (0 without model)
- Schema: NO `asset_domains`, NO `asset_types`, NO `parent_id`/`domain_id`/`asset_type_id`

# 6. Migration File Review

| File | USE live? | DROP TABLE? | Unintended DELETE? | Notes |
|---|---|---|---|---|
| 030 | No (removed in Wave 1.5) | No | No | Creates domains/types + seeds IT |
| 031 | No | No | No | Nullable `parent_id`, `domain_id` |
| 032 | No | No | No | Nullable `models.asset_type_id` |
| 033 | No | No | No | Backfill only `category_type='asset'` |

Order: 030 → 031 → 032 → 033. FKs target existing tables after prior steps.

# 7. Migration Execution Log

| Migration | TARGET DATABASE | DATABASE() VERIFIED | STATUS | ERRORS |
|---|---|---|---|---|
| 030 | itassetmanagement_2026_test | yes | APPLIED | none |
| 031 | itassetmanagement_2026_test | yes | APPLIED | none |
| 032 | itassetmanagement_2026_test | yes | APPLIED | none |
| 033 | itassetmanagement_2026_test | yes | APPLIED | none |

# 8. Post-Migration Schema Validation

After 030: `asset_domains` + `asset_types` exist.  
After 031: `categories.parent_id`, `categories.domain_id` exist; 27 categories retained; nested = 0.  
After 032: `models.asset_type_id` exists, **IS_NULLABLE=YES**; 366 models retained; all NULL before backfill.  
After 033: backfill completed (section 9).

# 9. Backfill Validation

### Categories

| Metric | Expected | Actual |
|---|---|---|
| With `domain_id` | 7 | **7** |
| NULL `domain_id` | 20 | **20** |
| Nested | 0 | **0** |

### Asset Types

| Metric | Expected | Actual |
|---|---|---|
| Total | 7 | **7** |

Names (all domain **IT**): Desktop, Laptop, Mobile, Monitor, Other, Printer, Tablet — each linked to the same-named category.

### Models

| Metric | Expected | Actual |
|---|---|---|
| With `asset_type_id` | 366 | **366** |
| NULL | 0 | **0** |

### Assets

| Metric | Expected | Actual |
|---|---|---|
| Total preserved | 1204 | **1204** |
| Full chain Asset→Model→Type→Category→Domain | 1204 | **1204** |
| Unresolved | 0 | **0** |

No direct `assets.asset_type_id` column (correct).

# 10. Data Integrity Validation

Source vs target after migrations on **target only**:

- Asset / model / category counts unchanged.
- Asset id min/max unchanged (9 / 1212).
- Live source Wave 1 schema flags remain **false**.

# 11. Runtime Smoke Test

Script: `server/scripts/wave16-smoke.ts` with forced `DB_NAME=ITAssetManagement_2026_test`.

| Check | Result |
|---|---|
| App pool DATABASE() | `itassetmanagement_2026_test` |
| List domains / types / categories / models / hardware | 200 |
| Duplicate IT domain | 422 “Asset domain already exists” |
| Create disposable domain + subcategory | 201; cleaned up (soft delete) |
| Reject 3rd-level nest | 422 |
| Reject self-parent | 422 |
| Verdict | **PASS** |

# 12. Regression Results

| Suite | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Wave 0 (`npm test`) | 47 | 47 | 0 | 0 |
| Wave 1 (`npm run test:wave1`) | 12 | 12 | 0 | 0 |
| Combined | **59** | **59** | **0** | **0** |

# 13. Issues Discovered

1. `mysqldump`/`mysql` were not on PATH; resolved via MySQL Server 8.0 install path.
2. Soft-deleted smoke subcategory (`WAVE16_SMOKE_SUB`) may remain in the **test** DB only — harmless.
3. Production apply still requires a maintenance window + verified backup (documented, not executed).
4. Application default `.env` still points at live name — operators must set `DB_NAME=ITAssetManagement_2026_test` (see `server/.env.test`) when testing against the clone.

# 14. Production Migration Procedure

**DOCUMENT ONLY — DO NOT EXECUTE**

### PRE-PRODUCTION

1. Change window / stakeholder notice.
2. Full `mysqldump` of `ITAssetManagement_2026`; verify restore to a throwaway name.
3. Record baseline counts (27 / 366 / 1204).
4. Confirm app build matches Wave 1 code.
5. Confirm migration file checksums match the validated staging set.

### PRODUCTION EXECUTION

With `DB_NAME=ITAssetManagement_2026` (or current live name) and verified backup:

1. Apply 030 → validate tables `asset_domains`, `asset_types`, IT seed.
2. Apply 031 → validate nullable columns; category count 27; nested 0.
3. Apply 032 → validate nullable `models.asset_type_id`; model count 366.
4. Apply 033 → validate 7 types, 7 domains on asset cats, 366 model links, 1204 chain joins.

Prefer one-file apply with `SELECT DATABASE()` before each (same as staging), or `npm run migrate` only after confirming env points at live intentionally.

### POST-MIGRATION

1. Schema flags present.
2. Counts match staging expectations.
3. Smoke: domains/types/categories/models/hardware.
4. Regression 59 tests.
5. Monitor error logs.

# 15. Rollback Strategy

1. **Preferred:** restore the pre-migrate dump of production.
2. **Additive reverse (destroys new classification data):** drop FK/column `models.asset_type_id`; drop `categories.parent_id`/`domain_id`; `DROP TABLE asset_types`, `asset_domains`; remove `schema_migrations` 030–033 rows.
3. Do **not** DROP `categories` / `models` / `assets`.
4. Roll back application code **before** or **with** DB rollback if new APIs would error against old schema; after restore, old code works without Wave 1 tables.

# 16. Wave 1 Final Status

**SUCCESS**

# 17. Wave 2 Readiness

**NOT READY** — Wave 1 production migration has not been applied yet. Staging validation passed; apply production Wave 1 first, then authorize Wave 2.
