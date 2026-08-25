# PHASE 6 — WAVE 3.2 COMPLETION REPORT

## 1. Completion summary

Wave 3.2 closed the Wave 3.1 **SAFE WITH REQUIRED FIXES** domain leaks on secondary authenticated endpoints. Shared helpers in `domainAuth.ts` were tightened (fail-closed unknown `domain_id`, action-log SQL, file parent checks, import domain resolution) and applied to EOL, dashboard, activity, spaces, audit-by-tag, files, license invoices, import, plus same-gap routes (labels, agent logs, maintenances, requestable assets, location inventory).

No architecture redesign. No new modules. No new asset domains. Existing RBAC (`hasPermission` / `moduleGate` / `requirePerm`) is unchanged; domain is an additional layer.

## 2. Production code modified: YES

Application code and tests only. Client Import page gained a Domain select for Super Admin (locked for single-domain roles).

## 3. Production database modified: NO

## 4. Staging database modified: NO

## 5. Migration created: NO

No schema change was required. Prefer code-level authorization.

## 6. Schema changes: NO

## 7. Documents produced

- `WAVE3_2_DOMAIN_RBAC_SECURITY_CLOSURE.md` — full security closure write-up  
- `PHASE6_WAVE3_2_COMPLETION_REPORT.md` — this file  

## 8. Executive summary of the security work

Every authenticated path that reads, lists, mutates, exposes, or creates a domain-owned record now goes through:

**Authentication → module permission → user domain scope → record domain validation.**

IT Asset Manager is IT-only. Admin Asset Manager is ADMIN-only. Super Admin is both. Client-supplied domain cannot override a single-domain role.

## 9. Wave 3.1 findings addressed

D1, D2, D3, D4, D5, D6, D7, D8, D9, D11 — all fixed. Same-gap leaks (restore, labels, agent, maintenances, requestable, location node inventory) included.

## 10. Authorization architecture / shared helpers

Central file: `server/src/services/domainAuth.ts`.

Used by hardware, licenses, inventory, reports/dashboard, spaces, files, labels, imports, users (categories + locations), locationHierarchy, eolAlerts, importEngine.

## 11. Endpoint coverage

See matrix in `WAVE3_2_DOMAIN_RBAC_SECURITY_CLOSURE.md` §5.

## 12–13. EOL, dashboard, activity, space, audit-by-tag, files, invoices, import

Implemented as specified. Public QR left public. Import:

- ITAM → forced IT  
- AAM → forced ADMIN  
- Super Admin → explicit Domain select; omitted → **IT** (documented legacy default)  

## 14. Direct API bypass results

Unauthenticated former leaky endpoints: **401**. Query-param spoof: empty scope. Import override: server-forced. Unknown domain id: fail closed.

## 15. Regression tests

| Suite | Before (Wave 3.1) | Added | After | Passed | Failed | Skipped |
|---|---|---|---|---|---|---|
| Wave 0 | 47 | 0 | 47 | 47 | 0 | 0 |
| Wave 1 | 12 | 0 | 12 | 12 | 0 | 0 |
| Wave 2 | 83 | 0 | 83 | 83 | 0 | 0 |
| Wave 3 | 35 | **18** | **53** | 53 | 0 | 0 |
| **Total** | **177** | **18** | **195** | **195** | **0** | **0** |

New tests: `server/test/wave3/domain-rbac-closure.test.ts`.  
Full command: `npm run test:regression:all` (2026-08-24).  
No existing test was weakened, skipped, or deleted.

## 16. Backward compatibility

ITAM / Super Admin / tags / QR / checkout / check-in / replacement / assignment / locations / People / Space placement FKs preserved. AAM import no longer creates IT rows (intended security fix). Viewer loses GET `/spaces` without `settings.view` (D9).

## 17. Production database changes

None.

## 18. Remaining known gaps

Kits unscoped; dashboard people counts global; application `admin` flag bypass; `ON DELETE SET NULL` on `domain_id`; no default live two-role HTTP; **manual three-role browser smoke not performed**.

## 19. Manual smoke

**Not performed.** Browser automation was not available in this session. `npm run dev` was already running on the local app, but Super Admin / ITAM / AAM UI flows were not exercised by hand.

## 20. Final security verdict

**READY WITH NON-BLOCKING GAPS**

Wave 3.3 was not started.
