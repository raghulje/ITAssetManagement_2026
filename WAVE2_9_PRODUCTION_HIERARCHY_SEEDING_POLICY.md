# WAVE 2.9 — Production Physical Hierarchy Seeding Policy & Rollout Plan

**Status:** STEP 1 COMPLETE — policy + rollout plan only.  
**Mode:** READ-ONLY discovery + governance. **No production writes. No schema changes. No application code changes required for this step.**  
**Date:** 2026-08-24  
**Production DB inspected:** `ITAssetManagement_2026` (`SELECT DATABASE()` → `itassetmanagement_2026`)  
**Regression baseline:** 142 passed / 0 failed / 0 skipped (Wave 2.8)

---

## 1. Executive summary

Facility Management UI (Wave 2.8) and hierarchy APIs (Wave 2.6) are ready. Production still has **zero** typed physical nodes.

Wave 2.9 defines **how** real Site → Building → Floor → … trees may be introduced into production **safely**:

| Rule | Decision |
|---|---|
| How physical trees appear | **Create NEW typed rows** via Facility UI (or approved script) |
| What happens to 187 UNSPECIFIED | **Unchanged** — no bulk retype, no reparent |
| What happens to `id=9` Refex Tower | **Leave as operational UNSPECIFIED** — do not convert to BUILDING/SITE in this wave |
| What happens to asset / RTD / inventory FKs | **Never rewritten** by seeding |
| First production write | **Blocked** until explicit stakeholder approval + staging rehearsal |

**This document does not authorize production hierarchy inserts.**

---

## 2. Verified production baseline (2026-08-24, SELECT only)

| Metric | Value |
|---|---|
| Live locations | **187** |
| Soft-deleted locations | 7 |
| UNSPECIFIED live | **187** |
| Typed physical (SITE…SPACE) | **0** |
| `parent_id` non-null | **0** |
| Companies live | 38 |
| Locations with `company_id` | **1** (`id=194` Chennai HQ → company 42) |
| Assets live | **1204** |
| Assets with null `location_id` | 1 |
| Assets on `id=9` Refex Tower-Nungambakkam | **1203** (placement + RTD) |
| `SUM(location_id)` / `SUM(rtd_location_id)` | **10827** / **10827** |
| Consumables / accessories / components | 15 / 15 / 15 (consumables concentrated on `location_id=9`) |

Location type masters present: UNSPECIFIED(1), SITE(2), BUILDING(3), FLOOR(4), ZONE(5), DEPARTMENT_AREA(6), SPACE(7).

**Implication:** Production Facility tree will show the Wave 2.8 empty-state until NEW typed nodes are created under policy.

---

## 3. Locked non-goals (still apply)

1. No automatic reclassification of the 187 UNSPECIFIED locations.  
2. No reparenting of legacy rows under new SITEs.  
3. No `UPDATE` of `assets.location_id`, `assets.rtd_location_id`, or inventory `location_id`.  
4. No descendant hardware-filter rollout as part of seeding.  
5. No Masters Locations redesign.  
6. No new RBAC keys.  
7. No `legal_entity_id` / `sort_order` schema in this wave.  
8. No Wave 2.7-style `FACILITY TEST` rows in production.

---

## 4. Dual-location operating model (confirmed)

```
OPERATIONAL (HRMS / ITAM placement)
  → 187 UNSPECIFIED rows (incl. id=9 Refex Tower)
  → Masters → Locations + Facility → Operational tab
  → Asset / RTD / inventory / import / checkout consumers

PHYSICAL (Facilities)
  → NEW typed SITE → BUILDING → FLOOR → ZONE|DEPARTMENT_AREA|SPACE
  → Facility → Physical Hierarchy tab
  → Coexists in same `locations` table; separate tree roots
```

**Coexistence rule:** Physical trees and operational rows share one table and one FK namespace, but operational rows are **not** required to hang under a physical SITE. Assets may remain on operational `id=9` indefinitely while a parallel physical campus tree is built for facilities planning.

---

## 5. Seeding principles

### P1 — Additive only
Only `INSERT` of new typed locations (via API/`facilitiesApi` or Facility UI). No mass `UPDATE` of legacy type/parent.

### P2 — Naming discipline
Production physical names must be **real facility names** (e.g. “Refex Tower Campus — Nungambakkam”), never `FACILITY TEST` / `WAVE27_*`.

Optional: set `notes` to include seed batch tag (e.g. `WAVE29_PILOT`) for audit; do **not** require synthetic external codes in production unless ops wants them.

