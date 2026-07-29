import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const BROWSER_FILES = [
  'src/features/daily-v2/dailyV2BrowserPipeline.ts',
  'src/features/daily-v2/dailyV2SupabaseService.ts',
  'src/features/daily-v2/DailyV2Tables.tsx',
  'src/features/daily-v2/dailyV2UiUtils.ts',
  'src/features/daily-v2/dailyV2RuntimeTarget.ts',
  'src/services/structuredBankStatementExcelProfiles.ts',
  'src/services/structuredBankStatementExcelParser.ts',
  'src/services/structuredBankStatementXlsxArchive.ts',
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

// Le build frontend de production reçoit sa configuration Vite par ce seul
// fichier versionné. Ces assertions sont statiques : elles ne comparent jamais
// la valeur de la clé et ne l'écrivent dans aucun message d'échec.
test('the production build env carries exactly the three public frontend values', () => {
  const env = readFileSync('.env.production', 'utf8');
  const assignments = env
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  const names = assignments.map((line) => line.split('=')[0]);

  assert.deepEqual(names, [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_PROJECT_ID',
  ]);
  assert.match(env, /^VITE_SUPABASE_URL=https:\/\/leakcdbbawzysfqyqsnr\.supabase\.co$/m);
  assert.match(env, /^VITE_SUPABASE_PROJECT_ID=leakcdbbawzysfqyqsnr$/m);

  // Clé présente et de forme JWT publishable, sans jamais exposer sa valeur.
  const key = /^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(env)?.[1] ?? '';
  assert.ok(key.length > 100, 'the publishable key must be present');
  assert.ok(/^eyJ[A-Za-z0-9._-]+$/.test(key), 'the publishable key must be a JWT-shaped public key');

  // Aucune cible staging, aucune clé backend, aucune variable hors VITE.
  assert.equal(env.includes('gbbsqcscryygqlmqncyv'), false);
  assert.doesNotMatch(env, /service_role|SERVICE_ROLE|sb_secret|SUPABASE_SERVICE|SECRET_KEY/);
  for (const name of names) {
    assert.match(name, /^VITE_/, 'only VITE_ variables belong to a frontend build');
  }
});

test('no Supabase key is ever hardcoded in TypeScript sources', () => {
  const CLIENT = 'src/integrations/supabase/client.ts';
  const client = readFileSync(CLIENT, 'utf8');
  // Le client continue de lire l'environnement, jamais une valeur en dur.
  assert.match(client, /import\.meta\.env\.VITE_SUPABASE_URL/);
  assert.match(client, /import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/);

  for (const path of [...BROWSER_FILES, CLIENT]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /eyJ[A-Za-z0-9._-]{60,}/, `${path} must not embed a key literal`);
    assert.doesNotMatch(source, /sb_secret|service_role/, `${path} must not reference a backend key`);
  }
});
