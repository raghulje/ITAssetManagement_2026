# Wave 2.1 — Location Regression and Implementation Readiness

**Mode:** Regression protection + design decisions. No location types, hierarchy implementation, import changes, or schema ALTER.

---

# 1. Executive Summary

Wave 2.1 locks **current** location contracts with 17 automated tests (Node test runner, same harness as Wave 0/1). Live `locations.external_code` drift is documented: present in production **and** staging, absent from repository migrations, unused by application code. Descendant filtering, import uniqueness, company tenancy, and frontend hierarchy work are **designed, not implemented**.

Runtime ITAM behavior is unchanged.

**Wave 2.1 status:** SUCCESS  
**Wave 2.2 readiness:** READY WITH KNOWN GAPS

---

# 2. Scope

**In scope**

- Location regression test pack
- Schema drift investigation (read-only)
- API design for future descendant filters
- Import uniqueness transition design
- Company/location tenancy recommendation
- Frontend Wave 2.2 plan

**Out of scope**

- Location types / UNSPECIFIED / Site–Space
- `assets.site_id`
- Import algorithm changes
- Frontend tree UI
- Production schema or data changes

---

# 3. Existing Test Harness Analysis

| Item | Current |
|---|---|
| Framework | Node.js `node:test` + `node:assert/strict` via `tsx` |
| Runners | `server/scripts/run-wave0-tests.mjs`, `run-wave1-tests.mjs` |
| Strategy | Source-backed contracts (`readServerSource`) + pure helpers; HTTP tests without DB (`http-public-contract`) |
| DB | Default suites **do not** open MySQL; live flags fail closed vs production |
| Wave 0 | `server/test/wave0/**/*.test.ts` — 47 tests (identity, custody, inventory, locations, imports, auth) |
| Wave 1 | `server/test/wave1/classification-foundation.test.ts` — 12 tests |

Wave 2.1 **reuses** this pattern. No second framework.

---

# 4. Regression Tests Added

Suite: `server/test/wave2/location-contracts.test.ts`  
Runner: `server/scripts/run-wave2-tests.mjs` (`npm run test:wave2`)

| Test name | Current contract protected | Implementation location | Result |
|---|---|---|---|
| locations_crud_allowed_fields | CRUD fields: name, parent_id, company_id, address, city, state, country, zip, notes | TEST 1 | PASS |
| locations_parent_id_current_behavior | parent_id accepted/optional; no depth/cycle validation | TEST 2 | PASS |
| locations_soft_delete_keeps_asset_fk | Soft delete sets `deleted_at` only; assets FKs unchanged | TEST 3 | PASS |
| asset_list_location_or_rtd | Filter is OR, not AND | TEST 4 | PASS |
| asset_create_copies_rtd_to_location | `location_id \|\| rtd_location_id \|\| null` | TEST 5 | PASS |
| checkout_location_overwrites_location_id | `assigned_type=location` overwrites placement | TEST 6 | PASS |
| checkout_employee_preserves_location_id | employee/user/asset checkout leaves location_id | TEST 7 | PASS |
| checkin_prefers_rtd_then_location | body → rtd → location | TEST 8 | PASS |
| replace_uses_rtd_location | replace uses old rtd then location | TEST 9 | PASS |
| coalesce_display_location | COALESCE(location_id, rtd_location_id) | TEST 10 | PASS |
| consumable_filter_location_id | Exact `location_id` on catalog | TEST 11 | PASS |
| accessory_component_location_crud | location_id on inventory create/update | TEST 12 | PASS |
| import_location_by_global_name | `WHERE name = ? LIMIT 1` | TEST 13 | PASS |
| import_asset_sets_location_and_rtd | Import sets both columns to resolved id | TEST 14 | PASS |
| locations_selectlist_optional_companyId | companyId optional filter only | TEST 15 | PASS |
| public_qr_shows_location_name | location_name \|\| rtd_location_name | TEST 16 | PASS |
| assigned_type_location_enum | ENUM includes `location`; checkout accepts it | TEST 17 | PASS |

---

# 5. Regression Test Results

