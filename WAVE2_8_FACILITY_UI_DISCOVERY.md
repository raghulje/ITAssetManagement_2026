# WAVE 2.8 — Facility Management UI Discovery

**Status:** STEP 1 complete — discovery only. No UI implementation in this step.  
**Date:** 2026-08-24  
**Baseline:** Regression 142 passed (Wave 0–2.7). Backend hierarchy contracts: Wave 2.6 validated on staging (Wave 2.7).

---

## 1. Executive summary

The React client already has a flat **Locations** master under **Masters** (`/locations`) that uses legacy CRUD + selectlists. Wave 2.6 hierarchy APIs exist on the server but are **not yet wired in the frontend** (`mastersApi` has no tree/path/move/archive clients).

Facility Management can be added **additively** as a new route area that consumes hierarchy APIs, while leaving `/locations` as the operational/legacy list. No schema change and no placement-behavior change are required for the UI.

**No blockers that require a new backend redesign.** One UX gap (company name on nested `parent`/`company` in mapLocationRow) is cosmetic and workable via path/tree payloads.

---

## 2. Existing files analyzed

### Routing & shell

| File | Relevance |
|---|---|
| `client/src/App.tsx` | All app routes; locations at `/locations`, `/locations/create`, `/locations/:id`, `/locations/:id/edit` |
| `client/src/layout/AppLayout.tsx` | Sidebar, section tabs, RBAC-gated nav, narrow (`max-width: 991px`) drawer |
| `client/src/main.tsx` | Vite entry; styles from `styles/refex.css` |
| `client/src/styles/refex.css` | AdminLTE-inspired design language (boxes, labels, toolbar, detail-layout) |

### Locations / masters UI

| File | Relevance |
|---|---|
| `client/src/pages/settings/MasterData.tsx` | `LocationsList` / `LocationDetail` / `LocationForm` — flat list; fields: name, company, address, notes. **No** `location_type_id`, `space_subtype_id`, or `parent_id` in the form |
| Locations subtitle | “HRMS + manually added location masters” |

### API / auth

| File | Relevance |
|---|---|
| `client/src/api/client.ts` | Shared `api()` helper; `mastersApi.listLocations` / `createLocation` / `updateLocation` / `removeLocation` / `locations` selectlist |
| `client/src/api/AuthContext.tsx` | `can(permission)`, `isAdmin` (superuser/admin); used across layout |
| `client/src/api/baseUrl.ts` | API base URL |

### Reusable UI

| File | Relevance |
|---|---|
| `client/src/components/ui.tsx` | `Box`, `SmallBox`, `Field`, `PageForm`, `DataTable`, `StatusBadge` |
| `client/src/components/DetailLayout.tsx` | Summary + tabs + detail fields (good for Facility node Details / Assets / Inventory) |
| `client/src/components/MasterSelect.tsx` | Select + optional “Add” for masters |
| `client/src/components/Toast.tsx` | Success/error toasts |
| `client/src/components/formControls.tsx` | Shared form controls |
| `client/src/pages/Dashboard.tsx` | Metric cards via `SmallBox` + Font Awesome |

### Consumers of location selectlist (must not break)

| File | Usage |
|---|---|
| `AssetForm.tsx`, `AssetsList.tsx`, `AssetCheckout.tsx`, `AssetExtras.tsx` | Location dropdowns / filters |
| `QtyModules.tsx` | Inventory location |
| `Users.tsx` | User location |

### Backend contracts (already implemented)

| File | Relevance |
|---|---|
| `server/src/routes/users.ts` | Hierarchy routes under `/locations`; masters `/location-types`, `/space-subtypes` |
| `server/src/services/locationHierarchy.ts` | Tree/path/move/archive/assets/inventory |
| `server/src/services/locationFoundation.ts` | Parent matrix + tree assembly |
| `WAVE2_6_HIERARCHY_BACKEND_CONTRACTS.md` | Approved response contracts |
| `server/src/app.ts` | GET locations open to authenticated users; mutations require `settings.edit` |

### Testing

| Finding | Detail |
|---|---|
| Frontend tests | **None.** `client` `npm test` is a deferred stub |
| Backend regression | `server` `npm run test:regression:all` — 142 tests |

---

## 3. Current navigation model

