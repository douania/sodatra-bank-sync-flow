import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { detectDocumentType } from './documentDetectionService';
import { detectImportDocumentFromText } from './importPreflightService';

function namedFile(name: string): File {
  return new File(['synthetic'], name, { type: name.endsWith('.pdf') ? 'application/pdf' : '' });
}

function workbookFile(name: string, rows: unknown[][]): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'DATA');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([bytes], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

test('le détecteur read-only partage les familles strictes du précontrôle', async () => {
  assert.equal((await detectDocumentType(namedFile('Collection Report synthetic.xlsx'))).detectedType, 'collectionReport');
  assert.equal((await detectDocumentType(namedFile('Fund Position synthetic.xlsx'))).detectedType, 'fundsPosition');
  assert.equal((await detectDocumentType(namedFile('Client Reconciliation synthetic.xlsx'))).detectedType, 'clientReconciliation');
  assert.equal((await detectDocumentType(namedFile('synthetic-BDK-internal-book.xlsx'))).detectedType, 'internalBook');
  assert.equal((await detectDocumentType(namedFile('CORPORATE.pdf'))).detectedType, 'unknown');
});

test('distingue rapport et relevé bancaire sans faux positifs de sous-chaîne', async () => {
  const bdk = await detectDocumentType(namedFile('Relevé BDK synthetic.pdf'));
  assert.equal(bdk.detectedType, 'bankStatement');
  assert.equal(bdk.bankType, 'BDK Relevé');

  const bicis = await detectDocumentType(namedFile('Rapport BICIS synthetic.pdf'));
  assert.equal(bicis.detectedType, 'bankAnalysis');
  assert.equal(bicis.bankType, 'BICIS Rapport');

  assert.equal((await detectDocumentType(namedFile('RUBICON.pdf'))).detectedType, 'unknown');
  assert.equal((await detectDocumentType(namedFile('MSG.pdf'))).detectedType, 'unknown');
});

test('un nom neutre peut être qualifié par un classeur synthétique, sans Supabase', async () => {
  const detection = await detectDocumentType(workbookFile('synthetic-document.xlsx', [
    ['COLLECTION', 'CLIENT CODE', 'AMOUNT'],
    ['SYNTHETIC', 'CLIENT_SYN_1', 1000],
  ]));

  assert.equal(detection.detectedType, 'collectionReport');
  assert.equal(detection.confidence, 'medium');
});

test('les familles documentaires priment sur une banque citée dans le contenu', () => {
  assert.equal(detectImportDocumentFromText('RAPPORT COLLECTIONS JUILLET\nBDK').kind, 'COLLECTION_REPORT');
  assert.equal(detectImportDocumentFromText('INTERNAL BOOK\nBDK').kind, 'INTERNAL_BOOK');
  assert.equal(detectImportDocumentFromText('BRIDGE RELEVE\nORABANK').kind, 'UNKNOWN');
  assert.equal(detectImportDocumentFromText('FUND POSITION 05/08/2026\nBDK 100').kind, 'FUND_POSITION');
});
