# WAVE 2.8 — Facility Management UI Implementation Plan

**Status:** STEP 2 complete (historical plan). **Step 3 implemented** — see `WAVE2_8_FACILITY_UI_IMPLEMENTATION.md` and `PHASE6_WAVE2_8_COMPLETION_REPORT.md`.  
**Inputs:** `WAVE2_8_FACILITY_UI_DISCOVERY.md`, Wave 2.6 backend contracts, verified client/server source.  
**Regression baseline to preserve:** 142 passed / 0 failed / 0 skipped.

---

## 1. Executive recommendation

Build an **additive** Facility Management module at `/facilities` that:

- Consumes existing Wave 2.6 hierarchy APIs (no new backend routes, no schema).
- Uses a **dedicated `facilitiesApi`** in `client/src/api/client.ts` (alongside unchanged `mastersApi` location CRUD/selectlist).
- Presents **Physical Hierarchy** (typed tree) and **Operational Locations** (flat legacy view) as **section tabs** driven by nested routes under `/facilities`.
- Leaves Masters → Locations (`/locations*`) completely unchanged.
- Gates browse with `settings.view`, mutations with `settings.edit`.
- Supports a first-class **empty state** (production currently has 0 typed nodes).

**Backend changes required:** NONE (optional tiny shared `api()` error enhancement only — frontend utility).  
**Schema / data changes:** NONE.

---

## 2. Final information architecture

```
Facility Management (/facilities)
├── Physical Hierarchy   ← default view
└── Operational Locations
```

**Masters → Locations** remains the existing flat CRUD for HRMS/operational locations.

Facility Management does **not** replace Masters Locations; it provides the typed facilities experience and a clearer read-oriented operational entry point.

---

## 3. Route architecture

### Choice: **B — Nested routes + section tabs** (fits current app)

The app already uses `AppLayout` **section tabs** (`SECTION_TABS` in `AppLayout.tsx`) for Assets / People / Masters / Settings / Reports. Tabs are `Link`s to real routes/query URLs, with `isActive(pathname, search)`.

**Facility Management should follow the same pattern**, not invent an in-page-only tab system that fights the shell.

### Routes

| Path | Element | Purpose |
|---|---|---|
| `/facilities` | `FacilityManagementPage` (mode=physical) | Physical Hierarchy workspace |
| `/facilities/operational` | `FacilityManagementPage` (mode=operational) **or** thin wrapper | Operational Locations view |

Optional deep link:

| Query | Purpose |
|---|---|
| `/facilities?node=:id` | Select node after refresh / move / create |

**Rejected:** single route with only local React tab state — loses refresh/deep-link consistency with the rest of the app.

### Navigation state & deep linking

| Concern | Behavior |
|---|---|
| Section tabs | `Physical Hierarchy` → `/facilities`; `Operational Locations` → `/facilities/operational` |
| Selected node | `?node=<id>` on physical route; cleared when switching to operational |
| Browser refresh | Tree reloads; if `node` still exists in typed tree, re-select; else clear selection + optional toast |
| History | Changing selection updates `node` via `navigate(..., { replace: true })` to avoid cluttering history |
| Invalid node id | Show details error / “Node not found”; keep tree usable |

### Why this fits the codebase

- Mirrors Masters/People section-tab pattern in `AppLayout.tsx`.
- `shouldShowSectionTabs` already keys off list-style paths (`/^\/locations\/?$/`, etc.) — Facility list routes are analogous.
- Avoids over-routing (`/facilities/tree`, `/facilities/:id` detail pages unnecessary for split-pane desktop UX).

---

## 4. Navigation integration

### Files

- **MODIFY** `client/src/layout/AppLayout.tsx`
- **MODIFY** `client/src/App.tsx`

### Sidebar

Add under Masters (same permission band):

```
{can('settings.view') ? (
  <li className={path.startsWith('/facilities') ? 'active' : ''}>
    <NavLink to="/facilities" …>
      <i className="fas fa-building fa-fw" />
      <span>Facility Management</span>
    </NavLink>
  </li>
) : null}
```

Place **after** Masters, **before** Import — domain adjacency without burying under Settings.

### Section tabs

