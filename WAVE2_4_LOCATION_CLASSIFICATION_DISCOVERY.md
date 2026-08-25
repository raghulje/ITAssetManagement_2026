# Wave 2.4 — Location Classification & Hierarchy Readiness Discovery

**Mode:** READ-ONLY. No database or application writes.  
**Database:** `SELECT DATABASE()` → `itassetmanagement_2026` (`ITAssetManagement_2026`)

---

# 1. Executive Summary

The 187 live locations are an **HRMS operational place-name list**, not a physical Site → Building → Floor → Space tree.

- Current types: **187 UNSPECIFIED**, **0** SITE/BUILDING/FLOOR/ZONE/DEPARTMENT_AREA/SPACE in production.
- **parent_id** is unused (0 live children).
- **1203 / 1204** assets sit on a single location: `id=9` “Refex Tower-Nungambakkam”. One asset has null `location_id`. Inventory catalog rows also concentrate on `id=9`.
- **186** distinct employee `refex_location` values **match** `locations.name` — these records are the HRMS location master.
- **No HIGH-confidence auto-classification** is safe. No deterministic floor/cabin/meeting-room names exist.
- **No parent–child edges** can be reconstructed from existing records without inventing missing Building/Floor/Space rows.

**Recommended implementation option: D** — keep existing locations as operational locations; grow a physical hierarchy later through approved UI/mapping. Do not auto-reparent or auto-create missing levels.

---

# 2. Wave Scope

Read-only analysis of production locations, usage, companies, legal entities, and naming. Classification proposals only. No `location_type_id` / `parent_id` updates.

---

# 3. Current Production State

| Metric | Expected | Actual |
|---|---|---|
| Live locations | 187 | **187** |
| Soft-deleted | 7 | **7** |
| UNSPECIFIED | 187 | **187** |
| SITE | 0 | **0** |
| BUILDING | 0 | **0** |
| FLOOR | 0 | **0** |
| ZONE | 0 | **0** |
| DEPARTMENT_AREA | 0 | **0** |
| SPACE | 0 | **0** |
| Live with parent_id | — | **0** |
| Assets | 1204 | **1204** |

Verified: no typed hierarchy records in production.

---

# 4. Location Data Profile

| Field | Observation |
|---|---|
| parent_id | All live NULL |
| company_id | **1 / 187** populated (`Chennai HQ` → company 42) |
| external_code | Column present; not used as classifier (values unused in practice) |
| space_subtype_id | All NULL |
| Usage | **185 unused**; **1** user-only (`Bazullah -T.Nagar`, 3 users); **1** heavy (`id=9`, 1203 assets + 45 inventory rows + 2 users) |

Locations are globally named (no unique-per-parent). Names align with HRMS `employees.refex_location`.

---

# 5. Naming Pattern Analysis

Dominant pattern: **city / office / project / plant / loading-point labels** (HRMS attendance/office names).

| Pattern | Examples (anonymized style) | Hierarchy meaning |
|---|---|---|
| City | Chennai, Pune, Mysore, Kochi | Possible **SITE** after review |
| HQ / campus | Chennai HQ, SIPCOT | Possible **SITE** |
| Tower | Refex Tower-Nungambakkam | Ambiguous **SITE vs BUILDING** |
| Project / industrial | NTPC … Loading Point, BTPS … | Operational, not Floor/Space |
| Airport / terminal | Airport-Terminal 1/2, Aerocity_Delhi | Operational, keep UNSPECIFIED |
| Abbreviations | GVR, ADMS-Mohali …, 3i MedT-… | LOW |
| Floor / Zone / Cabin / Meeting room | **None found** | Cannot type SPACE/FLOOR from names |

Inconsistent punctuation (`_`, `-`, parentheses). Duplicate **semantic** cities possible (Chennai vs Chennai HQ vs Tower in Chennai) but different rows — do **not** merge.

---

# 6. Company and Legal Entity Analysis

| Master | Count | Link to locations |
|---|---|---|
| companies | 38 live | `locations.company_id` nullable; **186 NULL** |
| legal_entities | 68, all have `company_id` | **No** `locations.legal_entity_id` |
| assets.legal_entity_id | 1 of 1204 populated | Cannot backfill location→LE from assets |

**Company → Legal Entity → Site cannot be inferred** without inventing mappings. Only `Chennai HQ` has a company_id.

---

# 7. Location Classification Results

**Proposed types (review-only; not applied):**

| Proposed type | Count |
|---|---|
| SITE | 163 |
| BUILDING | 1 (Refex Tower — MEDIUM, not auto) |
| FLOOR | 0 |
| ZONE | 0 |
| DEPARTMENT_AREA | 0 |
| SPACE | 0 |
| UNSPECIFIED | 23 |

SITE proposals are **MEDIUM** city/office/HRMS labels, not proven physical sites.

---

# 8. Space Subtype Results

| Subtype | Count |
|---|---|
| CABIN | 0 |
| MEETING_ROOM | 0 |
| SERVER_ROOM | 0 |
| STORE_ROOM | 0 |
| WORKSTATION | 0 |
| OTHER | 0 |

No name evidence for SPACE subtypes.

---

# 9. Confidence Distribution

