# WAVE 0 — REGRESSION HARNESS

## 1. Purpose

Wave 0 protects the **current ITAM production behavior** before any schema or domain evolution.

The harness captures current contracts first, then automates them. It does **not** redesign APIs, schema, or business behavior.

## 2. Scope

Covered in Wave 0:

- Backend API envelope contracts
- Asset identity helpers
- Current custody / checkout / check-in / replace contracts
- Current location reference behavior
- Current quantity inventory contracts
- Import field contracts
- Agent helper contracts
- Authentication / authorization guard behavior
- Attachment and action-log contracts
- Public and unauthorized HTTP route contracts that do not need MySQL

Deferred in Wave 0:

- Real database integration tests
- Browser end-to-end tests
- Full frontend component tests
- Wave 1+ EAM features

## 3. What Wave 0 protects

- Asset tag / FY format helper behavior
- QR public page URL shape
- Unauthorized responses on protected routes
- Login validation failure contract
- Agent shared-key unauthorized contract
- `assigned_type` support and current checkout/checkin semantics
- `location_id` / `rtd_location_id` fallback behavior
- Inventory remaining-quantity semantics
- Import type and field-mapping contracts
- RBAC helper behavior
- Action-log envelope and file download path shape

## 4. Test framework selection

**Backend test framework:** Node built-in test runner via `tsx`

Why selected:

- Already compatible with the current TypeScript + ESM server
- No new heavy framework required
- Can test exported functions directly
- Can boot the Express app for HTTP contract checks

Why alternatives were not selected:

- Jest / Vitest: unnecessary extra framework for current backend-only Wave 0 needs
- Supertest: useful, but not required because Node 22 has `fetch`
- Playwright / Cypress: too heavy for this phase and not justified without stable UI test infrastructure

Commands:

- Backend test command: `npm test` or `npm run test:backend` in `server/`
- Frontend test command: `npm test` in `client/` prints the Wave 0 defer message
- Full regression command: `cd server && npm run test:regression`

## 5. Test environment setup

Server harness files:

- `server/scripts/run-wave0-tests.mjs`
- `server/test/wave0/**/*`

The suite defaults to:

- `NODE_ENV=test`
- no direct MySQL usage
- no mail delivery
- no browser automation

HTTP tests boot the existing Express app on an ephemeral localhost port.

## 6. Database safety strategy

**Selected strategy:** Hybrid — unit/contract tests without DB by default; optional live DB mode only behind explicit opt-in.

### Default mode

- No database connection is required for the current Wave 0 suite.
- Tests focus on exported logic, source-backed contracts, and public/unauthorized HTTP behavior.

### Optional live mode

If later needed:

- set `WAVE0_LIVE=1`
- the runner fail-closes unless `DB_NAME` looks like a test database name (`/test/i` or `_test`) **or** `WAVE0_ALLOW_DB=1` is explicitly set after manual confirmation

### Safety guards

- `server/scripts/run-wave0-tests.mjs` refuses suspicious live DB runs
- no cleanup SQL exists in Wave 0
- no destructive setup/teardown exists in Wave 0

## 7. Test structure

```text
server/
  test/
    wave0/
      helpers/
        http.ts
        source.ts
      response-contract.test.ts
      asset-identity.test.ts
      custody-contract.test.ts
      locations-contract.test.ts
      inventory-contract.test.ts
      imports-agent-auth.test.ts
      http-public-contract.test.ts
      audit-attachments.test.ts
```

## 8. How to run tests

### Backend

```bash
cd server
npm test
```

### Regression alias

```bash
cd server
npm run test:regression
```

### Watch a small contract slice

```bash
cd server
npm run test:watch
```

### Frontend placeholder

```bash
cd client
npm test
```

## 9. Current coverage inventory

| Area | Coverage |
|---|---|
| Asset identity | Covered |
| Asset tags | Covered (helper contracts) |
| QR / public URL | Covered |
| Assignment / custody | Covered at contract level |
| Checkout / check-in / replace | Covered at contract level |
| Locations | Covered at contract level |
| Consumables / accessories / components | Covered at quantity/contract level |
| Imports | Covered at field + auto-map level |
| Agent helpers | Covered |
| Authentication | Covered for unauthorized/login validation/JWT helper |
| RBAC | Covered for helper logic |
| Attachments | Covered for route/path contract |
| Frontend critical components | Not covered in Wave 0 |

## 10. Known gaps

1. **Real DB-backed asset creation success path**
   - Why not tested: current app seeds and queries MySQL directly; Wave 0 intentionally avoided live DB mutation.
   - Risk: medium
   - Blocks Wave 1: no

2. **Successful login with seeded credentials**
   - Why not tested: would require a real DB user fixture.
   - Risk: medium
   - Blocks Wave 1: no

3. **Real import processing and CSV persistence**
   - Why not tested: requires file upload + DB-backed `imports` rows.
   - Risk: medium
   - Blocks Wave 1: no

4. **Real agent sync/update flow**
   - Why not tested: requires DB fixtures and agent rows.
   - Risk: high
   - Blocks Wave 1: no, but should be expanded before agent-related refactors

5. **Frontend behavior tests**
   - Why not tested: no frontend test stack existed; Wave 0 prioritized backend production contracts first.
   - Risk: medium
   - Blocks Wave 1: no

## 11. Untestable areas

### Full production-like DB transaction flows

Current limitation:

- Route handlers call the concrete MySQL layer directly.
- There is no pre-existing repository abstraction or test DB harness.

Minimal future change that would help:

- Add a dedicated `*_test` database bootstrap or seeded test fixture utility.

Not done in Wave 0.

### Email side effects

Current limitation:

- Notification paths are mixed into route flows.

Minimal future change that would help:

- Add mail transport stubbing in test setup only.

Not done in Wave 0.

## 12. Existing behavior captured as contracts

- `okList` returns `{ total, rows }`
- `okMessage` / `fail` wrap responses with `status/messages/payload`
- `assigned_type` currently includes `user | location | asset | employee`
- checkout-to-location overwrites `assets.location_id`
- check-in restores `body.location_id || rtd_location_id || location_id`
- replace is employee-only
- inventory remaining = `qty - checked_out`
- protected APIs return `401 Unauthorized` without a bearer token
- login without credentials returns `400` + `Email and password required`
- agent register returns `401 Unauthorized agent` when shared key is configured and missing

## 13. Possible bugs discovered but intentionally not changed

1. `server/src/app.ts` still serves the whole storage root at `/storage`
   - Known from earlier audit
   - Not changed in Wave 0

2. `server/src/routes/agent.ts` authorizes when `AGENT_API_KEY` is empty
   - Known from earlier audit
   - Wave 0 only tests the configured-key branch
   - Not changed in Wave 0

3. Empty permissions may still be soft-migrated to Admin in role setup
   - Known from earlier audit
   - Not changed in Wave 0

## 14. Requirements before Wave 1

- Wave 0 suite passes
- Team accepts documented gaps
- Schema work remains blocked until this harness is part of normal regression runs
- If deeper route coverage is required, add a dedicated test database before Wave 1 or early in Wave 1 preflight