| Suite | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| Wave 0 (`npm test`) | 47 | 47 | 0 | 0 |
| Wave 1 (`npm run test:wave1`) | 12 | 12 | 0 | 0 |
| Wave 2.1 (`npm run test:wave2`) | 17 | 17 | 0 | 0 |
| Combined (`npm run test:regression:all`) | **76** | **76** | **0** | **0** |

`test:regression:all` now uses `scripts/run-regression-all.mjs` so Windows npm does not treat `;` as part of the filename.

---

# 6. Location Schema Drift Analysis

## external_code

Live column: `locations.external_code` `varchar(100)` NULL, no default, no index.

## Repository State

- **Not** in `server/src/db/mysql/*.sql` (including `001_schema.sql`)
- **Not** referenced in backend TypeScript (`server/src`)
- **Not** referenced in frontend
- **Not** in imports (`importEngine.ts`) or HRMS sync (`hrmsMastersSync.ts`)
- Present in root dump `db.sql` on `locations`, and also on `companies`, `legal_entities`, `business_lines`
- Git `-S external_code` on app SQL/TS did not show a dedicated migration commit
- Populated rows: **0** (Wave 2.0)

**Conclusion:** Dead / unmanaged column. Likely introduced via dump restore or manual ALTER aligned with org-master `external_code` pattern, never wired into CRUD `allowedFields`.

## Database Comparison

Read-only `information_schema` compare of `locations`:

| | ITAssetManagement_2026 | ITAssetManagement_2026_test |
|---|---|---|
| `external_code` present | YES | YES |
| Type | varchar(100) NULL | varchar(100) NULL |
| Column set difference | none | none |

Prod and staging **match**. Drift is **repo vs live**, not prod vs test.

## Recommendation

**OPTION A** — Create a later reconciliation migration that **adds** `external_code VARCHAR(100) NULL` if missing (`IF NOT EXISTS` / information_schema guard) so canonical migrations match live DBs.

Do **not** drop the column. Do **not** treat it as the import key until Wave 2 import design lands (see §8). Do **not** apply that migration in Wave 2.1.

---

# 7. Descendant Filtering Design

## Current Behavior

`GET /hardware?location_id=` matches `a.location_id = ? OR a.rtd_location_id = ?` only. Inventory uses exact `location_id`. No CTE, no subtree.

## Options Considered

| Option | Shape | Pros | Cons |
|---|---|---|---|
| A | `location_id` + `include_descendants=true` | Additive; default exact; reuse same param | Boolean can be mis-set |
| B | `location_scope=exact\|subtree` | Explicit enum | Extra param to remember |
| C | `site_id` / dedicated endpoint | Hierarchy-specific | Conflicts with deferred I6; new parallel filter |

## Recommended API Contract

**OPTION A** (safest for backward compatibility).

- Default / omitted `include_descendants`: **exact current OR filter** (assets) or exact catalog `location_id` (inventory).
- `include_descendants=true` (or `1`): expand `location_id` to self + descendants, then apply the **same** existing predicate (assets: location OR rtd in that id set).
- Invalid/unknown flag values treated as exact (fail-safe).
- Same query params on hardware, consumables, accessories, components, reports.

## Future Query Strategy

Shared helper (e.g. `locationDescendantIds(rootId)`):

```sql
WITH RECURSIVE loc_tree AS (
  SELECT id FROM locations WHERE id = ? AND deleted_at IS NULL
  UNION ALL
  SELECT l.id FROM locations l
  INNER JOIN loc_tree t ON l.parent_id = t.id
  WHERE l.deleted_at IS NULL
)
SELECT id FROM loc_tree
```

MySQL 8 / MariaDB 10.2+ recursive CTE. Cap depth in application later when types exist. Soft-deleted nodes excluded.

## Backward Compatibility

Existing clients omit the flag → **identical result sets**. No silent expansion.

---

# 8. Import Uniqueness Transition

## Current Behavior

`findOrCreateByName`: `SELECT id FROM locations WHERE name = ? AND deleted_at IS NULL LIMIT 1`. Location import same. Names globally unique in live data (0 duplicate groups).

## Risks

Duplicate names under different parents will make `LIMIT 1` pick an arbitrary row. CSV files today send a single `location` name column.

## Recommended Strategy

