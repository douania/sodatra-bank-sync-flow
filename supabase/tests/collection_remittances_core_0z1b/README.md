# 0Z1B Core Collections / Remittances — local PostgreSQL 17 replay

This suite validates the local-only migration candidate. It uses synthetic users,
accounts, receipts and statement lines. It never connects to Supabase and contains
no real banking data.

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File supabase/tests/collection_remittances_core_0z1b/run_pg17_replay.ps1
```

The runner creates one unexposed `postgres:17-alpine` container, applies the minimal
Supabase/Daily v2 shape, the candidate migration and all assertions, exercises a real
two-session reservation race, then destroys the container in `finally`.

Expected final markers:

- `STRUCTURE_SECURITY_PASS`
- `CORE_SCENARIOS_PASS`
- `COUNTER_REVIEW_REGRESSIONS_PASS`
- `CONCURRENT_OVERRESERVATION_BLOCKED`
- `CONCURRENCY_PASS`
- `POST_NEGATIVE_PASS`
- `ALL_COLLECTION_REMITTANCES_CORE_0Z1B_PG17_PASS`
- `DISPOSABLE_CONTAINER_REMOVED`
