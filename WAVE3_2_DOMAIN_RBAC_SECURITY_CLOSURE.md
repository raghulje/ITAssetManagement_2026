# WAVE 3.2 — Domain RBAC Security Closure

**Scope:** Close Wave 3.1 domain authorization gaps on secondary authenticated endpoints.  
**Mode:** Code-level authorization fixes. No schema migration. No production data changes.  
**Date:** 2026-08-24

---

## 1. Executive Summary

Wave 3.1 found the shared IT/ADMIN inventory model **architecturally sound on the primary CRUD path**, with remaining leaks on secondary authenticated endpoints. Wave 3.2 closes those leaks by **reusing and tightening** `server/src/services/domainAuth.ts` and applying the same rule everywhere a domain-owned record is listed, counted, searched, attached, audited, imported, or mutated.

Authorization order is unchanged and now consistently applied:

1. Authentication  
2. Module / action permission  
3. User domain scope  
4. Record domain validation  
5. Allow or deny  

The backend remains the source of truth. Frontend navigation, filters, and client-supplied `domain` / `domain_id` cannot widen scope.

**Final security verdict: READY WITH NON-BLOCKING GAPS**

---

## 2. Wave 3.1 Findings Addressed

| ID | Finding | Fix |
|---|---|---|
| D1 | EOL due list unscoped | `listEolDueAssets` takes caller permissions + `inventoryDomainClause` |
| D11 | Dashboard / hub EOL count unscoped | `countEolDue({ permissions, domain })` |
| D2 | Activity report / Dashboard item names unscoped | `actionLogDomainSql` on `GET /reports/activity` |
| D3 | Space item listing unscoped | `inventoryDomainClause` per inventory table |
| D4 | Audit-by-tag skipped domain | `loadItemDomain` + `assertRecordDomainAccess` (same as check-in-by-tag) |
| D5 | License invoice PUT/DELETE skipped parent domain | Load parent license domain first |
| D6 | Files list/download/delete skipped parent domain | `assertUploadableDomainAccess` |
| D7 | Import always wrote Domain = IT | `resolveImportDomainId` from importer perms; single-domain force |
| D8 | Unknown numeric `domain_id` became IT | Fail closed (`Unknown domain` / 403) |
| D9 | GET `/spaces` had no `settings.view` | GET/HEAD → `settings.view`; writes remain `settings.edit` |

Same-gap endpoints included in this wave (not a redesign):

- Hardware restore, audit-by-id, agent status/scan/snapshots, agent-sync-logs  
- Labels (single + batch)  
- Maintenances CRUD  
- Dashboard `licenses_assigned` and hub `pending_acceptance`  
- Account / user assigned assets, requestable assets  
- Location node asset/inventory listings and location asset counts  

---

## 3. Authorization Architecture

```
Request
  → authRequired (JWT / session)
  → moduleGate / requirePerm (existing RBAC)
  → allowedDomainCodes(permissions)
       Super Admin / application admin  → IT + ADMIN
       domains.it                       → IT
       domains.admin                    → ADMIN
       legacy module perms, no domain   → IT
  → inventoryDomainClause | assertRecordDomainAccess | resolveWriteDomainId
  → SQL filter or 403
```

NULL `domain_id` remains **IT** for backward compatibility. Unknown `domain_id` no longer maps to IT.

---

## 4. Shared Domain Authorization Logic

**Existing path (reused):** `server/src/services/domainAuth.ts`

| Helper | Role |
|---|---|
| `allowedDomainCodes` | Role → IT / ADMIN |
| `scopedDomainCodes` | Intersect with requested domain; unauthorized request → empty (SQL `AND 1=0`) |
| `inventoryDomainClause` | List / aggregate SQL filter; NULL = IT |
| `assertRecordDomainAccess` | Record-level 403 |
| `resolveWriteDomainId` | Create/update write domain |
| `loadItemDomain` | Load `id` + `domain_id` |

**Added / tightened this wave:**

| Helper | Role |
|---|---|
| `domainCodeFromRows` / `domainCodeForId` | NULL → IT; **unknown id throws** |
| `canAccessDomainId` | Unknown id → **false** (not IT) |
| `actionLogDomainSql` | Inventory-backed logs scoped; generic / `item_id` 0\|NULL kept |
| `assertUploadableDomainAccess` | Parent entity domain for files |
| `resolveImportDomainCode` / `resolveImportDomainId` | Import force + Super Admin select |
| `domainErrorStatus` | Map Forbidden → 403 |

