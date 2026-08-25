# Wave 2.5 — Physical Location Hierarchy Domain & Management Design

**Mode:** READ-ONLY architecture and UI/UX design. No code, schema, or data changes.  
**Production database:** `ITAssetManagement_2026` (unchanged by this wave)

---

# 1. Executive Summary

Wave 2.5 designs how a real physical facility hierarchy (Site → Building → Floor → Zone / Department Area → Space) can be managed in the product while **preserving the existing 187 HRMS operational locations** and all placement contracts (`assets.location_id`, `rtd_location_id`, inventory, imports, checkout/check-in).

**Recommended architecture: OPTION A — single `locations` table with typed hierarchy** (already aligned with approved D5/D6 and Wave 2.2 foundation).

**Operational strategy:** Keep legacy rows as `UNSPECIFIED` (and optionally later reviewed as SITE). Do not auto-reparent them. Grow physical trees as **new typed nodes** through Facility Management UI.

**Backend readiness:** Type masters, `parent_id`, hierarchy validators (`locationFoundation.ts`), and additive location API fields already exist. Frontend remains flat (no parent/type/subtype UI). Exact location filters remain exact-ID (no descendants yet).

**Readiness for implementation:** READY WITH KNOWN GAPS — proceed to a backend hierarchy contract + UI wave sequence; do not reclassify production data automatically.

---

# 2. Current Location Architecture

## Backend

| Surface | Path / behavior |
|---|---|
| CRUD | `/api/v1/locations` custom router in `server/src/routes/users.ts` |
| Selectlist | `/api/v1/locations/selectlist` — flat `{ id, text }`, optional `companyId` |
| Mutating auth | `settings.edit` |
| Read auth | Any authenticated user |
| Soft delete | Sets `deleted_at`; does **not** clear asset FKs or child `parent_id` |
| Typed columns | `location_type_id`, `space_subtype_id`, `external_code` |
| Validation | `server/src/services/locationFoundation.ts` — parent matrix, cycles, SPACE leaf rules |
| Create default | Omitting type → `UNSPECIFIED` when typed schema present |
| Types CRUD API | **None** (seeded tables only) |

## Frontend

| Surface | Behavior |
|---|---|
| Masters Locations | Flat list/form in `MasterData.tsx` — name, company, address, notes only |
| Parent / type / subtype UI | **Not exposed** |
| Dropdowns | `MasterSelect` → selectlist (AssetForm RTD, checkout target, QtyModules, Users, AssetsList filter) |
| Closest hierarchy UX | Category form parent picker in same MasterData module |

## Placement & filters

- `location_id` = operational / current placement; `rtd_location_id` = home / check-in preference  
- List filter: `(location_id = ? OR rtd_location_id = ?)` exact — no subtree  
- Checkout to location overwrites `location_id`; employee checkout preserves it  
- Check-in: body → rtd → current  

## Dependency map (extend vs leave alone)

| Consumer | Extend for hierarchy? | Break if flat APIs change? |
|---|---|---|
| AssetForm / AssetsList / Checkout | Path-aware labels later; keep exact IDs | **CRITICAL** |
| QtyModules / inventory | Same | **HIGH** |
| Users / HRMS / import | Keep name + flat selectlist | **CRITICAL** |
| Location CRUD UI | **Primary extension target** | New tree UI additive |
| Reports / EOL filters | Optional descendant later | Keep exact default |
| Public QR | Name display only | LOW |

---

# 3. Wave 2.4 Findings Incorporated

| Finding | Design implication |
|---|---|
| 187 UNSPECIFIED, 0 parents | Physical tree starts empty of typed structure |
| HRMS name master | Operational locations must remain first-class in dropdowns |
| 0 safe auto-classify | No bulk retype/reparent in next waves |
| Option D recommended | UI-driven creation of physical nodes |
| 1203 assets on `id=9` | Never change that row’s ID; never mass-move asset FKs |
| No company/LE on most locations | New SITE rules ≠ backfill legacy |

---

# 4. Operational vs Physical Location Domain

## OPERATIONAL LOCATION

**Purpose:** HRMS employee place, project/plant/office label, legacy asset & RTD placement, inventory catalog site.

