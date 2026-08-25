# WAVE 2.6 — Physical Location Hierarchy Backend Contracts

# 1. Executive Summary

Wave 2.6 adds **additive hierarchy APIs** on the existing shared `locations` table for the future Facility Management UI. No parallel hierarchy tables, no schema migration, no frontend redesign, and no changes to asset/inventory placement FKs.

Shared validation in `locationFoundation.ts` / `locationHierarchy.ts` is used by create, update, move, restore, and validate-parent. Typed physical children are blocked under `UNSPECIFIED`. Tree ordering is **type then name** (no `sort_order` column).

# 2. Baseline Before Wave 2.6

| Suite | Result |
|---|---|
| Wave 0 | 47 passed |
| Wave 1 | 12 passed |
| Wave 2 (2.1 + 2.2) | 41 passed |
| **Total** | **100 passed / 0 failed / 0 skipped** |

Command: `npm run test:regression:all`

# 3. Existing Location Contracts Preserved

| Contract | Status |
|---|---|
| GET/POST/PUT/DELETE `/locations` | Unchanged shape; create/update share hierarchy validators |
| GET `/locations/selectlist` | Unchanged |
| Hardware filter `(location_id = ? OR rtd_location_id = ?)` | Unchanged; exact ID only |
| Checkout / check-in / replace | Unchanged |
| Import by global location name | Unchanged |
| QR location display | Unchanged |
| Soft DELETE `/locations/:id` | Still soft-deletes without dependency guards (legacy) |
| Legacy 187 UNSPECIFIED rows | Not reclassified or reparented |

