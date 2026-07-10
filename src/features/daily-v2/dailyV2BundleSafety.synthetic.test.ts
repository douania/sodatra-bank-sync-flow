import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const BROWSER_FILES = [
  'src/features/daily-v2/dailyV2BrowserPipeline.ts',
  'src/features/daily-v2/dailyV2SupabaseService.ts',
  'src/features/daily-v2/DailyV2Tables.tsx',
  'src/features/daily-v2/dailyV2UiUtils.ts',
  'src/features/daily-v2/dailyV2RuntimeTarget.ts',
  'src/pages/DailyStatementV2.tsx',
];

const NODE_ONLY_IMPORTS = [
  'node:crypto',
  'structuredBankStatementCsvIdempotencyKeys',
  'structuredBankStatementCsvPreIngestion',
  'structuredBankStatementCsvNodeIngestionRuntime',
  'structuredBankStatementDailyIdentity',
  'structuredBankStatementDailyRpcPayload',
];

test('Daily v2 browser chain never imports a Node-only module', () => {
  for (const path of BROWSER_FILES) {
    const source = readFileSync(path, 'utf8');
    for (const forbidden of NODE_ONLY_IMPORTS) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${path} must not import or reference Node-only module ${forbidden}`,
      );
    }
  }
});

test('Daily v2 application uses the existing Supabase client and never creates another client', () => {
  const source = readFileSync('src/features/daily-v2/dailyV2SupabaseService.ts', 'utf8');
  assert.match(source, /from ['"]@\/integrations\/supabase\/client['"]/);
  assert.equal(source.includes('createClient('), false);
  assert.equal(source.includes('service_role'), false);
});
