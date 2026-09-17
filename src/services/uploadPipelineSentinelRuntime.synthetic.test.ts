import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import * as XLSX from 'xlsx';

import type { InternalBookValidationIssue } from '@/types/internalBook';
import { summarizeExtractionErrors } from './extractionErrorSummary';
import { orchestrateInternalBookImport } from './internalBookImportOrchestrator';
import { buildInternalBookImportResult } from './internalBookImportResult';
import { adaptInternalBookImportResultToProcessingResult } from './internalBookProcessingResultAdapter';
import { progressService } from './progressService';

/**
 * Tests runtime de bout en bout du pipeline `/upload` par sentinelles sensibles
 * (Pack 2, FIX_5 / FIX_6). `fileProcessingService.processFiles` est EXÉCUTÉ :
 *  - sur un lot marqué INVALIDE (refus d'extraction de chaque famille) ;
 *  - sur un lot marqué VALIDE qui atteint la persistance et la synchronisation,
 *    dont les doubles Supabase échouent avec des messages sentinelles ;
 *  - sur un document bloqué au précontrôle et sur une exception générale.
 * Sont inspectés : la console (quatre niveaux), les événements de progression,
 * `results.errors` et les diagnostics Excel. Aucune sentinelle ne doit y apparaître.
 *
 * Doubles injectés au niveau du loader Node (aucune option de production) :
 *  - `@/integrations/supabase/client` → faux client sans réseau : les lectures
 *    répondent vide, les écritures (insert/update/upsert/delete, rpc) échouent
 *    avec une erreur sentinelle ;
 *  - `./uploadRuntimeGuard`, vu depuis `fileProcessingService` seulement →
 *    garde substituée (cible autorisée) pour que le traitement démarre hors Vite.
 */
const SUPABASE_CLIENT_SPECIFIER = '@/integrations/supabase/client';
const SUPABASE_SENTINEL = 'SUPABASE_SENTINELLE_QX message serveur CLIENT_SENTINELLE_ZQX 7777777 CHQ_SENTINELLE_9Q';

const supabaseDoubleModuleUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    `const SENT = ${JSON.stringify(SUPABASE_SENTINEL)};
     const WRITE = new Set(['insert', 'update', 'upsert', 'delete']);
     const calls = (globalThis.__supabaseDoubleCalls ??= { from: 0, rpc: 0, insert: 0, update: 0, upsert: 0, delete: 0 });
     const failure = () => Object.assign(new Error(SENT), { code: 'SENTINEL', details: SENT, hint: SENT });
     function builder(write) {
       return new Proxy(function () {}, {
         get(_target, prop) {
           if (prop === 'then') {
             const outcome = write ? { data: null, error: failure(), count: null } : { data: [], error: null, count: 0 };
             return (resolve, reject) => Promise.resolve(outcome).then(resolve, reject);
           }
           if (typeof prop === 'symbol' || prop === 'toJSON') return undefined;
           return () => {
             if (WRITE.has(String(prop))) calls[String(prop)] += 1;
             return builder(write || WRITE.has(String(prop)));
           };
         },
       });
     }
     export const supabase = {
       from: () => { calls.from += 1; return builder(false); },
       rpc: async () => { calls.rpc += 1; return { data: null, error: failure() }; },
       auth: {
         getUser: async () => ({ data: { user: null }, error: null }),
         getSession: async () => ({ data: { session: null }, error: null }),
       },
       channel: () => ({ on() { return this; }, subscribe() { return this; } }),
     };`
  );

const guardDoubleModuleUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    `export const UPLOAD_READ_ONLY_TARGET_MESSAGE = 'garde substituée (test synthétique)';
     export function currentUploadMutationVerdict() { return { allowed: true, projectRef: 'synthetic' }; }`
  );

const resolverHooksUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    `export function resolve(specifier, context, nextResolve) {
      if (specifier === ${JSON.stringify(SUPABASE_CLIENT_SPECIFIER)}) {
        return { shortCircuit: true, url: ${JSON.stringify(supabaseDoubleModuleUrl)} };
      }
      if (specifier === './uploadRuntimeGuard' && String(context.parentURL ?? '').endsWith('/fileProcessingService.ts')) {
        return { shortCircuit: true, url: ${JSON.stringify(guardDoubleModuleUrl)} };
      }
      return nextResolve(specifier, context);
    }`
  );