Extend:

```ts
type SectionKey = 'assets' | 'people' | 'masters' | 'settings' | 'reports' | 'facilities'
```

```ts
facilities: [
  { to: '/facilities', label: 'Physical Hierarchy', isActive: (p) => p === '/facilities' || (p.startsWith('/facilities') && !p.startsWith('/facilities/operational')) },
  { to: '/facilities/operational', label: 'Operational Locations', isActive: (p) => p.startsWith('/facilities/operational') },
]
```

Update `resolveSection`:

- `pathname.startsWith('/facilities')` → `'facilities'`

Update `shouldShowSectionTabs` list routes:

- `/^\/facilities\/?$/`
- `/^\/facilities\/operational\/?$/`

### Unchanged

- Masters → Locations tab and `/locations*` routes.

---

## 5. Component architecture

Colocate under `client/src/pages/facilities/`. Prefer page-local components over premature shared library entries.

| Component | Status | Path | Responsibility | Key props / state | APIs |
|---|---|---|---|---|---|
| `FacilityManagementPage` | CREATE | `pages/facilities/FacilityManagementPage.tsx` | Shell: header, metrics, split/stack layout, owns tree load + selection | `mode: 'physical' \| 'operational'` via route | tree load |
| `FacilityMetrics` | CREATE | `pages/facilities/FacilityMetrics.tsx` | Count Sites/Buildings/Floors/Spaces from trees | `trees` | none |
| `FacilityHierarchyTree` | CREATE | `pages/facilities/FacilityHierarchyTree.tsx` | Expand/collapse, selection, empty/loading/error | `trees`, `selectedId`, `onSelect`, `expandedIds`, `onToggle` | none (data from parent) |
| `FacilityTreeNode` | CREATE | `pages/facilities/FacilityTreeNode.tsx` | Recursive row + children | `node`, `depth`, selection/expand callbacks | none |
| `FacilityNodeDetails` | CREATE | `pages/facilities/FacilityNodeDetails.tsx` | Details/Assets/Inventory tabs + actions | `nodeId`, callbacks for mutations | path, get, assets, inventory |
| `FacilityBreadcrumb` | CREATE | `pages/facilities/FacilityBreadcrumb.tsx` | Path display | `path[]` | none |
| `FacilityNodeFormDialog` | CREATE | `pages/facilities/FacilityNodeFormDialog.tsx` | Create / Add Child modal-style panel | `mode`, `parentId?`, `onSuccess` | types, subtypes, validate-parent, create |
| `MoveFacilityNodeDialog` | CREATE | `pages/facilities/MoveFacilityNodeDialog.tsx` | Move parent picker | `nodeId`, current parent, `onSuccess` | validate-parent, move, tree for parent options |
| `FacilityAssetsTab` | CREATE | `pages/facilities/FacilityAssetsTab.tsx` | Read-only assets table | `locationId` | get assets |
| `FacilityInventoryTab` | CREATE | `pages/facilities/FacilityInventoryTab.tsx` | Read-only inventory groups | `locationId` | get inventory |
| `OperationalLocationsView` | CREATE | `pages/facilities/OperationalLocationsView.tsx` | Flat operational list + link to Masters | — | `mastersApi.listLocations` |

### Reuse (NO CHANGE to component APIs unless noted)

| Component | Path | Use |
|---|---|---|
| `AppLayout` | `layout/AppLayout.tsx` | Page chrome |
| `Box`, `Field`, `PageForm`, `DataTable`, `StatusBadge` | `components/ui.tsx` | Panels, forms, tables |
| `DetailLayout` | `components/DetailLayout.tsx` | Node summary + tabs |
| `useToast` | `components/Toast.tsx` | Success/error feedback |
| `useAuth` / `can` | `api/AuthContext.tsx` | RBAC |
| Font Awesome | existing markup | Type icons |

### Avoid

- New icon libraries in this module.
- Extracting Masters `ApiMasterList` into a shared package (high regression risk).
- Global state libraries (React local state + URL is enough).

---

## 6. API integration map

### Placement: dedicated `facilitiesApi` in `client/src/api/client.ts`

