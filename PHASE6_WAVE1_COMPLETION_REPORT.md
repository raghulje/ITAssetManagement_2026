# Phase 6 — Wave 1 Completion Report

## 1. Executive Summary
Wave 1 (“Classification Foundation”) was implemented additively to safely introduce the target Enterprise Asset Management classification chain:

Asset Domain → Category → Optional Subcategory → Asset Type → Model

Key outcomes:
- Added new global masters: `asset_domains` and `asset_types`.
- Extended `categories` with `parent_id` (max depth 1 enforced in backend) and optional `domain_id`.
- Extended `models` with nullable `asset_type_id` (optional association; existing models continue functioning).
- Implemented backend validations for asset-domain creation, category parent-depth/cycle, and model asset-type association.
- Updated frontend forms to optionally capture `parent_id`, `domain_id`, and `asset_type_id`.

Note: SQL migration files were created, but migrations were NOT applied because `server/.env` points to a non-`test` DB (`DB_NAME=ITAssetManagement_2026`) and the environment could not be confirmed as non-production.

## 2. Wave 0 Baseline Result
Wave 0 regression suite: `47 passed / 0 failed / 0 skipped`.

## 3. Classification Architecture Implemented
The implemented relationship chain is backed by the following data model:

1. `asset_domains` (global master)
   - Rows represent global asset domains (e.g. ITAM “IT” domain seeded by migration).

2. `categories` (existing master, extended)
   - `categories.parent_id` enables optional subcategory (backend validation enforces max 1 level).
   - `categories.domain_id` associates a category (root or subcategory) to an `asset_domain` (nullable for backward compatibility).

3. `asset_types` (new global master)
   - `asset_types.category_id` points to a leaf category node (category or optional subcategory).
   - `asset_types.asset_domain_id` is nullable and supports domain-aware filtering.

4. `models` (existing master, extended)
   - `models.asset_type_id` is nullable and points to `asset_types`.
   - Existing models remain valid with `asset_type_id = NULL`.

Max category depth behavior (Wave 1 target):
- Allowed: `Category → Subcategory` (parent depth = 0 → 1)
- Not allowed: deeper nesting (backend rejects when `parent.parent_id` is non-NULL)

## 4. Schema Changes

TABLE: `asset_domains`
- CHANGE: Added new table (global domain master).
- ADDITIVE: Yes (new table only).
- BACKWARD COMPATIBLE: Yes (no changes to existing tables required).
- ROLLBACK: Remove the table (`DROP TABLE asset_domains`) if/only if migrations were applied.

TABLE: `asset_types`
- CHANGE: Added new table (global asset type master).
- ADDITIVE: Yes (new table only).
- BACKWARD COMPATIBLE: Yes (no existing tables depend on it until `models.asset_type_id` is used).
- ROLLBACK: Remove the table (`DROP TABLE asset_types`) if/only if migrations were applied.

TABLE: `categories`
- CHANGE: Added nullable columns `parent_id` and `domain_id`, plus indexes and FKs.
- ADDITIVE: Yes (columns are nullable).
- BACKWARD COMPATIBLE: Yes (legacy categories remain valid with `NULL` parent/domain).
- ROLLBACK: Remove added columns + constraints if/only if migrations were applied.

TABLE: `models`
- CHANGE: Added nullable column `asset_type_id` with index and FK.
- ADDITIVE: Yes (nullable column only).
- BACKWARD COMPATIBLE: Yes (legacy models remain valid with `NULL`).
- ROLLBACK: Remove the column + constraint if/only if migrations were applied.

## 5. Migration Details
Migration files (additive, ordered):
1. `server/src/db/mysql/030_classification_asset_domains_and_types.sql`
2. `server/src/db/mysql/031_classification_categories_parent_domain.sql`
3. `server/src/db/mysql/032_classification_models_asset_type_id.sql`
4. `server/src/db/mysql/033_classification_safe_backfill.sql`

Dependencies:
- `030` must run before `031`/`033` (creates `asset_domains` + `asset_types`).
- `031` must run before category validation features are useful (creates `categories.parent_id`/`categories.domain_id`).
- `032` must run before backfill and model association become available (`models.asset_type_id`).
- `033` runs after `030`/`031`/`032`.

Applied to which environment:
- Not applied (migration staging only).
- Safety note: `server/.env` uses `DB_NAME=ITAssetManagement_2026` (not `*_test`), so production impact could not be ruled out.

## 6. Backend Changes
Files:
- `server/src/routes/users.ts`
  - Replaced `/categories` CRUD wiring with a custom router to enforce Wave 1 validations:
    - Validates `categories.parent_id` depth and cycle safety using `validateCategoryParenting`.
    - Adds `parent_id` + `domain_id` to allowed fields (nullable; optional until data completeness is ready).
  - Extended `/models` master create/update:
    - Supports nullable `asset_type_id`.
    - Validates `asset_type_id` existence via `validateModelAssetTypeAssociation`.
  - Added new master endpoints:
    - `/asset-domains` + `/asset-domains/selectlist`
    - `/asset-types` + `/asset-types/selectlist`
    - Includes basic input validation + duplicate handling for domains.

- `server/src/services/classificationFoundation.ts`
  - Added shared helper logic:
    - `validateAssetDomainCreateInput`
    - `assertAssetDomainNotDuplicate`
    - `validateCategoryParenting`
    - `validateModelAssetTypeAssociation`

