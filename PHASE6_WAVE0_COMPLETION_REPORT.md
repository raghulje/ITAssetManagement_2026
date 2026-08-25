# Phase 6 — Wave 0 Completion Report

## 1. Executive Summary

Wave 0 is complete.

A backend regression harness was added around the **current** ITAM behavior without changing production schema or business logic. The suite focuses on stable contracts first: response envelopes, asset identity helpers, custody semantics, location references, quantity inventory behavior, imports metadata, agent helper behavior, auth/RBAC helpers, and public/unauthorized HTTP route contracts.

## 2. Testing Stack Selected

- Backend: Node built-in test runner + `tsx`
- Frontend: no component test framework added in Wave 0; placeholder scripts document the defer
- HTTP contract checks: existing Express app + Node `fetch`

Why:

- smallest practical stack for current TypeScript/ESM backend
- no extra runner or browser harness required
- production runtime unchanged

## 3. Files Added

PATH: `server/scripts/run-wave0-tests.mjs`  
PURPOSE: Runs the Wave 0 suite and fail-closes optional live DB mode.

PATH: `server/test/wave0/helpers/http.ts`  
PURPOSE: Starts the existing Express app on an ephemeral port for HTTP contract checks.

PATH: `server/test/wave0/helpers/source.ts`  
PURPOSE: Reads server source files so source-backed contract tests can assert current behavior without changing production code.

PATH: `server/test/wave0/response-contract.test.ts`  
PURPOSE: Locks the JSON response envelope helpers.

PATH: `server/test/wave0/asset-identity.test.ts`  
PURPOSE: Protects asset tag helper behavior and QR page URL shape.

PATH: `server/test/wave0/custody-contract.test.ts`  
PURPOSE: Protects current checkout/check-in/replace contracts and `assigned_type` semantics.

PATH: `server/test/wave0/locations-contract.test.ts`  
PURPOSE: Protects current location CRUD field shape and `location_id` / `rtd_location_id` behavior.

PATH: `server/test/wave0/inventory-contract.test.ts`  
PURPOSE: Protects current quantity and inventory checkout rules.

PATH: `server/test/wave0/imports-agent-auth.test.ts`  
PURPOSE: Protects import field metadata, agent helper behavior, and auth/RBAC helper behavior.

PATH: `server/test/wave0/http-public-contract.test.ts`  
PURPOSE: Protects public status/login/unauthorized route behavior without a DB.

PATH: `server/test/wave0/audit-attachments.test.ts`  
PURPOSE: Protects action-log insert shape and attachment route contracts.

PATH: `WAVE0_REGRESSION_HARNESS.md`  
PURPOSE: Documents the Wave 0 harness, scope, safety model, and known gaps.

## 4. Files Modified

PATH: `server/package.json`  
REASON: Added backend test scripts for Wave 0.  
PRODUCTION BEHAVIOR CHANGED: NO

PATH: `client/package.json`  
REASON: Added placeholder frontend test scripts so the repository has explicit Wave 0 commands.  
PRODUCTION BEHAVIOR CHANGED: NO

PATH: `server/test/wave0/README.md`  
REASON: Earlier short note retained during setup; superseded by `WAVE0_REGRESSION_HARNESS.md`.  
PRODUCTION BEHAVIOR CHANGED: NO

## 5. Test Environment Safety

- Default Wave 0 tests do **not** connect to MySQL.
- The suite uses direct helper tests, source-backed contract tests, and public/unauthorized HTTP tests.
- Optional live DB mode is guarded:
  - only when `WAVE0_LIVE=1`
  - runner rejects the run unless `DB_NAME` looks like a test database (`test` / `_test`) or `WAVE0_ALLOW_DB=1` is explicitly set
- No destructive cleanup exists in Wave 0.
- No schema or data mutation scripts were added.

## 6. Regression Coverage

| Area | Critical Behavior | Automated Tests | Status |
|---|---|---|---|
| Asset Identity | Tag helper rules, FY segment, QR page URL shape | `asset-identity.test.ts` | COVERED |
| Asset Tags | Required preconditions + current format pattern | `asset-identity.test.ts` | COVERED |
| QR / Labels | Public asset page URL path shape | `asset-identity.test.ts`, `http-public-contract.test.ts` | PARTIALLY COVERED |
| Assignment | `assigned_type` contract | `custody-contract.test.ts` | COVERED |
| Checkout | current failure rules + location overwrite semantics | `custody-contract.test.ts` | COVERED |
| Check-in | reason required + location fallback | `custody-contract.test.ts` | COVERED |
| Replacement | employee-only swap contract | `custody-contract.test.ts` | COVERED |
| Locations | CRUD field shape + filter clauses + FK behavior | `locations-contract.test.ts` | COVERED |
| Consumables | quantity + issue target contract | `inventory-contract.test.ts` | COVERED |
| Accessories | quantity + issue target contract | `inventory-contract.test.ts` | COVERED |
| Components | quantity + asset target contract | `inventory-contract.test.ts` | COVERED |
| Imports | import types, required fields, auto-map aliases | `imports-agent-auth.test.ts` | COVERED |
| Agents | serial filtering, token hash, unauthorized register path | `imports-agent-auth.test.ts`, `http-public-contract.test.ts` | PARTIALLY COVERED |
| Authentication | unauthorized, invalid JWT, login validation, JWT helper | `http-public-contract.test.ts`, `imports-agent-auth.test.ts` | COVERED |
| RBAC | permission helper and viewer scope | `imports-agent-auth.test.ts` | COVERED |
| Frontend Critical Components | component-level UI regression tests | none | NOT COVERED |

