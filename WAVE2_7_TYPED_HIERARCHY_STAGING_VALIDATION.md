# WAVE 2.7 — Typed Hierarchy Staging Validation

# 1. Executive Summary

Wave 2.7 created a clearly labelled **NON-PRODUCTION** typed physical hierarchy in staging database `ITAssetManagement_2026_test` and validated Wave 2.6 hierarchy services against that data. Production `ITAssetManagement_2026` was not written. Legacy 187 UNSPECIFIED locations were not modified. Asset and inventory placement FKs were unchanged. No application defect requiring a production code fix was found.

# 2. Objective

Safely create NEW typed physical hierarchy records on staging and prove tree / path / children / validate-parent / move / archive / restore contracts work against realistic nested data — without legacy migration, Facility UI, or placement rewrites.

# 3. Database Safety

| Role | Database | Modified? |
|---|---|---|
| Production | `ITAssetManagement_2026` (`SELECT DATABASE()` → `itassetmanagement_2026`) | **NO** (read-only preflight + recheck) |
| Staging | `ITAssetManagement_2026_test` (`SELECT DATABASE()` → `itassetmanagement_2026_test`) | **YES** (sample hierarchy only) |

Safety controls in `server/scripts/wave27-staging-validate.ts`:

- Refuses target if name equals production or lacks `test|staging|sandbox`
- Verifies `SELECT DATABASE()` before every write path
- No hardcoded `USE` that switches databases
- Sample rows tagged `external_code LIKE 'WAVE27_%'` and names prefixed `FACILITY TEST`

# 4. Baseline Before Changes

## Production (read-only)

| Metric | Value |
|---|---|
| Live locations | 187 |
| UNSPECIFIED live | 187 |
| Typed physical live | 0 |
| Assets live | 1204 |
| `SUM(location_id)` | 10827 |
| `SUM(rtd_location_id)` | 10827 |
| Consumables / accessories / components | 15 / 15 / 15 |

## Staging (before insert)

| Metric | Value |
|---|---|
| Live locations | 187 |
| UNSPECIFIED live | 187 |
| Typed physical live | 0 |
| `parent_id` non-null | 0 |
| Assets live | 1204 |
| Asset id / tag / location / rtd checksums | recorded (unchanged after) |
| Inventory location sums | cons/acc/comp = 135 each |

## Masters (both DBs)

Location types: UNSPECIFIED(1), SITE(2), BUILDING(3), FLOOR(4), ZONE(5), DEPARTMENT_AREA(6), SPACE(7)

Space subtypes: CABIN(1), MEETING_ROOM(2), SERVER_ROOM(3), STORE_ROOM(4), WORKSTATION(5), OTHER(6)

# 5. Hierarchy Creation Plan

No approved real facility hierarchy source was available. Therefore staging received an obviously non-production sample:

- Names: `FACILITY TEST …`
- External codes: `WAVE27_*`
- Notes: `Wave 2.7 NON-PRODUCTION sample`
- SITE `company_id` set to first live company in staging (id=4) for company-filter exercise; descendants leave `company_id` NULL (ancestry resolution)

Creation used `assertLocationHierarchy` before each insert (domain validation), then Wave 2.6 service APIs for post-insert validation.

# 6. Staging Hierarchy Created

```
FACILITY TEST SITE (SITE)
└── FACILITY TEST BUILDING A (BUILDING)
    ├── FACILITY TEST Floor 01 (FLOOR)
    │   ├── FACILITY TEST North Zone (ZONE)
    │   │   ├── FACILITY TEST Workstation Zone A-01 (SPACE / WORKSTATION)
    │   │   └── FACILITY TEST Workstation Zone A-02 (SPACE / WORKSTATION)
    │   ├── FACILITY TEST Operations Area (DEPARTMENT_AREA)
    │   │   └── FACILITY TEST Cabin 01 (SPACE / CABIN)
    │   ├── FACILITY TEST Meeting Room 01 (SPACE / MEETING_ROOM)
    │   └── FACILITY TEST Store Room 01 (SPACE / STORE_ROOM)
    └── FACILITY TEST Floor 02 (FLOOR)
        └── FACILITY TEST Archive Leaf (SPACE / OTHER)
```

**Label:** NON-PRODUCTION sample data only. Do not treat as real company facilities.

# 7. Inserted Location Records

| ID | Name | Parent | Type | Space subtype | Company |
|---|---|---|---|---|---|
| 196 | FACILITY TEST SITE | — | SITE | — | 4 |
| 197 | FACILITY TEST BUILDING A | 196 | BUILDING | — | NULL |
| 198 | FACILITY TEST Floor 01 | 197 | FLOOR | — | NULL |
| 199 | FACILITY TEST Floor 02 | 197 | FLOOR | — | NULL |
| 200 | FACILITY TEST North Zone | 198 | ZONE | — | NULL |
| 201 | FACILITY TEST Operations Area | 198 | DEPARTMENT_AREA | — | NULL |
| 202 | FACILITY TEST Meeting Room 01 | 198 | SPACE | MEETING_ROOM | NULL |
| 203 | FACILITY TEST Store Room 01 | 198 | SPACE | STORE_ROOM | NULL |
| 204 | FACILITY TEST Workstation Zone A-01 | 200 | SPACE | WORKSTATION | NULL |
| 205 | FACILITY TEST Workstation Zone A-02 | 200 | SPACE | WORKSTATION | NULL |
| 206 | FACILITY TEST Cabin 01 | 201 | SPACE | CABIN | NULL |
| 207 | FACILITY TEST Archive Leaf | 199 | SPACE | OTHER | NULL |

