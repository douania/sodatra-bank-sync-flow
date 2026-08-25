import assert from 'node:assert/strict';
import test from 'node:test';

import { extractFundPosition } from './extractionService';

const nominal = [
  'FUND POSITION 29/02/2024',
  'Book balance',
  'BDK\t100\t0\t100\t0\t100',
  'TOTAL FUND AVAILABLE 100',
  'GRAND TOTAL 0',
].join('\n');

test('Fund Position accepte un grand total explicite à zéro avec date et détail bancaire', () => {
  const result = extractFundPosition(nominal);
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.reportDate, '2024-02-29');
  assert.equal(result.data?.grandTotal, 0);
  assert.equal(result.data?.details?.length, 1);
});

test('Fund Position refuse date absente ou invalide, grand total absent et détail absent', () => {
  for (const invalid of [
    nominal.replace('FUND POSITION 29/02/2024', 'FUND POSITION'),
    nominal.replace('29/02/2024', '29/02/2025'),
    nominal.replace('GRAND TOTAL 0', 'TOTAL GENERAL ABSENT'),
    nominal.replace('BDK\t100\t0\t100\t0\t100\n', ''),
  ]) {
    const result = extractFundPosition(invalid);
    assert.equal(result.success, false);
    assert.ok((result.errors ?? []).length > 0);
  }
});

test('Fund Position refuse un montant décimal non nul dans un détail bancaire', () => {
  const result = extractFundPosition(nominal.replace('BDK\t100\t0\t100\t0\t100', 'BDK\t100,50\t0\t100\t0\t100'));
  assert.equal(result.success, false);
});

test('Fund Position refuse une ligne financière dont les colonnes sont séparées par des espaces ambigus', () => {
  const result = extractFundPosition(nominal.replace('BDK\t100\t0\t100\t0\t100', 'BDK 100 0 100 0 100'));
  assert.equal(result.success, false);
});

test('Fund Position refuse tout le document si une ligne parmi plusieurs est invalide', () => {
  const result = extractFundPosition(nominal.replace(
    'BDK\t100\t0\t100\t0\t100',
    'BDK\t100\t0\t100\t0\t100\nATB\t100,50\t0\t100\t0\t100',
  ));
  assert.equal(result.success, false);
  assert.match((result.errors ?? []).join(' '), /ATB|montant/i);
});

test('Fund Position valide strictement dates et montants de la section HOLD', () => {
  const validHold = `${nominal}\nHOLD\n05/08/2026 CHQ1 BDK CLIENTA FACT1 100 06/08/2026\nTotal: 100`;
  const valid = extractFundPosition(validHold);
  assert.equal(valid.success, true, valid.errors?.join(' '));
  assert.equal(valid.data?.holdCollections?.[0].holdDate, '2026-08-05');
  assert.equal(valid.data?.holdCollections?.[0].depositDate, '2026-08-06');

  for (const invalid of [
    validHold.replace('05/08/2026 CHQ1', '31/02/2026 CHQ1'),
    validHold.replace('06/08/2026', '06/08/2026,'),
    validHold.replace('FACT1 100', 'FACT1 100,50'),
  ]) {
    assert.equal(extractFundPosition(invalid).success, false);
  }
});