### P3 — Company on SITE
New SITE should set `company_id` to the owning company (Wave 2.5 Option C). Descendants may leave `company_id` NULL (ancestry resolution) or copy SITE company — either is acceptable for v1; prefer **SITE required, children optional**.

Facility UI today allows optional company on create — **policy requires** company on SITE even if UI does not hard-block empty company yet. Gap: consider a follow-up UX validation (not blocking this policy).

### P4 — Never touch high-blast rows
| Row | Why protected |
|---|---|
| `id=9` Refex Tower-Nungambakkam | 1203 assets + inventory catalog home |
| Any location with asset/RTD/inventory counts > 0 | Placement integrity |
| All 187 UNSPECIFIED | HRMS / operational contracts |

### P5 — Archive ≠ delete
If a pilot node is wrong: archive (if unused) or soft-correct via move — never hard-delete; never Facility-call Masters DELETE.

### P6 — Staging rehearsal first
Any production pilot tree shape must be created once on `ITAssetManagement_2026_test` (or a fresh clone) and walked in Facility UI before production approval.

---

## 6. Decision: how to treat Refex Tower (`id=9`)

| Option | Description | Verdict |
|---|---|---|
| **A** Retype `id=9` → SITE or BUILDING | Changes type of the placement hub | **REJECT for Wave 2.9** — high confusion risk; still no parents/floors |
| **B** Reparent assets onto new SPACE nodes | Placement migration | **OUT OF SCOPE** — separate future wave with explicit FK rewrite approval |
| **C** Leave `id=9` operational; create **parallel** physical tree | New SITE (+ BUILDING/FLOOR…) alongside Tower | **ADOPT** |

**Adopted narrative for users:**

> “Refex Tower-Nungambakkam” remains the operational / checkout location for IT assets.  
> Facility Management will hold a separate physical campus hierarchy (Site → Building → Floors → Spaces) for facilities structure.  
> Linking assets into Spaces is a later, explicit decision — not part of seeding.

---

## 7. Recommended pilot scope (production — when authorized)

### Pilot name (proposed — stakeholder must confirm exact strings)

| Level | Proposed name | Type | Parent | Company |
|---|---|---|---|---|
| SITE | Refex Chennai — Nungambakkam Campus | SITE | — | Stakeholder-chosen company (likely Refex Industries / HQ company — **confirm id**) |
| BUILDING | Refex Tower | BUILDING | SITE | optional / inherit |
| FLOOR | Floor — TBD (e.g. Ground / L1 / L2) | FLOOR | BUILDING | — |
| SPACE (optional pilot) | 1–2 sample spaces (Meeting Room / Store) | SPACE + subtype | FLOOR | — |

**Minimum viable pilot:** SITE + BUILDING only.  
**Preferred pilot:** SITE + BUILDING + 1–2 FLOORs + 0–2 SPACE leaves (proves UI end-to-end without sprawl).

### Explicitly deferred for pilot

- Full floor plate / every cabin  
- Other cities (Pune, Mysore, Kochi, …)  
- Retyping city names (Chennai, Pune, …) to SITE  
- Mapping SIPCOT / Bazullah / 3i sites  
- Multi-company campus trees beyond the chosen SITE company  

### Company selection gate

Stakeholders must answer before production insert:

1. Which `companies.id` owns the Nungambakkam campus SITE?  
2. Is one SITE enough for all Refex entities sharing that tower, or one SITE per legal company?

Until answered, production seeding remains **blocked**.

---

## 8. Rollout phases

```
Phase 0  Policy accepted (this document)          ← CURRENT
Phase 1  Stakeholder naming + company confirmation
Phase 2  Staging rehearsal (real names, not FACILITY TEST)
Phase 3  Explicit production write authorization
Phase 4  Production pilot insert (SITE→… via UI preferred)
Phase 5  Integrity verification + regression
Phase 6  Expand to additional floors/spaces (same campus)
Phase 7  Additional campuses (new SITE roots) — separate approvals
```

### Phase 2 — Staging rehearsal checklist

Target: `ITAssetManagement_2026_test` only.

1. Confirm DB name contains `test` / is not production.  
2. Create proposed pilot tree via Facility UI (or script with real names).  
3. Verify tree / path / children / metrics.  
4. Exercise move (optional) and archive of an unused leaf.  
5. Confirm legacy 187 UNSPECIFIED unchanged; asset FK checksums unchanged.  
6. Capture screenshots / node id list for production mirror.

### Phase 3 — Production authorization template

Require written approval containing:

