import assert from 'node:assert/strict';

import { parseDocumentDate as parseDocumentDateForShortYear } from './bankReportExtractionContract';

test('règle Pack 2 : année sur deux chiffres = 2000 + AA, jour en premier ; le rendu m/d/yy de SheetJS est refusé', () => {
  assert.equal(parseDocumentDateForShortYear('09/07/26'), '2026-07-09');
  assert.equal(parseDocumentDateForShortYear('09-07-26'), '2026-07-09');
  assert.equal(parseDocumentDateForShortYear('31/02/26'), null);
  assert.equal(parseDocumentDateForShortYear('7/9/26'), null);
  assert.equal(parseDocumentDateForShortYear('07/9/26'), null);
  assert.equal(parseDocumentDateForShortYear('9/07/26'), null);
});
import test from 'node:test';

import { hasStructuredLines, parseDocumentDate, parseFinancialInteger } from './bankReportExtractionContract';

test('les dates documentaires sont calendaires et normalisées sans date de repli', () => {
  assert.equal(parseDocumentDate('29/02/2024'), '2024-02-29');
  assert.equal(parseDocumentDate('05-08-2026'), '2026-08-05');
  assert.equal(parseDocumentDate('2026-08-05'), '2026-08-05');
  assert.equal(parseDocumentDate('29/02/2025'), null);
  assert.equal(parseDocumentDate('31/04/2026'), null);
  assert.equal(parseDocumentDate(undefined), null);
});

test('les montants FCFA doivent être des entiers sûrs explicitement parsables', () => {
  assert.equal(parseFinancialInteger('1 234 567'), 1234567);
  assert.equal(parseFinancialInteger('-1.234.567'), -1234567);
  assert.equal(parseFinancialInteger('1,234,000.00'), 1234000);
  assert.equal(parseFinancialInteger('1.234,000'), null);
  assert.equal(parseFinancialInteger('1,234.567'), null);
  assert.equal(parseFinancialInteger('1 000,50'), null);
  assert.equal(parseFinancialInteger('1 000\n18'), null);
  assert.equal(parseFinancialInteger('1 000 000\t900 000'), null);
  assert.equal(parseFinancialInteger('100 0'), null);
  assert.equal(parseFinancialInteger('12O000'), null);
  assert.equal(parseFinancialInteger('999999999999999999999'), null);
});

test('un rapport aplati ne satisfait pas le contrat de lignes', () => {
  assert.equal(hasStructuredLines('BDK RAPPORT 05/08/2026 OPENING BALANCE 100'), false);
  assert.equal(hasStructuredLines('BDK RAPPORT 05/08/2026\nOPENING BALANCE 100'), true);
});
