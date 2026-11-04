import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDailyV2DecisionReads,
  DAILY_V2_DECISION_ID_CHUNK,
  DAILY_V2_DECISION_PAGE_SIZE,
  DAILY_V2_READ_INCOMPLETE,
  readAllDecisionRows,
  type DailyV2DecisionPage,
  type DailyV2DecisionPageQuery,
  type DailyV2DecisionPageReader,
} from './dailyV2DecisionReadCore';
import { activeRefutations, dailyV2VersionKey, dailyV2VersionSources, stagingVersionFacts } from './dailyV2Types';

// P2 de la contre-revue CTO de la PR #156 : exhaustivité des lectures des
// décisions. Un faux PostgREST en mémoire (filtres, tri, plage, total exact,
// plafond de lignes par réponse) ; données entièrement fictives.

type Row = Record<string, unknown>;
type Tables = Partial<Record<DailyV2DecisionPageQuery['table'], Row[]>>;

function compare(a: string[], b: string[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function fakeServer(tables: Tables, options: {
  maxRows?: number;
  fault?: (query: DailyV2DecisionPageQuery, call: number) => DailyV2DecisionPage | null;
} = {}) {
  const calls: DailyV2DecisionPageQuery[] = [];
  const reader: DailyV2DecisionPageReader = async (query) => {
    calls.push(query);
    const injected = options.fault?.(query, calls.length);
    if (injected) return injected;
    const rows = (tables[query.table] ?? [])
      .filter((row) => query.eq.every(([column, value]) => String(row[column]) === value)
        && (query.in === null || query.in[1].includes(String(row[query.in[0]]))))
      .sort((a, b) => compare(query.order.map((column) => String(a[column])), query.order.map((column) => String(b[column]))));
    const limit = Math.min(query.to - query.from + 1, options.maxRows ?? Number.POSITIVE_INFINITY);
    return { data: rows.slice(query.from, query.from + limit), count: rows.length, error: null };
  };
  return { reader, calls };
}

const pad = (n: number, width = 12) => String(n).padStart(width, '0');
const uuid = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${pad(n)}`;
const at = (n: number) => `2026-10-${String(1 + Math.floor(n / 1000)).padStart(2, '0')}T08:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000000+00:00`;
const DAY = 'day-2026-10-02';
const ACCOUNT = '20000000-0000-4000-8000-000000000001';

function stagingUnit(n: number, attemptId: string, overrides: Row = {}): Row {
  return {
    id: uuid('5', n), attempt_id: attemptId, day_unit_id: DAY, bank: 'ATB', account_fingerprint: 'f'.repeat(64),
    account_registry_id: ACCOUNT, currency: 'XOF', accounting_date: '2026-10-02', day_content_hash: 'a'.repeat(64),
    line_count: 1, day_total_debits: 0, day_total_credits: 10, opening_balance_derived: 200, closing_balance_derived: 210,
    aggregates_status: 'derived', validation_status: 'valid', review_reason_codes: [], status: 'conflict',
    created_at: at(n), created_by: null, ...overrides,
  };
}

function exportAttempt(n: number): Row {
  return { id: uuid('a', n), created_at: at(n), raw_text_hash: pad(n, 64), account_registry_id: ACCOUNT };
}

function isIncomplete(error: unknown): boolean {
  return error instanceof Error && (error as { safeCode?: string }).safeCode === DAILY_V2_READ_INCOMPLETE;
}

test('réfutations au-delà d’une page : la révocation de la troisième page est lue', async () => {
  // 1 234 décisions de la journée ; la révocation de la première est la dernière.
  const refutations: Row[] = [];
  for (let n = 1; n <= 1233; n += 1) {
    refutations.push({ id: uuid('6', n), action: 'REFUTE', day_unit_id: DAY, refuted_version_key: `k${n}`, created_at: at(n) });
  }
  refutations.push({ id: uuid('6', 9999), action: 'REVOKE', revokes_id: uuid('6', 1), day_unit_id: DAY, created_at: at(1999) });
  const sources = refutations.filter((row) => row.action === 'REFUTE').map((row) => ({
    refutation_id: row.id, raw_text_hash: 'b'.repeat(64), account_registry_id: ACCOUNT,
  }));
  const server = fakeServer({ daily_statement_version_refutations: refutations, daily_statement_refutation_sources: sources },
    { maxRows: 1000 });
  const read = await createDailyV2DecisionReads(server.reader).listVersionRefutations(DAY);
  assert.equal(read.refutations.length, 1234);
  assert.equal(read.sources.length, 1233, 'sources de toutes les décisions, par lots d’identifiants');
  const active = activeRefutations(read.refutations);
  assert.equal(active.some((row) => row.id === uuid('6', 1)), false, 'décision révoquée en page 3 : plus active');
  assert.equal(active.length, 1232);
  // Une lecture tronquée à la première réponse aurait gardé la décision révoquée active.
  const truncated = refutations.slice(0, 1000) as never[];
  assert.equal(activeRefutations(truncated).some((row: { id: string }) => row.id === uuid('6', 1)), true);
  // Ordre stable et départage unique : le tri finit par l'identifiant.
  const refutationQueries = server.calls.filter((call) => call.table === 'daily_statement_version_refutations');
  assert.deepEqual(refutationQueries[0].order, ['created_at', 'id']);
  assert.equal(refutationQueries.length, 3, 'trois pages de 500');
  assert.ok(server.calls.filter((call) => call.in !== null).every((call) => call.in![1].length <= DAILY_V2_DECISION_ID_CHUNK));
});

test('livraisons au-delà d’une page : une nouvelle source en dernière page et son fichier sont lus', async () => {
  const attempts = [exportAttempt(1), exportAttempt(2)];
  const units = Array.from({ length: 1100 }, (_, index) => stagingUnit(index + 1, attempts[0].id as string));
  // Nouvelle source : livraison d'un autre fichier, déposée en dernier.
  units.push(stagingUnit(5000, attempts[1].id as string));
  // Plafond serveur inférieur à la page demandée : le décalage suit les lignes reçues.
  const server = fakeServer({ daily_statement_units_staging: units, daily_statement_export_attempts: attempts }, { maxRows: 300 });
  const read = await createDailyV2DecisionReads(server.reader).listDayDeliveries(DAY);
  assert.equal(read.units.length, 1101);
  assert.deepEqual(read.attempts.map((row) => row.id).sort(), attempts.map((row) => row.id as string).sort());
  const key = dailyV2VersionKey(stagingVersionFacts(read.units[0]));
  const versionSources = dailyV2VersionSources(read.units, read.attempts, key);
  assert.equal(versionSources.length, 2, 'la nouvelle source est vue');
  assert.equal(versionSources.find((source) => source.raw_text_hash === attempts[1].raw_text_hash)?.deliveries, 1);
  const pages = server.calls.filter((call) => call.table === 'daily_statement_units_staging').map((call) => call.from);
  assert.deepEqual(pages, [0, 300, 600, 900], 'décalage égal aux lignes reçues : 1 101 lignes en quatre réponses');
});

test('identifiants découpés en lots, résultat complet et ordonné', async () => {
  const attestations: Row[] = [];
  const attemptIds = Array.from({ length: 250 }, (_, index) => uuid('a', index + 1));
  attemptIds.forEach((attemptId, index) => {
    attestations.push({ id: uuid('7', index + 1), attempt_id: attemptId, action: 'ATTEST', created_at: at(index) });
  });
  const server = fakeServer({ daily_statement_attempt_attestations: attestations });
  const rows = await createDailyV2DecisionReads(server.reader).listAttemptAttestations([...attemptIds].reverse());
  assert.equal(rows.length, 250);
  assert.deepEqual(rows.map((row) => row.id), [...rows].sort((a, b) => compare([a.created_at, a.id], [b.created_at, b.id]))
    .map((row) => row.id));
  const chunks = server.calls.map((call) => call.in![1].length);
  assert.deepEqual(chunks, [100, 100, 50]);
});

test('lecture en erreur, instable ou incomplète : DAILY_V2_READ_INCOMPLETE, jamais une liste tronquée', async () => {
  const rows = Array.from({ length: 1200 }, (_, index) => ({ id: uuid('6', index + 1), day_unit_id: DAY, created_at: at(index),
    action: 'REFUTE' }));
  const base = { table: 'daily_statement_version_refutations' as const, eq: [['day_unit_id', DAY] as const], in: null,
    order: ['created_at', 'id'] };
  const cases: Array<[string, Parameters<typeof fakeServer>[1]]> = [
    ['erreur en deuxième page', { fault: (_q, call) => (call === 2 ? { data: null, count: null, error: { message: 'boom' } } : null) }],
    ['total modifié pendant la lecture', { fault: (q, call) => (call === 2
      ? { data: rows.slice(q.from, q.from + 500), count: 1201, error: null } : null) }],
    ['page vide avant le total', { fault: (_q, call) => (call === 2 ? { data: [], count: 1200, error: null } : null) }],
    ['ligne répétée (ordre instable)', { fault: (q, call) => (call === 2
      ? { data: rows.slice(q.from - 1, q.from + 499), count: 1200, error: null } : null) }],
    ['total exact absent', { fault: () => ({ data: rows.slice(0, 500), count: null, error: null }) }],
    ['page plus grande que demandée', { fault: () => ({ data: rows.slice(0, 501), count: 1200, error: null }) }],
    ['adaptateur en échec', { fault: () => { throw new Error('réseau'); } }],
  ];
  for (const [label, options] of cases) {
    const server = fakeServer({ daily_statement_version_refutations: rows }, options);
    await assert.rejects(readAllDecisionRows(server.reader, base, 'réfutations'), (error) => {
      assert.ok(isIncomplete(error), label);
      assert.match((error as Error).message, /^Lecture incomplète \(réfutations\) : .+\. Aucune décision n’est proposée sur cette base\.$/);
      return true;
    }, label);
  }
  // Plafond de sûreté : au-delà, refus plutôt que troncature.
  await assert.rejects(readAllDecisionRows(fakeServer({ daily_statement_version_refutations: rows }).reader, base, 'réfutations',
    { maxRows: 1000 }), (error) => isIncomplete(error));
  // Fichier associé manquant : les livraisons ne sont pas présentées comme complètes.
  const orphan = fakeServer({ daily_statement_units_staging: [stagingUnit(1, uuid('a', 404))], daily_statement_export_attempts: [] });
  await assert.rejects(createDailyV2DecisionReads(orphan.reader).listDayDeliveries(DAY), (error) => {
    assert.ok(isIncomplete(error));
    assert.match((error as Error).message, /fichier associé manquant/);
    return true;
  });
});

test('taille de page et de lot bornées', () => {
  assert.equal(DAILY_V2_DECISION_PAGE_SIZE, 500);
  assert.equal(DAILY_V2_DECISION_ID_CHUNK, 100);
});