register(resolverHooksUrl);

interface SupabaseDoubleCalls { from: number; rpc: number; insert: number; update: number; upsert: number; delete: number }
function supabaseDoubleCalls(): SupabaseDoubleCalls {
  const calls = (globalThis as unknown as { __supabaseDoubleCalls?: SupabaseDoubleCalls }).__supabaseDoubleCalls;
  assert.ok(calls, 'le double Supabase doit avoir été chargé par le hook de résolution');
  return calls;
}

/**
 * Charge le pipeline sous les doubles. Pack 2 (FIX_7) : aucun `skip` silencieux —
 * si le runtime résout l'alias Vite avant le hook (constaté sous Node ≥ 24 avec
 * tsx), l'import du client généré jette et la preuve runtime ÉCHOUE explicitement.
 */
async function loadPipeline(): Promise<typeof import('./fileProcessingService')> {
  try {
    return await import('./fileProcessingService');
  } catch {
    assert.fail(
      `Harness loader non supporté sur Node ${process.versions.node} : la preuve runtime du pipeline /upload est obligatoire `
      + '(runtime supporté : Node 20 ou 22, celui de la CI).',
    );
  }
}

/** Résultat complet moins les trois charges utiles extraites (données métier rendues à l'interface). */
function resultWithoutExtractedPayloads(result: { data?: Record<string, unknown> } & Record<string, unknown>): string {
  const { bankReports: _bankReports, fundPosition: _fundPosition, collectionReports: _collectionReports, ...restData } = result.data ?? {};
  return JSON.stringify({ ...result, data: restData });
}

const FILE_SENTINEL = 'NOMFICHIER_SENTINELLE_QX';
const SENTINELS = [
  FILE_SENTINEL, 'CLIENT_SENTINELLE_ZQX', '7777777', 'CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE', 'SUPABASE_SENTINELLE_QX',
  'EXCEPTION_SENTINELLE_QX', 'FEUILLE_SENTINELLE_QX', 'MESSAGE_SENTINELLE_QX', '31/02/2026',
];
const ACCOUNTING = '_-* #,##0\\ _€_-;\\-* #,##0\\ _€_-;_-* "-"??\\ _€_-;_-@_-';

function assertNoSentinel(payload: string, context: string): void {
  for (const sentinel of SENTINELS) {
    assert.equal(payload.includes(sentinel), false, `${context} expose la sentinelle ${sentinel}`);
  }
}

interface CapturedRun<T> { result: T; console: string; progress: string }

async function withCapturedRuntime<T>(operation: () => Promise<T>): Promise<CapturedRun<T>> {
  const captured: string[] = [];
  const progress: string[] = [];
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const capture = (...parts: unknown[]) => {
    captured.push(parts.map(part => (typeof part === 'string' ? part : JSON.stringify(part, (_key, value) => (
      value instanceof Error ? { message: value.message, stack: value.stack } : value
    )))).join(' '));
  };
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  const unsubscribe = progressService.subscribe(event => progress.push(JSON.stringify(event)));
  try {
    const result = await operation();
    return { result, console: captured.join('\n'), progress: progress.join('\n') };
  } finally {
    unsubscribe();
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}

type Cell = string | number | { date: string } | { amount: number } | { ref: number } | null;
const D = (iso: string): Cell => ({ date: iso });
const A = (amount: number): Cell => ({ amount });

function serialOf(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function typedSheet(rows: Cell[][]): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  let maxColumn = 0;
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === null) return;
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (typeof value === 'string') sheet[address] = { t: 's', v: value };
      else if (typeof value === 'number') sheet[address] = { t: 'n', v: value };
      else if ('date' in value) sheet[address] = { t: 'n', v: serialOf(value.date), z: 'm/d/yy' };
      else if ('amount' in value) sheet[address] = { t: 'n', v: value.amount, z: ACCOUNTING };
      else sheet[address] = { t: 'n', v: value.ref, z: 'General' };
      maxColumn = Math.max(maxColumn, columnIndex);
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxColumn } });
  return sheet;
}

