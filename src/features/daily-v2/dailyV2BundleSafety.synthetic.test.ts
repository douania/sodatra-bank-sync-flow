import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  // Lovable ne lit que `.env` versionné : `.env.production` n'est pas un canal
  // valide et doit rester absent pour écarter toute ambiguïté de configuration.
  assert.equal(existsSync('.env.production'), false, '.env.production must not exist');
  const env = readFileSync('.env', 'utf8');
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

  // Provenance durablement vérifiable : le payload du JWT legacy anon est
  // décodé LOCALEMENT (aucun appel réseau). Les messages d'échec restent
  // génériques : ni la clé, ni un fragment de token n'y apparaissent.
  const segments = key.split('.');
  assert.equal(segments.length, 3, 'the publishable key must be a three-segment JWT');
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(segments[1], 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    assert.fail('the publishable key payload must be decodable');
  }
  assert.equal(claims.role, 'anon', 'the key must carry the anon role, never a backend role');
  assert.equal(claims.ref, 'leakcdbbawzysfqyqsnr', 'the key must belong to the authorized production project');
  assert.equal(claims.iss, 'supabase', 'the key must be issued by Supabase');

  // Aucune cible staging, aucune clé backend, aucune variable hors VITE.
  assert.equal(env.includes('gbbsqcscryygqlmqncyv'), false);
  assert.doesNotMatch(env, /service_role|SERVICE_ROLE|sb_secret|SUPABASE_SERVICE|SECRET_KEY/);
  for (const name of names) {
    assert.match(name, /^VITE_/, 'only VITE_ variables belong to a frontend build');
  }
});

test('the versioned .env is committable while local overrides stay ignored', () => {
  const gitignore = readFileSync('.gitignore', 'utf8');
  const patterns = gitignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  // `.env` doit être versionnable : aucune règle ne doit l'ignorer.
  assert.equal(patterns.includes('.env'), false, '.env must not be ignored');
  assert.equal(patterns.includes('.env*'), false, '.env must not be ignored by a wildcard');
  // Les surcharges locales, elles, restent ignorées.
  assert.ok(patterns.includes('.env.local'), '.env.local must stay ignored');
  assert.ok(patterns.includes('.env.*.local'), '.env.*.local must stay ignored');
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
