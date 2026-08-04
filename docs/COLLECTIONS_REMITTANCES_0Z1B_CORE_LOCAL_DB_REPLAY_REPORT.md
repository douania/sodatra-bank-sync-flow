# 0Z1B Core Collections / Remittances — local DB draft and PostgreSQL 17 replay

## Verdict

`PASS_LOCAL_DB_P1_P2_CORRECTIONS_PG17_REPLAY`

This verdict is local only. It does not authorize a Supabase apply, staging, commit,
push, PR or merge. It closes the local remediation replay, not the required targeted
independent DB/security counter-review.

## Authorized scope

GOs received:

- `GO_0Z1B_CORE_LOCAL_DB_DRAFT_AND_PG17_REPLAY_ON_CLEAN_BRANCH_APPROVED`;
- `GO_0Z1B_CORE_LOCAL_DB_P1_P2_CORRECTIONS_ONLY_APPROVED`.

- Clean branch: `feat/0z1b-core-local-db`.
- Base: `origin/main` at `c36c15eb2d1f13018162e31c6d7bba6098576f75`.
- Previous 0Z1B worktrees and PR #118 were not modified.
- No Supabase endpoint, real credential or real banking data was used.
- No commit, push or PR was created.

## Candidate delivered

Migration candidate:

`supabase/migrations/20260803000000_collection_remittances_core_0z1b.sql`

- 1,786 lines.
- SHA-256: `DCBC4D33E20BB34AEB9DA18125CB1013896D7F2FF74106E04049B5DB1BD7F147`.
- Eleven Core tables and one read-only exception view.
- Fifteen versioned write commands and one read-only register export.
- All write commands are `SECURITY DEFINER`, use a bounded `search_path`, require an
  authenticated actor, a nominal capability, command idempotency and append-only audit.
- Direct INSERT/UPDATE/DELETE grants are absent for `authenticated`, `anon` and PUBLIC.
- The Core prepares, controls and justifies collections; it exposes no payment or
  accounting-posting command.

The first independent counter-review returned
`FAIL_P1_INDEPENDENT_COUNTER_REVIEW_LOCAL_DB`. This bounded correction delta addresses
all five findings:

- native PostgreSQL SHA-256 replaces schema-dependent `pgcrypto.digest` resolution;
- withdrawal is limited to `SUBMITTED`, and receipt-level over-allocation is rejected
  when the proposal is created;
- draft item instrument correction enforces method, amount and currency invariants and
  reopens the motivated duplicate-review path when identity changes;
- direct journal and exception reads require `AUDIT`; assignment reads are limited to
  the actor concerned, `AUDIT` or `MANAGE_ACCESS`;
- unexpected-credit detection excludes already allocated evidence and requires a bank
  line dated on or after the confirmed withdrawal.

## PostgreSQL replay

Runtime: `postgres:17-alpine`, server version `17.10`, disposable unexposed container.

Final markers:

- `STRUCTURE_SECURITY_PASS`
- `CORE_SCENARIOS_PASS`
- `COUNTER_REVIEW_REGRESSIONS_PASS`
- `CONCURRENT_OVERRESERVATION_BLOCKED`
- `CONCURRENCY_PASS`
- `POST_NEGATIVE_PASS`
- `ALL_COLLECTION_REMITTANCES_CORE_0Z1B_PG17_PASS`
- `DISPOSABLE_CONTAINER_REMOVED`

Final synthetic replay summary: `tables=12|events=98|allocations=12|cutovers=1`.
The table count includes the eleven Core tables plus the exception view as exposed by
`information_schema.tables`.

The tested scenarios include:

- manual entry, scan control, independent validation and command replay;
- exact Bank A account enforcement and Bank B refusal;
- partial then full settlement without exceeding item, receipt or Daily-line caps;
- refusal of a partial-item withdrawal and early receipt-cap rejection of a synthetic
  historical reroute inconsistency;
- net discount with gross, credit, observed fees and net liquidity kept distinct;
- multiple separate fee debits and the bounded same-bank cross-account fee case;
- withdrawal from Bank A, rerouting to Bank B and preservation of both attempts;
- probabilistic duplicate review and motivated resolution;
- null/type-incompatible instrument correction rejection and reviewed reuse of a known
  instrument for a new presentation;
- correction and cancellation audit;
- Daily v2 evidence supersession and explicit rebind;
- idempotent legacy import, cutover request cancellation, replacement request,
  second-actor confirmation and final rejection of later legacy LOAD calls;
- stable read-only export without raw bank labels;
- separation of audit/non-audit reads, with the pre-withdrawal allocated-credit false
  positive removed and a genuine later credit still blocking;
- empty, all-cancelled and mixed terminal header projections;
- a real two-session reservation race: one 700 reservation on a 1,000 Daily line wins,
  the concurrent second 700 reservation waits then fails closed.

## Reproducibility

Run locally from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File supabase/tests/collection_remittances_core_0z1b/run_pg17_replay.ps1
```

The runner destroys its exact disposable container in a `finally` block and verifies
that it is absent.

## Limits and next gate

This replay proves the candidate against a minimal synthetic platform/Daily v2 schema
matching the referenced production object shapes. It does not prove production values,
live grants, live policies, the complete Supabase migration ledger or application UI
integration.

Next gate: targeted independent local DB/security counter-review of this exact
uncommitted correction delta and migration hash. Any further correction requires a new
local-only authorization; any staging action requires a separate explicit GO.
