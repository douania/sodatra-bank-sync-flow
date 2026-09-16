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
 * (Pack 2, FIX_5). `fileProcessingService.processFiles` est EXÉCUTÉ sur un lot
 * synthétique marqué (rapport bancaire, Fund Position, Collection Report,
 * Internal Book), puis sur un document bloqué au précontrôle, puis sur un
 * fichier qui déclenche l'exception générale. Sont inspectés : la console
 * (quatre niveaux), les événements de progression, `results.errors` et les
 * diagnostics Excel. Aucune sentinelle ne doit y apparaître.
 *
 * Note runner : le client Supabase généré est Vite-only ; comme dans
 * `uploadRuntimeGuard.synthetic.test.ts`, il est court-circuité par un stub
 * qui jette au moindre accès — ce test ne peut physiquement pas toucher
 * Supabase, et prouve qu'aucun chemin de persistance n'est atteint. La garde
 * de mutation canonique est injectée (option `mutationGate`, tests seulement)
 * pour que le traitement démarre hors Vite.
 */
const SUPABASE_CLIENT_SPECIFIER = '@/integrations/supabase/client';
const supabaseStubModuleUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    'export const supabase = new Proxy({}, {' +
      ' get() { throw new Error("synthetic test: supabase client must never be used"); }' +
      ' });'
  );
const resolverHooksUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    `export function resolve(specifier, context, nextResolve) {
      if (specifier === ${JSON.stringify(SUPABASE_CLIENT_SPECIFIER)}) {
        return { shortCircuit: true, url: ${JSON.stringify(supabaseStubModuleUrl)} };
      }
      return nextResolve(specifier, context);
    }`
  );
register(resolverHooksUrl);

const nodeMajorVersion = Number(process.versions.node.split('.')[0]);
const runnerSkip = nodeMajorVersion >= 24 ? 'Harness Supabase/Vite exécuté en CI Node 20.' : false;

const FILE_SENTINEL = 'NOMFICHIER_SENTINELLE_QX';
const SENTINELS = [
  FILE_SENTINEL, 'CLIENT_SENTINELLE_ZQX', '7777777', 'CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE',
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

function workbookFile(name: string, sheets: Array<{ name: string; rows: unknown[][]; accounting?: string[]; dates?: string[] }>): File {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    for (const address of sheet.accounting ?? []) if (ws[address]) ws[address].z = ACCOUNTING;
    for (const address of sheet.dates ?? []) if (ws[address]) ws[address].z = 'm/d/yy';
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
  }
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  return new File([bytes], name);
}

