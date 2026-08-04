# 0Z1B Core — service_role EXECUTE corrective migration

## Verdict

`PASS_LOCAL_SERVICE_ROLE_EXECUTE_P2_FIX_PG17_REPLAY`

This verdict is local only. It does not authorize a staging apply, commit, push,
pull-request update, merge or production action.

## Authorization and scope

GO received:

- `GO_0Z1B_CORE_SERVICE_ROLE_EXECUTE_P2_FIX_LOCAL_ONLY_APPROVED`.

The staging validation had shown that fifteen Core write RPCs retained effective
`EXECUTE` for `service_role`. The live default privileges grant execution of new
functions to that role, while the original migration's final revoke selected only
`collection_*` helpers and `export_collection_register_v1()`.

No Supabase endpoint was accessed during this local correction. No real user,
credential or banking datum was used.

## Additive correction

Migration:

`supabase/migrations/20260804000000_collection_remittances_core_service_role_execute_fix.sql`

- 83 lines;
- SHA-256:
  `341013AFC3765E25A07AB36E749709D3C0D8C35717A19C19CEC0AE5AD8785601`;
- explicitly revokes `EXECUTE` from `service_role` on the fifteen write RPC
  signatures;
- verifies in the same transaction that `authenticated` retains every write RPC;
- preserves the deliberate `service_role` grant on the read-only capability helper;
- contains no table mutation and no business-data operation.

The already-applied Core migration remains byte-for-byte unchanged:

- `20260803000000_collection_remittances_core_0z1b.sql`;
- SHA-256:
  `DCBC4D33E20BB34AEB9DA18125CB1013896D7F2FF74106E04049B5DB1BD7F147`.

## Regression coverage

The local platform shim now reproduces the staging default privilege before the
Core migration. A dedicated pre-fix assertion proves that all fifteen unintended
grants exist before the additive correction. The post-fix security suite proves:

- zero Core write RPC executable by `service_role`;
- all fifteen write RPCs still executable by `authenticated`;
- the read-only capability helper remains executable by `service_role`;
- the existing RLS, direct-DML, PUBLIC and anon assertions remain unchanged.

Relevant proof files:

- `00_platform_daily_v2_shim.sql`: 117 lines,
  `B71FCE183A5BEDED8B7F53850F4C95ABCDC74FAFD0A8E618E61A1EE16DA4C328`;
- `05_service_role_execute_pre_fix.sql`: 33 lines,
  `53753E801E65BB1C4345D41D8E246586BC92D4BC092DA8C9E47663794003CD15`;
- `10_structure_security.sql`: 176 lines,
  `2AB1E6C9435EB77B509A8BFE49D6F7786B5D264A0CE1B87FAC7713801DEF89BD`;
- `run_pg17_replay.ps1`: 98 lines,
  `FEF9BDCA2FC4E1D3012F875EBC1B229BE5C40F3A5E5ADF0EC32E5C8341E901FB`.

## PostgreSQL 17 replay

Runtime: disposable unexposed `postgres:17-alpine`, server version `17.10`.

Observed markers:

- `SERVICE_ROLE_EXPOSURE_REPRODUCED`;
- `STRUCTURE_SECURITY_PASS`;
- `CORE_SCENARIOS_PASS`;
- `COUNTER_REVIEW_REGRESSIONS_PASS`;
- `CONCURRENT_OVERRESERVATION_BLOCKED`;
- `CONCURRENCY_PASS`;
- `POST_NEGATIVE_PASS`;
- `ALL_COLLECTION_REMITTANCES_CORE_0Z1B_PG17_PASS`;
- `DISPOSABLE_CONTAINER_REMOVED`.

Synthetic summary remained unchanged:
`tables=12|events=98|allocations=12|cutovers=1`.

## Next gate

The next gate is an independent targeted local DB/security counter-review of this
exact delta. Applying the corrective migration to staging requires a separate,
explicit staging GO. Production remains forbidden.
