# Wave 2.2 — Typed Location Hierarchy Foundation

**Mode:** Additive schema + backend validation + staging-first apply.  
**Production database:** not modified.  
**Staging database:** `ITAssetManagement_2026_test` migrated and validated.

---

# 1. Executive Summary

Wave 2.2 introduces typed physical locations on the existing `locations` table:

- Masters: `location_types` (7) and `space_subtypes` (6)
- Additive columns: `location_type_id`, `space_subtype_id`
- Guarded `external_code` reconciliation
- Conservative backfill: **all** existing locations → **UNSPECIFIED** (0 aggressive auto-types)
- Backend hierarchy validation for **new/typed** writes; UNSPECIFIED remains soft-compatible
- Location APIs extended additively; checkout/check-in/import/filter defaults unchanged
- Staging validation **PASS**; production schema unchanged

---

# 2. Scope

**In scope:** migrations 034–036, `locationFoundation` validation, locations CRUD extensions, regression tests, staging apply.

**Out of scope:** frontend tree UI, descendant filtering, import uniqueness, company tenancy, `assets.site_id`, production migrate, checkout/check-in changes.

---

# 3. Current State Before Migration

| Item | Production | Staging (before) |
|---|---|---|
| Database | `ITAssetManagement_2026` | `ITAssetManagement_2026_test` |
| Live locations | 187 | 187 |
| Soft-deleted | 7 | 7 |
| Assets | 1204 | 1204 |
| `external_code` | present | present |
| `location_types` | absent | absent |
| Regression baseline | 76 pass | — |

---

# 4. Schema Changes

## location_types

Lookup: id, name, code (unique), description, hierarchy_level, is_space, is_active, created_at, updated_at.

Seeded codes: UNSPECIFIED, SITE, BUILDING, FLOOR, ZONE, DEPARTMENT_AREA, SPACE.

## space_subtypes

Seeded: CABIN, MEETING_ROOM, SERVER_ROOM, STORE_ROOM, WORKSTATION, OTHER.

## locations

Additive nullable FKs:

- `location_type_id` → `location_types` (ON DELETE RESTRICT)
- `space_subtype_id` → `space_subtypes` (ON DELETE SET NULL)

Existing columns (`parent_id`, `company_id`, `external_code`, …) unchanged.

## external_code reconciliation

Migration 035 adds `external_code VARCHAR(100) NULL` **only if missing**. Staging already had the column; migration was a no-op for that column.

---

# 5. Hierarchy Rules

| Child | Allowed parents |
|---|---|
| SITE | root (null) or UNSPECIFIED (legacy) |
| BUILDING | SITE |
| FLOOR | BUILDING |
| ZONE | FLOOR |
| DEPARTMENT_AREA | FLOOR |
| SPACE | FLOOR, ZONE, DEPARTMENT_AREA |
| UNSPECIFIED | no strict matrix (legacy) |

SPACE may not have physical children. Self-parent and cycles rejected.

---

# 6. Backend Validation

Service: `server/src/services/locationFoundation.ts`  
Wired in locations POST/PUT when typed schema is present (`users.ts`).

- `space_subtype_id` only when type = SPACE (**subtype optional** for SPACE)
- Non-SPACE rejects subtype
- Typed parent matrix enforced for non-UNSPECIFIED
- If `location_types` table missing (production pre-migrate), validation/type fields are skipped safely

---

# 7. Legacy Compatibility

- Default `GET /hardware?location_id=` still exact OR on location/rtd
- Create: `location_id \|\| rtd_location_id`
- Checkout/check-in/replace unchanged
- Imports unchanged (global name)
- Inventory exact `location_id` unchanged
- Selectlist shape unchanged (`id`, `text`)
- Old location bodies without type fields remain valid; create defaults to UNSPECIFIED when typed schema exists

---

# 8. Backfill Strategy

**Automatically typed (SITE/BUILDING/…): 0**  
Wave 2.0 high/medium name heuristics were **not** applied (insufficient deterministic ID-level evidence).

**UNSPECIFIED:** all live locations (187) + any previously null rows including soft-deleted.

No location IDs, parent_ids, names, or asset/inventory FKs changed.

---

# 9. Staging Migration Process

1. Confirmed `SELECT DATABASE()` = staging test DB  
2. Applied via `server/scripts/wave22-staging.ts` (fail-closed against production)  
3. Applied: 034, 035, 036  
4. Integrity checks: locations, assets, inventory location sums unchanged  

Command: `npm run test:wave22:staging`

---

# 10. Expected vs Actual Validation

| Metric | Expected | Actual (staging) |
|---|---|---|
| Location types | 7 | 7 |
| Space subtypes | 6 | 6 |
| Live locations | 187 | 187 |
| Soft-deleted | 7 | 7 |
| Automatically typed | 0 | 0 |
| UNSPECIFIED (live) | 187 | 187 |
| Untyped live | 0 | 0 |
| external_code column | present | present |

---

# 11. Asset Integrity Validation

| Metric | Before | After |
|---|---|---|
| Assets | 1204 | 1204 |
| SUM(location_id) | 10827 | 10827 |
| SUM(rtd_location_id) | 10827 | 10827 |

**PASS**

---

# 12. Inventory Integrity Validation

| Module | Count | SUM(location_id) |
|---|---|---|
| Consumables | 15 / 15 | 135 / 135 |
| Accessories | 15 / 15 | 135 / 135 |
| Components | 15 / 15 | 135 / 135 |

**PASS**

---

# 13. Regression Tests

| Suite | Count | Result |
|---|---|---|
| Wave 0 | 47 | PASS |
| Wave 1 | 12 | PASS |
| Wave 2.1 + 2.2 | 41 (17 + 24) | PASS |
| **Total** | **100** | **100 pass / 0 fail / 0 skip** |

Before Wave 2.2: 76. After: 100.

---

# 14. Known Gaps

- Production not yet migrated (intentional)
- No high-confidence SITE/BUILDING auto-classification (all UNSPECIFIED)
- Frontend still flat (no type/parent UI)
- Descendant filters not implemented
- Soft-deleted rows also backfilled to UNSPECIFIED (safe; same UPDATE)

---

# 15. Deferred Work

- Production apply (Wave 2.3 / dedicated prod wave)
- Frontend hierarchy UI
- Descendant filtering (`include_descendants`)
- Import uniqueness / location_code
- Company tenancy
- `assets.site_id`
- Optional reviewed reclassification of UNSPECIFIED → SITE/…

---

# 16. Production Migration Readiness

**READY WITH KNOWN GAPS**

Migrations and staging validation are ready. Production apply requires an explicit confirmed production wave (same pattern as Wave 1.7). Do not run `npm run migrate` against live `.env` until authorized.
