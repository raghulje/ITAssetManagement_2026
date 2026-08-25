# Wave 2.0 — Location & Physical Space Dependency Extraction

**Mode:** READ-ONLY discovery. No code, schema, migration, or data changes.

**Database inspected:** `ITAssetManagement_2026` (`SELECT DATABASE()` → `itassetmanagement_2026`)

**Approved constraints (not redesigned):** D5 typed locations tree · D6 `assets.location_id` primary placement · I3 expand → UNSPECIFIED backfill · I6 `site_id` later only.

---

# 1. Executive Summary

The current location system is a **flat soft-deletable master** (`locations`) with optional `parent_id` (self-FK `ON DELETE SET NULL`) but **zero live nesting** (187 roots, depth 0). Placement for hardware is almost entirely concentrated on **one** location (`id=9`, “Refex Tower-Nungambakkam”): **1203/1204** assets share identical `location_id` and `rtd_location_id`.

Asset filters and reports use **exact** `location_id OR rtd_location_id` — **no descendant-aware** queries. Backend location CRUD accepts `parent_id` but the **frontend Location form does not expose it**. Imports resolve locations by **global name**. Agent/QR do not write location. Legal entities exist for assets/inventory but **not** on `locations`.

Wave 2 can evolve this table into a typed tree **if** Wave 0-style contracts are extended first and legacy rows are backfilled as **UNSPECIFIED** (I3).

**Readiness:** **READY WITH KNOWN GAPS**

---

# 2. Current Location Architecture

```
locations (master)
  ├── optional parent_id (unused in live data)
  ├── optional company_id (186/187 NULL)
  └── referenced by:
        assets.location_id / assets.rtd_location_id
        consumables / accessories / components.location_id
        users.location_id
        departments.location_id
        action_logs.location_id
        accessories_checkout.assigned_type='location' (schema capability)
```

Custody: `assets.assigned_type` may be `'location'` (checkout target). Live count of such assignments: **0**.

Display placement often uses `COALESCE(location_id, rtd_location_id)`.

---

# 3. Current Database Schema

Live `locations` columns (information_schema):

| COLUMN | TYPE | NULLABLE | KEY | PURPOSE |
|---|---|---|---|---|
| id | int unsigned | NO | PRI | Surrogate key |
| name | varchar(191) | NO | | Display / import match key |
| external_code | varchar(100) | YES | | Present in live DB; **not** in repo migrations (schema drift) |
| parent_id | int unsigned | YES | MUL | Optional parent; FK → locations.id ON DELETE SET NULL |
| company_id | int unsigned | YES | MUL | Optional company; FK → companies.id ON DELETE SET NULL |
| address, address2 | varchar(255) | YES | | Address lines |
| city, state | varchar(100) | YES | | Address |
| country | char(2) | YES | | ISO country |
| zip | varchar(20) | YES | | Postal |
| currency | char(3) | YES | | Unused in UI paths reviewed |
| ldap_ou | varchar(255) | YES | | Legacy LDAP |
| manager_id | int unsigned | YES | | Unused in CRUD allowedFields |
| notes | text | YES | | Notes / HRMS sync tag |
| created_by, updated_by | int unsigned | YES | | Audit (not set by makeCrud) |
| created_at, updated_at, deleted_at | datetime | YES | | Soft delete |

**No** `legal_entity_id`, **no** location type/subtype columns, **no** `site_id` on assets.

Foreign keys: `fk_locations_parent`, `fk_locations_company` (both SET NULL).

---

# 4. Location Hierarchy Behavior

| Question | Answer |
|---|---|
| Can a location have a parent? | **Yes** (schema + `allowedFields` includes `parent_id`) |
| FK enforced? | **Yes** — `fk_locations_parent` ON DELETE SET NULL |
| Cycle detection? | **No** for locations (unlike Wave 1 categories) |
| Max depth? | **None** in backend |
| Recursive traversal? | **No** CTEs / app recursion found |
| Validation location | **Nowhere** for depth/cycles; soft-delete via `makeCrudRouter` |
| Parent + assignable? | **Yes** — no rule forbidding asset placement on non-leaf |
| Delete with children? | Soft-delete allowed; children keep `parent_id` pointing at soft-deleted parent |
| Delete with assets? | Soft-delete allowed; assets keep `location_id` (no block) |
| Parent change | Unvalidated PUT via CRUD |