No duplicate per-controller role maps were added.

---

## 5. Endpoint Coverage Matrix

| Endpoint | Before | After |
|---|---|---|
| Assets / Licenses / Acc / Cons / Comp CRUD, checkout, check-in | Domain | Unchanged (already protected) |
| GET `/hardware/eol/due` | Unscoped | Scoped |
| GET `/reports/hub` eol_due / pending_acceptance | Partial / unscoped | Scoped |
| GET `/dashboard` counts + eol_due + licenses_assigned | Partial | Scoped |
| GET `/reports/activity` | Unscoped | Inventory logs scoped; generic kept |
| GET `/spaces/:id/assets` | Unscoped | Scoped |
| POST `/hardware/audit` (by tag) | No domain | 403 if out of scope |
| POST `/hardware/:id/audit` | No domain | 403 if out of scope |
| POST `/hardware/:id/restore` | No domain | 403 if out of scope |
| GET/POST `/labels/hardware/:id` | No domain | 403 if out of scope |
| GET/POST/DELETE files | No domain | Parent domain |
| PUT/DELETE `/licenses/invoices/:invoiceId` | No domain | Parent license domain |
| POST `/imports/process/:id` | Always IT | Server-resolved domain |
| GET `/hardware/agent-sync-logs` | Unscoped | Linked assets scoped; unlinked kept |
| Maintenances | Unscoped | Parent asset domain |
| GET `/requests/requestable` | Unscoped | Scoped |
| Location `/assets` and `/inventory` | Unscoped | Scoped |
| GET `/spaces` | Any authenticated | `settings.view` |
| Public QR `/api/v1/public` | Public | **Unchanged** (intentionally public) |

---

## 6. EOL Fixes

User APIs pass `permissions` + optional `domain` into `listEolDueAssets` / `countEolDue`. Aggregates only count authorized rows. Unauthorized domain query → empty list, not unfiltered.

**Scheduled digest** `runEolAlertDigest()` still calls `listEolDueAssets()` **without** a user. That is a background email, not a user API, and remains unscoped by design.

---

## 7. Dashboard Fixes

`GET /dashboard` already filtered most inventory counts. This wave:

- Scopes `eol_due` through caller permissions  
- Scopes `licenses_assigned` via `JOIN licenses` + domain clause  
- Hub `pending_acceptance` joins assets and applies domain  

People directory totals (`users`, `employees`) remain global: People is the shared assignment center, not a domain-owned inventory module.

---

## 8. Activity Log Fixes

`GET /reports/activity` appends `actionLogDomainSql`:

- `item_type` in asset / license / accessory / consumable / component → EXISTS parent in caller scope  
- Other `item_type`, or `item_id` NULL/0 (e.g. parse-PO) → visible as generic/system logs  
- Employee assignment history was already domain-filtered in Wave 3.0  

---

## 9. Space Visibility Fixes

`GET /spaces/spaces/:id/assets` (mounted under `/api/v1/spaces`) now applies `inventoryDomainClause` to assets, accessories, consumables, and components.

**Not changed:** `assets.location_id`, `assets.rtd_location_id`, inventory `location_id`, hierarchy, or placement behavior. This is visibility only.

IT Asset Manager sees only IT-owned items in a mixed space. Admin Asset Manager sees only ADMIN. Super Admin sees both.

GET office/floor/space maps now require `settings.view`. Writes still require `settings.edit`. ITAM / AAM already have both. Viewer (no settings.view) can no longer enumerate offices.

Location tree inventory (`getNodeAssets` / `getNodeInventory`) uses the same clause so Masters location views do not dump cross-domain items.

---

## 10. Audit-by-Tag Fixes

`POST /hardware/audit` loads by tag with `loadItemDomain` then `assertRecordDomainAccess`.

- Authorized domain → audit succeeds  
- Unauthorized domain → **403** (same message model as check-in-by-tag)  
- Missing tag → **404**  

No partial metadata is returned before the domain check. Query-parameter manipulation cannot skip this check.

---

## 11. File Authorization Fixes

Authenticated file routes resolve the **parent**:

| `uploadable_type` | Parent |
|---|---|
| asset / license / accessory / consumable / component | That inventory row |
| license_invoice | Parent license |
| maintenance | Parent asset |
| user | No inventory domain (People) |

List / upload / download / delete all call `assertUploadableDomainAccess` before returning bytes or metadata.