Sidebar (permission-gated):

- Dashboard  
- Assets (`assets.view`)  
- Licenses / Accessories / Consumables / Components (module view)  
- People (`people.view`)  
- **Masters** (`settings.view`) → lands on `/companies`; section tabs include **Locations**  
- Import (`settings.edit`)  
- Settings / Reports (`isAdmin`)

**Locations today live under Masters**, not as a top-level item.

Section tabs for masters: Companies | Departments | Locations | Suppliers | Asset Models.

---

## 4. Components to reuse

| Component | Use in Facility UI |
|---|---|
| `AppLayout` | Page shell, title, breadcrumbs |
| `Box` | Tree panel, details panel, forms |
| `SmallBox` (sparingly) or compact count chips | Summary metrics from loaded tree only |
| `DetailLayout` | Node details + Assets / Inventory tabs |
| `DataTable` | Assets tab rows; Operational Locations list (or reuse `LocationsList` patterns) |
| `Field` / `PageForm` | Create / move dialogs |
| `MasterSelect` / company selectlist | Company on SITE create |
| `useToast` / `callout callout-danger` | Errors (esp. archive dependency messages) |
| Font Awesome (`fas fa-*`) | Type icons; **do not** introduce Lucide into this module (Lucide is login-only today) |
| `window.confirm` | Archive confirmation (existing app pattern; no shared Modal) |

---

## 5. Components to extend

| Area | Extension |
|---|---|
| `client/src/api/client.ts` (`mastersApi` or new `facilitiesApi`) | Add hierarchy client methods matching Wave 2.6 contracts |
| `App.tsx` | New routes under `/facilities` (recommended) |
| `AppLayout.tsx` | Sidebar entry + optional section tabs + `resolveSection` |
| `createLocation` TypeScript body type | Already incomplete vs backend: must allow `location_type_id`, `space_subtype_id`, `parent_id` for Facility create |

**Do not extend** existing `LocationForm` into a full hierarchy editor in this wave (risk of confusing operational CRUD with typed facilities). Prefer Facility-specific create/move dialogs.

---

## 6. New components proposed

Keep new surface area small; colocate under e.g. `client/src/pages/facilities/`:

| Component | Role |
|---|---|
| `FacilityManagementPage` | Shell: header, metrics, tabs (Physical / Operational), split layout |
| `FacilityTree` | Expand/collapse typed tree from `/locations/tree` |
| `FacilityTreeNode` | Single node row (type icon, selected state) |
| `FacilityNodeDetails` | Breadcrumb + fields + actions + tabs |
| `FacilityBreadcrumb` | Path from `/locations/:id/path` |
| `FacilityNodeDialog` | Create / Add Child (POST `/locations`) |
| `MoveFacilityNodeDialog` | POST `/locations/:id/move` |
| `FacilityAssetsTab` | GET `/locations/:id/assets` — **read-only** |
| `FacilityInventoryTab` | GET `/locations/:id/inventory` — **read-only** |
| `OperationalLocationsPanel` | Wrapper around existing list patterns / link to Masters Locations without mixing into tree |

Optional CSS block in `refex.css` for split-pane + tree selected state (match existing density).

---

## 7. Routes proposed

**Recommended base:** `/facilities` (avoids colliding with existing `/locations` CRUD).

| Route | Purpose |
|---|---|
| `/facilities` | Main Facility Management (Physical Hierarchy explorer + details) |
| `/facilities/operational` | Operational / legacy locations view (or in-page tab) |

Internal state (selected node id) via query `?node=:id` or local state — prefer `?node=` for deep-link refresh after move.

**Keep unchanged:**

- `/locations`, `/locations/create`, `/locations/:id`, `/locations/:id/edit`

---

## 8. Navigation integration (recommended)

**Preferred (cleanest, least duplication):**

1. Add sidebar item **Facility Management** gated by `settings.view` (same as Masters visibility for location browsing).  
2. Mutations (create/move/archive/restore) gated in UI by `settings.edit` (matches backend).  
3. Keep Masters → **Locations** as the operational flat list (label can stay “Locations”; Facility page explains the split).  
4. On Facility page, tab or secondary link: **Operational Locations** → `/facilities/operational` (reuse list UX) and/or link to `/locations`.

