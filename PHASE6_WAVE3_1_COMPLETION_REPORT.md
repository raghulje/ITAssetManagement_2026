# PHASE 6 — WAVE 3.1 COMPLETION REPORT

## 1. Completion summary

Wave 3.1 is a **read-only post-implementation audit** of Domain RBAC + People + Space Management. No application code, tests, schema, or database rows were changed in this step.

Live SELECT on `ITAssetManagement_2026` confirmed:

- **1204 / 15 / 15 / 15 / 15** assets / licenses / accessories / consumables / components, **all IT**, **0 NULL** `domain_id`
- Migrations **037–042** present
- **22** ADMIN categories seeded
- **187** locations, **0** `is_office`, **0** FLOOR, **0** SPACE (Space Management unused in production data)

## 2. Production code modified: NO

## 3. Production database modified: NO

SELECT-only inspection.

## 4. Staging database modified: NO

## 5. Migration created: NO

041/042 were already applied in the prior implementation pass.

## 6. Schema changes: NO

## 7. Documents produced

- `WAVE3_1_POST_IMPLEMENTATION_AUDIT.md` — full data-model, RBAC matrix, People/Space/migration/regression audit
- `PHASE6_WAVE3_1_COMPLETION_REPORT.md` — this file

## 8. Audit verdict

**SAFE WITH REQUIRED FIXES**

Primary inventory list/detail/create/update/delete/checkout **is real API authorization**. Query `?domain=` cannot widen scope. Super Admin / application Admin see both domains; IT Asset Manager / Viewer see IT; Admin Asset Manager sees ADMIN.

**Must fix before next wave** (secondary leaks, not the main CRUD path):

1. `GET /hardware/eol/due` and EOL dashboard counts — no domain clause  
2. Dashboard + `GET /reports/activity` — unscoped `action_logs` (cross-domain names)  
3. `GET /spaces/spaces/:id/assets` — unscoped inventory at a location  
4. `POST /hardware/audit` by tag — no domain check  
5. License invoice mutate + files-by-id — no domain check  
6. Unknown `domain_id` coerced to IT  
7. Import always writes IT (Admin Asset Manager has `settings.edit`)

## 9. Critical architectural answers (short)

| Q | Answer |
|---|---|
| Q1 Real auth or UI only? | **Real auth** on primary CRUD; **UI-only** is insufficient and not relied on there. Secondary routes are the hole. |
| Q2 Bypass with direct API? | **Not** on list/detail/checkout. **Yes** on EOL, activity, space items, audit-by-tag, files. |
| Q3 Legacy IT safe? | **Yes.** 1204 remain IT; NULL treated as IT; Admin AM cannot see them. |
| Q4 domain_attrs maintainable? | **Temporarily yes.** Unallowlisted JSON bag. |
| Q5 JSON vs columns later? | Keep JSON now; promote searched fields (MAC/IP/OS) later if needed. |
| Q6 Spaces vs ITAM locations? | **Yes coexist.** Same `locations` table; FKs unchanged; 187 UNSPECIFIED untouched. |
| Q7 Assignment totals/history? | **Trustworthy for employee-type checkouts** in-scope. Legacy `assigned_type=user` assets may miss the current list. History uses `action_logs`. Consumable issues never leave “assigned”. |
| Q8 Continue from this? | **Yes, after the must-fix list.** Do not add modules on top of leaky secondary endpoints. |
| Q9 Before more modules? | Close D1–D8 in the audit (EOL, activity, space items, audit-by-tag, invoices/files, domain_id fail-closed, import domain). |

## 10. Regression

Not re-run (read-only docs). Prior known greens: Wave 2 **83**, Wave 3 **35** from the implementation pass. Coverage gap: **no live two-role HTTP tests**.

## 11. Production readiness for more modules

**NOT READY FOR WAVE 3.2** until required fixes are implemented and re-audited.

Space Management UI/API may be used for offices **after** space-item listing is domain-scoped; production currently has **no** office/floor/space rows.

## 12. Explicit stop

Wave 3.2 was **not** started. No fixes were applied. Waiting for approval of the audit verdict and the must-fix list.
