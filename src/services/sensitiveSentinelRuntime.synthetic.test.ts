import assert from 'node:assert/strict';
import test from 'node:test';

import * as XLSX from 'xlsx';

import { extractBankReportFromGrid } from './bankReportGridExtractor';
import { bankReportProcessingService } from './bankReportProcessingService';
import { bankReportSectionExtractor } from './bankReportSectionExtractor';
import { worksheetToGrid } from './excelSheetGrid';
import { summarizeExtractionErrors } from './extractionErrorSummary';
import { extractFundPosition } from './extractionService';
import { extractFundPositionFromGrid } from './fundPositionGridExtractor';

/**
 * Tests par sentinelles sensibles (Pack 2, FIX_4) : chaque chemin du graphe
 * d'appel est EXÉCUTÉ avec des valeurs marquées ; ni la console capturée, ni
 * les erreurs retournées, ni le résumé fermé ne peuvent les contenir.
 */
const SENTINELS = ['CLIENT_SENTINELLE_ZQX', '7777777', 'CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE', '31/02/2026'];
const ACCOUNTING = '_-* #,##0\\ _€_-;\\-* #,##0\\ _€_-;_-* "-"??\\ _€_-;_-@_-';

function assertNoSentinel(payload: string, context: string): void {
  for (const sentinel of SENTINELS) {
    assert.equal(payload.includes(sentinel), false, `${context} expose la sentinelle ${sentinel}`);
  }
}