**Alternative (more nested under Masters):**

- Add section tab “Facilities” under Masters → `/facilities`.  
- Risk: Facilities buried; less discoverable for a major domain.

**Recommendation:** Top-level sidebar entry **Facility Management** + preserve Masters Locations.

Update `resolveSection` / `shouldShowSectionTabs` so Facility routes get optional internal tabs (Physical Hierarchy | Operational Locations) without hijacking Masters tabs.

---

## 9. API mapping (actual contracts — do not invent)

### Auth

| Method | Auth |
|---|---|
| GET hierarchy / types / assets / inventory | Authenticated (`authRequired`) |
| POST create / move / archive / restore; PUT/DELETE locations | `settings.edit` |

### Client helper behavior

`api()` throws `Error` with `messages` joined by `", "`. Archive 422 payloads include `payload.dependencies` in HTTP body, but **`api()` currently drops `payload`** and only surfaces messages.  
**Implication:** Archive UX can show backend message text; rich dependency counts require either extending `api()` error shape slightly or parsing message list (messages already include bullet-style dependency lines from Wave 2.6). Prefer extending error to carry optional `payload` only if needed — small, safe change.

### Endpoints

| UI need | API | Request | Response shape |
|---|---|---|---|
| Physical tree | `GET /locations/tree` | `company_id?`, `root_id?`, `include_operational?`, `include_archived?` | `{ trees, operational?, meta }` via `okItem` (raw body) |
| Operational separate | Same with `include_operational=true` | | `operational[]` **not** grafted into `trees` |
| Path / breadcrumb | `GET /locations/:id/path` | | `{ path: [...] }` |
| Children (optional refresh) | `GET /locations/:id/children` | `include_archived?` | `{ children: [...] }` |
| Create preflight | `GET /locations/validate-parent` | `parent_id`, `location_type_id` or `type` | `{ valid, parent_id }` or 422 |
| Move preflight | `GET /locations/:id/validate-parent` | `parent_id` | same |
| Create node | `POST /locations` | `name`, `location_type_id`, `parent_id?`, `company_id?`, `space_subtype_id?`, … | `okMessage` + mapped row |
| Move | `POST /locations/:id/move` | `{ parent_id }` | `okMessage` + node/path |
| Archive | `POST /locations/:id/archive` | | `okMessage` or 422 + dependency messages |
| Restore | `POST /locations/:id/restore` | | `okMessage` + mapped row |
| Node assets | `GET /locations/:id/assets` | `limit`, `offset` | `{ total, placement_count, rtd_count, rows }` (**not** wrapped in status) |
| Node inventory | `GET /locations/:id/inventory` | | `{ consumables, accessories, components, total }` |
| Type masters | `GET /location-types` | | `{ total, rows }` |
| Subtype masters | `GET /space-subtypes` | | `{ total, rows }` |
| Operational flat list | Existing `GET /locations` / selectlist | | Unchanged |
| Soft delete (legacy) | `DELETE /locations/:id` | | **Do not use in Facility UI** — use archive |

### Tree node fields (from foundation)

`id`, `name`, `parent_id`, `company_id`, `archived`, `location_type_id`, `location_type{id,code,name}`, `space_subtype_id`, `space_subtype?`, `children[]`  
**No** `assets_count` on tree nodes.

### Detail row fields (`mapLocationRow`)

`id`, `name`, `parent{id,name|null}`, `company{id,name|null}`, `address`, `notes`, `assets_count` (placement `location_id` only — **not** RTD), `location_type`, `space_subtype`.

### Metrics that are safe without new APIs

Derive from loaded `trees` walk:

- Sites / Buildings / Floors / Spaces (and Zones / Department Areas if desired)

**Omit or defer:** “Assets in Facilities” as a global aggregate — would require N calls to `/locations/:id/assets` or a new backend aggregate. Per-node Assets tab is sufficient for Wave 2.8.

---

## 10. Hierarchy UX rules (frontend assists; backend authoritative)