**Why not `mastersApi`:** Masters methods are flat CRUD/selectlist used widely. Hierarchy methods are Facility-scoped; a separate export avoids accidental coupling and keeps selectlist contracts visually untouched.

**Also:** slightly extend `createLocation` body type **only if** Facility create reuses it — preferred: Facility create goes through `facilitiesApi.createNode` calling `POST /locations` so Masters typings stay as-is.

### Methods to add (`facilitiesApi`)

| Method | HTTP | Notes |
|---|---|---|
| `getTree(params?)` | `GET /locations/tree` | Query: `company_id`, `root_id`, `include_operational`, `include_archived`. Returns `{ trees, operational?, meta }` |
| `getPath(id)` | `GET /locations/:id/path` | `{ path }` |
| `getChildren(id, opts?)` | `GET /locations/:id/children` | Optional; tree usually enough |
| `validateParentCreate(q)` | `GET /locations/validate-parent` | `parent_id`, `location_type_id` and/or `type` |
| `validateParentMove(id, parent_id)` | `GET /locations/:id/validate-parent` | |
| `createNode(body)` | `POST /locations` | `name`, `location_type_id`, `parent_id?`, `company_id?`, `space_subtype_id?`, optional address/notes |
| `moveNode(id, parent_id)` | `POST /locations/:id/move` | Body `{ parent_id }` — **parent_id only** |
| `archiveNode(id)` | `POST /locations/:id/archive` | Never call `DELETE` |
| `restoreNode(id)` | `POST /locations/:id/restore` | |
| `getAssets(id, {limit,offset})` | `GET /locations/:id/assets` | `{ total, placement_count, rtd_count, rows }` |
| `getInventory(id)` | `GET /locations/:id/inventory` | Groups + totals |
| `listTypes()` | `GET /location-types` | `{ total, rows }` |
| `listSubtypes()` | `GET /space-subtypes` | `{ total, rows }` |

### Explicit non-use

| API | Facility UI |
|---|---|
| `DELETE /locations/:id` | **Forbidden** in Facility flows |
| `mastersApi.locations()` selectlist | **Unchanged**; not rewritten |
| Hardware/inventory placement endpoints | **Not called** for move/archive |

### Types

Add lightweight TypeScript types in `client.ts` (or `pages/facilities/types.ts`) mirroring tree node / path entry shapes from Wave 2.6 — do not import server modules into the client.

---

## 7. State management strategy

Owned primarily by `FacilityManagementPage` (physical mode):

| State | Owner | Persistence |
|---|---|---|
| `trees`, `treeLoading`, `treeError` | Page | Memory; reload on mount / after mutation |
| `selectedId` | Page ↔ URL `?node=` | URL |
| `expandedIds: Set<number>` | Page or Tree | Memory; after create/move expand ancestors |
| `metrics` | Derived from `trees` | — |
| Dialog open (create/move) | Page | Memory |
| Detail tab (`details`/`assets`/`inventory`) | `FacilityNodeDetails` | Memory |
| Path / detail row | Details | Fetch on `selectedId` change |
| Assets / inventory | Tabs | Lazy fetch when tab active |

No Redux/Context beyond existing Auth/Toast.

Refresh after mutation:

1. `await facilitiesApi.getTree()`
2. Keep `selectedId` if still present (and not archived unless viewing archived)
3. Re-expand path to selected node
4. Toast success

---

## 8. Tree behavior

### Data

- Load `GET /locations/tree` **without** `include_operational` for the Physical Hierarchy.
- Backend already excludes UNSPECIFIED and soft-deleted by default.
- Do **not** client-filter further unless defensive (`location_type.code !== 'UNSPECIFIED'`).

### Rendering

- Recursive `FacilityTreeNode` over `node.children`.
- Expand/collapse via local `expandedIds`.
- Initial expansion: expand all SITE roots (and optionally first level BUILDING) when tree is small (< ~50 nodes); otherwise expand SITE only. Staging sample (~12 nodes) → expand all is fine.
- Selected row: distinct background using existing CSS patterns (e.g. table hover / active nav tones) — single accent, not rainbow.

### Type visuals (subtle)