# 4. APIs Added

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/locations/tree` | Typed physical forest |
| GET | `/api/v1/locations/validate-parent` | Create preflight |
| GET | `/api/v1/locations/:id/path` | Ancestor chain |
| GET | `/api/v1/locations/:id/children` | Direct children |
| GET | `/api/v1/locations/:id/validate-parent` | Move preflight |
| POST | `/api/v1/locations/:id/move` | Reparent node only |
| POST | `/api/v1/locations/:id/archive` | Guarded soft delete |
| POST | `/api/v1/locations/:id/restore` | Clear `deleted_at` if safe |
| GET | `/api/v1/locations/:id/assets` | Exact placement assets |
| GET | `/api/v1/locations/:id/inventory` | Exact inventory groups |
| GET | `/api/v1/location-types` | Read-only masters |
| GET | `/api/v1/space-subtypes` | Read-only masters |

# 5. Tree Contract

**Query:** `company_id`, `root_id`, `include_operational`, `include_archived`

**Defaults:**
- Active typed physical nodes only (`SITE`…`SPACE`)
- Exclude `UNSPECIFIED`
- Exclude soft-deleted

**`include_operational=true`:** returns `operational[]` separately; never grafted into typed trees.

**`company_id`:** filters by SITE `company_id`; descendants included via ancestry even if their own `company_id` is NULL. Operational rows with NULL `company_id` are not dropped solely for NULL.

**Assembly:** one query + in-memory forest (no N+1). Cycle-safe. Stable order: `TYPE_SORT_ORDER` then name.

**Response:** `{ trees, operational?, meta: { cycles_detected, ordering } }`

# 6. Path Contract

`GET /locations/:id/path` → `{ path: [...] }` ordered root → node.

404 if missing / not visible. 422 if cycle detected while walking.

Deleted ancestors are not exposed by default.

# 7. Children Contract

`GET /locations/:id/children?include_archived=`

Direct children only with type / subtype / company metadata. No asset or inventory payloads.

# 8. Parent Validation Contract

- `GET /locations/validate-parent?parent_id=&location_type_id=` (create)
- `GET /locations/:id/validate-parent?parent_id=` (move)

Checks: parent exists & active, not self, no cycle, parent-type matrix, SPACE cannot parent, typed child not under UNSPECIFIED, SITE remains root.

Source of truth: `assertLocationHierarchy` + `validateLocationWrite`.

# 9. Move Contract

`POST /locations/:id/move` body `{ parent_id }`

- Updates **only** `locations.parent_id` for the moved node
- Subtree moves logically (children keep their `parent_id`s)
- **Never** updates `assets.location_id`, `assets.rtd_location_id`, or inventory `location_id`
- Blocks invalid matrix / SITE non-root / cycles
- Does **not** block merely because the node has children or assets (placement stays on the same IDs)
- SITE cannot be moved under another node

# 10. Archive Guards

`POST /locations/:id/archive` soft-deletes only when all counts are zero:

- active children
- asset placements (`location_id`)
- RTD references (`rtd_location_id`)
- inventory (consumables + accessories + components)
- users / departments referencing `location_id`

No cascade. Actionable dependency payload on 422.

Legacy `DELETE /locations/:id` remains unguarded soft delete for backward compatibility; Facility UI should use archive.

# 11. Restore Rules

`POST /locations/:id/restore`

- Target must be soft-deleted
- Parent (if any) must exist and be active
- Parent-child matrix must still be valid
- No automatic descendant restore
- No placement FK changes
- No name uniqueness conflict on current schema (none enforced)

# 12. Node Assets Contract

`GET /locations/:id/assets?limit=&offset=`

Exact: `location_id = :id OR rtd_location_id = :id`. No descendants.

Response: `{ total, placement_count, rtd_count, rows }`

# 13. Node Inventory Contract

`GET /locations/:id/inventory`

Exact `location_id` for consumables, accessories, components. Groups with `total` + `rows`. No quantity/checkout logic changes.

# 14. Location Type APIs

`GET /location-types` — active types ordered by `hierarchy_level`, name  
`GET /space-subtypes` — active subtypes ordered by name  

Read-only. No master CRUD in this wave.

# 15. Authorization

| Operation | Auth |
|---|---|
| Reads (tree/path/children/assets/inventory/masters) | Authenticated (existing location GET behavior) |
| move / archive / restore / create / update / delete | `settings.edit` |

No `locations.*` or `facilities.*` permission keys added.

# 16. Audit Logging

Via existing `logAction` / `action_logs.log_meta`:

| action_type | When |
|---|---|
| `LOCATION_MOVED` | Successful move |
| `LOCATION_ARCHIVED` | Successful archive |
| `LOCATION_RESTORED` | Successful restore |

Meta includes actor (user_id), location id/name, old/new parent_id, type id, timestamp (action_date).

# 17. Database Changes

**NONE**

Existing columns (`parent_id`, `location_type_id`, `space_subtype_id`, `company_id`, `deleted_at`) are sufficient. Optional `legal_entity_id` / `sort_order` not added.

# 18. Regression Tests

File: `server/test/wave2/hierarchy-backend-contracts.test.ts` (TEST 1–40 + route/company extras).

Post-wave totals: Wave 0 47 + Wave 1 12 + Wave 2 83 = **142 passed**.

# 19. Backward Compatibility Validation

Hardware exact OR filter, checkout CASE, check-in restore order, selectlist, import global name — covered by Wave 2.1 + Wave 2.6 backward tests. No frontend redesign.

# 20. Known Gaps

- Facility Management UI not built (Wave 2.9)
- Legacy DELETE remains unguarded (archive is the safe path)
- No descendant filtering on hardware lists
- No production typed SITE hierarchy data yet
- HRMS `employees.refex_location` is name-based (not FK); archive does not scan it
- Tree company filter assumes SITE carries company; deeper legal-entity scoping deferred

# 21. Wave 2.7 Readiness

Backend hierarchy contracts are in place for Facility UI consumption. Next wave should focus on controlled creation of typed SITE/BUILDING/FLOOR… data (staging-first) without reparenting the 187 legacy UNSPECIFIED operational locations or rewriting placement FKs.