- Pilot SITE/BUILDING/FLOOR names  
- `company_id` for SITE  
- Confirmation: no legacy retype, no asset FK updates  
- Approver name + date  
- Rollback plan acknowledgment (archive unused pilot nodes)

### Phase 4 — Production insert method

**Preferred:** Facility Management UI (`/facilities`) with `settings.edit` user.  
**Alternate:** Controlled script (fail-closed: refuse if `SELECT DATABASE()` is not production after explicit `WAVE29_CONFIRM_PRODUCTION=1`, and refuse if typed count already exceeds expected baseline) — only if UI unavailable.

Do **not** copy Wave 2.7 `FACILITY TEST` script into production.

### Phase 5 — Post-insert verification

| Check | Expect |
|---|---|
| Typed physical count | Pilot node count (e.g. 4–8) |
| UNSPECIFIED live | Still **187** |
| `id=9` type | Still UNSPECIFIED |
| Asset `SUM(location_id)` / `SUM(rtd_location_id)` | Still **10827** / **10827** |
| Assets on `id=9` | Still **1203** |
| Regression | **142** pass / 0 fail |
| Facility tree | Shows pilot; Operational tab still lists legacy |

### Rollback

| Situation | Action |
|---|---|
| Unused wrong leaf / floor | Archive via Facility UI |
| Wrong parent | Move via Facility UI |
| Entire pilot abandoned | Archive leaves bottom-up when unused; leave SITE if referenced |
| Mistaken legacy UPDATE | **Must not happen** under this policy; if it did, restore from backup — out of band |

Seeding never uses hard DELETE.

---

## 9. Expansion policy (after pilot)

1. **Same campus:** Add floors/zones/spaces under the approved SITE freely (still no FK moves).  
2. **New campus:** Requires a new SITE approval (name + company).  
3. **Optional future SITE retype of city labels:** Mapping workshop only; one-row type change after review; still no children under UNSPECIFIED; still no asset moves.  
4. **Asset placement onto SPACE:** Separate wave with:
   - Per-asset or batch mapping file  
   - Checksums before/after  
   - Explicit FK rewrite authorization  
   - Regression for checkout/check-in/RTD  

---

## 10. Roles & permissions

| Activity | Who | Permission |
|---|---|---|
| Approve policy / pilot names | Facilities + ITAM owners | Business |
| Create/edit physical nodes | Designated admins | `settings.edit` |
| View hierarchy | Ops / facilities viewers | `settings.view` |
| Manage operational HRMS list | Existing Masters owners | unchanged |
| Authorize production seed | Named stakeholder | Written |

No new RBAC keys in Wave 2.9.

---

## 11. UI / product gaps noted

| Gap | Impact | Status |
|---|---|---|
| SITE company not hard-required in create dialog | Policy relies on operator discipline | **Addressed in UI** — Site create requires company (client validation) |
| Parallel Tower (physical) vs Tower (operational `id=9`) naming | User confusion | **Addressed in UI** — Physical + Operational callouts explain dual model |
| No tree search / company filter | Harder as trees grow | **Addressed in UI** — search + company filter on Physical Hierarchy |
| Empty prod tree today | Expected | Resolved after Phase 4 |

---

## 12. Integrity checksums to record at each write gate

Before and after any production insert:

```
live_locations
unspecified_count
typed_physical_count
parent_id_non_null
assets_live
sum(location_id), sum(rtd_location_id)
assets_on_id_9
consumables/accessories/components counts + location_id sums
```

Read-only helper: `server/scripts/wave29-readonly-discovery.ts` (SELECT only).

---

## 13. Explicit out of scope for Wave 2.9 Step 1

- Production or staging hierarchy inserts  
- Application / schema changes  
- Asset placement migration  
- Bulk SITE classification of the 187  
- Descendant filters  
- Legal entity on locations  

---

## 14. Approval gates (status)

| Gate | Status |
|---|---|
| Policy document published | **DONE** (this file) |
| Stakeholder naming + company_id | **PENDING** |
| Staging rehearsal with real names | **PENDING** |
| Explicit production write authorization | **NOT GRANTED** |
| Production pilot insert | **BLOCKED** |

---

## 15. Recommended next actions

1. Stakeholders confirm pilot SITE/BUILDING names and `company_id`.  
2. Authorize **Wave 2.9 Phase 2** staging rehearsal (real names on `ITAssetManagement_2026_test`).  
3. Only after rehearsal + written approval: authorize **Phase 4** production pilot.

Until then, Facility UI remains empty for physical hierarchy in production — by design.