After: staging live locations **199** (187 legacy + 12 typed).

# 8. Hierarchy Validation

**PASS**

- Correct parent / type / subtype IDs
- SITE has no parent
- SPACE nodes have no children
- No cycles (`cycles_detected: false`)
- Parent-child matrix satisfied via `assertLocationHierarchy` at insert

# 9. Tree API Validation

Via `getLocationTree` (Wave 2.6 service used by `GET /locations/tree`):

| Check | Result |
|---|---|
| Typed tree contains FACILITY TEST SITE | PASS |
| UNSPECIFIED inside typed trees | PASS (none) |
| `include_operational=true` | PASS — 187 operational rows separate |
| Ordering | `type_then_name` |
| Cycles | none |

# 10. Path API Validation

| Node | Path codes |
|---|---|
| SITE | SITE |
| BUILDING | SITE → BUILDING |
| FLOOR | SITE → BUILDING → FLOOR |
| ZONE | SITE → BUILDING → FLOOR → ZONE |
| DEPARTMENT_AREA | SITE → BUILDING → FLOOR → DEPARTMENT_AREA |
| SPACE (ws A-01) | SITE → BUILDING → FLOOR → ZONE → SPACE |

**PASS**

# 11. Children API Validation

- Floor 01 direct children: North Zone, Operations Area, Meeting Room 01, Store Room 01 (ids 200–203) — **PASS** (direct only)
- SPACE children count: **0** — **PASS**

# 12. Parent Validation

| Case | Result |
|---|---|
| SPACE under DEPARTMENT_AREA (valid) | PASS |
| Self-parent | Rejected |
| Cycle (FLOOR under its SPACE descendant) | Rejected |
| SPACE as parent of BUILDING | Rejected |
| Typed BUILDING under UNSPECIFIED | Rejected |
| SITE under its BUILDING child | Rejected (cycle defense; also invalid SITE root rule) |

# 13. Move Validation

Moved Workstation A-01 (204) from ZONE (200) → DEPARTMENT_AREA (201), then restored to ZONE (200).

| Check | Result |
|---|---|
| `parent_id` changed / restored | PASS |
| Node ID preserved | PASS |
| Sibling under ZONE remained | PASS |
| Asset location/rtd sums unchanged | PASS |
| Inventory location sums unchanged | PASS |

# 14. Archive / Restore Validation

| Check | Result |
|---|---|
| Unused Archive Leaf archive | PASS |
| Same leaf restore | PASS |
| Floor 01 archive blocked (children) | PASS |
| Meeting Room archive blocked with temporary staging asset | PASS (temp asset deleted after) |
| Store Room archive blocked with temporary staging consumable | PASS (temp consumable deleted after) |

Temporary fixtures used only staging disposable rows (`WAVE27-TEMP-*`); existing assets untouched.

# 15. Legacy Location Integrity

| Check | Result |
|---|---|
| UNSPECIFIED count 187 | Unchanged |
| Legacy id / parent / type checksums | Unchanged |
| No legacy reparent / retype / rename | Confirmed |

# 16. Asset Placement Integrity

Assets 1204; id/tag/location/rtd checksums unchanged. No existing asset reassigned to sample hierarchy.

# 17. RTD Placement Integrity

`SUM(rtd_location_id)` unchanged (10827).

# 18. Inventory Placement Integrity

Consumables/accessories/components counts and location sums unchanged.

# 19. Regression Results

| When | Result |
|---|---|
| Baseline before Wave 2.7 | 142 passed / 0 failed / 0 skipped |
| After staging validation | 142 passed / 0 failed / 0 skipped |
| `tsc --noEmit` | Clean |

# 20. Defects Found

**NONE** requiring application code changes.

Note: validating “SITE under BUILDING” when BUILDING is a descendant is rejected first by cycle detection (correct and safe). Matrix “SITE must be root” still applies for non-descendant parents.

# 21. Code Changes Required

**NO** production application code changes.

Added staging-only tooling: `server/scripts/wave27-staging-validate.ts` (refuses production writes).

# 22. Production Readiness

Staging hierarchy contracts validated. **Production hierarchy creation is NOT approved and was NOT performed.**

Requires separate explicit approval plus an approved real facility structure before any production SITE/BUILDING/FLOOR inserts.

# 23. Known Gaps

- Facility Management UI not built
- No production typed hierarchy
- 187 legacy UNSPECIFIED remain operational-only
- Sample staging data is synthetic (not real facilities)
- Descendant hardware filtering still out of scope
- HRMS `refex_location` still name-based

# 24. Recommended Next Wave

**Wave 2.8** (or Facility UI prep per roadmap): define approved real SITE/BUILDING inventory with management sign-off; optionally thin API smoke against staging sample; still no auto production writes and no legacy reclassification.