## 7. API Contract Coverage

METHOD: `GET`  
ROUTE: `/api/v1/status`  
CURRENT CONTRACT PROTECTED: public health/status payload shape  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

METHOD: `GET`  
ROUTE: `/api/v1/hardware`  
CURRENT CONTRACT PROTECTED: bearer token required  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

METHOD: `GET`  
ROUTE: `/api/v1/locations`  
CURRENT CONTRACT PROTECTED: bearer token required  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

METHOD: `GET`  
ROUTE: `/api/v1/consumables`  
CURRENT CONTRACT PROTECTED: bearer token required  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

METHOD: `GET`  
ROUTE: `/api/v1/accessories`  
CURRENT CONTRACT PROTECTED: bearer token required  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

METHOD: `GET`  
ROUTE: `/api/v1/components`  
CURRENT CONTRACT PROTECTED: bearer token required  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

METHOD: `GET`  
ROUTE: `/api/v1/kits`  
CURRENT CONTRACT PROTECTED: bearer token required  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

METHOD: `POST`  
ROUTE: `/api/v1/login`  
CURRENT CONTRACT PROTECTED: missing credentials error shape  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

METHOD: `POST`  
ROUTE: `/api/v1/agent/register`  
CURRENT CONTRACT PROTECTED: unauthorized when shared key is configured but missing  
TEST FILE: `server/test/wave0/http-public-contract.test.ts`

## 8. Test Execution Results

Command:

```bash
cd server
npm test
```

Result summary:

- TOTAL TESTS: 47
- PASSED: 47
- FAILED: 0
- SKIPPED: 0

Actual output summary:

```text
1..10
# tests 47
# suites 10
# pass 47
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## 9. Known Gaps

1. Real asset creation success path  
WHY NOT TESTED: requires DB-backed fixtures and live inserts  
RISK: MEDIUM  
RECOMMENDATION: add a dedicated test DB harness before deeper mutation coverage  
BLOCKS WAVE 1: NO

2. Real checkout/check-in/replace through live DB rows  
WHY NOT TESTED: current Wave 0 avoided database mutation for safety  
RISK: HIGH  
RECOMMENDATION: expand with dedicated test DB before Wave 1 or in early Wave 1 preflight  
BLOCKS WAVE 1: NO

3. Real import processing  
WHY NOT TESTED: needs upload + DB-backed import rows  
RISK: MEDIUM  
RECOMMENDATION: add test DB + fixture CSV processing tests  
BLOCKS WAVE 1: NO

4. Real agent sync/update flow  
WHY NOT TESTED: needs DB fixtures and auth setup  
RISK: HIGH  
RECOMMENDATION: add isolated agent fixture tests before agent-related refactors  
BLOCKS WAVE 1: NO

5. Frontend critical components  
WHY NOT TESTED: no frontend test stack added in Wave 0; backend regression was higher-value first  
RISK: MEDIUM  
RECOMMENDATION: add selected component tests once backend evolutionary waves start touching forms  
BLOCKS WAVE 1: NO

## 10. Possible Existing Bugs Discovered

CURRENT BEHAVIOR: `/storage` still exposes the whole storage root via `app.use('/storage', express.static(storageRoot))`  
EXPECTED / SUSPECTED ISSUE: private uploads may still be publicly reachable  
EVIDENCE: existing app route configuration and earlier security audit  
TEST ADDED: NO (Wave 0 only protected current contract paths)  
CHANGED IN WAVE 0: NO

CURRENT BEHAVIOR: `/api/v1/agent/register` allows requests when `AGENT_API_KEY` is empty  
EXPECTED / SUSPECTED ISSUE: fail-open agent auth path  
EVIDENCE: `sharedKeyAuthorized()` in `server/src/routes/agent.ts`  
TEST ADDED: PARTIAL — configured-key unauthorized path only  
CHANGED IN WAVE 0: NO

CURRENT BEHAVIOR: activated users with empty permissions may still be soft-migrated to Admin  
EXPECTED / SUSPECTED ISSUE: broader-than-expected access bootstrap  
EVIDENCE: `ensureDefaultRoles()` in `server/src/services/permissions.ts`  
TEST ADDED: NO  
CHANGED IN WAVE 0: NO

## 11. Wave 0 Acceptance Checklist

| Requirement | Status |
|---|---|
| Test framework installed | YES |
| Production runtime unchanged | YES |
| No schema changes | YES |
| No migrations | YES |
| Asset identity protected | YES |
| Custody behavior protected | YES |
| Location behavior protected | YES |
| Inventory behavior protected | YES |
| Critical APIs covered | YES |
| Test database isolated | YES |
| Full suite runnable | YES |
| Documentation created | YES |

## 12. Wave 1 Readiness Assessment

READY WITH KNOWN GAPS

Why:

1. The regression suite runs successfully.
2. Production database use is fail-closed by default.
3. No production schema or runtime behavior was changed.
4. High-risk ITAM helper and contract paths now have meaningful automated protection.
5. Remaining gaps are documented and visible.