**OPTION D** (stable code/path later) **plus** **OPTION B** uniqueness `(parent_id, name)` when hierarchy is introduced — **not** OPTION C (`external_code`) as canonical import key (column is unused/dead).

Keep **OPTION A** (global unique names) as the **compatibility** path until parent-aware CSVs exist.

## Transition Phases

| Phase | Behavior |
|---|---|
| **1 — Current compatibility** | Unchanged global-name match/create. Existing CSVs keep working. |
| **2 — Hierarchy-safe identifier** | Additive optional `location_code` (or path) column on locations + optional CSV column. Resolve **code first** if present. |
| **3 — Parent-aware resolution** | If `parent` / `parent_code` provided, match `(parent_id, name)`. Unique index `(parent_id, name)` where `deleted_at IS NULL` (nullable parent treated as a distinct group). |
| **4 — Deprecate ambiguous global-name** | If global name matches **more than one** live row, fail the row with a clear error (do not `LIMIT 1`). Single match still succeeds for legacy files. |

Do not change imports in Wave 2.1.

---

# 9. Company / Location Scope Analysis

## Current State

- `company_id` optional; 186/187 NULL
- Selectlist `companyId` is optional SQL filter
- No backend check that asset.company matches location.company

## Options

1. Require company_id immediately — **breaks** existing masters  
2. Keep NULL locations globally visible — **current**  
3. Backfill company where known — **low confidence** (one used location, HRMS names)  
4. Gradual validation — I3-compatible

## Recommendation

**OPTION 2 now, OPTION 4 later** (I3). Keep NULL locations globally visible. Do not require company_id in Wave 2.2 create for legacy. Optional later: warn on mismatch; then tighten new locations only. Backfill (OPTION 3) only with an explicit mapping exercise, not guesswork.

---

# 10. Future Frontend Plan

## Location Management (`MasterData.tsx`)

Today: flat list/form; name, company, address, notes; **no parent picker**.

Wave 2.2+ needs: tree or indented list; type/subtype badges; parent select filtered by allowed types; breadcrumb; UNSPECIFIED badge; soft-delete remains; do not hide legacy rows.

## Asset Forms (`AssetForm.tsx`)

Today: one RTD picker dual-writes `rtd_location_id` and `location_id`.

Compatibility mode: **all locations remain selectable** (including UNSPECIFIED). Later: prefer Space/Workstation leaves; still allow legacy. Label remains “location” until types exist.

## Asset Filters (`AssetsList.tsx`)

Today: exact `location_id` query. Future: exact default; optional “Include sub-locations” → `include_descendants=true`.

## Inventory (`QtyModules.tsx`) / Checkout (`AssetCheckout.tsx`)

Same flat selectlist. Later: optional subtree filter on lists; checkout target remains a **single** location id (exact placement).

---

# 11. Wave 2.2 Prerequisites

1. Apply OPTION A `external_code` reconciliation migration (additive, guarded).  
2. Additive location type/subtype + UNSPECIFIED backfill (I3).  
3. Keep exact filters default; optional descendant flag.  
4. Do not implement `site_id`.  
5. Do not change import matching until Phase 2 identifier exists.  
6. Keep Wave 2.1 tests green; extend them when new fields are additive.

---

# 12. Risks

| Risk | Mitigation |
|---|---|
| Wave 2 types break CRUD allowedFields | TEST 1 must be updated **with** the additive field, not removed |
| Silent subtree filters | Default exact (OPTION A) |
| Duplicate names after tree | Import phases 3–4 |
| Soft-deleted parents in CTE | Filter `deleted_at IS NULL` |
| Company required too early | Tenancy OPTION 2/4 |

---

# 13. Deferred Items

- Location types / subtypes / UNSPECIFIED (Wave 2.2+)
- `assets.site_id` (I6)
- Import algorithm change
- Company tenancy enforcement
- Frontend tree UI
- Cycle/depth validation
- Dropping `external_code`

---

# 14. Wave 2.1 Status

**SUCCESS**

---

# 15. Wave 2.2 Readiness

**READY WITH KNOWN GAPS**

Gaps: types not designed in SQL yet; `external_code` reconciliation not applied; import still global-name; frontend still flat. Regression and design decisions are sufficient to start Wave 2.2 additive schema work.