**Representation:** Prefer **`location_type = UNSPECIFIED`** for all current rows. Optional future: reviewed retype to `SITE` only when management confirms — still **without inventing children**.

**Consumers:** Asset/RTD pickers, inventory, users, imports (global name), HRMS sync.

## PHYSICAL FACILITY LOCATION

**Purpose:** Typed Site / Building / Floor / Zone / Department Area / Space (+ subtypes).

**Representation:** Same `locations` table with typed `location_type_id`, `parent_id`, optional `space_subtype_id`.

## Coexistence rules

1. Both concepts share one table and one `location_id` FK on assets/inventory.  
2. Operational rows are not required to sit under a physical SITE.  
3. Physical children may only hang under typed parents (strict matrix).  
4. An operational UNSPECIFIED may **later** become SITE (type change only) after review — **must not** receive physical children until it is SITE (or an approved exception).  
5. Dropdowns for ITAM stay inclusive of **all active** locations; Facility Management UI filters by typed / tree.

---

# 5. Data Model Options

| Option | Description | Fit |
|---|---|---|
| **A** Single `locations` typed tree | Extend existing table | Matches D5/D6; all FKs already point here |
| B Separate `physical_spaces` | Parallel model | Forces dual placement / sync; violates D6 spirit |
| C Separate facility tables | buildings/floors/… | Rejected in Wave 2.0/2.2 |
| D Hybrid dual tables | Operational + physical | High migration cost; no current code need |

---

# 6. Recommended Architecture

**OPTION A — Single `locations` table with typed hierarchy.**

Reasons:

- D5 already locked: evolve `locations`, do not replace.  
- D6: `assets.location_id` remains sole placement pointer.  
- Wave 2.2 already delivered types, subtypes, validators, soft compatibility for UNSPECIFIED.  
- Every dependency already joins `locations`.  

**No second locations table.** Optional later: nullable caches (`site_id` on assets — I6 deferred) computed from ancestry — not required for Wave 2.6–2.9.

---

# 7. Parent-Child Rule Matrix

Align with and **preserve** `locationFoundation.ts`, with explicit child rules for UI:

| Type | Root OK? | Allowed parents | Allowed children | Subtype |
|---|---|---|---|---|
| UNSPECIFIED | Yes | Any (legacy soft) | Prefer none for *new* typed children; do not attach BUILDING under UNSPECIFIED in new UI | No |
| SITE | Yes | none, or UNSPECIFIED (legacy bridge only) | BUILDING | No |
| BUILDING | No | SITE | FLOOR | No |
| FLOOR | No | BUILDING | ZONE, DEPARTMENT_AREA, SPACE | No |
| ZONE | No | FLOOR | SPACE only | No |
| DEPARTMENT_AREA | No | FLOOR | SPACE only | No |
| SPACE | No | FLOOR, ZONE, DEPARTMENT_AREA | **None** | Optional CABIN / MEETING_ROOM / SERVER_ROOM / STORE_ROOM / WORKSTATION / OTHER |

## SPACE under FLOOR / ZONE / DEPARTMENT_AREA

**Recommend: allow SPACE under all three.**

Enterprise layout example:

```
Building
└── Floor
    ├── Zone (Open plan)
    │   └── SPACE / WORKSTATION
    ├── Department Area (Finance)
    │   └── SPACE / CABIN
    └── SPACE / MEETING_ROOM  (directly on floor)
```

ZONE and DEPARTMENT_AREA are **siblings under FLOOR**, not parents of each other. Neither nests under the other in v1.

## Self / cycle / leaf

Already enforced: no self-parent, no cycles, SPACE cannot be parent or gain children.

---

# 8. Company and Legal Entity Strategy

## Facts

- `locations.company_id` exists; 186/187 legacy NULL.  
- No `locations.legal_entity_id`.  
- Assets have both `company_id` and `legal_entity_id` (LE sparsely used).  
- Selectlists: companies; legal entities by `company_id`.

## Recommendation for **NEW physical** nodes

**Company — OPTION C (required on SITE; resolve via ancestry for descendants):**

- Creating a SITE requires `company_id`.  
- BUILDING / FLOOR / … inherit company from ancestor SITE for validation/display; may store `company_id` as optional denormalized copy on create (same as parent SITE) for simpler filters — **not** independent tenancy.  
- Do **not** require company_id on legacy UNSPECIFIED.  
- Do **not** backfill existing 187.