| Confidence | Count | Meaning |
|---|---|---|
| HIGH | **0** | No deterministic type tokens |
| MEDIUM | **164** | Likely SITE (or Tower as BUILDING) — human review |
| LOW | **23** | Keep UNSPECIFIED |

---

# 10. Proposed Hierarchy Edges

**None at HIGH confidence.**

All live `parent_id` are NULL. Names are sibling HRMS places, not nested physical objects.

Illustrative **rejected** auto-edge:

| Parent | Child | Why not auto |
|---|---|---|
| Chennai (SITE?) | Refex Tower (BUILDING?) | Geographic guess only; assets would remain on Tower; Chennai has **0** assets |

Do not create this edge without management approval.

---

# 11. Missing Hierarchy Levels

If facilities hierarchy is required under the operational HQ:

| Existing | Missing levels | Recommended action |
|---|---|---|
| Refex Tower-Nungambakkam (all assets) | SITE (if Tower=BUILDING); FLOOR; ZONE/DEPT AREA; SPACE subtypes | **Create missing parents later** after design, or **keep standalone** as operational location |
| City names (Chennai, Pune, …) | BUILDING, FLOOR, SPACE | **Keep standalone** / **UNSPECIFIED or SITE after review** — do not invent buildings |
| Loading points / terminals | Entire physical tree | **Keep UNSPECIFIED** |

---

# 12. Asset Placement Impact

| Band | Locations | Notes |
|---|---|---|
| 0 assets | 186 | Type-only change would not move assets |
| 1–10 | 0 | |
| 11–50 | 0 | |
| 51–100 | 0 | |
| 100+ | **1** (`id=9`, **1203** assets) | Also **1203** `rtd_location_id` |
| null location_id | 1 asset | Unrelated to classification |

**Risk if `id=9` is retyped or reparented:** HIGH for filters/displays if meaning of that id changes; **checkout/check-in/RTD remain ID-based** so IDs must not change. Changing `location_type_id` only does not move assets. Changing `parent_id` does not move assets. **Never change `assets.location_id` / `rtd_location_id` in a classification wave.**

Exact `location_id OR rtd_location_id` filters stay valid. Descendant “all assets under Chennai” would **not** include Tower until a real tree exists — it does not today.

---

# 13. Inventory Impact

Consumables, accessories, components: **15 rows each**, location sums consistent with **all catalog rows on `location_id=9`**.

Retyping unused locations: **no inventory impact**. Retyping `id=9`: **no FK change** if only `location_type_id` updates. Do not reassign inventory `location_id`.

---

# 14. Safe Auto-Classification Candidates

**GROUP A — SAFE FOR AUTOMATIC CLASSIFICATION: 0**

Auto-apply matrix: nothing marked safe.

---

# 15. Management Review Queue

## GROUP B — REVIEW RECOMMENDED (164)

Includes city/office/HQ/SIPCOT-style names proposed as **SITE**, plus **Refex Tower-Nungambakkam** proposed **BUILDING** (MEDIUM) because of “Tower” — **ambiguity: this row is also the enterprise operational placement for 1203 assets; treating it as BUILDING without a SITE parent is incomplete; treating it as SITE is operationally truer.**

## GROUP C — KEEP UNSPECIFIED (23)

Project/terminal/abbreviation names (loading points, airports, ADMS/3i codes, etc.).

Full per-row evidence: `LOCATION_CLASSIFICATION_REVIEW.csv`.

---

# 16. Implementation Options

| Option | Fit to data |
|---|---|
| **A** Classify existing only | Possible later for SITE labels; **0 auto-safe now**; no tree |
| **B** Classify + create missing parents | Requires inventing Building/Floor/Space — **not from existing rows** |
| **C** Mapping-file migration | Good for approved SITE flags; still won’t create a real floor plate |
| **D** Keep operational list; build physical tree in UI | Matches HRMS nature of the 187 names; assets stay on `id=9` until facilities model exists |

---

# 17. Recommended Option

**OPTION D**

Keep the 187 records as operational/HRMS locations (UNSPECIFIED until a reviewed mapping says SITE). Introduce Site/Building/Floor/Space **as new or later-classified rows through UI**, without automatically reparenting or moving `assets.location_id`.

Optionally use a **future mapping file (C)** only to set `location_type_id=SITE` on approved city/office names — still not a physical tree.

---

# 18. Risks

| Risk | Severity |
|---|---|
| Treating Tower as BUILDING while it holds 1203 assets | HIGH (semantic) |
| Auto SITE on loading points / abbreviations | HIGH (wrong type) |
| Inventing Floor/Space parents | HIGH |
| Company→LE→Site without data | HIGH (false tenancy) |
| Unused 185 locations cluttering dropdowns | MEDIUM (UX, not data corruption) |

---

# 19. What Must NOT Be Automated

- Guess types from weak names  
- Auto-create Building/Floor/Space  
- Reparent by string match (e.g. Chennai → Tower)  
- Change `assets.location_id` or `rtd_location_id`  
- Merge or delete unused locations  
- Assign `space_subtype` to non-SPACE  
- Infer `legal_entity_id` on locations  

---

# 20. Wave 2.5 Readiness

**READY WITH KNOWN GAPS**

The typed foundation is live; **classification/hierarchy content is not auto-ready**. Next work should be a **management mapping workshop** (optional SITE flags) and/or **frontend hierarchy UI** to capture new physical rows — not an unattended reclassification job.
