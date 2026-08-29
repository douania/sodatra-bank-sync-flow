import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDailyV2BackfillIncrementalDelta } from './dailyV2IncrementalDelta';
import type { DailyV2PreIngestPayload, DailyV2RpcLine, DailyV2RpcUnit } from './dailyV2Types';

const app = readFileSync('src/App.tsx', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const access = readFileSync('src/features/daily-v2/dailyV2Access.ts', 'utf8');
const accessState = readFileSync('src/features/daily-v2/dailyV2AccessState.ts', 'utf8');
const browserPipeline = readFileSync('src/features/daily-v2/dailyV2BrowserPipeline.ts', 'utf8');
const service = readFileSync('src/features/daily-v2/dailyV2SupabaseService.ts', 'utf8');
const types = readFileSync('src/features/daily-v2/dailyV2Types.ts', 'utf8');
const page = readFileSync('src/pages/DailyStatementV2.tsx', 'utf8');
const tables = readFileSync('src/features/daily-v2/DailyV2Tables.tsx', 'utf8');
const migration0U = readFileSync(
  'supabase/migrations/20260715000000_daily_v2_account_registry_review_visibility.sql',
  'utf8',
);
const migration0U3 = readFileSync(
  'supabase/migrations/20260715010000_daily_v2_historical_identity_adoption_bridge.sql',
  'utf8',
);
const migration0U4 = readFileSync(
  'supabase/migrations/20260716000000_daily_v2_legacy_fingerprint_compatibility.sql',
  'utf8',
);
const migrationRuntimeLockReadApi = readFileSync(
  'supabase/migrations/20260730180000_daily_v2_runtime_lock_read_api.sql',
  'utf8',
);
const migrationBisTimeoutHardening = readFileSync(
  'supabase/migrations/20260829000000_daily_v2_bis_backfill_atomic_ingest_timeout_hardening.sql',
  'utf8',
);
const e2eRunner = readFileSync('supabase/tests/daily_statement_units_v2/run_e2e_0r.sh', 'utf8');
const bisMassGenerator = readFileSync(
  'supabase/tests/daily_statement_units_v2/e2e0r_generate_bis_mass_backfill.ts',
  'utf8',
);
const bisMassSqlTest = readFileSync(
  'supabase/tests/daily_statement_units_v2/31_bis_mass_backfill_timeout_hardening.sql',
  'utf8',
);
const e2ePipelineSqlTest = readFileSync(
  'supabase/tests/daily_statement_units_v2/30_e2e0r_pipeline.sql',
  'utf8',
);
const bisConcurrencyAssertions = readFileSync(
  'supabase/tests/daily_statement_units_v2/32d_bis_backfill_concurrency_asserts.sql',
  'utf8',
);

test('uses the exact Daily v2 RPC names and no direct table mutation', () => {
  for (const rpc of [
    'pre_ingest_daily_statement_units',
    'promote_daily_statement_unit',
    'supersede_daily_statement_unit',
    'provision_daily_statement_account',
    'deactivate_daily_statement_account',
    'issue_daily_statement_backfill_grant',
    'revoke_daily_statement_backfill_grant',
  ]) {
    assert.match(service, new RegExp(`\\.rpc\\(['"]${rpc}['"]`));
    assert.match(types, new RegExp(`${rpc}:`));
  }

  assert.doesNotMatch(service, /\.(insert|update|delete|upsert)\s*\(/);
  assert.equal(service.includes('createClient('), false);
  assert.equal(service.includes('service_role'), false);
});

test('keeps the six historical Daily v2 tables and adds the 0U control tables', () => {
  for (const table of [
    'daily_statement_export_attempts',
    'daily_statement_units_staging',
    'daily_statement_lines_staging',
    'daily_statement_units_canonical',
    'daily_statement_lines_canonical',
    'daily_statement_import_events',
    'daily_statement_account_registry',
    'daily_statement_backfill_grants',
    'daily_statement_account_events',
  ]) {
    assert.match(types, new RegExp(`${table}:`));
  }
});

test('exposes only a fail-closed read API for the private runtime lock', () => {
  assert.match(
    migrationRuntimeLockReadApi,
    /FUNCTION public\.daily_stmt_mutations_enabled\(\)\s*RETURNS boolean/,
  );
  assert.match(migrationRuntimeLockReadApi, /STABLE\s+SECURITY DEFINER/);
  assert.match(migrationRuntimeLockReadApi, /SET search_path = pg_catalog, pg_temp/);
  assert.match(
    migrationRuntimeLockReadApi,
    /SELECT COALESCE\([\s\S]*daily_v2_private\.runtime_control[\s\S]*false/,
  );
  assert.match(
    migrationRuntimeLockReadApi,
    /REVOKE ALL ON FUNCTION public\.daily_stmt_mutations_enabled\(\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    migrationRuntimeLockReadApi,
    /GRANT EXECUTE ON FUNCTION public\.daily_stmt_mutations_enabled\(\)[\s\S]*TO authenticated, service_role/,
  );
  assert.doesNotMatch(migrationRuntimeLockReadApi, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(migrationRuntimeLockReadApi, /mutations_enabled\s*=/);
  assert.match(service, /\.rpc\('daily_stmt_mutations_enabled'\)/);
  assert.match(types, /daily_stmt_mutations_enabled:/);
  assert.match(e2eRunner, /MIGRATION_RUNTIME_LOCK_READ_API=/);
  assert.match(e2eRunner, /18_runtime_lock_read_api\.sql/);
  assert.match(e2eRunner, /18a_runtime_lock_read_api_enabled\.sql/);
});

test('keeps the 0U migration additive and makes the historical ingest core internal', () => {
  for (const table of [
    'daily_statement_account_registry',
    'daily_statement_backfill_grants',
    'daily_statement_account_events',
  ]) {
    assert.match(migration0U, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(migration0U, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(migration0U, /RENAME TO daily_stmt_pre_ingest_legacy_core_0u/);
  assert.match(
    migration0U,
    /REVOKE ALL ON FUNCTION public\.daily_stmt_pre_ingest_legacy_core_0u\(jsonb,jsonb,jsonb,jsonb\)/,
  );
  assert.doesNotMatch(migration0U, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.match(e2eRunner, /MIGRATION_0U=/);
  assert.match(e2eRunner, /--single-transaction < "\$MIGRATION_0U"/);
});

test('hardens the BIS mass backfill with one atomic set-based review batch', () => {
  assert.match(
    migrationBisTimeoutHardening,
    /CREATE OR REPLACE FUNCTION public\.pre_ingest_daily_statement_units\(/,
  );
  assert.match(
    migrationBisTimeoutHardening,
    /CREATE OR REPLACE FUNCTION public\.daily_stmt_pre_ingest_bis_backfill_core_0v\(/,
  );
  assert.match(
    migrationBisTimeoutHardening,
    /IF p_attempt ->> 'requested_mode' = 'backfill'[\s\S]*daily_stmt_pre_ingest_bis_backfill_core_0v/,
  );
  assert.match(migrationBisTimeoutHardening, /WITH unit_input AS MATERIALIZED/);
  assert.match(migrationBisTimeoutHardening, /FOR v_lock_day_unit_id IN[\s\S]*ORDER BY[\s\S]*LOOP[\s\S]*daily_stmt_acquire_day_lock/);
  assert.match(migrationBisTimeoutHardening, /result_units AS MATERIALIZED/);
  assert.doesNotMatch(migrationBisTimeoutHardening, /JOIN LATERAL \([\s\S]*jsonb_array_elements\(v_result -> 'units'\)/);
  assert.doesNotMatch(migrationBisTimeoutHardening, /line_count',\(SELECT[\s\S]*jsonb_array_elements\(p_units\)/);
  assert.match(migrationBisTimeoutHardening, /sum\(\(d\.value ->> 'line_count'\)::integer\)/);
  assert.match(migrationBisTimeoutHardening, /DAILY_STMT_BIS_BACKFILL_LINE_CARDINALITY/);
  assert.match(migrationBisTimeoutHardening, /DAILY_STMT_UNIT_DATE_OUT_OF_PERIOD/);
  assert.match(migrationBisTimeoutHardening, /'input_review_required', input_review_required/);
  assert.match(migrationBisTimeoutHardening, /WHERE \(e\.value ->> 'input_review_required'\)::boolean[\s\S]*validation_status' <> 'needs_review'/);
  assert.match(migrationBisTimeoutHardening, /INSERT INTO public\.daily_statement_units_staging/);
  assert.match(migrationBisTimeoutHardening, /INSERT INTO public\.daily_statement_lines_staging/);
  assert.equal(
    (migrationBisTimeoutHardening.match(/INSERT INTO public\.daily_statement_import_events/g) ?? []).length,
    1,
  );
  assert.match(
    migrationBisTimeoutHardening,
    /FUNCTION public\.daily_stmt_append_audit_events_0v\(jsonb\)/,
  );
  assert.match(
    migrationBisTimeoutHardening,
    /REVOKE ALL ON FUNCTION public\.daily_stmt_append_audit_events_0v\(jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    migrationBisTimeoutHardening,
    /REVOKE ALL ON FUNCTION public\.daily_stmt_pre_ingest_bis_backfill_core_0v\(jsonb,jsonb,jsonb,jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    migrationBisTimeoutHardening,
    /REVOKE ALL ON FUNCTION public\.pre_ingest_daily_statement_units\(jsonb,jsonb,jsonb,jsonb\)[\s\S]*FROM PUBLIC, anon, service_role/,
  );
  assert.match(
    migrationBisTimeoutHardening,
    /GRANT EXECUTE ON FUNCTION public\.pre_ingest_daily_statement_units\(jsonb,jsonb,jsonb,jsonb\)[\s\S]*TO authenticated/,
  );
  assert.doesNotMatch(migrationBisTimeoutHardening, /statement_timeout/i);
  assert.doesNotMatch(migrationBisTimeoutHardening, /CREATE\s+(?:TEMP|TEMPORARY)\s+TABLE/i);
  assert.equal((migrationBisTimeoutHardening.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((migrationBisTimeoutHardening.match(/^COMMIT;$/gm) ?? []).length, 1);

  assert.match(e2eRunner, /MIGRATION_BIS_TIMEOUT_HARDENING=/);
  assert.match(e2eRunner, /--single-transaction < "\$MIGRATION_BIS_TIMEOUT_HARDENING"/);
  assert.match(e2eRunner, /e2e0r_generate_bis_mass_backfill\.ts/);
  assert.match(e2eRunner, /31_bis_mass_backfill_timeout_hardening\.sql/);
  for (const concurrencyScript of ['32a_', '32b_', '32c_', '32d_']) {
    assert.match(e2eRunner, new RegExp(concurrencyScript));
  }
  assert.match(bisMassGenerator, /unitCount: 4_000/);
  assert.match(bisMassGenerator, /lineCount: 4_000/);
  assert.match(bisMassSqlTest, /SET LOCAL statement_timeout = '15s'/);
  assert.match(bisMassSqlTest, /BIS-4000 bounded/);
  for (const invariant of [
    'missing line',
    'excess line',
    'orphan line',
    'duplicate line hash',
    'dishonest line_count',
  ]) {
    assert.match(bisMassSqlTest, new RegExp(invariant));
  }
  assert.match(e2ePipelineSqlTest, /0R-J0: la sonde R3 est declaree valid sans motif par le client/);
  assert.match(e2ePipelineSqlTest, /daily date below the declared period is rejected/);
  assert.match(e2ePipelineSqlTest, /daily date above the declared period is rejected/);
  assert.match(bisConcurrencyAssertions, /BISC2: session B waited at least three seconds/);
  assert.match(bisConcurrencyAssertions, /B directly returns the exact canonical unit promoted by A/);
  assert.match(bisConcurrencyAssertions, /BISC4: canonical duplicate B stages no financial line/);
});

test('submits only useful BIS days and preserves server reconciliation', () => {
  const unit = (day: string, content: string): DailyV2RpcUnit => ({
    day_unit_id: day.repeat(64),
    accounting_date: '01/01/2026',
    day_content_hash: content.repeat(64),
    line_count: 1,
    day_total_debits: 0,
    day_total_credits: 1,
    opening_balance_derived: null,
    closing_balance_derived: null,
    aggregates_status: 'unavailable',
    validation_status: 'needs_review',
    review_reason_codes: ['BACKFILL_REVIEW_REQUIRED'],
    requested_unit_status: 'staged',
  });
  const line = (day: string): DailyV2RpcLine => ({
    day_unit_id: day.repeat(64),
    daily_line_hash: day.repeat(64),
    daily_occurrence_ordinal: 1,
    source_line_index: 1,
    accounting_date: '01/01/2026',
    value_date: null,
    description_sanitized: 'SYNTHETIC',
    debit_amount: null,
    credit_amount: 1,
    signed_amount: 1,
    running_balance: null,
    direction: 'credit',
    currency: 'XOF',
  });
  const payload: DailyV2PreIngestPayload = {
    p_attempt: {
      requested_mode: 'backfill',
      source_format: 'xls',
      bank: 'BIS',
      currency: 'XOF',
      account_fingerprint: 'f'.repeat(64),
      account_registry_id: '00000000-0000-4000-8000-000000000001',
      account_number_masked: null,
      source_file_name_redacted: null,
      raw_text_hash: 'e'.repeat(64),
      export_period_start: '01/01/2026',
      export_period_end: '03/01/2026',
      statement_date: null,
      export_reference_date: null,
      parser_validation_status: 'needs_review',
      errors_count: 0,
      warnings_count: 0,
      runtime_version: 'synthetic',
      parser_version: 'synthetic',
      review_reason_codes: ['BACKFILL_REVIEW_REQUIRED'],
    },
    p_units: [unit('1', 'a'), unit('2', 'b'), unit('3', 'c')],
    p_lines: [line('1'), line('2'), line('3')],
    p_guard_context: {
      ingestion_ready: true,
      period_days: 3,
      bridge_guard_passed: true,
      backfill_grant_id: '00000000-0000-4000-8000-000000000002',
    },
  };

  const delta = buildDailyV2BackfillIncrementalDelta(payload, [
    { day_unit_id: '1'.repeat(64), active_day_content_hash: 'a'.repeat(64) },
    { day_unit_id: '2'.repeat(64), active_day_content_hash: 'd'.repeat(64) },
  ]);
  assert.deepEqual(delta.summary, {
    sourceUnits: 3,
    sourceLines: 3,
    identicalUnitsSkipped: 1,
    identicalLinesSkipped: 1,
    newUnits: 1,
    changedUnits: 1,
    serverReconciliationUnits: 0,
    submittedUnits: 2,
    submittedLines: 2,
  });
  assert.deepEqual(delta.payload.p_units.map((entry) => entry.day_unit_id), [
    '2'.repeat(64),
    '3'.repeat(64),
  ]);
  assert.deepEqual(delta.payload.p_lines.map((entry) => entry.day_unit_id), [
    '2'.repeat(64),
    '3'.repeat(64),
  ]);
  assert.equal(payload.p_units.length, 3, 'the source payload must remain immutable');

  const reconciliationDelta = buildDailyV2BackfillIncrementalDelta(
    payload,
    [{ day_unit_id: '1'.repeat(64), active_day_content_hash: 'a'.repeat(64) }],
    ['1'.repeat(64)],
  );
  assert.equal(
    reconciliationDelta.summary.serverReconciliationUnits,
    1,
    'an identical canonical day must still reach the server when a live provisional needs sweeping',
  );
  assert.equal(reconciliationDelta.summary.identicalUnitsSkipped, 0);
  assert.deepEqual(reconciliationDelta.payload.p_units, payload.p_units);

  assert.throws(
    () => buildDailyV2BackfillIncrementalDelta(payload, [
      { day_unit_id: '1'.repeat(64), active_day_content_hash: 'a'.repeat(64) },
      { day_unit_id: '1'.repeat(64), active_day_content_hash: 'a'.repeat(64) },
    ]),
    /DAILY_V2_INCREMENTAL_DUPLICATE_ACTIVE_CANONICAL/,
  );
  assert.throws(
    () => buildDailyV2BackfillIncrementalDelta(
      { ...payload, p_lines: [...payload.p_lines, line('4')] },
      [],
    ),
    /DAILY_V2_INCREMENTAL_ORPHAN_SOURCE_LINE/,
  );

  assert.match(service, /\.from\('daily_statement_units_canonical'\)[\s\S]*?\.select\('id,day_unit_id,active_day_content_hash'\)[\s\S]*?\.eq\('status', 'ingested'\)/);
  assert.match(service, /\.from\('daily_statement_units_staging'\)[\s\S]*?\.select\('id,day_unit_id'\)[\s\S]*?\.eq\('status', 'provisional'\)/);
  assert.match(service, /if \(incremental\.summary\.submittedUnits === 0\)[\s\S]*?outcome: 'no_changes'/);
});

test('adopts one historical identity without exposing or changing its fingerprint', () => {
  assert.match(
    migration0U3,
    /FUNCTION public\.adopt_daily_statement_historical_account\(\s*p_bank text,\s*p_currency text,\s*p_safe_alias text\s*\)/,
  );
  assert.match(migration0U3, /SECURITY DEFINER/);
  assert.match(migration0U3, /has_role\(v_actor, 'admin'::public\.app_role\)/);
  assert.match(migration0U3, /count\(DISTINCT c\.account_fingerprint\)/);
  assert.match(migration0U3, /account_fingerprint, account_number_masked\s*\) VALUES \(\s*v_actor,[\s\S]*v_fingerprint, v_masked/);
  assert.match(migration0U3, /UPDATE public\.daily_statement_export_attempts/);
  assert.match(migration0U3, /UPDATE public\.daily_statement_units_staging/);
  assert.match(migration0U3, /UPDATE public\.daily_statement_units_canonical/);
  assert.match(migration0U3, /'attempts_mapped', v_attempts_updated/);
  assert.match(migration0U3, /'staging_units_mapped', v_staging_updated/);
  assert.match(migration0U3, /'canonical_units_mapped', v_canonical_updated/);
  assert.doesNotMatch(migration0U3, /p_(account_)?fingerprint/);
  assert.doesNotMatch(migration0U3, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(migration0U3, /SET\s+(day_unit_id|day_content_hash|active_day_content_hash|status)\s*=/i);
  assert.match(
    migration0U3,
    /REVOKE ALL ON FUNCTION public\.adopt_daily_statement_historical_account\(text,text,text\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(e2eRunner, /MIGRATION_0U3=/);
  assert.match(e2eRunner, /25_e2e0r_historical_adoption_seed\.sql/);
  assert.match(e2eRunner, /--single-transaction < "\$MIGRATION_0U3"/);
  assert.match(e2eRunner, /26_e2e0r_historical_adoption_assert\.sql/);
});

test('supports only an explicit safe legacy identity scheme in the 0U4 bridge', () => {
  assert.match(
    migration0U4,
    /ADD COLUMN fingerprint_scheme text NOT NULL DEFAULT 'sha256_hex_v1'/,
  );
  assert.match(
    migration0U4,
    /DROP CONSTRAINT daily_statement_account_registry_account_fingerprint_check/,
  );
  assert.match(migration0U4, /fingerprint_scheme = 'sha256_hex_v1'[\s\S]*\^\[0-9a-f\]\{64\}\$/);
  assert.match(migration0U4, /fingerprint_scheme = 'legacy_opaque_v1'/);
  assert.match(migration0U4, /\^\[A-Za-z0-9\._:-\]\+\$/);
  assert.match(migration0U4, /v_value !~ '\[0-9\]\{8,\}'/);
  assert.match(migration0U4, /v_value !~\* '\^\[A-Z\]\{2\}\[0-9\]\{2\}\[A-Z0-9\]\{8,\}\$'/);
  assert.match(
    migration0U4,
    /v_fingerprint_scheme := public\.daily_stmt_classify_fingerprint_scheme\(v_fingerprint\)/,
  );
  assert.match(
    migration0U4,
    /account_fingerprint, account_number_masked, fingerprint_scheme[\s\S]*v_fingerprint, v_masked, v_fingerprint_scheme/,
  );
  assert.match(
    migration0U4,
    /public\.provision_daily_statement_account[\s\S]*'sha256_hex_v1'/,
  );
  assert.doesNotMatch(migration0U4, /p_(account_)?fingerprint/);
  assert.doesNotMatch(
    migration0U4,
    /SET\s+(account_fingerprint|day_unit_id|day_content_hash|active_day_content_hash|status)\s*=/i,
  );
  assert.match(service, /z\.discriminatedUnion\('fingerprint_scheme'/);
  assert.match(service, /fingerprint_scheme: z\.literal\('legacy_opaque_v1'\)/);
  assert.match(types, /DailyV2FingerprintScheme = 'sha256_hex_v1' \| 'legacy_opaque_v1'/);
  assert.match(e2eRunner, /MIGRATION_0U4=/);
  assert.match(e2eRunner, /--single-transaction < "\$MIGRATION_0U4"/);
});

test('keeps role-gated UI decisions fail closed', () => {
  assert.match(page, /const isAdmin = roles\.includes\('admin'\)/);
  assert.match(page, /const canDeposit = isAdmin \|\| roles\.includes\('manager'\)/);
  assert.match(page, /const canReadCanonical = isAdmin \|\| roles\.includes\('auditor'\)/);
  assert.match(tables, /unit\.status === 'staged'/);
  assert.match(tables, /unit\.status === 'conflict'/);
  assert.match(page, /\{isAdmin && bank === 'BIS' && <SelectItem value="backfill"/);
  assert.match(page, /requestedMode === 'backfill' && !isAdmin/);
  assert.match(browserPipeline, /backfillGrantId is mandatory in backfill mode/);
  assert.match(browserPipeline, /accountRegistryId must identify a provisioned account/);
  assert.match(page, /Compte pré-provisionné/);
  assert.doesNotMatch(page, /Account fingerprint pré-provisionné/);
  assert.match(page, /Motifs à examiner avant décision/);
  assert.match(browserPipeline, /Backfill mode is supported only for the characterized BIS profile in 0Q/);
  assert.match(browserPipeline, /MAX_BACKFILL_PERIOD_DAYS = 4_000/);
});

test('classifies pending conflicts as review-required and never technically clear', () => {
  assert.match(
    service,
    /status\.eq\.conflict,status\.eq\.needs_review,validation_status\.eq\.needs_review,aggregates_status\.eq\.unavailable/,
  );
  assert.match(
    service,
    /query = query\s*\.neq\('status', 'conflict'\)\s*\.neq\('status', 'needs_review'\)\s*\.eq\('validation_status', 'valid'\)\s*\.eq\('aggregates_status', 'derived'\)/,
  );
});

test('exposes only the characterized structured bank/file matrix', () => {
  for (const bank of ['BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE']) {
    assert.match(page, new RegExp(`<SelectItem value="${bank}"`));
  }
  assert.match(page, /'text\/csv': \['\.csv'\]/);
  assert.match(page, /'application\/vnd\.ms-excel': \['\.xls'\]/);
  assert.match(page, /spreadsheetml\.sheet': \['\.xlsx'\]/);
});

test('gives every Daily v2 network operation an explicit capability', () => {
  const runtimeTarget = readFileSync('src/features/daily-v2/dailyV2RuntimeTarget.ts', 'utf8');
  const CAPABILITY_BY_OPERATION: Record<string, 'read' | 'deposit' | 'promote' | 'admin'> = {
    getCurrentUserDailyV2Roles: 'read',
    getDailyV2MutationsEnabled: 'read',
    listDailyV2Accounts: 'read',
    listDailyV2BackfillGrants: 'read',
    listDailyV2AccountEvents: 'read',
    listDailyV2StagingUnits: 'read',
    listDailyV2StagingLines: 'read',
    listDailyV2CanonicalUnits: 'read',
    listDailyV2CanonicalLines: 'read',
    getActiveDailyV2CanonicalUnit: 'read',
    listDailyV2AuditEvents: 'read',
    listDailyV2CanonicalUnitsForReporting: 'read',
    preIngestDailyV2WithIncrementalDelta: 'deposit',
    promoteDailyV2Unit: 'promote',
    supersedeDailyV2Unit: 'promote',
    provisionDailyV2Account: 'admin',
    deactivateDailyV2Account: 'admin',
    issueDailyV2BackfillGrant: 'admin',
    revokeDailyV2BackfillGrant: 'admin',
  };

  // Chaque opération réseau publique déclare sa capacité, et une seule.
  const declarations = service.match(/assertAuthorizedDailyV2Target\('(\w+)'\)/g) ?? [];
  assert.equal(declarations.length, Object.keys(CAPABILITY_BY_OPERATION).length);
  assert.doesNotMatch(service, /assertAuthorizedDailyV2Target\(\)/);

  const bodies = service.split(/export (?:async )?function /).slice(1);
  const seen = new Set<string>();
  for (const body of bodies) {
    const name = /^([A-Za-z0-9_]+)/.exec(body)?.[1] ?? '';
    const expected = CAPABILITY_BY_OPERATION[name];
    const declared = /assertAuthorizedDailyV2Target\('(\w+)'\)/.exec(body)?.[1];
    if (expected === undefined) {
      assert.equal(declared, undefined, `${name} is a pure helper and must not call the guard`);
      continue;
    }
    assert.equal(declared, expected, `${name} must declare the ${expected} capability`);
    seen.add(name);
  }
  assert.equal(seen.size, Object.keys(CAPABILITY_BY_OPERATION).length);
  assert.doesNotMatch(
    service,
    /export async function preIngestDailyV2\(/,
    'the service must expose no direct full-payload ingest path',
  );

  // La capacité est obligatoire côté garde : aucune valeur par défaut.
  assert.match(runtimeTarget, /capability: DailyV2Capability,\s*\)/);
  assert.doesNotMatch(runtimeTarget, /capability: DailyV2Capability = /);
  assert.match(
    runtimeTarget,
    /\[DAILY_V2_AUTHORIZED_PRODUCTION_PROJECT_REF\]: \['read'\]/,
  );
  assert.match(
    runtimeTarget,
    /\[DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF\]: \['read', 'deposit', 'promote', 'admin'\]/,
  );
});

test('separates local staging preparation from fail-closed server persistence', () => {
  // Accès page et navigation : capacité read uniquement.
  assert.match(access, /currentDailyV2RuntimeTargetVerdict\('read'\)/);
  assert.match(access, /capabilities: Record<DailyV2Capability, boolean> = currentDailyV2Capabilities\(\)/);

  // La préparation dépend du rôle et de la politique statique de cible. La
  // persistance ajoute obligatoirement le verrou serveur effectif.
  assert.match(
    page,
    /\{\s*canPrepareLocally,\s*canPersist: canSubmitDeposit,\s*\} = resolveDailyV2ImportPermissions\(canDeposit, targetCapabilities, capabilities\)/,
  );
  assert.match(page, /const canDecide = isAdmin && capabilities\.promote/);
  assert.match(page, /const canAdminister = isAdmin && capabilities\.admin/);
  assert.match(page, /queryFn: getDailyV2MutationsEnabled/);
  assert.match(
    page,
    /const runtimeMutationsEnabled =\s*staticReadOnlyTarget \|\| runtimeLockQuery\.isError\s*\? false\s*: runtimeLockQuery\.data/,
  );
  assert.match(
    page,
    /const capabilities = applyDailyV2RuntimeMutationLock\(\s*targetCapabilities,\s*runtimeMutationsEnabled/,
  );
  assert.match(page, /disabled: !canPrepareLocally/);

  const prepareMutation = /const prepareMutation =[\s\S]*?(?=\n[ ]{2}const depositMutation =)/.exec(page)?.[0];
  assert.ok(prepareMutation, 'the local preparation mutation must remain explicit');
  assert.match(
    prepareMutation,
    /if \(!canPrepareLocally\) throw new DailyV2ServiceError\(READ_ONLY_TARGET_MESSAGE\)/,
  );
  assert.match(prepareMutation, /return prepareDailyV2BrowserDeposit\(/);
  assert.doesNotMatch(prepareMutation, /preIngestDailyV2|\.rpc\(|\.from\(/);

  const depositMutation = /const depositMutation =[\s\S]*?(?=\n[ ]{2}const provisionAccountMutation =)/.exec(page)?.[0];
  assert.ok(depositMutation, 'the persistence mutation must remain explicit');
  assert.match(
    depositMutation,
    /if \(!canSubmitDeposit\) throw new DailyV2ServiceError\(READ_ONLY_TARGET_MESSAGE\)/,
  );
  assert.match(depositMutation, /return preIngestDailyV2WithIncrementalDelta\(prepared\.payload\)/);
  assert.doesNotMatch(browserPipeline, /dailyV2SupabaseService|preIngestDailyV2/);

  // Handlers fail closed, y compris si un bouton résiduel était déclenché.
  for (const guarded of [
    /if \(!canSubmitDeposit\) throw new DailyV2ServiceError\(READ_ONLY_TARGET_MESSAGE\)/,
    /if \(!canDecide\) throw new DailyV2ServiceError\(READ_ONLY_TARGET_MESSAGE\)/,
    /if \(!canAdminister\) throw new DailyV2ServiceError\(READ_ONLY_TARGET_MESSAGE\)/,
  ]) {
    assert.match(page, guarded);
  }
  assert.equal((page.match(/if \(!canAdminister\) throw new DailyV2ServiceError/g) ?? []).length, 4);
  assert.equal((page.match(/if \(!canDecide\) throw new DailyV2ServiceError/g) ?? []).length, 2);

  // Boutons et cartes de mutation neutralisés sans la capacité.
  assert.match(page, /disabled=\{!canSubmitDeposit \|\| depositMutation\.isPending\}/);
  assert.match(page, /disabled=\{!canDecide \|\| Boolean\(reasonRequired/);
  assert.match(page, /\{canAdminister && \(/);
  assert.match(page, /if \(!canDecide\) \{\s*toast\.error\(READ_ONLY_TARGET_MESSAGE\);\s*return;/);
  assert.match(page, /Production en lecture seule/);
  assert.match(page, /Environnement en lecture seule/);
  assert.match(page, /Verrou serveur : \{runtimeLockLabel\}/);
  assert.match(page, /Consultation uniquement\. La préparation locale et toutes les mutations sont indisponibles sur cette cible\./);
  assert.match(page, /Mode parse-only/);
  assert.match(page, /Persistance bloquée par le verrou serveur/);
  assert.match(
    page,
    /!canPrepareLocally \? \(\s*<AccessDenied text="Préparation indisponible sur cette cible\."/,
  );

  // Les lectures par rôle restent inchangées.
  assert.match(page, /enabled: canReadStaging/);
  assert.match(page, /enabled: canReadCanonical/);
  assert.match(page, /enabled: canReadAudit/);
});

test('separates staging line reading from decision actions', () => {
  // StagingTable expose deux permissions distinctes.
  assert.match(tables, /isAdmin: boolean;/);
  assert.match(tables, /canDecide: boolean;/);
  assert.match(tables, /StagingTable = \(\{ rows, isAdmin, canDecide, onLines, onDecision \}/);

  // Consultation des lignes : règle de rôle existante, inchangée.
  assert.match(tables, /\{isAdmin && unit\.status !== 'duplicate' && <Button[\s\S]*?onLines\(unit\)/);

  // Décisions : rendues uniquement avec la capacité promote.
  assert.match(tables, /\{canDecide && unit\.status === 'staged' && <Button[\s\S]*?onDecision\('promote', unit\)/);
  assert.match(tables, /\{canDecide && unit\.status === 'conflict' && <Button[\s\S]*?onDecision\('supersede', unit\)/);
  assert.doesNotMatch(tables, /\{isAdmin && unit\.status === 'staged'/);
  assert.doesNotMatch(tables, /\{isAdmin && unit\.status === 'conflict'/);

  // La page transmet la règle de rôle pour les lignes et rôle × capacité pour
  // les décisions : en production read-only, Lignes reste rendu, jamais
  // Promouvoir ni Supersede ; en staging admin, ils ne reviennent que lorsque
  // le verrou serveur autorise explicitement les mutations.
  assert.match(page, /<StagingTable rows=\{stagingQuery\.data\?\.rows \?\? \[\]\} isAdmin=\{isAdmin\} canDecide=\{canDecide\}/);
});

test('blocks the Daily v2 page and navigation for the user-only role', () => {
  const accessRoles = access.match(/new Set\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(accessRoles, 'Daily v2 page access roles must be declared explicitly');
  assert.match(accessRoles, /'admin'/);
  assert.match(accessRoles, /'manager'/);
  assert.match(accessRoles, /'auditor'/);
  assert.doesNotMatch(accessRoles, /'user'/);

  assert.match(access, /enabled: Boolean\(user\?\.id\) && targetAllowed/);
  assert.match(access, /canAccessPage = targetAllowed && canAccessDailyV2Page\(roles\)/);
  assert.match(access, /classifyDailyV2AccessState/);
  assert.match(accessState, /runtime_target_rejected/);
  assert.match(accessState, /role_lookup_failed/);
  assert.match(accessState, /insufficient_role/);
  assert.match(app, /accessState\.status === "checking"/);
  assert.match(app, /accessState\.status === "blocked"/);
  assert.match(app, /Aucun accès Daily v2 n’a été accordé/);
  assert.doesNotMatch(app, /rolesQuery\.isError \|\| !canAccessPage/);
  assert.match(
    layout,
    /\.filter\(\(item\) => item\.href !== '\/daily-statements' \|\| canAccessPage\)/,
  );
});