**Legal Entity — optional on SITE only:**

- `legal_entity_id` (future additive column) nullable on SITE when a site is owned by one LE.  
- Must belong to the SITE’s company when set.  
- Not required for v1 tree creation if product needs only company scope first.  
- Do not invent LE for legacy rows.

This yields correct tenancy for new trees, fast SITE-level company filters, and zero forced mapping of the HRMS list.

---

# 9. Legacy Location Compatibility

| Question | Answer |
|---|---|
| Can operational become SITE? | Yes, **manual reviewed** type change only; no auto |
| Can legacy have physical children? | Only after typed as SITE (UI blocks children on UNSPECIFIED for new creates) |
| New operational flag? | **Not required** — UNSPECIFIED is sufficient |
| Asset dropdown | All active locations (typed + UNSPECIFIED) |
| Facility tree | Typed physical only (filter out UNSPECIFIED by default; toggle “Show operational”) |
| HRMS / import | Unchanged global-name create → UNSPECIFIED |
| Inventory | Unchanged |

---

# 10. New Location Creation Flows

## CREATE SITE

| Field | Rule |
|---|---|
| name | Required; unique within company preferred (soft warn if global duplicate) |
| company_id | **Required** for new SITE |
| legal_entity_id | Optional; must match company |
| parent_id | Null |
| type | SITE |
| address fields | Optional |

## CREATE BUILDING

| Field | Rule |
|---|---|
| parent | Required SITE |
| name | Required |
| type | BUILDING |
| company | Inherited / copied from SITE |

## CREATE FLOOR

| Field | Rule |
|---|---|
| parent | Required BUILDING |
| name | Required (e.g. “Floor 3” or “L3”) |
| sort_order | Optional future metadata (logical only now) |

## CREATE ZONE / DEPARTMENT_AREA

| Field | Rule |
|---|---|
| parent | Required FLOOR |
| name | Required |
| department_id | **Optional metadata only** on DEPARTMENT_AREA — do not require org department FK for v1; link later if product needs it |

## CREATE SPACE

| Field | Rule |
|---|---|
| parent | FLOOR, ZONE, or DEPARTMENT_AREA |
| subtype | Optional |
| name | Required |
| capacity / code | Future optional fields — design only |

All flows: soft-delete aware parent picker; validate via existing matrix.

---

# 11. Hierarchy Management UI/UX Specification

## Module placement

New **Location & Facility Management** experience under Masters (or Facilities tab when that domain expands). Keep existing flat `/locations` list as “Operational Locations” or merge with tabs:

- **Operational** — current flat MasterData list (HRMS / UNSPECIFIED)  
- **Facilities** — tree workspace  

Visual language: match existing `AppLayout` + `Box` + `DataTable` + `label-*` badges + `callout-*` — enterprise, not a raw file explorer.

## Layout (desktop)

```
┌──────────────┬────────────────────────────┬─────────────────┐
│ Tree         │ Node detail                │ Actions         │
│ Company filter│ Type badge · Path breadcrumb│ Add child       │
│ Search       │ Address / notes            │ Edit            │
│ Type chips   │ Asset count · Inventory    │ Archive         │
│ Expand/coll  │ Children table             │ View assets     │
└──────────────┴────────────────────────────┴─────────────────┘
```

## Tree interactions

- Lazy expand by parent_id  
- Type badges: SITE / BLD / FL / ZONE / DEPT / SPACE+subtype  
- Asset count badge (location_id matches)  
- Empty state: “No physical hierarchy yet — Create SITE”  
- Toggle: Show operational (UNSPECIFIED) as flat sibling section, not nested under Sites  
- Soft-deleted: hidden by default; “Show archived”  
- Company filter filters SITE roots then descendants  
- Legal Entity filter when SITE.legal_entity_id exists  
- Mobile: tree as accordion list; detail full-screen; actions bottom sheet  

## Empty / first-run

Guided callout: operational list remains for ITAM; create first SITE under selected company to start facilities.

---

# 12. API Design

## Preserve existing flat contracts

| Endpoint | Keep |
|---|---|
| GET/POST/PUT/DELETE `/locations` | Yes — additive fields already |
| GET `/locations/selectlist` | Yes — flat `id,text` |

