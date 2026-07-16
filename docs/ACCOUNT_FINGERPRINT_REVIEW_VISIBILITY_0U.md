# DAILY-V2-0U — Account registry and review visibility

Status: 0U and 0U3 are merged and applied to staging. The first controlled
historical adoption was refused before any write because staging carries one
safe opaque legacy token of 31 characters rather than a 64-hex SHA-256. The
forward-only 0U4 compatibility fix is implemented. Its application tests,
type/lint baselines and build are validated locally; the mandatory PostgreSQL
15 Docker replay is still pending. It has not been applied to a remote project.

## Outcome

- Operators no longer type an account fingerprint. They select an active,
  bank/currency-scoped account from `daily_statement_account_registry`.
- Only an admin can provision or deactivate an account. PostgreSQL generates
  the 64-hex opaque fingerprint; the UI never renders or exports it.
- BIS backfill uses a real one-use `daily_statement_backfill_grants` row,
  bounded by account, period, maximum units and expiration. Free-text grants
  are no longer accepted by the 0U wrapper.
- Review reasons use a server allow-list and are persisted on attempts,
  staging units and canonical units. The staging UI filters review-required
  units independently of the lifecycle status and shows reasons before an
  admin decision.
- Account/grant lifecycle actions are appended to
  `daily_statement_account_events`, readable only by admin/auditor.

## Migration design

`20260715000000_daily_v2_account_registry_review_visibility.sql` is additive:

- three new control/audit tables;
- nullable registry/grant foreign keys plus non-null empty-array review codes
  on historical Daily v2 tables;
- four admin-only lifecycle RPCs;
- a new `pre_ingest_daily_statement_units` wrapper around the unchanged legacy
  core. The renamed core has EXECUTE revoked from every application role.

All new deposits fail closed unless the active registry row matches the bank,
currency and fingerprint exactly. Backfill grants are locked and consumed in
the same transaction as the deposit. Any failure rolls the entire operation
back.

When both the file and registry carry a masked account label, they must match.
If that identity cannot be corroborated (missing on either side), every unit is
held as `needs_review` with `ACCOUNT_IDENTITY_NOT_CORROBORATED`; promotion then
requires an explicit audited admin reason.

### Historical identity adoption bridge (0U3)

The additive follow-up migration
`20260715010000_daily_v2_historical_identity_adoption_bridge.sql` adds one
admin-only RPC for a controlled pre-0U identity adoption. The operator supplies
only bank, currency and a non-sensitive alias. The server selects exactly one
unmapped historical identity for that context, preserves its existing opaque
fingerprint and optional masked label, and maps attempts, staging units and
canonical units in one transaction.

The RPC never accepts, returns or audits the fingerprint. It fails closed on
multiple fingerprints, cross-context reuse, multiple masked labels, partial
prior mapping, missing attempts/staging/canonical rows or concurrent count
changes. It does not modify day identifiers, content or line hashes, statuses,
amounts or transaction lines. A mapped historical `conflict` remains a
conflict and can subsequently use the normal audited supersede workflow.

### Legacy fingerprint compatibility (0U4)

The forward-only migration
`20260716000000_daily_v2_legacy_fingerprint_compatibility.sql` does not rewrite
0U or 0U3 and never updates historical fingerprints, day identifiers, hashes,
amounts, statuses or lines. It adds an explicit registry discriminator:

- `sha256_hex_v1` remains the mandatory normal-provisioning format;
- `legacy_opaque_v1` is available only to the admin historical-adoption RPC.

The legacy grammar is closed and server-side: 16–128 ASCII characters from
`A-Z`, `a-z`, `0-9`, `.`, `_`, `:` or `-`, with at least one letter. Whitespace,
control characters, eight consecutive digits, IBAN-like values, masked-account
syntax and case-insensitive hex64 values are rejected. The RPC discovers and
classifies the existing identity internally; callers cannot submit a
fingerprint or choose its scheme. The exact historical token is preserved so
all existing idempotency preimages remain stable.

The application parses registry rows as a discriminated union but continues to
treat `account_fingerprint` as internal-only. The scheme is non-sensitive; the
token itself is never rendered, logged, returned by adoption or added to audit
details.

## Review reason allow-list

- `TRUSTED_CURRENCY_UNCORROBORATED`
- `RUNNING_BALANCE_MISSING`
- `RUNNING_BALANCE_CHAIN_INCOHERENT`
- `AGGREGATES_UNAVAILABLE`
- `ACTIVE_LINE_HASH_SCOPE_CONFLICT`
- `ACCOUNT_IDENTITY_NOT_CORROBORATED`
- `BACKFILL_REVIEW_REQUIRED`

Unknown or free-text codes are rejected. A submitted unit carrying codes must
also carry `validation_status=needs_review`. Server-detected R3 conflicts add
`ACTIVE_LINE_HASH_SCOPE_CONFLICT` before the unit becomes visible in review.

## Local verification

The existing 0R runner now applies the historical Daily v2 migration followed
by the additive 0U, 0U3 and forward-only 0U4 migrations. Before the normal multi-bank campaign,
it seeds an entirely synthetic pre-0U state (three active canonical days and
one same-identity conflict), validates the admin-only adoption and its targeted
teardown. The remaining campaign validates registry binding, admin-only
lifecycle RPCs, RLS, review-code persistence, one-use grant consumption,
legacy-core non-bypass and the unchanged canonical/reporting flow.

Run only against the throwaway Docker container:

```sh
bash supabase/tests/daily_statement_units_v2/run_e2e_0r.sh
```

The runner must end with `ALL_LOCAL_E2E_0R_PASS` and destroy its container and
anonymous volume. Never point this runner or its SQL files at a linked Supabase
project.

The 0U4 campaign additionally proves preservation of a synthetic 31-character
legacy identity, continued SHA-256 adoption, the closed rejection grammar and
normal provisioning locked to `sha256_hex_v1`.

Current 0U4 validation state: 381/381 application tests and the production build
pass; TypeScript (19 diagnostics) and ESLint (222 diagnostics) are identical
item by item to the canonical baseline. `ALL_LOCAL_E2E_0R_PASS` remains a hard
stop condition until the campaign has run in a Docker-capable environment.

## Stop conditions and rollback

Stop before any remote apply if the Docker replay, RLS matrix, application
tests, build or baseline comparison fails. Also stop if remote `main` moves or
the target migration ledger differs from the expected staging ledger.
Stop if any pre-0U staging unit
still requires a canonical decision, especially a unit in `staged` or
`conflict`: its nullable historical `account_registry_id` would make the 0U
canonical trigger reject promotion or supersede until an explicit mapping or
closure plan has been reviewed.

The staging preflight found one coherent historical identity, three active
canonical units and one same-identity conflict with no other-day R3 overlap.
0U/0U3 were applied, but adoption correctly failed before writing because the
historical token is safe opaque legacy rather than hex64. Imports remain paused.
Remote 0U4 application and a new single adoption call require separate GOs,
ledger verification and independent DB/security review; any deviation from the
reviewed aggregate counts is a stop condition.

Before first remote use, rollback is to remove the additive migration from the
deployment plan. After remote apply but before any 0U deposit, a dedicated,
reviewed rollback migration may restore the legacy RPC name and remove the new
objects. After any account/grant/event or 0U deposit exists, do not drop the
new columns or tables: disable new imports and ship a forward corrective
migration so audit and identity links remain intact.
