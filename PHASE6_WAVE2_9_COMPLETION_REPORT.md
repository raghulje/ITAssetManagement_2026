# PHASE 6 — WAVE 2.9 COMPLETION REPORT

## 1. Completion summary

Wave 2.9 Step 1 delivered a **production physical hierarchy seeding policy and rollout plan**. Live production was inspected read-only and confirmed still at **187 UNSPECIFIED / 0 typed physical / 0 parents**, with **1203** assets on operational `id=9` Refex Tower-Nungambakkam. Policy adopts **parallel new typed trees** (not retyping Tower, not moving FKs). **No production writes** were performed. **No application or schema changes** were required for this step.

## 2. Production code modified: NO

(Helper only: `server/scripts/wave29-readonly-discovery.ts` — SELECT-only discovery.)

## 3. Production database modified: NO

## 4. Staging database modified: NO

## 5. Migration created: NO

## 6. Schema changes: NO

## 7. Hierarchy records created: NO

## 8. Legacy locations modified: NO

## 9. Asset / RTD / inventory placement FKs modified: NO

## 10. Verified production baseline

| Metric | Value |
|---|---|
| Database | `ITAssetManagement_2026` |
| Live locations | 187 |
| UNSPECIFIED | 187 |
| Typed physical | 0 |
| Parent links | 0 |
| Assets | 1204 |
| On `id=9` | 1203 |
| Placement checksums | sum loc/rtd = 10827 / 10827 |

## 11. Policy decisions locked

| Topic | Decision |
|---|---|
| Seed method | Additive NEW typed nodes only |
| `id=9` Refex Tower | Remain operational UNSPECIFIED |
| Asset FK moves | Forbidden in this wave |
| 187 UNSPECIFIED | No bulk retype/reparent |
| First campus | Parallel Nungambakkam SITE/BUILDING pilot (names + company TBD) |
| Production insert | Blocked until naming + staging rehearsal + written approval |

## 12. Documentation produced

- `WAVE2_9_PRODUCTION_HIERARCHY_SEEDING_POLICY.md`
- `PHASE6_WAVE2_9_COMPLETION_REPORT.md` (this file)
- `server/scripts/wave29-readonly-discovery.ts`

## 13. Regression

Not re-run required (no code/behavior change). Prior baseline remains **142 / 0 / 0**.

## 14. Production readiness for hierarchy data

**NOT READY TO WRITE** — policy ready; awaiting:

1. Stakeholder SITE/BUILDING names + `company_id`  
2. Staging rehearsal (real names)  
3. Explicit production write authorization  

## 15. Known gaps

- ~~Facility create dialog does not hard-require SITE `company_id`~~ → **client now requires company on SITE**  
- ~~Tree search / company filter~~ → **search + company filter on Physical Hierarchy**  
- Exact pilot company id not chosen  
- ~~Parallel Tower naming confusion~~ → **help text added on Physical + Operational tabs**

## 15b. Follow-on UI polish (same wave family)

Client-only updates after Step 1 policy:

- Site create: company required; Site-only company field; callout that Site ≠ operational placement  
- Physical Hierarchy banner: dual physical vs operational model  
- Operational Locations banner: explains Refex Tower placement stays operational  
- Empty tree copy updated  
- Tree search (name/type/subtype) with highlight + auto-expand  
- Company filter via Wave 2.6 `GET /locations/tree?company_id=`  

No backend/schema/DB writes.

## 16. Recommended next step

**Wave 2.9 Phase 2** — staging rehearsal with stakeholder-approved real facility names on `ITAssetManagement_2026_test` (still no production writes).