## Additive hierarchy endpoints (recommended separate prefix)

| Method | Route | Purpose |
|---|---|---|
| GET | `/locations/tree?company_id=&root_id=` | Nested typed nodes (exclude UNSPECIFIED by default) |
| GET | `/locations/:id/path` | Breadcrumb ancestors |
| GET | `/locations/:id/children` | Direct children |
| POST | `/locations` | Already creates; UI sends type/parent |
| POST | `/locations/:id/move` | Reparent with validation |
| POST | `/locations/:id/archive` | Soft delete with guard rules |
| POST | `/locations/:id/restore` | Clear deleted_at if safe |
| GET | `/locations/:id/validate-parent?parent_id=&type=` | Pre-check for UI |
| GET | `/locations/:id/assets?limit=` | Exact placement list (location OR rtd) |
| GET | `/locations/:id/inventory` | Exact catalog location_id |
| GET | `/location-types` / `/space-subtypes` | Read-only selectlists |

**Do not** change default GET `/hardware?location_id=` to subtree in hierarchy waves — that remains Wave 2.1 Option A (`include_descendants`) for a later opt-in.

---

# 13. Move and Reparent Rules

| Rule | Detail |
|---|---|
| Validation | Target parent must satisfy matrix for node type; no cycle; SPACE cannot receive children |
| Descendants | Move subtree with the node (same parent_id updates only for the moved root; children keep relative parents) |
| Assets | **NEVER** auto-update `assets.location_id` or `rtd_location_id` |
| Inventory | **NEVER** auto-update inventory `location_id` |
| Rationale | Placement is by location **ID**; moving a Floor record keeps the same ID → assets already on that Floor stay correctly placed |
| If move would orphan meaning | Block moving a SITE that has assets placed *on the SITE id* into a non-root parent |
| Permissions | `settings.edit` or future `locations.move` |
| Audit | Log before/after parent_id |

---

# 14. Archive and Delete Rules

Soft delete only (existing pattern).

| Situation | Rule |
|---|---|
| Node has live children | **BLOCK** archive |
| Node has assets on location_id or rtd | **BLOCK** (or require force + reason later — default BLOCK) |
| Node has inventory catalog rows | **BLOCK** |
| Node referenced by users | **BLOCK** or warn + BLOCK for v1 |
| Leaf SPACE unused | ARCHIVE OK |
| SITE unused empty tree | ARCHIVE children first, bottom-up |

**No CASCADE archive** in v1 (too easy to hide entire campuses).  
**No hard DELETE.**  
Restore: only if parent still live and matrix still valid.

---

# 15. RBAC Model

## Current

Location mutations → `settings.edit`. Reads → authenticated. No `locations.*` keys. Roles: Superuser, Admin, IT Asset Manager (`settings.edit`), Viewer (no settings).

## Recommendation (incremental)

**Phase 1 (next UI waves):** Keep hierarchy CRUD under `settings.edit` to avoid RBAC migration risk.

**Phase 2 (when Facilities domain grows):** Add module `locations` (or `facilities`) with:

| Permission | Superuser/Admin | IT Asset Manager | Viewer | Future Facilities role |
|---|---|---|---|---|
| locations.view | Yes | Yes | Optional | Yes |
| locations.create / edit | Yes | Yes | No | Yes |
| locations.archive / restore | Yes | Yes | No | Yes |
| locations.move | Yes | Configurable | No | Yes |
| locations.manage_hierarchy | Yes | Yes | No | Yes |

Map to existing `{module}.{action}` catalog pattern in `permissions.ts`. Until then, do not invent orphan keys in UI.

---

# 16. Audit Requirements

Extend `action_logs` (or structured `log_meta`) for:

| Event | Capture |
|---|---|
| location created | type, subtype, parent, company, LE |
| type / subtype assigned | before → after |
| parent changed / moved | before → after parent_id |
| archived / restored | actor, timestamp |
| company / LE changed | before → after |

Always: actor user id, timestamp. Reason required for archive/move when assets exist (if force allowed later).

HRMS sync location creates: keep current behavior or add bulk meta — not blocking for hierarchy UI.

---

# 17. Asset Placement Rules

**Keep:** `assets.location_id` = placement; `rtd_location_id` = home. No `space_id`.