Sources: `server/src/utils/crud.ts`, `server/src/routes/users.ts` (`/locations`), `001_schema.sql`.

Frontend: **Location form does not send `parent_id`** (`MasterData.tsx` `ApiMasterForm`).

---

# 5. Complete Dependency Map

| Dependency | Table/File | Column/API | R/W | Operation | Risk |
|---|---|---|---|---|---|
| Asset placement | assets | location_id | R/W | create/update/list/detail | CRITICAL |
| Asset home/default | assets | rtd_location_id | R/W | create/update/import/checkin | CRITICAL |
| Asset filter | hardware.ts | location_id OR rtd | R | list/facets | CRITICAL |
| Display join | hardware.ts / transformers | COALESCE | R | list/detail | CRITICAL |
| Checkout to location | hardware.ts | assigned_type + location_id overwrite | W | checkout | CRITICAL |
| Check-in restore | hardware.ts | rtd then location | W | checkin | CRITICAL |
| Replace | hardware.ts | rtd/location | W | replace | HIGH |
| Map fields | assets | map_* near rtd | R/W | asset form | MEDIUM |
| Consumables stock site | consumables | location_id | R/W | CRUD/filter | HIGH |
| Accessories | accessories | location_id | R/W | CRUD/filter | HIGH |
| Components | components | location_id | R/W | CRUD/filter | HIGH |
| Accessory checkout target | accessories_checkout | assigned_type location | W | checkout | HIGH |
| Users home | users | location_id | R/W | user CRUD/import | MEDIUM |
| Departments | departments | location_id | R/W | dept master | MEDIUM |
| Action log | action_logs | location_id | W | checkin/audit | MEDIUM |
| Location master CRUD | locations | * | R/W | /locations | CRITICAL |
| Selectlist | locations | id,text | R | dropdowns | CRITICAL |
| Import asset/user/inv/loc | importEngine.ts | name → id | R/W | CSV | CRITICAL |
| HRMS sync | hrmsMastersSync.ts | refex_location → locations | W | masters sync | HIGH |
| Reports/custom | reports.ts | location joins/filters | R | reports | HIGH |
| Dashboard EOL | reports.ts | location_id filter | R | insights | MEDIUM |
| Public QR | publicAssets.ts | location names | R | public page | MEDIUM |
| Maintenance | maintenances | via asset only | R | no direct FK | LOW |
| Licenses | licenses | none | — | no location | — |
| Agent | agent.ts | none | — | no location write | LOW |
| Labels | labels.ts | none | — | no location | LOW |

---

# 6. Backend API Contract Map

Locations are mounted via `mastersRouter` + `makeCrudRouter` (`users.ts`).

| METHOD | ROUTE | Handler | Auth | Body/Params | Response | Notes |
|---|---|---|---|---|---|---|
| GET | `/api/v1/locations` | makeCrud list | JWT | search, limit, offset | `{ total, rows }` mapped | soft-deleted excluded |
| GET | `/api/v1/locations/selectlist` | selectlist | JWT | search, companyId?, limit | `{ results, pagination }` | optional company filter |
| GET | `/api/v1/locations/:id` | makeCrud get | JWT | id | mapped row | nest parent/company |
| POST | `/api/v1/locations` | makeCrud create | JWT + settings.edit | name, parent_id, company_id, address, city, state, country, zip, notes | okMessage | no depth validation |
| PUT/PATCH | `/api/v1/locations/:id` | makeCrud update | settings.edit | same fields | okMessage | |
| DELETE | `/api/v1/locations/:id` | soft delete | settings.edit | | okMessage | no usage guard |

**Consumers:** AssetForm, AssetsList, AssetCheckout, QtyModules, MasterData Locations, Users (indirect), imports, HRMS sync.