| Type | Icon (FA) | Badge text |
|---|---|---|
| SITE | `fa-map-marker-alt` | Site |
| BUILDING | `fa-building` | Building |
| FLOOR | `fa-layer-group` | Floor |
| ZONE | `fa-border-all` | Zone |
| DEPARTMENT_AREA | `fa-briefcase` | Dept area |
| SPACE | `fa-door-open` | Space (+ subtype name if present) |

Use `label label-default` / muted text — no per-type neon colors.

### Empty / loading / error

See §17.

---

## 9. Node details behavior

### Layout

Reuse `DetailLayout` with tabs:

1. **Details** (default)  
2. **Assets**  
3. **Inventory**

### Data loading

| Data | When |
|---|---|
| Node summary | Prefer selected tree node fields immediately; optionally `GET /locations/:id` for `assets_count`, notes, address |
| Breadcrumb | `GET /locations/:id/path` on selection |
| Assets | Lazy on Assets tab |
| Inventory | Lazy on Inventory tab |

### Display fields (only if present)

- Name  
- Type badge (`location_type.name` / code)  
- Space subtype (SPACE only)  
- Company (`company` nest or `company_id` + companies selectlist lookup if name null)  
- Parent (from path penultimate or `parent`)  
- Status: Active / Archived (`archived` or `deleted_at`)  
- Notes/address if loaded from detail GET  

### Actions visibility (`settings.edit` required for all mutations)

| Action | Visible when |
|---|---|
| Add Child | Selected, not archived, type ≠ SPACE |
| Move | Selected, not archived, type ≠ SITE (SITE stays root; backend also rejects) |
| Archive | Selected, not archived |
| Restore | Selected node is archived (only if tree loaded with `include_archived` **or** restore entry from a small “show archived” toggle — see §13). Default plan: optional toolbar toggle “Show archived” → reload tree with `include_archived=true`; Restore then available on archived selection |

Viewers (`settings.view` only): no mutation buttons.

---

## 10. Create flow

### Entry points

1. Header **+ Add Facility** → dialog (default type SITE, parent empty).  
2. Details **Add Child** → same dialog with `parentId` prefilled, type dropdown UX-filtered.

### Fields

| Field | Rules |
|---|---|
| Name | Required |
| Type | Required; from `GET /location-types` excluding UNSPECIFIED for Facility create |
| Parent | Hidden/disabled for SITE; required for others; picker from typed tree nodes only |
| Company | Shown for SITE (recommended); optional otherwise |
| Space subtype | Only when type code === `SPACE`; from `GET /space-subtypes` |
| Notes | Optional |

### Validation

1. Frontend: required fields + UX type filter via static child-allow map (mirror of backend matrix for dropdown only — document as UX assist, not source of truth).  
2. Optional preflight: `GET /locations/validate-parent?parent_id=&location_type_id=`.  
3. Submit `POST /locations`.  
4. On 422: show `messages` in dialog.  
5. On success: close dialog, refresh tree, select new id (`?node=`), expand ancestors, toast.

### Add Child type filter (UX only)

| Parent type | Suggested child types |
|---|---|
| SITE | BUILDING |
| BUILDING | FLOOR |
| FLOOR | ZONE, DEPARTMENT_AREA, SPACE |
| ZONE | SPACE |
| DEPARTMENT_AREA | SPACE |
| SPACE | — (action hidden) |

Backend remains authoritative.

---

## 11. Add child flow

Same as Create with:

- `parentId = selectedId`
- Parent field read-only showing selected name
- Type default = first suggested child type

No separate route.

---

## 12. Move flow

### UI

`MoveFacilityNodeDialog`:

- Show current parent name (from path).  
- New parent selector: typed non-archived nodes excluding self and descendants (client-side prune from tree for UX).  
- SITE: Move button hidden.  
- Preflight `validateParentMove` on parent change (debounce optional).  
- Submit `POST /locations/:id/move` with `{ parent_id }` only.

### After success

Refresh tree; keep selection; reload path; toast.

### Explicit placement rule (UI)

Dialog help text:

> Moving a facility changes hierarchy only. Asset and inventory placements stay on the same location record.

**No frontend code** may call hardware/inventory update APIs as part of move.