function sentinelBatch(): { files: File[]; sheetSelections: Map<File, string>; fileOrdinals: Map<File, number> } {
  const bankReport = workbookFile(`BDK ${FILE_SENTINEL}.xlsx`, [
    {
      name: '090726',
      rows: [
        [null, null, null, 'BDK'],
        ['Date', 'Ch.No', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT'],
        ['OPENING BALANCE 09/07/26', null, null, null, null, null, 7777777],
        ['ADD :', 'DEPOSIT NOT YET CLEARED'],
        [46211, 46212, 'CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE', 'CLIENT_SENTINELLE_ZQX', null, 7777777.5],
        [null, null, 'CLOSING BALANCE as per Book : C=(A-B)', null, null, null, 7777777],
        [null, null, null, 'BANK FACILITY (180 jrs)'],
        [null, 46212, '31/02/2026', 7777777, 0, null, 7777777],
        ['CLIENT_SENTINELLE_ZQX', null, null, null, 7777777],
      ],
      accounting: ['G3', 'G5', 'G6', 'D8', 'E8', 'G8', 'E9'],
      dates: ['A5', 'B5', 'B8'],
    },
    { name: '100726', rows: [['BDK']] },
  ]);
  const fundPosition = workbookFile(`FUND POSITION ${FILE_SENTINEL}.xlsx`, [
    {
      name: '070726',
      rows: [
        [null, null, 'Bank Balance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit', 'Grand Balance'],
        ['Book balance', 'BANQUE_SENTINELLE', 7777777.5, 0, 7777777, 0, 7777777],
        [null, 'TOTAL FUND AVAILABLE', 7777777, 0, 7777777, 0, 7777777],
        ['COLLECTION NOT DEPOSITED'],
        [null, null, 'HOLD'],
        ['DATE', 'n°chéque/Ech', 'BANQUE Client', 'Client', 'facture', 'Montant', 'DATE DEPOT/Nbre Jrs'],
        [46211, 'CHQ_SENTINELLE_9Q', 'BDK', 'CLIENT_SENTINELLE_ZQX', 'FACT', 7777777, -3],
      ],
      accounting: ['C2', 'D2', 'E2', 'F2', 'G2', 'C3', 'D3', 'E3', 'F3', 'G3', 'F7'],
      dates: ['A7'],
    },
  ]);
  const collectionReport = workbookFile(`COLLECTION REPORT ${FILE_SENTINEL}.xlsx`, [
    {
      name: 'Feuil1',
      rows: [
        ['DATE', 'CLIENT NAME', 'AMOUNT', 'BANK NAME', 'FACTURE N°', 'No.CHq /Bd'],
        ['09/07/2026', 'CLIENT_SENTINELLE_ZQX', 7777777, '', 'FACT-7777777', 'CHQ_SENTINELLE_9Q'],
        ['31/02/2026', 'CLIENT_SENTINELLE_ZQX', 7777777, 'BANQUE_SENTINELLE', null, null],
        [null, 'CLIENT_SENTINELLE_ZQX', 7777777, 'BANQUE_SENTINELLE', null, null],
      ],
    },
  ]);
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

test('processFiles exécuté sur un lot marqué : ni la console, ni la progression, ni les erreurs, ni les diagnostics ne fuient', { skip: runnerSkip }, async () => {
  const { fileProcessingService } = await import('./fileProcessingService');
  const { files, sheetSelections, fileOrdinals } = sentinelBatch();

  const run = await withCapturedRuntime(() => fileProcessingService.processFiles(files, {
    sheetSelections,
    fileOrdinals,
    mutationGate: () => ({ allowed: true }),
  }));

  assert.equal(run.result.success, false);
  assert.ok((run.result.errors ?? []).length >= 4, 'chaque famille du lot produit au moins une erreur fermée');
  assertNoSentinel(run.console, 'console processFiles');
  assertNoSentinel(run.progress, 'événements de progression');
  assertNoSentinel(JSON.stringify(run.result.errors), 'results.errors');
  assertNoSentinel(JSON.stringify(run.result.data?.excelImportDiagnostics ?? null), 'diagnostics Excel');
  // Les erreurs désignent les fichiers par leur rang et les motifs par le vocabulaire fermé.
  for (const message of run.result.errors ?? []) {
    assert.doesNotMatch(message, /\.xlsx|\.pdf|file=|row=/i, `message brut d’extracteur : ${message.slice(0, 60)}`);
  }
  const diagnostics = run.result.data?.excelImportDiagnostics;
  assert.ok(diagnostics && diagnostics.excel_errors.length > 0, 'les lignes Collection rejetées sont diagnostiquées');
  for (const issue of diagnostics!.excel_errors) {
    assert.match(issue.file, /^fichier n°\d+$/);
  }
  assert.equal(run.result.data?.bankReports?.length ?? 0, 0);
  assert.equal(run.result.data?.collectionReports?.length ?? 0, 0);
  assert.equal(run.result.data?.syncResult, undefined);
});

test('processFiles sur un document bloqué au précontrôle : le rang remplace le nom, aucune sentinelle', { skip: runnerSkip }, async () => {
  const { fileProcessingService } = await import('./fileProcessingService');
  const blocked = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], `CLIENT RECONCILIATION ${FILE_SENTINEL}.pdf`);

  const run = await withCapturedRuntime(() => fileProcessingService.processFiles([blocked], {
    fileOrdinals: new Map([[blocked, 3]]),
    mutationGate: () => ({ allowed: true }),
  }));

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

test('exception générale du pipeline : réduite au vocabulaire fermé, console et progression sans sentinelle', { skip: runnerSkip }, async () => {
  const { fileProcessingService } = await import('./fileProcessingService');
  const exploding = new ExplodingFile([new Uint8Array([1])], 'x.xlsx');

  const run = await withCapturedRuntime(() => fileProcessingService.processFiles([exploding], {
    mutationGate: () => ({ allowed: true }),
  }));

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
  assert.ok(processingResult.errors.length > 0);
  assert.ok(processingResult.errors.includes('TOTAL_MISMATCH (ligne 12)'), processingResult.errors.join(' | '));
  assertNoSentinel(JSON.stringify(processingResult.errors), 'erreurs adaptateur Internal Book');
});