**Related asset APIs:** `/hardware` list (`location_id` filter), create/update (`location_id`/`rtd_location_id`), checkout/checkin/replace; inventory modules; reports custom/`by_location_id`.

**No** dedicated tree/hierarchy endpoint.

---

# 7. Frontend Dependency Map

| FILE | PURPOSE | Source | Flat? | Tree? | Parent UI? | Risk if types added |
|---|---|---|---|---|---|---|
| `MasterData.tsx` LocationsList/Form/Detail | CRUD | `/locations` | Yes | No | **No** | HIGH — need type/parent UX |
| `AssetForm.tsx` | RTD/placement | selectlist | Yes | No | N/A | HIGH — leaf vs any location rules |
| `AssetsList.tsx` | Exact location filter | selectlist + `location_id` | Yes | No | N/A | CRITICAL — site-wide filter expectation |
| `AssetCheckout.tsx` | Checkout target location | selectlist | Yes | No | N/A | CRITICAL |
| `QtyModules.tsx` | Inventory location | selectlist | Yes | No | N/A | HIGH |
| `Users.tsx` | User location | likely selectlist | Yes | No | N/A | MEDIUM |
| `App.tsx` routes | `/locations*` | — | — | — | — | LOW |
| `AppLayout.tsx` | Nav link | — | — | — | — | LOW |

Asset form sets **both** `rtd_location_id` and `location_id` from the same control on save.

---

# 8. Asset Location Semantics

## location_id

| Topic | Behavior |
|---|---|
| Meaning | **Current physical / operational placement** (also set equal to RTD on create/import) |
| Create | `location_id = body.location_id \|\| body.rtd_location_id` (`hardware.ts`) |
| UI create/edit | Form writes both from RTD picker (`AssetForm.tsx`) |
| Checkout employee/user | **Does not clear** `location_id` |
| Checkout location | **Overwrites** `location_id` to assigned location id |
| Check-in | Sets `location_id = body.location_id \|\| rtd_location_id \|\| location_id` |
| Replace | Uses old RTD/location for check-in side |
| Import | Sets `location_id` and `rtd_location_id` from same resolved name |
| Agent | Does not update |
| History | Prior values overwritten; action_logs may store location on checkin |
| Employee + location_id | **Yes** — 354 assets assigned to employee still have location_id |

`assigned_type='location'` is **custody assignment**, not a separate placement model; checkout also syncs `location_id` when type is location.

## rtd_location_id

| Topic | Behavior |
|---|---|
| Meaning | **Ready-to-deploy / home / default return location** (schema comment) |
| Create | Set from form; often equals location_id |
| Check-in | Preferred restore target before current location_id |
| Import | `COALESCE(imported, existing rtd)` on update |
| Filters | Included in list filter with location_id (OR) |
| Agent | Not used |
| Live data | **1203** assets have rtd = location = id 9 |

---

# 9. Inventory Location Dependencies

## Consumables / Accessories / Components

- Column `location_id` on catalog rows (`001_schema.sql`).
- List filter exact `location_id` (`inventory.ts`).
- Forms bind flat location select (`QtyModules.tsx`).
- Accessories checkout supports `assigned_type` including `'location'` (schema/default user).
- Live: **1** distinct location used across each inventory module (same concentration pattern).

## Maintenance

- No `location_id` on `maintenances`; location only via joined asset.

## Licenses

- No location dependency found.

---

# 10. Location Filtering & Query Behavior

| Pattern | Present? | Where |
|---|---|---|
| Exact location_id | Yes | hardware list/facets, inventory, reports |
| Exact OR rtd | Yes | hardware, dashboard EOL filters |
| Descendant / subtree | **No** | — |
| Recursive CTE | **No** | — |
| Name equality in API filter | No (id-based); import uses name | importEngine |
| COALESCE display join | Yes | list/transformers/public |

**“Show all assets under Chennai Site”** when assets sit on Cabin under Floor: **not supported today**. Exact-id filter only.

---

