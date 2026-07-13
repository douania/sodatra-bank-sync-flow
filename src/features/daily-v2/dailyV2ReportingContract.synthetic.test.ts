import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const money = readFileSync('src/features/daily-v2/dailyV2Money.ts', 'utf8');
const calculations = readFileSync('src/features/daily-v2/dailyV2ReportingCalculations.ts', 'utf8');
const reportingService = readFileSync('src/features/daily-v2/dailyV2ReportingService.ts', 'utf8');
const summaryExport = readFileSync('src/features/daily-v2/dailyV2SummaryExport.ts', 'utf8');
const reportingUi = readFileSync('src/features/daily-v2/DailyV2Reporting.tsx', 'utf8');
const supabaseService = readFileSync('src/features/daily-v2/dailyV2SupabaseService.ts', 'utf8');
const readCore = readFileSync('src/features/daily-v2/dailyV2ReportingReadCore.ts', 'utf8');
const runtimeTarget = readFileSync('src/features/daily-v2/dailyV2RuntimeTarget.ts', 'utf8');
const page = readFileSync('src/pages/DailyStatementV2.tsx', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

const newReportingSources = [money, calculations, reportingService, summaryExport, reportingUi, readCore];

// Real PostgREST composition region: the non-exported adapter plus the public
// guarded wrapper.
const serviceReadRegion = supabaseService.slice(
  supabaseService.indexOf('const dailyV2ReportingReadAdapter'),
  supabaseService.indexOf('function assertAuthorizedDailyV2Target'),
);

test('reporting modules perform no mutation and no RPC', () => {
  for (const source of newReportingSources) {
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\s*\(/);
    assert.doesNotMatch(source, /\.rpc\s*\(/);
  }
});

test('reporting reads only ingested canonical units, never the canonical lines', () => {
  assert.ok(serviceReadRegion.length > 0, 'reporting read adapter must exist in the service');
  assert.match(serviceReadRegion, /daily_statement_units_canonical/);
  assert.match(serviceReadRegion, /\.eq\('status', 'ingested'\)/);
  assert.doesNotMatch(serviceReadRegion, /daily_statement_lines_canonical/);
  assert.doesNotMatch(serviceReadRegion, /daily_statement_units_staging/);
  assert.doesNotMatch(serviceReadRegion, /\.rpc\s*\(/);

  for (const source of [calculations, reportingService, summaryExport, reportingUi, readCore]) {
    assert.equal(source.includes('daily_statement_lines_canonical'), false);
  }
});

test('the bounded read keeps its period cap, unit ceiling and fail-closed count', () => {
  assert.match(calculations, /MAX_DAILY_V2_REPORT_PERIOD_DAYS = 400/);
  assert.match(readCore, /DAILY_V2_REPORTING_MAX_UNITS = 5000/);
  assert.match(readCore, /REPORT_COUNT_UNAVAILABLE/);
  assert.match(readCore, /REPORT_TOO_MANY_UNITS/);
  assert.match(readCore, /REPORT_READ_INCONSISTENT/);
  assert.match(reportingService, /validateDailyV2ReportingFilters/);
});

test('monetary code never uses node:crypto nor converts bigint through Number()', () => {
  for (const source of [...newReportingSources, supabaseService]) {
    assert.equal(source.includes('node:crypto'), false);
    assert.equal(source.includes('Number('), false);
    assert.equal(source.includes('parseFloat'), false);
  }
  assert.match(calculations, /globalThis\.crypto\?\.subtle/);
});

test('UI and export never mention the account fingerprint or technical ids', () => {
  for (const source of [reportingUi, summaryExport]) {
    assert.equal(source.includes('account_fingerprint'), false);
    assert.equal(source.includes('accountFingerprint'), false);
    assert.equal(source.includes('day_unit_id'), false);
    assert.equal(source.includes('raw_text_hash'), false);
  }
  assert.doesNotMatch(summaryExport, /fingerprint/i);
});

test('export builders keep every cell textual and injection-protected', () => {
  assert.match(summaryExport, /protectDailyV2ExportCell/);
  assert.match(summaryExport, /EXPORT_EMPTY_REPORT_REFUSED/);
  assert.match(summaryExport, /daily-v2-report_/);
  assert.match(summaryExport, /await import\('xlsx'\)/);
  assert.equal(summaryExport.includes("from 'xlsx'"), false);
});

test('the reporting tab exists and is gated to admin/auditor while manager is refused', () => {
  assert.match(page, /<TabsTrigger value="reporting">Reporting<\/TabsTrigger>/);
  assert.match(
    page,
    /!canReadCanonical \? <AccessDenied text="Reporting réservé aux rôles admin et auditor\." \/> : <DailyV2Reporting \/>/,
  );
  assert.match(page, /const canReadCanonical = isAdmin \|\| roles\.includes\('auditor'\)/);
  assert.doesNotMatch(page, /canDeposit \? <DailyV2Reporting/);
});

test('the reporting read anchors an immutable snapshot cutoff before paginating', () => {
  // Anchor query: narrow projection + exact count + ingested-only filter.
  assert.match(
    serviceReadRegion,
    /\.select\('id,ingested_at', \{ count: 'exact' \}\)\s*\.eq\('status', 'ingested'\)/,
  );
  // Anchor ordering and single-row limit.
  assert.match(
    serviceReadRegion,
    /\.order\('ingested_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)\s*\.limit\(1\)/,
  );

  // The core validates the anchor and freezes the cutoff.
  assert.match(readCore, /reportingSnapshotAnchorSchema\.safeParse\(anchorData\)/);
  assert.match(readCore, /const snapshotCutoff = anchorParsed\.data\[0\]\.ingested_at;/);
  assert.match(readCore, /REPORT_SNAPSHOT_ANCHOR_INVALID/);

  // Every page the adapter composes is pinned to the received cutoff.
  assert.match(serviceReadRegion, /\.lte\('ingested_at', input\.snapshotCutoff\)/);
  assert.match(
    serviceReadRegion,
    /status\.eq\.ingested,and\(status\.eq\.superseded,superseded_at\.gt\.\$\{input\.snapshotCutoff\}\)/,
  );
  assert.match(serviceReadRegion, /\.or\(activeAtSnapshotCondition\)/);
  assert.match(serviceReadRegion, /\.order\('accounting_date', \{ ascending: true \}\)\s*\.order\('id', \{ ascending: true \}\)/);

  // The core re-checks the exact count of every page against the anchor.
  assert.match(readCore, /count !== anchorCount/);
  assert.match(readCore, /REPORT_SNAPSHOT_COUNT_MISMATCH/);

  // The whole read path stays read-only: no mutation, no RPC, no line tables.
  for (const source of [serviceReadRegion, readCore]) {
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\s*\(/);
    assert.doesNotMatch(source, /\.rpc\s*\(/);
    assert.doesNotMatch(source, /daily_statement_lines_canonical/);
    assert.doesNotMatch(source, /daily_statement_lines_staging/);
  }
});

test('the public wrapper keeps the guard and the real adapter stays private', () => {
  // Guarded public entry point delegating to the pure core.
  assert.match(
    serviceReadRegion,
    /assertAuthorizedDailyV2Target\(\);\s*return runDailyV2CanonicalReportingRead\(dailyV2ReportingReadAdapter, filters\);/,
  );
  // The real adapter is module-private: the UI can never inject a client.
  assert.equal(supabaseService.includes('export const dailyV2ReportingReadAdapter'), false);
  // No second client: the core never touches one, the service keeps the single
  // existing import.
  assert.equal(readCore.includes("'@/integrations/supabase/client'"), false);
  assert.equal(readCore.includes('createClient'), false);
  assert.equal(readCore.includes('SupabaseClient'), false);
  assert.ok(supabaseService.includes("from '@/integrations/supabase/client'"));
  assert.equal(supabaseService.match(/createClient/g), null);
  // The behavioral suite runs with the reporting pack.
  assert.ok(packageJson.includes('src/features/daily-v2/dailyV2ReportingRead.synthetic.test.ts'));
});

test('every reporting row is validated with Zod before being accepted', () => {
  // Whole-page fail-closed parser exists in the core and uses safeParse.
  assert.match(
    readCore,
    /function parseDailyV2ReportingRows\(value: unknown\): DailyV2ReportingUnitRow\[\] \{/,
  );
  assert.match(readCore, /reportingUnitRowsSchema\.safeParse\(value\)/);
  assert.match(readCore, /REPORT_RESPONSE_INVALID/);

  // Rows only enter the result through the parser — never a partial page.
  assert.match(readCore, /rows\.push\(\.\.\.parseDailyV2ReportingRows\(data \?\? \[\]\)\);/);

  // The blind cast is gone from the whole read path.
  assert.equal(readCore.includes('as unknown as DailyV2ReportingUnitRow[]'), false);
  assert.equal(supabaseService.includes('as unknown as DailyV2ReportingUnitRow[]'), false);

  // Row schema is strict and covers the reporting projection statuses.
  assert.match(readCore, /const reportingUnitRowSchema = z\.strictObject\(\{/);
  assert.match(readCore, /aggregates_status: z\.enum\(\['derived', 'unavailable'\]\)/);
  assert.match(readCore, /validation_status: z\.enum\(\['valid', 'needs_review'\]\)/);
});

test('monetary conversion enforces the 2^42 limit, lexical gate and fixed tolerance', () => {
  assert.match(money, /export const DAILY_V2_MAX_EXACT_MAJOR_UNITS_EXCLUSIVE = 2 \*\* 42;/);
  assert.ok(
    money.includes('/^-?(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$/'),
    'the strict two-decimal lexical pattern must be present',
  );
  assert.match(money, /const DAILY_V2_MAX_SCALED_ROUNDING_DISTANCE = 0\.05;/);
  assert.match(
    money,
    /Math\.abs\(value\) >= DAILY_V2_MAX_EXACT_MAJOR_UNITS_EXCLUSIVE/,
  );
  assert.match(
    money,
    /Math\.abs\(scaled - rounded\) > DAILY_V2_MAX_SCALED_ROUNDING_DISTANCE/,
  );
  // The old magnitude-dependent tolerance is gone.
  assert.equal(money.includes('Number.EPSILON'), false);
  assert.equal(money.includes('tolerance'), false);
});

test('grouping is keyed by the full fingerprint and alias collisions are fatal', () => {
  assert.ok(
    calculations.includes(
      'JSON.stringify([unit.bank, unit.currency, unit.account_fingerprint])',
    ),
    'the group key must use the full account fingerprint',
  );
  assert.equal(
    calculations.includes('JSON.stringify([unit.bank, unit.currency, alias])'),
    false,
  );
  assert.match(calculations, /const aliasByFingerprint = new Map<string, string>\(\);/);
  assert.match(calculations, /const fingerprintByAlias = new Map<string, string>\(\);/);
  assert.match(calculations, /fingerprintByAlias\.get\(alias\)/);
  assert.match(calculations, /REPORT_ACCOUNT_ALIAS_COLLISION/);
  // The orchestration propagates the aggregation safe code untouched.
  assert.match(reportingService, /summaries\.safeCode/);
});

test('the public alias spans 16 hex characters (first 8 digest bytes)', () => {
  // Versioned preimage untouched, Web Crypto only.
  assert.match(calculations, /daily-v2-report-alias-v1\|/);
  assert.match(calculations, /globalThis\.crypto\?\.subtle/);
  // Digest loop over the first 8 bytes → 16 lowercase hex characters.
  assert.ok(calculations.includes('for (let index = 0; index < 8; index++)'));
  assert.equal(calculations.includes('index < 4'), false);
  // The injectable-alias seam exists but production and consumers never use a
  // foreign builder: only the calculations module and its test know it.
  assert.match(calculations, /buildDailyV2ReportingSummariesWithAliasBuilder/);
  assert.match(
    calculations,
    /return buildDailyV2ReportingSummariesWithAliasBuilder\(\s*units,\s*buildDailyV2ReportAccountAlias,\s*\);/,
  );
  for (const source of [reportingUi, reportingService, supabaseService, summaryExport, readCore]) {
    assert.equal(source.includes('WithAliasBuilder'), false);
  }
});

test('counters are bounded by the PostgreSQL integer domain and added fail-closed', () => {
  assert.match(calculations, /const POSTGRES_INTEGER_MAX = 2_147_483_647;/);
  assert.match(readCore, /const POSTGRES_INTEGER_MAX = 2_147_483_647;/);
  // DB constraint reproduced: line_count >= 1 in the Zod schema and in the
  // aggregation-layer validation.
  assert.ok(
    readCore.includes('line_count: z.number().int().min(1).max(POSTGRES_INTEGER_MAX)'),
    'the Zod reporting schema must reproduce the DB domain 1..POSTGRES_INTEGER_MAX',
  );
  assert.ok(calculations.includes('unit.line_count < 1'));
  assert.equal(calculations.includes('unit.line_count < 0'), false);
  assert.match(
    calculations,
    /export function addDailyV2SafeCount\(left: number, right: number\): number \{/,
  );
  assert.match(calculations, /REPORT_COUNT_UNSAFE/);
  assert.ok(calculations.includes('addDailyV2SafeCount(total, unit.line_count)'));
  assert.ok(calculations.includes('addDailyV2SafeCount(summary.groupCount, 1)'));
  assert.ok(calculations.includes('addDailyV2SafeCount(summary.dayCount, group.dayCount)'));
  assert.ok(calculations.includes('addDailyV2SafeCount(summary.lineCount, group.lineCount)'));
  // No unchecked += remains on those counters.
  assert.equal(calculations.includes('groupCount +='), false);
  assert.equal(calculations.includes('dayCount +='), false);
  assert.equal(calculations.includes('lineCount +='), false);
});

test('a monotone canonical epoch brackets the reporting read, empty report included', () => {
  // Dedicated read-only HEAD count over ALL canonical units (no status filter).
  const epochRegion = supabaseService.slice(
    supabaseService.indexOf('function readDailyV2CanonicalEpochCount'),
    supabaseService.indexOf('const dailyV2ReportingReadAdapter'),
  );
  assert.ok(epochRegion.length > 0, 'the epoch count helper must exist');
  assert.match(epochRegion, /\.select\('id', \{ count: 'exact', head: true \}\)/);
  assert.doesNotMatch(epochRegion, /\.eq\(/);
  assert.doesNotMatch(epochRegion, /\.rpc\s*\(/);
  assert.doesNotMatch(epochRegion, /\.(insert|update|delete|upsert)\s*\(/);
  assert.match(supabaseService, /REPORT_EPOCH_COUNT_UNAVAILABLE/);
  assert.match(supabaseService, /REPORT_EPOCH_COUNT_INVALID/);

  // The real adapter wires the epoch to that helper.
  assert.match(
    serviceReadRegion,
    /async readEpochCount\(\): Promise<number> \{\s*return readDailyV2CanonicalEpochCount\(\);/,
  );

  // The core reads the epoch before the anchor and after the last page.
  assert.match(readCore, /const epochBefore = await adapter\.readEpochCount\(\);/);
  assert.match(readCore, /const epochAfter = await adapter\.readEpochCount\(\);/);
  assert.match(readCore, /assertDailyV2CanonicalEpochUnchanged\(epochBefore, epochAfter\);/);
  assert.match(readCore, /epochAfter !== epochBefore/);
  assert.match(readCore, /REPORT_CONCURRENT_CANONICAL_MUTATION/);
  // The empty report goes through the very same comparison before returning.
  assert.match(
    readCore,
    /if \(anchorCount === 0\) \{[\s\S]*?assertDailyV2CanonicalEpochUnchanged\(epochBefore, await adapter\.readEpochCount\(\)\);[\s\S]*?return \{ rows: \[\], totalCount: 0 \};/,
  );
});

test('the frozen staging runtime lock is untouched', () => {
  assert.match(
    runtimeTarget,
    /DAILY_V2_AUTHORIZED_STAGING_PROJECT_REF = 'gbbsqcscryygqlmqncyv'/,
  );
  assert.match(runtimeTarget, /hostname !== `\$\{EXPECTED_REF\}\.supabase\.co`|hostname\.endsWith\('\.supabase\.co'\)/);
  for (const source of newReportingSources) {
    assert.equal(source.includes('leakcdbbawzysfqyqsnr'), false);
  }
});