Validation behavior (Wave 1):
- Asset Domain: validates non-empty name, optional code format, rejects duplicates.
- Category:
  - Self-parent rejected
  - Cycles rejected (via helper check on parent’s parent)
  - Max depth enforced (rejects when parentParentId is non-NULL)
- Model → Asset Type:
  - `models.asset_type_id` is nullable
  - If provided, it must refer to an existing `asset_types` row

## 7. Frontend Changes
Files:
- `client/src/pages/settings/MasterData.tsx`
  - Category form:
    - Added optional `domain_id` dropdown (`asset-domains`).
    - Added optional `parent_id` dropdown (root categories).
    - Backend-safe payload omission when fields are blank.
  - Model form:
    - Added optional `Asset Type` dropdown sourced from `/asset-types/selectlist` filtered by `category_id`.
    - Syncs `category_id` when an asset type is chosen.

- `client/src/api/client.ts`
  - Added `mastersApi.assetDomains` and `mastersApi.assetTypeMasters` (plus CRUD helpers) for dropdowns and master screens.

## 8. Backward Compatibility
Existing systems continue functioning because:
- `models.asset_type_id` is nullable and treated as optional.
  - Existing models/assets load without requiring classification fields.
- `categories.parent_id` and `categories.domain_id` are nullable.
  - Legacy categories remain valid with `NULL` parent/domain.
- Existing response envelopes remain unchanged:
  - The system continues using `okList`, `okItem`, `okMessage`, and `fail` for error formatting.

Known transitional constraint:
- Frontend dropdowns for asset domains/types will be empty until DB migrations are applied (endpoints still exist in code, but tables are not present until migration).

## 9. Data Backfill Results
Backfill status:
- Migration `033_classification_safe_backfill.sql` was created, but not applied.

Backfill safety analysis (counts derived from current DB using existing ITAM semantics `categories.category_type='asset'`):
- SAFE AUTOMATIC
  - Categories safely mapped: 7
  - Models successfully associated with Asset Type: 366
  - Assets automatically classified: 1204
- REQUIRES REVIEW
  - Categories requiring review: 20
  - Assets requiring review: 0 (based on current dataset’s model/category coverage)
- AMBIGUOUS
  - Categories with ambiguous mapping: 0

No ambiguous mapping was auto-applied in code or migration logic.

## 10. Test Results
Wave 0 regression suite:
- Total: 47
- Passed: 47
- Failed: 0
- Skipped: 0

Wave 1 classification foundation tests:
- Total: 12
- Passed: 12
- Failed: 0
- Skipped: 0

Full regression (Wave 0 + Wave 1, harness level):
- Total: 59
- Passed: 59
- Failed: 0
- Skipped: 0

## 11. Possible Issues Discovered
- DB migrations were intentionally NOT executed due to `DB_NAME` not being `*_test`, so runtime behavior requiring new tables/columns is pending migration application.
- `asset_type_id` is validated only when provided by the client. Blank/omitted values remain compatible.
- Category parent-depth enforcement assumes existing legacy data does not already exceed depth constraints; it rejects new updates that would exceed the target depth.
- Domain/category alignment for asset-types is currently transitional (domain fields are nullable; strict cross-field enforcement can be tightened later in Wave 2+).

## 12. Files Added
- `server/src/services/classificationFoundation.ts`
- `server/scripts/run-wave1-tests.mjs`
- `server/scripts/wave1_counts.ts`
- `server/test/wave1/classification-foundation.test.ts`
- `server/src/db/mysql/030_classification_asset_domains_and_types.sql`
- `server/src/db/mysql/031_classification_categories_parent_domain.sql`
- `server/src/db/mysql/032_classification_models_asset_type_id.sql`
- `server/src/db/mysql/033_classification_safe_backfill.sql`

## 13. Files Modified
- `server/src/routes/users.ts`
  - WHY MODIFIED: Implemented Wave 1 classification masters routes, replaced categories CRUD to enforce parent-depth validation, and extended models to support nullable `asset_type_id`.
  - BEHAVIORAL IMPACT: Adds new optional fields + validations; does not change existing category/model fields’ meaning.

- `client/src/pages/settings/MasterData.tsx`
  - WHY MODIFIED: Adds optional UI inputs for `domain_id`, `parent_id`, and `asset_type_id` without forcing classification on existing records.
  - BEHAVIORAL IMPACT: Existing pages still render; new dropdowns are empty until migrations exist.

- `client/src/api/client.ts`
  - WHY MODIFIED: Adds API client bindings for new asset domain/type master endpoints.
  - BEHAVIORAL IMPACT: Does not affect existing `mastersApi.assetTypes()` (legacy category-based “Hardware asset types” selection).

- `server/package.json`
  - WHY MODIFIED: Adds `test:wave1` and `test:regression:all` scripts for Wave 1 test execution.
  - BEHAVIORAL IMPACT: No change to Wave 0 test command.

## 14. Rollback Strategy
Because Wave 1 migration is additive and runtime code changes are optional:
- Code rollback:
  - Revert `server/src/routes/users.ts`, remove new frontend dropdown wiring, and remove new masters API client calls.
  - Existing assets/categories/models remain usable because original fields are unchanged.
- DB rollback (if/only if migrations were applied):
  - Remove `models.asset_type_id`, `categories.parent_id`, `categories.domain_id`.
  - Drop `asset_types` and `asset_domains` tables.
  - This is destructive and should be coordinated with data retention requirements.

## 15. Wave 2 Readiness
READY WITH KNOWN GAPS
- Code + validations for classification foundation are present.
- DB migrations were not applied yet, so runtime/master data behavior is pending migration execution.