# 11. Import / Export Dependencies

| Type | Resolution | Missing location | Duplicates |
|---|---|---|---|
| asset | `findOrCreateByName('locations', name, {company_id})` | creates new | first name match globally |
| user / inventory | findOrCreate by name | creates | global name |
| location import | match `WHERE name=?` | create | reject if exists unless update |

Assumes **globally unique location names** (confirmed: **0** duplicate live name groups).

Renames break future import matching by name until IDs used.

Parent hierarchy **not** imported.

---

# 12. Agent / QR / Label Dependencies

| Area | Location behavior |
|---|---|
| ITAgent | No location fields in register/sync paths reviewed |
| Public QR | Displays location/rtd **names** only (`publicAssets.ts`) |
| Labels | No location dependency |
| Sync update location_id | **No** |

Adding types should not break agent matching (serial/tag/hostname). QR remains name display — subtype labels are cosmetic.

---

# 13. Company & Legal Entity Scope

| Topic | Current |
|---|---|
| locations.company_id | Optional; **186/187 NULL** |
| Required? | No |
| Backend enforce asset↔location company match? | **No** |
| selectlist companyId | Optional filter only |
| legal_entities table | **Yes** (68 rows); on assets/inventory |
| locations.legal_entity_id | **No** |
| Target Company→Legal Entity→Site | Not represented on locations |

---

# 14. Existing Location Data Analysis

| Metric | Count |
|---|---|
| Live locations | **187** |
| Soft-deleted | 7 |
| With parent_id | **0** |
| Roots | **187** |
| Max depth | **0** |
| Orphan parent_id | 0 |
| Self-parent | 0 |
| Duplicate names | **0** groups |
| Missing company_id | **186** |
| Locations used by any asset | **1** (id 9 → 1203 assets) |
| Assets null location_id | **1** |
| location_id = rtd_location_id | **1203** |
| location ≠ rtd | **0** |
| assigned_type=location | **0** |
| Unused (no asset/inv/user/dept/child deps) | **185** |
| legal_entities | 68 |
| external_code populated | 0 |

Sample roots are mostly HRMS office/city labels (SIPCOT, Mysore, Chennai, …) plus “Refex Tower-Nungambakkam”.

---

# 15. Legacy Backfill Confidence Analysis

**Method:** read-only name-pattern heuristics + usage. No writes. Per I3, default production posture should still be **UNSPECIFIED** until reviewed.

| Bucket | Count | Basis |
|---|---|---|
| **HIGH** | **12** | Name keywords: site/campus/tower/HQ/building/block (may overlap); includes heavily used Tower |
| **MEDIUM** | **40** | Remaining city/office-style HRMS labels that are plausible **Sites** but not typed (conservative subset of non-keyword roots) |
| **LOW / UNSPECIFIED** | **135** | No safe type inference; primarily unused flat masters → default **UNSPECIFIED** under I3 |

Do **not** auto-map MEDIUM/LOW to Building/Floor/Space without human review. Floor/Zone/Space subtype signals in names: **~0**.

---

# 16. Target Hierarchy Compatibility

| Target level | Exists today? | Mapping notes |
|---|---|---|
| Company | Separate table | Not enforced on locations |
| Legal Entity | Separate table | Not on locations |
| Site | Conceptually flat offices | Candidate for many roots / UNSPECIFIED→Site later |
| Building / Floor | No typed rows | parent_id unused |
| Zone / Department Area | No | Can be siblings under Floor via typed `parent_id` later |
| Space + subtypes | No | Prefer type/subtype on same `locations` table (D5) |

Current parent-child: none → introducing strict Site→Building→Floor will not invalidate existing edges.

Invalid under strict rules later: placing assets on Site/Building if only Space allowed; unlimited depth if still unrestricted.

Zone + Department Area as Floor children: compatible with single `parent_id`.

---

# 17. Risk Matrix