async function withCapturedConsole<T>(operation: () => Promise<T> | T): Promise<{ result: T; console: string }> {
  const captured: string[] = [];
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
  try {
    const result = await operation();
    return { result, console: captured.join('\n') };
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}

test('sentinelles : le chemin texte Fund Position (PDF legacy) ne fuit ni en console ni dans ses erreurs', async () => {
  const text = [
    'FUND POSITION 29/02/2024',
    'Book balance',
    'BANQUE_SENTINELLE\t7777777\t0\t7777777',
    'TOTAL FUND AVAILABLE 7777777',
    'GRAND TOTAL 12O000',
    'HOLD',
    '31/02/2026 CHQ_SENTINELLE_9Q BDK CLIENT_SENTINELLE_ZQX FACT1 7777777 06/08/2026',
    'Total: 1O0',
  ].join('\n');
  const { result, console: output } = await withCapturedConsole(() => extractFundPosition(text));
  assert.equal(result.success, false);
  assertNoSentinel(output, 'console Fund Position texte');
  assertNoSentinel(JSON.stringify(result), 'erreurs Fund Position texte');
  assertNoSentinel(summarizeExtractionErrors(result.errors), 'résumé Fund Position texte');
});

test('sentinelles : le chemin texte des rapports bancaires (PDF) ne fuit ni en console ni dans ses erreurs', async () => {
  const text = [
    'BDK RAPPORT 05/08/2026',
    'OPENING BALANCE 05/08/2026 7777777',
    'CLOSING BALANCE as per Book: C=(A-B) 12O000',
    'DEPOSIT NOT YET CLEARED',
    '31/02/2026 123 REGLEMENT FACTURE CLIENT_SENTINELLE_ZQX 7777777',
    'CHECK Not yet cleared',
    '05/08/2026 CHQ_SENTINELLE_9Q BANQUE_SENTINELLE 12O000',
  ].join('\n');
  const { result, console: output } = await withCapturedConsole(() => bankReportSectionExtractor.extractBankReportSections(text, 'BDK'));
  assert.equal(result.success, false);
  assertNoSentinel(output, 'console rapport bancaire texte');
  assertNoSentinel(JSON.stringify(result), 'erreurs rapport bancaire texte');
  assertNoSentinel(summarizeExtractionErrors(result.errors), 'résumé rapport bancaire texte');
});

function sentinelWorkbookSheet(): XLSX.WorkSheet {
  const rows: unknown[][] = [
    [null, null, null, 'BDK'],
    ['Date', 'Ch.No', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR NO/FACT.NO', 'AMOUNT'],
    ['OPENING BALANCE 09/07/26', null, null, null, null, null, 7777777],
    ['ADD :', 'DEPOSIT NOT YET CLEARED'],
    [46211, 46212, 'CHQ_SENTINELLE_9Q', 'BANQUE_SENTINELLE', 'CLIENT_SENTINELLE_ZQX', null, 7777777.5],
    [null, null, 'CLOSING BALANCE as per Book : C=(A-B)', null, null, null, 7777777],
    [null, null, null, 'BANK FACILITY (180 jrs)'],
    [null, 46212, '31/02/2026', 7777777, 0, null, 7777777],
    ['CLIENT_SENTINELLE_ZQX', null, null, null, 7777777],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const address of ['G3', 'G5', 'G6', 'D8', 'E8', 'G8', 'E9']) if (sheet[address]) sheet[address].z = ACCOUNTING;
  for (const address of ['A5', 'B5', 'B8']) if (sheet[address]) sheet[address].z = 'm/d/yy';
  return sheet;
}

test('sentinelles : les extracteurs tabulaires ne fuient ni en console ni dans leurs erreurs', async () => {
  const grid = worksheetToGrid(sentinelWorkbookSheet(), '090726');
  const bank = await withCapturedConsole(() => extractBankReportFromGrid(grid, 'BDK', { fileName: 'BDK-SYNTHETIQUE-2026.xlsx' }));
  assert.equal(bank.result.success, false);
  assertNoSentinel(bank.console, 'console extracteur tabulaire');
  assertNoSentinel(JSON.stringify(bank.result), 'erreurs extracteur tabulaire');

  const fundSheet = XLSX.utils.aoa_to_sheet([
    [null, null, 'Bank Balance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit', 'Grand Balance'],
    ['Book balance', 'BANQUE_SENTINELLE', 7777777.5, 0, 7777777, 0, 7777777],
    [null, 'TOTAL FUND AVAILABLE', 7777777, 0, 7777777, 0, 7777777],
    ['COLLECTION NOT DEPOSITED'],
    [null, null, 'HOLD'],
    ['DATE', 'n°chéque/Ech', 'BANQUE Client', 'Client', 'facture', 'Montant', 'DATE DEPOT/Nbre Jrs'],
    [46211, 'CHQ_SENTINELLE_9Q', 'BDK', 'CLIENT_SENTINELLE_ZQX', 'FACT', 7777777, -3],
  ]);
  for (const address of ['C2', 'D2', 'E2', 'F2', 'G2', 'C3', 'D3', 'E3', 'F3', 'G3', 'F7']) if (fundSheet[address]) fundSheet[address].z = ACCOUNTING;
  fundSheet.A7.z = 'm/d/yy';
  const fund = await withCapturedConsole(() => extractFundPositionFromGrid(worksheetToGrid(fundSheet, '090726'), { fileName: 'FP-SYNTHETIQUE-2026.xlsx' }));
  assert.equal(fund.result.success, false);
  assertNoSentinel(fund.console, 'console Fund Position tabulaire');
  assertNoSentinel(JSON.stringify(fund.result), 'erreurs Fund Position tabulaire');
});

test('sentinelles : le service de traitement des rapports bancaires, exécuté sur un vrai File, ne fuit pas', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sentinelWorkbookSheet(), '090726');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['BDK']]), '100726');
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  const file = new File([bytes], 'CLIENT_SENTINELLE_ZQX-BDK-2026.xlsx');

  const unselected = await withCapturedConsole(() => bankReportProcessingService.processBankReportExcel(file));
  assert.equal(unselected.result.success, false);
  assertNoSentinel(unselected.console, 'console service (sélection requise)');
  assertNoSentinel(summarizeExtractionErrors(unselected.result.errors), 'résumé service (sélection requise)');

  const selected = await withCapturedConsole(() => bankReportProcessingService.processBankReportExcel(file, { sheetName: '090726' }));
  assert.equal(selected.result.success, false);
  assertNoSentinel(selected.console, 'console service (feuille choisie)');
  assertNoSentinel(JSON.stringify(selected.result.errors), 'erreurs service (feuille choisie)');
  assertNoSentinel(summarizeExtractionErrors(selected.result.errors), 'résumé service (feuille choisie)');
});

test('le résumé fermé réduit tout message brut à un rang de ligne et un motif du vocabulaire', () => {
  const summary = summarizeExtractionErrors([
    'Ligne de dépôts non crédités non exploitable: 31/02/2026 123 CLIENT_SENTINELLE_ZQX 7777777',
    'Montant HOLD invalide pour CHQ_SENTINELLE_9Q.',
    'Ligne 12 de facilités bancaires sans libellé.',
    'Identité bancaire ambiguë dans l’en-tête (BDK, BANQUE_SENTINELLE) pour BDK.',
    'Le classeur contient 166 feuilles : choisissez explicitement la feuille à traiter.',
  ]);
  assertNoSentinel(summary, 'résumé fermé');
  assert.match(summary, /section ou ligne non exploitable/);
  assert.match(summary, /bloc HOLD invalide/);
  assert.match(summary, /ligne 12 : section ou ligne non exploitable/);
  assert.match(summary, /identité bancaire non corroborée/);
  assert.match(summary, /sélection de feuille requise/);
  assert.equal(summarizeExtractionErrors(undefined), 'contrat d’extraction refusé');
});
