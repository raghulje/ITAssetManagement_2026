# PHASE 6 — WAVE 2.5 COMPLETION REPORT

## Physical Location Hierarchy Domain & Management Design

**Date:** 2026-08-24  
**Mode:** Read-only architecture / UI-UX / implementation readiness

---

### 1. Completion summary

Wave 2.5 completed a deep design of operational vs physical location coexistence, parent-child rules, company/LE strategy, Facility Management UI/UX, additive APIs, move/archive/RBAC/audit rules, placement guidance, and a staged implementation plan. No code, schema, or database changes were made. Recommended architecture remains a **single typed `locations` table**, with legacy HRMS rows left as **UNSPECIFIED** and physical trees grown via UI (Wave 2.4 Option D).

### 2. Production code modified?

**NO**

### 3. Production database modified?

**NO**

### 4. Staging database modified?

**NO**

### 5. Recommended data architecture

**OPTION A** — Single `locations` table with typed hierarchy (`location_type_id`, `space_subtype_id`, `parent_id`). No parallel physical_spaces table.

### 6. Operational location strategy

Keep existing / HRMS locations as **UNSPECIFIED** (operational place names). Inclusive ITAM dropdowns. No auto-reparent. Optional later reviewed SITE retype without inventing children.

### 7. Physical hierarchy strategy

Create new typed SITE → BUILDING → FLOOR → (ZONE | DEPARTMENT_AREA | SPACE) nodes through Facility Management. Coexist with operational list.

### 8. Parent-child validation model

Preserve `locationFoundation` matrix; SPACE under FLOOR, ZONE, or DEPARTMENT_AREA; ZONE/DEPT are FLOOR siblings; SPACE is leaf; UNSPECIFIED soft for legacy; new UI blocks attaching typed children under UNSPECIFIED.

### 9. Company strategy

**OPTION C** — `company_id` **required on new SITE**; descendants inherit/resolve via ancestry (optional denormalized copy). No backfill of 187 legacy rows.

### 10. Legal Entity strategy

Optional `legal_entity_id` on **new SITE only** (future additive column), must match SITE company. Not required to start trees. No legacy LE mapping.

### 11. Asset placement recommendation

Keep `location_id` / `rtd_location_id`. No `space_id`. Allow any active location for compatibility; prefer SPACE for installables; never auto-change FKs on hierarchy move.

### 12. Inventory placement recommendation

Keep exact catalog `location_id`; prefer STORE_ROOM / operational site for stock; no FK rewrites on hierarchy move.

### 13. Recommended UI architecture

Dual experience under Masters: **Operational** flat list + **Facilities** tree (left tree / center detail / actions). Type badges, search, company filter, archive guards. Match existing AppLayout / Box / badge patterns.

### 14. Recommended API architecture

Preserve flat `/locations` + selectlist. Add `/locations/tree`, path, children, move, archive/restore, validate-parent, node assets/inventory, location-types selectlists. Default hardware filter stays exact.

### 15. RBAC readiness

v1 hierarchy CRUD continues under **`settings.edit`**. Later optional `locations.*` module keys mapped to existing permission catalog. Viewer: view-only when module exists.

### 16. Implementation readiness

**READY WITH KNOWN GAPS** — design complete; tree API and Facility UI not built; optional SITE `legal_entity_id` not in schema yet.

### 17. Recommended next wave

**Wave 2.6 — Hierarchy backend contracts** (tree/path/move/archive guards + regression tests; staging-first if any additive columns).

### 18. Existing production behavior changed?

**NO**

### 19. Documentation paths

- `WAVE2_5_PHYSICAL_LOCATION_HIERARCHY_DESIGN.md`
- `PHASE6_WAVE2_5_COMPLETION_REPORT.md`