| Rule | Frontend assist | Backend |
|---|---|---|
| SITE root only | Hide parent for SITE; block SITE under anything | Enforced |
| Allowed children by type | Filter Add Child type dropdown | Enforced |
| SPACE leaf | Hide Add Child on SPACE | Enforced |
| SPACE subtype | Show subtype field only when type=SPACE | Enforced |
| Typed under UNSPECIFIED | Never offer UNSPECIFIED as parent in Facility create/move | Enforced |
| Move ≠ move assets | Copy in UI help text; no placement updates | Move only updates `parent_id` |
| Archive | Confirm + show API errors | Dependency guards |

Allowed child matrix (for dropdown filtering only):

- SITE → BUILDING  
- BUILDING → FLOOR  
- FLOOR → ZONE | DEPARTMENT_AREA | SPACE  
- ZONE → SPACE  
- DEPARTMENT_AREA → SPACE  
- SPACE → (none)

---

## 11. RBAC plan (no redesign)

| Action | UI gate | Backend |
|---|---|---|
| View Facility Management / tree / details / assets / inventory | `settings.view` (or authenticated if we want broader read — **recommend `settings.view`** to match Masters) | Authenticated GET |
| Create / Add Child / Move / Archive / Restore | `settings.edit` | `settings.edit` |
| Operational Locations list | Same as Masters Locations (`settings.view`) | Authenticated GET |

Do **not** add `locations.*` / `facilities.*` permission keys in this wave.

---

## 12. Mobile behavior

Existing breakpoint: `991px` (`AppLayout` narrow drawer).

Facility page:

- **Desktop:** left tree (~320–380px) + right details.  
- **Narrow:** list/tree full width; selecting a node navigates to details pane (state or nested view); back control returns to tree. Do not squeeze split-pane.

---

## 13. Styling direction

- Match `refex.css` / AdminLTE-like boxes, `btn-theme`, `label`, `detail-layout`.  
- Subtle type differentiation via small FA icons + muted text badges (`label-default` / `label-primary`), not rainbow nodes.  
- Icons examples (non-binding): SITE `fa-map-marker-alt`, BUILDING `fa-building`, FLOOR `fa-layer-group`, ZONE `fa-draw-polygon`, DEPARTMENT_AREA `fa-briefcase`, SPACE `fa-door-open`.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Confusing Facility UI with Masters Locations | Clear labels; Operational tab; do not auto-import UNSPECIFIED into tree |
| Users use legacy DELETE instead of archive | Facility UI only calls archive/restore; leave Masters delete as-is (document gap) |
| `api()` loses error `payload` | Rely on messages; optional small error enhancement |
| `createLocation` TS type missing typed fields | Extend type when adding Facility create client |
| Tree empty in production (0 typed nodes until approved data) | Strong empty state + “Add Facility Node” CTA; staging has WAVE27 sample |
| Performance walking large trees | Backend returns full forest in one call (OK for current scale); no N+1 |
| Accidental edit of legacy rows | Facility create always sets physical type; never retype existing UNSPECIFIED from this UI |
| Section / sidebar active-state bugs | Explicit `resolveSection` for `/facilities` |
| Regression of selectlists | Do not change `mastersApi.locations()` selectlist signature |

---

## 15. Explicit non-goals (Wave 2.8)

- Facility Management UI implementation happens only after Step 2 plan approval (this document is Step 1).  
- No DB migrations / schema / production hierarchy data creation.  
- No reclassification / reparenting of 187 UNSPECIFIED locations.  
- No checkout / check-in / import / placement FK changes.  
- No descendant hardware filtering.  
- No new RBAC permission catalog.  
- No new frontend test framework.

---

## 16. Missing APIs?

| Need | Status |
|---|---|
| Tree / path / children / validate / move / archive / restore / assets / inventory / types / subtypes | **Present** |
| Aggregate “assets across all facility nodes” | **Absent** — omit metric |
| Dedicated “list archived only” | Partial via `include_archived=true` on tree/children — adequate |
| Company name always populated on `parent` nest | Weak (`name` often null) — use path entries / company selectlist for display |

**Conclusion:** Proceed to Step 2 (implementation plan) without backend redesign. No STOP blocker for missing core hierarchy APIs.

---

## 17. Recommended next step

**STEP 2:** Produce `WAVE2_8_FACILITY_UI_IMPLEMENTATION_PLAN.md` (file-by-file changes, state, mobile, RBAC, regression risks).

**Do not implement UI until that plan is complete.**