**Public QR** (`/api/v1/public`) is unchanged and is **not** routed through `domainAuth`. Public QR remains intentionally public.

---

## 12. License Invoice Fixes

PUT and DELETE `/licenses/invoices/:invoiceId` load `license_id`, then the license `domain_id`, then `assertRecordDomainAccess`. Direct invoice ID access across domains is 403. List/create under `GET/POST /licenses/:id/invoices` was already parent-scoped.

---

## 13. Import Domain Fix

Import no longer hard-codes `domainIdForCode('it')`.

| Role | Behavior |
|---|---|
| IT Asset Manager | Allowed if `settings.edit` (existing). Domain **forced to IT**. Client `domain=admin` is ignored. |
| Admin Asset Manager | Allowed if `settings.edit`. Domain **forced to ADMIN**. Client `domain=it` is ignored. |
| Super Admin / application Admin | Import page shows Domain select. Server validates IT or ADMIN. **Omitted domain defaults to IT** (legacy-compatible, documented). Numeric `domain_id` is resolved via `resolveWriteDomainId`. |

Updates of existing inventory rows check the **existing record domain** and do not reclassify. Cross-domain update → row error `Forbidden: no access to record domain`.

Qty modules and licenses now stamp `domain_id` on insert when the column exists.

The client is never the source of truth.

---

## 14. Direct API Bypass Results

Covered in `server/test/wave3/domain-rbac-closure.test.ts`:

| Bypass | Result |
|---|---|
| Unauthenticated GET/POST/PUT on former leaky endpoints | **401** |
| Invalid JWT | **401** |
| ITAM `?domain=admin` / AAM `?domain=it` | Empty scope (`AND 1=0`), not unfiltered |
| ITAM import `domain=admin` | Server-forced **IT** |
| AAM import `domain=it` | Server-forced **ADMIN** |
| Super Admin `it` / `admin` / omitted | IT, ADMIN, or legacy default IT |
| Unknown `domain_id` | Fail closed (not IT) |

Live two-role HTTP against the database is still gated (`WAVE3_LIVE`); this suite does not mint production tokens.

---

## 15. Regression Tests Added

New file: `server/test/wave3/domain-rbac-closure.test.ts` (**18** tests).

Existing Wave 0–3 tests were **not** weakened, skipped, or deleted. One Space Management contract was **strengthened** (`inventoryDomainClause` + `settings.view`).

---

## 16. Backward Compatibility Results

Preserved:

- Existing IT Asset Management workflows and Super Admin dual-domain access  
- Asset tags, QR public pages, checkout, check-in, replacement, assignment, unassignment  
- Locations / inventory placement FKs  
- People as the shared assignment center  
- Space Management office → floor → space model  
- NULL `domain_id` = IT  
- Scheduled EOL digest email (ops, not user API)  
- Live records remain visible to authorized roles  

Behavioral changes that are security fixes, not product redesign:

- Viewer can no longer GET `/spaces` without `settings.view`  
- Import no longer mints IT rows for Admin Asset Manager  
- Unknown `domain_id` is denied instead of treated as IT  

---

## 17. Production Database Changes

**None.** No migration was created. No production or staging writes.

---

## 18. Remaining Known Gaps

Non-blocking:

1. **Kits** (`/kits`) are templates, not `domain_id` inventory rows. Kit detail still returns linked model/license/accessory IDs without a domain join.  
2. **Dashboard people counts** (`users`, `employees`) remain global by product design.  
3. **Application `admin` flag** still bypasses module and domain checks (same as Super Admin). Naming collision with Admin Asset Manager is unchanged.  
4. **`ON DELETE SET NULL` on `domain_id`** would reclassify a row as IT; schema left unchanged (no migration this wave).  
5. **`domain_attrs` allowlist** (Wave 3.1 D10) not in this wave.  
6. **No live two-role HTTP suite** against MySQL in the default runner.  
7. **Manual three-role browser smoke** was not performed in this pass (no browser automation; `npm run dev` was already running).  

---

## 19. Final Security Verdict

**READY WITH NON-BLOCKING GAPS**

Primary and secondary inventory APIs now enforce domain as an additional layer on top of existing RBAC. Remaining gaps are kits, global People counts, known admin-flag bypass, and lack of live two-role HTTP — none reopen the Wave 3.1 MUST-FIX leaks.

Do not start Wave 3.3 until product owners accept the non-blocking list above.