---

## 13. Archive / restore flow

### Archive

1. `window.confirm` (existing app pattern — Users, etc.).  
2. `POST /locations/:id/archive`.  
3. On success: refresh tree; clear selection if archived node was selected; toast.  
4. On failure: show full backend message list (children/assets/RTD/inventory/users/departments).

### Restore

1. Requires archived node visible (`include_archived=true` toggle).  
2. `POST /locations/:id/restore`.  
3. Refresh; select restored node.

### Never

- Call `mastersApi.removeLocation` / `DELETE /locations/:id` from Facility UI.

---

## 14. Operational locations strategy

### Recommendation: **C — lightweight wrapper + link to Masters** (lowest risk)

`OperationalLocationsView`:

- Calls existing `mastersApi.listLocations({ limit: 500, search })`.  
- Renders `DataTable` with name, company, assets_count, notes (same columns as Masters list).  
- Row link → existing `/locations/:id` (reuse Masters detail).  
- Primary CTA: **Manage in Masters** → `/locations` (and Create → `/locations/create` for users with `settings.edit`).  
- Banner: “These are operational / HRMS locations (typically Unspecified). They are not part of the physical facility hierarchy.”

### Why not full embedded CRUD

- Duplicating `ApiMasterForm` / delete / bulk-delete risks diverging from Masters and accidentally encouraging DELETE vs archive.  
- Masters Locations already works and must remain regression-stable.

### Why not extract shared list component in Wave 2.8

- Higher churn in `MasterData.tsx` for little gain. Defer extraction.

### Physical tree isolation

Operational view never feeds the tree. Tree load never uses `include_operational` for the left panel (optional separate diagnostic only — not in v1 UI).

---

## 15. RBAC strategy

| Capability | Permission | Pattern |
|---|---|---|
| See sidebar “Facility Management” | `settings.view` | Same as Masters |
| Open `/facilities*` | `settings.view` (optional soft gate in page; sidebar already hides) | |
| View tree/details/assets/inventory | Authenticated + `settings.view` | Backend GET = any authenticated user; UI still uses settings.view for consistency with Masters |
| Create / Add Child / Move / Archive / Restore | `settings.edit` | Hide buttons; backend enforces |

`isAdmin` / superuser already bypass via `can()`.

**No new permission keys.**

---

## 16. Responsive strategy

Breakpoint: existing `991px` (`NARROW_MQ` in `AppLayout.tsx`).

### Desktop (≥992px)

Split pane:

- Left ~34% tree (`Box`)  
- Right ~66% details  

### Tablet

Same split if width allows; if cramped, stack with tree max-height ~40vh then details.

### Mobile (<992px)

Do **not** shrink split-pane.

Flow:

1. Default: show **tree only** (full width).  
2. On select: set `?node=` and switch to **details-only** view (`mobileView: 'tree' | 'detail'`).  
3. Details header: **Back to hierarchy** clears detail mode (keeps or clears `node` — prefer keep `node` but show tree).  
4. Actions: stack vertically under summary.  
5. Tabs: full-width, same DetailLayout tabs.

---

## 17. Loading / empty / error states

| Surface | Loading | Empty | Error |
|---|---|---|---|
| Tree | “Loading facilities…” | Title: **No physical facilities have been created yet.** Body: explain Sites/Buildings/…. CTA: **+ Add Facility** if `settings.edit` | `callout-danger` + Retry |
| Metrics | Skeletons or `0` while loading | All zeros with empty tree | Hide or zero |
| Details (no selection) | — | “Select a facility node to view details.” | — |
| Details (selected) | Loading path/detail | — | callout |
| Assets | Loading… | “No assets placed at this location.” (exact placement) | callout |
| Inventory | Loading… | “No inventory at this location.” | callout |
| Operational list | Same as Masters list pattern | “No locations found.” | callout |

Production empty tree is the **critical happy path** until typed data exists.

---

## 18. Minimal API error handling improvement

### Current behavior (`client/src/api/client.ts`)

```ts
if (!res.ok) {
  const msg = Array.isArray(data.messages) ? data.messages.join(', ') : …
  throw new Error(String(msg))
}
```

