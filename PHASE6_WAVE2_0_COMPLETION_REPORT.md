# PHASE 6 — WAVE 2.0 COMPLETION REPORT

## Location & Physical Space Dependency Extraction

**Date:** 2026-08-24  
**Mode:** Read-only discovery and architecture analysis  
**Database inspected:** `ITAssetManagement_2026`

---

### 1. Completion summary

Wave 2.0 completed. Current `locations` architecture, hierarchy behavior, API/frontend/inventory/import/agent dependencies, live data counts, legacy backfill confidence, risks, required regression tests, and Wave 2 boundaries are documented. No Wave 2 implementation started.

### 2. Production code modified?

**NO**

(Transient read-only analysis scripts were used against the DB and removed; application source, migrations, env, and UI were not changed for Wave 2.)

### 3. Production database modified?

**NO** (SELECT / information_schema only)

### 4. Current location table summary

- Soft-deletable master with `parent_id` (self-FK SET NULL) and optional `company_id`
- Live columns include `external_code` (not in repo migrations — drift)
- No location type, legal_entity_id, or asset `site_id`
- Live: **187** locations, **all roots** (depth 0), **0** parents used

### 5. Total location dependencies discovered

Approximate dependency surfaces catalogued: **~35+** distinct read/write paths.

| Area | Count (approx.) |
|---|---|
| Backend (routes/utils/services) | ~15 |
| Frontend (pages/api) | ~8 |
| Database FKs / columns | ~10 tables/columns |
| Inventory | 3 modules + accessory checkout enum |
| Import / HRMS sync | 4+ |
| Agent / QR / Labels | QR display only; agent/labels none |
| Reporting | custom + dashboard filters |

### 6. Critical dependencies

- `assets.location_id` / `assets.rtd_location_id`
- Hardware list filter (`location_id OR rtd_location_id`)
- Checkout to location (overwrites `location_id`)
- Check-in restore via `rtd_location_id`
- Location CRUD + selectlist
- Import resolve-by-global-name
- Inventory `location_id` on accessories/consumables/components

### 7. Current location hierarchy behavior

Parent allowed in schema/API; **unused in data**. No cycle/depth validation. Soft delete without usage guards. Frontend location form does **not** expose `parent_id`.

### 8. location_id semantics

Operational / current physical placement. Set on create (often from RTD), overwritten on checkout-to-location, restored on check-in. **Not** cleared on employee checkout. Can coexist with `assigned_type=employee` (354 live assets).

### 9. rtd_location_id semantics

Ready-to-deploy / home / default return location. Preferred check-in target. Frontend dual-writes with `location_id`. Live: equals `location_id` for 1203 assets.

### 10. Existing location data summary

| Metric | Value |
|---|---|
| Live locations | 187 |
| With parent | 0 |
| Used by assets | 1 location → 1203 assets |
| Unused | 185 |
| Missing company_id | 186 |
| Duplicate names | 0 |
| assigned_type=location | 0 |

### 11. High-confidence classification count

**12** (name-keyword signals for site/building-like)

### 12. Medium-confidence classification count

**40** (plausible Site/office labels without safe subtype)

### 13. Low-confidence / UNSPECIFIED count

**135** (default I3 UNSPECIFIED candidates)

### 14. Critical Wave 2 risks

- Exact-only filters (no Site→descendant asset views)
- Global name uniqueness vs future tree uniqueness
- Soft-delete leaving assets on soft-deleted locations
- Untyped flat dropdowns if leaf-only rules appear
- Nearly unused `company_id` before Company→Site enforcement

### 15. Required regression tests before implementation

Seventeen named contracts in `WAVE2_0_LOCATION_DEPENDENCY_EXTRACTION.md` §18 (CRUD, soft-delete FK behavior, list OR filter, create/checkout/checkin/replace, COALESCE, inventory, import, selectlist company, QR, enum).

### 16. Wave 2 blockers

1. Location regression pack not yet added  
2. Descendant-filter product decision  
3. Company tenancy policy for locations  
4. Import uniqueness strategy for trees  
5. `external_code` schema drift reconciliation  
6. Frontend parent/type UX plan  

### 17. Wave 2 readiness

**READY WITH KNOWN GAPS**

### 18. Documentation paths

- `WAVE2_0_LOCATION_DEPENDENCY_EXTRACTION.md`
- `PHASE6_WAVE2_0_COMPLETION_REPORT.md`