| Dependency | Current | Wave 2 impact | Risk | Protection |
|---|---|---|---|---|
| Exact location filter | OR location/rtd | Site filter must include descendants | CRITICAL | Regression + subtree query design |
| Checkout/checkin location | Overwrite / restore RTD | Typed leaf rules | CRITICAL | Wave0 custody + location contracts |
| Import by name | Global unique | Duplicate names under parents | CRITICAL | Import tests; unique (parent_id,name) policy |
| Soft delete | No usage guard | Orphan semantics | HIGH | Deletion constraints tests |
| Flat dropdowns | All locations | Need leaf-only or typed filters | HIGH | UI + API contract tests |
| COALESCE display | location then rtd | Still valid | MEDIUM | Keep COALESCE |
| company_id NULL | Most rows | Site tenancy | HIGH | Scope decision / backfill company |
| external_code drift | Unmigrated column | Document only | LOW | Align migrations later |
| parent_id unconstrained | No validation | Cycles/deep trees | HIGH | Backend validation like categories |
| Agent | No location write | Low | LOW | Smoke only |

---

# 18. Required Regression Tests Before Wave 2

| TEST NAME | CURRENT CONTRACT | WHY REQUIRED | RISK IF BROKEN |
|---|---|---|---|
| locations_crud_allowed_fields | parent_id allowed; no type yet | Lock Wave2 additive fields | Silent API break |
| locations_soft_delete_keeps_asset_fk | Soft delete does not clear assets.location_id | Deletion policy | Orphan/wrong placement |
| asset_list_location_or_rtd | Filter uses OR | Must stay until subtree added | Wrong inventory counts |
| asset_create_copies_rtd_to_location | location \|\| rtd on create | Placement semantics | Null placement |
| checkout_location_overwrites_location_id | CASE when type=location | Custody vs placement | Lost location |
| checkout_employee_preserves_location_id | Non-location checkout | Dual state | Accidental clear |
| checkin_prefers_rtd_then_location | Restore order | Stock return | Wrong home |
| replace_uses_rtd_location | Replace path | Custody continuity | Wrong location |
| coalesce_display_location | List/transformers | UI contract | Blank location column |
| consumable_filter_location_id | Exact catalog filter | Inventory | Wrong stock site |
| accessory_component_location_crud | location_id on write | Inventory | Lost location |
| import_location_by_global_name | findOrCreateByName | Imports | Duplicate/wrong loc |
| import_asset_sets_location_and_rtd | Both set | Baseline | Split placement |
| locations_selectlist_optional_companyId | Optional filter | Scope | Empty dropdowns |
| no_descendant_filter_today | Document absence | Prevent false assumptions | False “site” reports |
| public_qr_shows_location_name | Name only | QR | Blank public page |
| assigned_type_location_enum | Enum includes location | Checkout target | Checkout fail |

---

# 19. Wave 2 Blockers

1. **No Wave-2-specific regression pack** yet (section 18) — must land before schema.
2. **Descendant filtering gap** must be designed (not implemented) before promising Site-level asset views.
3. **Company tenancy on locations** almost unused (186 NULL) — policy needed before Company→Site enforcement.
4. **Import uniqueness** is global-by-name — typed tree may need composite uniqueness rules.
5. **Live schema drift:** `external_code` on locations not in repo migrations — reconcile before more ALTERs.
6. **Frontend parent_id gap** — API allows hierarchy UI does not; typed tree needs UI plan.

---

# 20. Recommended Wave 2 Implementation Boundaries

**In scope (later implementation wave, not this task):**

- Additive location type/subtype (+ UNSPECIFIED backfill)
- Backend parent depth/type validation
- Soft compatibility for existing flat rows
- Optional descendant-aware filters (new query param; keep exact filter)

**Out of scope / deferred:**

- `assets.site_id` cache (I6 later)
- Hard cutover requiring all assets on Space leaves
- License redesign
- Agent payload changes
- Parallel space tables

---

# 21. Wave 2 Readiness Assessment

**READY WITH KNOWN GAPS**

Discovery is sufficient to design Wave 2.1. Gaps: missing regression harness for location contracts, company/location tenancy policy, import uniqueness strategy, and `external_code` migration alignment.