Archive guards already put human-readable lines in `messages[]`. **Joined messages are enough** for v1 display.

### Proposed minimal change (optional but recommended)

Introduce a small typed error **without breaking callers**:

```ts
export class ApiError extends Error {
  status: number
  messages: string[]
  payload: unknown
}
```

Throw `ApiError` instead of plain `Error` when `!res.ok`.

| Impact | Assessment |
|---|---|
| Existing `catch (e: Error) => e.message` | Still works (`ApiError` extends `Error`) |
| Facility archive UI | Can render `messages` as a list if `e instanceof ApiError` |
| Broad rewrite | **Not required** |

**Localized alternative (if shared change deferred):** Facility archive catch uses `String(e.message)` only — Wave 2.6 messages already include “Cannot archive…” lines. Prefer `ApiError` as a one-file, backward-compatible improvement in Phase A.

**Do not** change success response handling or selectlist parsing.

---

## 19. File-by-file modification plan

| File | Status | Change |
|---|---|---|
| `client/src/App.tsx` | MODIFY | Add `/facilities` and `/facilities/operational` routes |
| `client/src/layout/AppLayout.tsx` | MODIFY | Sidebar item; `SectionKey`; `SECTION_TABS.facilities`; `resolveSection`; `shouldShowSectionTabs` |
| `client/src/api/client.ts` | MODIFY | Add `facilitiesApi`; optional `ApiError` |
| `client/src/pages/facilities/FacilityManagementPage.tsx` | CREATE | Main page |
| `client/src/pages/facilities/FacilityMetrics.tsx` | CREATE | Metric chips/cards |
| `client/src/pages/facilities/FacilityHierarchyTree.tsx` | CREATE | Tree container |
| `client/src/pages/facilities/FacilityTreeNode.tsx` | CREATE | Recursive node |
| `client/src/pages/facilities/FacilityNodeDetails.tsx` | CREATE | Details + tabs + actions |
| `client/src/pages/facilities/FacilityBreadcrumb.tsx` | CREATE | Path |
| `client/src/pages/facilities/FacilityNodeFormDialog.tsx` | CREATE | Create / Add Child |
| `client/src/pages/facilities/MoveFacilityNodeDialog.tsx` | CREATE | Move |
| `client/src/pages/facilities/FacilityAssetsTab.tsx` | CREATE | Read-only assets |
| `client/src/pages/facilities/FacilityInventoryTab.tsx` | CREATE | Read-only inventory |
| `client/src/pages/facilities/OperationalLocationsView.tsx` | CREATE | Flat operational view |
| `client/src/pages/facilities/types.ts` | CREATE | Shared TS types (optional but clean) |
| `client/src/pages/facilities/hierarchyUx.ts` | CREATE | Child-type UX map + tree walk helpers (counts, descendants) |
| `client/src/styles/refex.css` | MODIFY | Minimal `.facility-*` split pane / tree selected styles |
| `client/src/pages/settings/MasterData.tsx` | **NO CHANGE** | Locations CRUD preserved |
| `mastersApi.locations` / list/create/update/remove | **NO CHANGE** (signatures) | |
| Asset/Checkout/Inventory/Users location consumers | **NO CHANGE** | |
| Server routes / services / schema | **NO CHANGE** | |
| Database | **NO CHANGE** | |

---

## 20. Phased implementation sequence