function workbookFile(name: string, sheets: Array<{ name: string; rows: Cell[][] }>): File {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, typedSheet(sheet.rows), sheet.name);
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  return new File([bytes], name);
}

function invalidBankReportRows(): Cell[][] {
  return [
    [null, null, null, 'BDK'],
    ['Date', 'Ch.No', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT'],
    ['OPENING BALANCE 09/07/26', null, null, null, null, null, A(7777777)],
    ['ADD :', 'DEPOSIT NOT YET CLEARED'],
    [D('2026-07-08'), D('2026-07-09'), 'CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE', 'CLIENT_SENTINELLE_ZQX', null, A(7777777.5)],
    [null, null, 'CLOSING BALANCE as per Book : C=(A-B)', null, null, null, A(7777777)],
    [null, null, null, 'BANK FACILITY (180 jrs)'],
    [null, D('2026-07-09'), '31/02/2026', A(7777777), A(0), null, A(7777777)],
    ['CLIENT_SENTINELLE_ZQX', null, null, null, A(7777777)],
  ];
}

/** Rapport BDK valide (même forme que la fixture nominale de l'extracteur), valeurs sentinelles. */
function validBankReportRows(): Cell[][] {
  return [
    [null, null, null, 'BDK'],
    ['Date', 'Ch.No', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT', 'AMOUNT 2'],
    ['OPENING BALANCE 09/07/26', null, null, null, null, null, A(7_777_777)],
    ['ADD :', 'DEPOSIT NOT YET CLEARED'],
    [D('2026-07-08'), D('2026-07-09'), 'REGLEMENT CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE', 'CLIENT_SENTINELLE_ZQX', null, A(250_000)],
    [null, null, null, 'TOTAL DEPOSIT', null, null, A(250_000)],
    [null, null, null, 'TOTAL BALANCE (A)', null, null, A(8_027_777)],
    ['LESS :', null, null, 'CHECK Not yet cleared'],
    [D('2026-07-01'), { ref: 1234567 }, 'CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE', 'CLIENT_SENTINELLE_ZQX', { ref: 99999 }, null, A(150_000)],
    [null, null, null, 'TOTAL (B)', null, null, A(150_000)],
    [null, null, 'CLOSING BALANCE as per Book : C=(A-B)', null, null, null, A(7_877_777)],
    [],
    [D('2026-01-01'), null, null, 'BANK FACILITY (180 jrs)', null, null, D('2026-07-09')],
    [null, null, null, 'Limit', 'Used', null, 'Balance'],
    [null, D('2026-07-09'), 'SPN', A(1_000_000_000), A(400_000_000), null, A(600_000_000)],
    [null, null, null, null, A(400_000_000)],
    [],
    [null, null, null, 'IMPAYE'],
    [D('2026-06-30'), D('2026-07-05'), 'IMPAYE', 'CL01', 'CLIENT_SENTINELLE_ZQX', '123456-654321', A(75_000)],
    [null, null, null, null, null, null, A(75_000)],
  ];
}

/** Fund Position valide (forme nominale de l'extracteur), valeurs sentinelles. */
function validFundPositionRows(): Cell[][] {
  return [
    [null, null, 'Bank \nBalance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit', 'Grand Balance'],
    ['Book balance', 'BDK', A(100_000_000), A(0), A(100_000_000), A(0), A(100_000_000)],
    [null, 'BIS', A(20_000_000), A(500_000), A(19_500_000), A(0), A(19_500_000)],
    [],
    [null, 'TOTAL FUND AVAILABLE', A(120_000_000), A(500_000), A(119_500_000), A(0), A(119_500_000)],
    ['COLLECTION NOT DEPOSITED', null, null, null, null, null, A(7_777_777)],
    [],
    [null, null, 'HOLD'],
    ['DATE', 'n°chéque/Ech', 'BANQUE Client', 'Client', 'facture', 'Montant', 'DATE DEPOT/Nbre Jrs'],
    [D('2026-07-01'), 'CHQ_SENTINELLE_9Q', 'BDK', 'CLIENT_SENTINELLE_ZQX', 'FACT 1', A(7_777_777), -3, D('2026-07-12')],
    [null, null, null, null, null, A(7_777_777)],
  ];
}

function invalidBatch(): { files: File[]; sheetSelections: Map<File, string>; fileOrdinals: Map<File, number> } {
  const bankReport = workbookFile(`BDK ${FILE_SENTINEL}.xlsx`, [
    { name: '090726', rows: invalidBankReportRows() },
    { name: '100726', rows: [['BDK']] },
  ]);
  const fundPosition = workbookFile(`FUND POSITION ${FILE_SENTINEL}.xlsx`, [{
    name: '070726',
    rows: [
      [null, null, 'Bank Balance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit', 'Grand Balance'],
      ['Book balance', 'BANQUE_SENTINELLE', A(7777777.5), A(0), A(7777777), A(0), A(7777777)],
      [null, 'TOTAL FUND AVAILABLE', A(7777777), A(0), A(7777777), A(0), A(7777777)],
      ['COLLECTION NOT DEPOSITED'],
      [null, null, 'HOLD'],
      ['DATE', 'n°chéque/Ech', 'BANQUE Client', 'Client', 'facture', 'Montant', 'DATE DEPOT/Nbre Jrs'],
      [D('2026-07-01'), 'CHQ_SENTINELLE_9Q', 'BDK', 'CLIENT_SENTINELLE_ZQX', 'FACT', A(7777777), -3],
    ],
  }]);
  const collectionReport = workbookFile(`COLLECTION REPORT ${FILE_SENTINEL}.xlsx`, [{
    name: 'Feuil1',
    rows: [
      ['DATE', 'CLIENT NAME', 'AMOUNT', 'BANK NAME', 'FACTURE N°', 'No.CHq /Bd'],
      ['09/07/2026', 'CLIENT_SENTINELLE_ZQX', 7777777, '', 'FACT-7777777', 'CHQ_SENTINELLE_9Q'],
      ['31/02/2026', 'CLIENT_SENTINELLE_ZQX', 7777777, 'BANQUE_SENTINELLE', null, null],
      [null, 'CLIENT_SENTINELLE_ZQX', 7777777, 'BANQUE_SENTINELLE', null, null],
    ],
  }]);
  const internalBook = workbookFile(`INTERNAL BOOK ${FILE_SENTINEL}.xlsx`, [
    { name: '090726', rows: [['BIS'], ['CLIENT_SENTINELLE_ZQX', 7777777], ['CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE']] },
  ]);
  const files = [bankReport, fundPosition, collectionReport, internalBook];
  return {
    files,
    sheetSelections: new Map([[bankReport, '090726'], [fundPosition, '070726']]),
    fileOrdinals: new Map(files.map((file, index) => [file, index + 1] as const)),
  };
}

function validBatch(): { files: File[]; sheetSelections: Map<File, string>; fileOrdinals: Map<File, number> } {
  const bankReport = workbookFile(`BDK ${FILE_SENTINEL}.xlsx`, [{ name: '090726', rows: validBankReportRows() }]);
  const fundPosition = workbookFile(`FUND POSITION ${FILE_SENTINEL}.xlsx`, [{ name: '090726', rows: validFundPositionRows() }]);
  const collectionReport = workbookFile(`COLLECTION REPORT ${FILE_SENTINEL}.xlsx`, [{
    name: 'Feuil1',
    rows: [
      ['DATE', 'CLIENT NAME', 'AMOUNT', 'BANK NAME', 'FACTURE N°', 'No.CHq /Bd'],
      ['09/07/2026', 'CLIENT_SENTINELLE_ZQX', 7777777, 'BDK', 'FACT-7777777', 'CHQ_SENTINELLE_9Q'],
      ['09/07/2026', 'CLIENT_SENTINELLE_ZQX', 7777777, 'BIS', null, null],
    ],
  }]);
  const files = [bankReport, fundPosition, collectionReport];
  return {
    files,
    sheetSelections: new Map([[bankReport, '090726'], [fundPosition, '090726']]),
    fileOrdinals: new Map(files.map((file, index) => [file, index + 1] as const)),
  };
}

test('processFiles sur un lot marqué invalide : ni la console, ni la progression, ni les erreurs, ni les diagnostics ne fuient', async () => {
  const { fileProcessingService } = await loadPipeline();
  const { files, sheetSelections, fileOrdinals } = invalidBatch();

  const run = await withCapturedRuntime(() => fileProcessingService.processFiles(files, { sheetSelections, fileOrdinals }));

  assert.equal(run.result.success, false);
  assert.ok((run.result.errors ?? []).length >= 4, 'chaque famille du lot produit au moins une erreur fermée');
  assertNoSentinel(run.console, 'console processFiles (lot invalide)');
  assertNoSentinel(run.progress, 'événements de progression (lot invalide)');
  assertNoSentinel(JSON.stringify(run.result.errors), 'results.errors (lot invalide)');
  assertNoSentinel(JSON.stringify(run.result.data?.excelImportDiagnostics ?? null), 'diagnostics Excel (lot invalide)');
  assertNoSentinel(JSON.stringify(run.result), 'résultat complet (lot invalide)');
  for (const message of run.result.errors ?? []) {
    assert.doesNotMatch(message, /\.xlsx|\.pdf|file=|row=/i, `message brut d’extracteur : ${message.slice(0, 60)}`);
  }
  const diagnostics = run.result.data?.excelImportDiagnostics;
  assert.ok(diagnostics && diagnostics.excel_errors.length > 0, 'les lignes Collection rejetées sont diagnostiquées');
  for (const issue of diagnostics!.excel_errors) assert.match(issue.file, /^fichier n°\d+$/);
  assert.equal(run.result.data?.bankReports?.length ?? 0, 0);
  assert.equal(run.result.data?.collectionReports?.length ?? 0, 0);
  assert.equal(run.result.data?.syncResult, undefined);
});

test('processFiles sur un lot marqué valide : persistance et synchronisation atteintes, leurs échecs sentinelles ne fuient pas', async () => {
  const { fileProcessingService } = await loadPipeline();
  const { files, sheetSelections, fileOrdinals } = validBatch();
  const before = { ...supabaseDoubleCalls() };

  const run = await withCapturedRuntime(() => fileProcessingService.processFiles(files, { sheetSelections, fileOrdinals }));

  // Preuve que les chemins critiques ont été atteints : extraction acceptée,
  // puis persistance (rpc) et synchronisation (insert) en échec sentinelle.
  assert.equal(run.result.data?.bankReports?.length, 1, run.result.errors?.join(' | '));
  assert.ok(run.result.data?.fundPosition, 'Fund Position extraite');
  assert.equal(run.result.data?.collectionReports?.length, 2, 'collections extraites');
  assert.ok(run.result.data?.syncResult, 'synchronisation exécutée');
  assert.ok((run.result.data?.syncResult?.errors.length ?? 0) >= 1, 'la synchronisation a rencontré l’échec sentinelle');
  const errors = run.result.errors ?? [];
  assert.ok(errors.some(message => /^Erreur sauvegarde rapport bancaire BDK : /.test(message)), errors.join(' | '));
  assert.ok(errors.some(message => /^Erreur sauvegarde Fund Position : /.test(message)), errors.join(' | '));
  assert.ok(errors.some(message => /^Synchronisation Collection : \d+ collection\(s\) en erreur \(/.test(message)), errors.join(' | '));
  for (const message of errors) assert.match(message, /persistance refusée|réseau ou délai dépassé|contrat d’extraction refusé/);

  assertNoSentinel(run.console, 'console processFiles (lot valide, échecs de persistance)');
  assertNoSentinel(run.progress, 'événements de progression (lot valide)');
  assertNoSentinel(JSON.stringify(errors), 'results.errors (lot valide)');
  assertNoSentinel(JSON.stringify(run.result.data?.excelImportDiagnostics ?? null), 'diagnostics Excel (lot valide)');

  // Compteurs explicites du double : la persistance (rpc) et la synchronisation
  // (insert) ont réellement été appelées, et toutes ont échoué par sentinelle.
  const after = supabaseDoubleCalls();
  assert.ok(after.rpc - before.rpc >= 2, `rpc attendus ≥ 2 (rapport bancaire, Fund Position), obtenus ${after.rpc - before.rpc}`);
  assert.ok(after.insert - before.insert >= 1, `insert attendus ≥ 1, obtenus ${after.insert - before.insert}`);

  // Frontière du résultat : `data.syncResult` ne porte que rang de ligne et motif fermé.
  const syncResult = run.result.data!.syncResult!;
  assertNoSentinel(JSON.stringify(syncResult), 'data.syncResult');
  for (const syncError of syncResult.errors) {
    assert.deepEqual(Object.keys(syncError.collection).filter(key => key !== 'excelSourceRow'), [], 'référence collection limitée au rang de ligne');
    assert.match(syncError.error, /^(?:ligne \d+ : )?(?:persistance refusée|réseau ou délai dépassé|contrat d’extraction refusé)$/);
  }
  assert.ok(syncResult.errors.some(syncError => typeof syncError.collection.excelSourceRow === 'number'), 'au moins une erreur porte son rang de ligne');

  // Résultat complet : le message serveur n'apparaît nulle part, charges utiles
  // comprises ; hors charges utiles extraites (données métier rendues à
  // l'interface), aucune sentinelle.
  assert.equal(JSON.stringify(run.result).includes('SUPABASE_SENTINELLE_QX'), false, 'message serveur dans le résultat complet');
  assertNoSentinel(resultWithoutExtractedPayloads(run.result as never), 'résultat complet hors charges utiles extraites');
});

test('processFiles sur un document bloqué au précontrôle : le rang remplace le nom, aucune sentinelle', async () => {
  const { fileProcessingService } = await loadPipeline();
  const blocked = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], `CLIENT RECONCILIATION ${FILE_SENTINEL}.pdf`);

  const run = await withCapturedRuntime(() => fileProcessingService.processFiles([blocked], { fileOrdinals: new Map([[blocked, 3]]) }));

  assert.equal(run.result.success, false);
  assert.match(run.result.errors[0], /^fichier n°3: /);
  assertNoSentinel(run.console, 'console (document bloqué)');
  assertNoSentinel(run.progress, 'progression (document bloqué)');
  assertNoSentinel(JSON.stringify(run.result), 'résultat (document bloqué)');
});

class ExplodingFile extends File {
  override get name(): string {
    throw new Error('EXCEPTION_SENTINELLE_QX ligne brute CLIENT_SENTINELLE_ZQX 7777777');
  }
}

test('exception générale du pipeline : réduite au vocabulaire fermé, console et progression sans sentinelle', async () => {
  const { fileProcessingService } = await loadPipeline();
  const exploding = new ExplodingFile([new Uint8Array([1])], 'x.xlsx');

  const run = await withCapturedRuntime(() => fileProcessingService.processFiles([exploding]));

  assert.equal(run.result.success, false);
  assert.deepEqual(run.result.errors, [summarizeExtractionErrors(['EXCEPTION_SENTINELLE_QX ligne brute CLIENT_SENTINELLE_ZQX 7777777'])]);
  assertNoSentinel(run.console, 'console (exception générale)');
  assertNoSentinel(run.progress, 'progression (exception générale)');
  assertNoSentinel(JSON.stringify(run.result), 'résultat (exception générale)');
});

test('adaptateur Internal Book : les erreurs retournées ne portent ni nom de feuille ni message brut', () => {
  const issue: InternalBookValidationIssue = {
    code: 'TOTAL_MISMATCH' as InternalBookValidationIssue['code'],
    severity: 'error',
    message: 'MESSAGE_SENTINELLE_QX CLIENT_SENTINELLE_ZQX 7777777',
    sheetName: 'FEUILLE_SENTINELLE_QX',
    section: 'totalBalanceA',
    rowIndex: 11,
  };
  const importResult = buildInternalBookImportResult(orchestrateInternalBookImport({
    success: false,
    bank: 'BIS',
    sourceFile: `INTERNAL BOOK ${FILE_SENTINEL}.xlsx`,
    books: [],
    ignoredSheets: [],
    errors: [issue],
    warnings: [],
  }, { mode: 'latest' }));
  const processingResult = adaptInternalBookImportResultToProcessingResult(importResult);

  assert.equal(processingResult.success, false);
  assert.ok(processingResult.errors.includes('TOTAL_MISMATCH (ligne 12)'), processingResult.errors.join(' | '));
  assertNoSentinel(JSON.stringify(processingResult.errors), 'erreurs adaptateur Internal Book');
});
