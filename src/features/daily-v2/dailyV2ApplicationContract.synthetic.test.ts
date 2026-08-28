import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
const e2eRunner = readFileSync('supabase/tests/daily_statement_units_v2/run_e2e_0r.sh', 'utf8');

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
    preIngestDailyV2: 'deposit',
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
  assert.match(depositMutation, /return preIngestDailyV2\(prepared\.payload\)/);
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