| Phase | Work | Files | Depends on | Risk | Validation |
|---|---|---|---|---|---|
| **A** | `facilitiesApi` + optional `ApiError` | `client.ts` | — | Low | `tsc`; manual fetch in browser optional |
| **B** | Routes + nav | `App.tsx`, `AppLayout.tsx` | A | Low | Nav visible; empty page renders |
| **C** | Page shell + metrics stub | `FacilityManagementPage`, `FacilityMetrics` | B | Low | Empty metrics 0 |
| **D** | Tree | Tree + TreeNode + CSS | C | Medium | Empty state; staging tree if pointed at test |
| **E** | Selection + details shell | NodeDetails | D | Medium | Select updates `?node=` |
| **F** | Breadcrumb + metadata | Breadcrumb, path API | E | Low | Path order root→node |
| **G** | Assets + Inventory tabs | AssetsTab, InventoryTab | E | Low | Read-only; empty OK |
| **H** | Create Facility | FormDialog | A,D | Medium | Creates SITE; tree refresh |
| **I** | Add Child | FormDialog parent mode | H | Medium | SPACE hides Add Child; invalid types filtered |
| **J** | Move | MoveDialog | D,E | Medium | Valid move; invalid 422; no placement calls |
| **K** | Archive / Restore | Details actions + archived toggle | J, ApiError | Medium | Guard messages; no DELETE |
| **L** | Operational view | OperationalLocationsView | B | Low | List works; link to `/locations` |
| **M** | Responsive | Page CSS/state | E–L | Medium | Mobile tree→detail flow |
| **N** | Regression validation | — | All | — | §21 checklist + `test:regression:all` + client `build` |

Do not start Phase H until tree empty/load states are solid (production empty path).

---

## 21. Regression protection plan

After implementation, run:

1. `cd server && npm run test:regression:all` → expect **≥142** pass, 0 fail.  
2. `cd client && npm run build` (`tsc --noEmit && vite build`).  
3. Manual checklist:

| # | Check |
|---|---|
| 1 | `/locations` list works |
| 2 | Location create/edit (Masters) works |
| 3 | Location selectlists work (asset form, etc.) |
| 4 | Asset create/edit location selection works |
| 5 | Checkout to location unchanged |
| 6 | Check-in unchanged |
| 7 | RTD location behavior unchanged |
| 8 | Hardware exact location filter unchanged |
| 9–11 | Consumable / accessory / component location behavior unchanged |
| 12 | Physical hierarchy loads (or empty state) |
| 13 | UNSPECIFIED excluded from physical tree |
| 14 | Tree selection works |
| 15 | Path works |
| 16 | Add child works |
| 17 | SPACE cannot receive children (UI + API) |
| 18 | Invalid moves rejected with message |
| 19 | Archive guard errors displayed |
| 20 | Mutations refresh tree/selection correctly |

No new frontend test framework.

---

## 22. Risks

| Risk | Mitigation |
|---|---|
| Production empty tree looks “broken” | Explicit empty state + Add Facility CTA |
| Users confuse Facility vs Masters Locations | Labels + Operational banner + no tree mixing |
| Accidental DELETE from Facility | Never wire removeLocation |
| `api()` error UX weak | Optional `ApiError`; messages already useful |
| Over-filtering child types incorrectly | UX filter only; always show backend error |
| Deep link to deleted/archived node | Graceful not-found; clear selection |
| CSS regressions in `refex.css` | Scope under `.facility-workspace` |
| Nav active-state collisions | Dedicated `facilities` section key |

---

## 23. Explicit out-of-scope

- Production hierarchy data creation  
- Reclassification / reparenting of 187 UNSPECIFIED locations  
- Changing `assets.location_id` / `rtd_location_id` / inventory `location_id`  
- Descendant asset filtering on hardware lists  
- Import hierarchy redesign  
- New RBAC keys / field-group permissions  
- Legal entity hierarchy / `legal_entity_id` / `sort_order` schema  
- Asset domain furniture/facilities classification UI  
- Asset relationships, PM, AMC  
- New frontend test framework  
- Backend redesign or new aggregate APIs  

---

## Appendix — Metrics derivation

Recursive walk of `trees`:

```
counts = { SITE:0, BUILDING:0, FLOOR:0, SPACE:0, … }
for each node: counts[type.code]++; walk children
```

Empty tree → all zeros. No extra API calls.

---

## Plan approval gate

**Ready for Step 3 implementation** after stakeholder acceptance of:

1. `/facilities` + `/facilities/operational` nested routes with section tabs  
2. Dedicated `facilitiesApi`  
3. Operational view as list + link to Masters (not duplicated CRUD)  
4. Optional minimal `ApiError` in `client.ts`  
5. No backend/schema/data changes  

**Step 3 authorized and completed** — implementation docs: `WAVE2_8_FACILITY_UI_IMPLEMENTATION.md`, `PHASE6_WAVE2_8_COMPLETION_REPORT.md`.