| Asset class (guidance) | Preferred precision |
|---|---|
| Laptops / mobiles | SPACE or FLOOR; SITE acceptable for coarse ops |
| Meeting room AV / TV | SPACE (MEETING_ROOM) |
| Servers | SPACE (SERVER_ROOM) |
| Stock / spare | STORE_ROOM or SITE/operational UNSPECIFIED |

**Rules for UI (soft, not hard-block in v1):**

- Allow placing on any active location ID (including UNSPECIFIED and SITE) for backward compatibility.  
- Prefer leaf SPACE when creating new facilities-aware assets (warning, not error).  
- Exact filters remain default.

---

# 18. Inventory Placement Rules

Catalog `location_id` remains exact.

| Guidance | |
|---|---|
| Consumables / accessories stock | Prefer STORE_ROOM or operational site |
| Components | Same |
| No change to checkout quantity logic |

---

# 19. Future INSTALLED_IN Compatibility

No `asset_relationships` table exists yet. Design alignment:

| Concept | Rule |
|---|---|
| Move (custody / room change) | Updates `location_id` (or checkout-to-location) |
| Install (`INSTALLED_IN`) | Relationship to host asset or to SPACE location — **does not replace** location_id |
| Example | TV `location_id` = Meeting Room SPACE; `INSTALLED_IN` → wall mount asset or room |
| Biometric at entrance | SPACE or ZONE; relationship to door asset later |
| AC in Cabin | SPACE/CABIN + optional INSTALLED_IN host |
| Server in Server Room | SPACE/SERVER_ROOM |

**Move ≠ Install** remains locked: hierarchy move of Floor does not rewrite relationships; install events are separate.

---

# 20. Risks

| Risk | Mitigation |
|---|---|
| Users confuse HRMS list with facilities tree | Dual tabs / filters; clear copy |
| Soft-deleted parents break tree | Archive BLOCK with children; path API skips deleted |
| Accidental reparent of `id=9` | Confirm dialogs; BLOCK if type change to invalid parent |
| Subtree filter expectation | Keep exact default; document opt-in later |
| RBAC over-split too early | Stay on `settings.edit` initially |
| Import creates UNSPECIFIED forever | Acceptable; Facility UI creates typed nodes separately |

---

# 21. Implementation Wave Plan

| Wave | Scope | DB? | Guardrails |
|---|---|---|---|
| **2.6** | Hierarchy backend: tree/path/children/move/archive guards; location-types selectlists; deepen validation for UNSPECIFIED child block in create UI path; regression tests | Staging first if any schema (e.g. optional SITE `legal_entity_id`, `sort_order`) | Exact filters unchanged; no asset FK updates |
| **2.7** | Staging validation + optional additive columns only | Staging | Backup if prod columns later |
| **2.8** | Production additive schema (if any from 2.6) | Prod backup-first | Wave 1.7/2.3 pattern |
| **2.9** | Facility Management UI (tree + create flows) + Operational tab | No forced data reclass | Flat APIs remain |
| **2.10+** | Opt-in `include_descendants`; optional `assets.site_id` cache (I6); RBAC module split; reviewed SITE mapping file | Separate approvals | Never auto-move asset FKs |

Every wave: green `test:regression:all`; no weakening of Wave 2.1/2.2 contracts.

---

# 22. Final Recommendation

1. **Stay on one `locations` table** (Option A).  
2. **Treat 187 legacy rows as operational UNSPECIFIED**; build physical trees as new typed nodes (Wave 2.4 Option D).  
3. **SPACE allowed under FLOOR, ZONE, and DEPARTMENT_AREA**; ZONE/DEPT are floor siblings.  
4. **Company required on new SITE**; LE optional on SITE; no legacy backfill.  
5. **Additive hierarchy APIs + Facility UI**; preserve flat selectlist/CRUD for ITAM.  
6. **Move/archive never rewrite asset or inventory placement FKs.**  
7. **Start Wave 2.6** with backend hierarchy contracts and tests before UI.

---

# 23. Wave Readiness

**READY WITH KNOWN GAPS**

Gaps: no Facility UI yet; no tree API yet; no `legal_entity_id` on locations; no descendant filters; legacy still 100% UNSPECIFIED (intentional).
