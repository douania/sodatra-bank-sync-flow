// Local synthetic UI harness. No .env, Auth client, Supabase connection or disk output.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('package.json'));
const { build } = createRequire(require.resolve('vite'))('esbuild');
const fixture = resolve('tests/daily-v2-session/fixtures.tsx');
const mocks = new Set(['AuthContext', 'dailyV2SupabaseService', 'dailyV2RuntimeTarget',
  'dailyV2BrowserPipeline', 'dailyV2ReportingService', 'dailyV2DashboardService', 'dailyV2SummaryExport']);
const result = await build({ entryPoints: ['tests/daily-v2-session/harness.tsx'], bundle: true,
  write: false, format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'synthetic-only', setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => {
      const leaf = args.path.split('/').at(-1);
      if (mocks.has(leaf) || args.path === '@/components/ui/sonner') return { path: fixture };
      if (/integrations\/supabase|@supabase\/supabase-js/.test(args.path)) throw Error('Live client forbidden in harness');
      if (args.path.startsWith('@/')) return builder.resolve(resolve('src', args.path.slice(2)), { kind: args.kind, resolveDir: process.cwd() });
    });
  } }], logLevel: 'silent' });
const html = '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Daily v2 — tests synthétiques locaux</title><body><h1>Daily v2 — tests synthétiques locaux</h1><p>Aucune donnée réelle ni connexion externe.</p><button id="run">Exécuter les scénarios</button><pre id="results">Prêt</pre><main id="fixture"></main><script type="module" src="/harness.js"></script></body></html>';
const server = createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
  else if (req.url === '/harness.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(result.outputFiles[0].contents); }
  else { res.statusCode = 404; res.end(); }
});
server.listen(0, '127.0.0.1', () => { console.log(`Synthetic harness: http://127.0.0.1:${server.address().port}`); });
