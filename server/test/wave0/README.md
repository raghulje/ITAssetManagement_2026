# Wave 0 — Regression & contract protection

Locks **current production behavior** before any Wave 1 schema work.

- Does **not** change APIs, schema, or application logic.
- Offline tests import existing exported functions and HTTP routes that do not require MySQL.
- Optional live checks: set `WAVE0_LIVE=1` (needs a configured database). Those tests skip by default.

Run from `server/`:

```bash
npm test
```
