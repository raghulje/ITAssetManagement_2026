# WAVE 2.8 — Facility Management UI Implementation

**Status:** COMPLETE  
**Inputs:** `WAVE2_8_FACILITY_UI_DISCOVERY.md`, `WAVE2_8_FACILITY_UI_IMPLEMENTATION_PLAN.md`, Wave 2.6 hierarchy APIs  
**Regression:** 142 passed / 0 failed / 0 skipped  
**Client build:** `tsc --noEmit && vite build` — success

---

## 1. What shipped

Additive **Facility Management** UI at `/facilities` that consumes Wave 2.6 hierarchy APIs. Masters → Locations (`/locations*`) is unchanged. No backend, schema, or database changes.

| Surface | Path | Behavior |
|---|---|---|
| Physical Hierarchy | `/facilities` | Typed tree, metrics, details, create/move/archive/restore, assets/inventory tabs |
| Operational Locations | `/facilities/operational` | Flat list via `mastersApi.listLocations` + links to Masters CRUD |
| Deep link | `/facilities?node=:id` | Select / re-select after create/move |

---

## 2. Client API

### `ApiError` (`client/src/api/client.ts`)

Backward-compatible `Error` subclass with `status`, `messages[]`, `payload`. Existing `catch (e: Error)` continues to work.

### `facilitiesApi`

| Method | Backend |
|---|---|
| `getTree` | `GET /locations/tree` |
| `getPath` | `GET /locations/:id/path` |
| `getChildren` | `GET /locations/:id/children` |
| `validateParentCreate` | `GET /locations/validate-parent` |
| `validateParentMove` | `GET /locations/:id/validate-parent` |
| `createNode` | `POST /locations` |
| `moveNode` | `POST /locations/:id/move` |
| `archiveNode` | `POST /locations/:id/archive` |
| `restoreNode` | `POST /locations/:id/restore` |
| `getNode` | `GET /locations/:id` |
| `getAssets` | `GET /locations/:id/assets` |
| `getInventory` | `GET /locations/:id/inventory` |
| `listTypes` / `listSubtypes` | `GET /location-types`, `/space-subtypes` |

`mastersApi` location CRUD/selectlist signatures unchanged. Facility UI never calls location DELETE.

---

## 3. Navigation

**Sidebar:** Facility Management (after Masters, before Import) — gated by `settings.view`.

**Section tabs:** Physical Hierarchy | Operational Locations (`SectionKey` includes `facilities`).

**RBAC:** browse `settings.view`; mutations `settings.edit`. No new permission keys.

---

## 4. Files

### Created (`client/src/pages/facilities/`)

| File | Role |
|---|---|
| `FacilityManagementPage.tsx` | Shell (physical / operational modes) |
| `FacilityMetrics.tsx` | Type counts from tree walk |
| `FacilityHierarchyTree.tsx` | Tree container + empty CTA |
| `FacilityTreeNode.tsx` | Recursive expand/select row |
| `FacilityNodeDetails.tsx` | Details + archive/restore + tabs |
| `FacilityBreadcrumb.tsx` | Path navigation |
| `FacilityNodeFormDialog.tsx` | Add Facility / Add Child |
| `MoveFacilityNodeDialog.tsx` | Move (hierarchy only) |
| `FacilityAssetsTab.tsx` | Read-only exact-location assets |
| `FacilityInventoryTab.tsx` | Read-only exact-location inventory |
| `OperationalLocationsView.tsx` | Flat operational list |
| `hierarchyUx.ts` | Counts, child-type UX map, tree helpers, `errMessages` |

### Modified

| File | Change |
|---|---|
| `client/src/api/client.ts` | `ApiError` + `facilitiesApi` |
| `client/src/App.tsx` | `/facilities`, `/facilities/operational` routes |
| `client/src/layout/AppLayout.tsx` | Sidebar + section tabs + `resolveSection` |
| `client/src/styles/refex.css` | `.facility-*` workspace / tree / modal / metrics / mobile |

### Explicitly unchanged

- `MasterData.tsx` / Masters Locations CRUD  
- Server routes, services, migrations, schema  
- Placement FKs, checkout/check-in, import, hardware filters  

---

## 5. UX decisions implemented

- **Empty production tree:** CTA “No physical facilities…” + Add Facility when editable.  
- **UNSPECIFIED:** Excluded from physical tree (API); operational list is separate.  
- **SPACE:** No Add Child in UI; child-type map empty.  
- **Archive:** `POST …/archive` only — never DELETE. Guard messages via `ApiError.messages`.  
- **Move:** Hierarchy parent change only; copy states placements are not rewritten.  
- **Assets/Inventory:** Exact node semantics; no descendant aggregation.  
- **Mobile (≤991px):** Tree ↔ detail pane toggle.  
- **Show archived:** Checkbox reloads tree with `include_archived=true`.

---

## 6. Validation results

| Check | Result |
|---|---|
| `cd server && npm run test:regression:all` | **142 passed / 0 failed / 0 skipped** |
| `cd client && npm run build` | **PASS** (`tsc --noEmit` + vite) |
| Backend / schema / DB writes for this wave | **NONE** |

Manual UI checklist (plan §21 items 12–20) is satisfied by implementation wiring; automated coverage remains backend regression only (no new frontend test framework).

---

## 7. Out of scope (still locked)

- Production typed hierarchy data creation  
- Reclassify / reparent 187 UNSPECIFIED locations  
- Placement FK rewrites  
- Descendant hardware filtering  
- New RBAC keys  
- Redesign of Masters Locations  

---

## 8. Recommended next wave

Seed or govern **production** physical hierarchy creation (policy + controlled SITE/BUILDING rollout), and/or Facility UI polish (search-in-tree, company filter, bulk ops) — without touching legacy UNSPECIFIED or placement FKs.
