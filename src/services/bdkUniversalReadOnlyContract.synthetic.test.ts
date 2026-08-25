import assert from 'node:assert/strict';
import test from 'node:test';

import { bdkExtractionService } from './bdkExtractionService';
import { validateBdkUniversalReadOnlyResult } from './bdkUniversalReadOnlyContract';

const valid = [
  'BDK RAPPORT 05/08/2026',
  'OPENING BALANCE 05/08/2026 100',
  'CLOSING BALANCE as per Book : C=(A-B) 100',
].join('\n');

test('le résultat BDK read-only exige soldes explicites et validation mathématique', () => {
  assert.deepEqual(
    validateBdkUniversalReadOnlyResult(valid, bdkExtractionService.extractBDKData(valid)),
    [],
  );
});

test('un extrait de compte BDK non supporté ne devient pas un faux rapport à zéro', () => {
  const unsupported = [
    'BDK EXTRAIT DE COMPTE 05/08/2026',
    'Solde initial (XOF) : 100',
    'Solde (XOF) au 05/08/2026 : 100',
  ].join('\n');
  assert.ok(validateBdkUniversalReadOnlyResult(
    unsupported,
    bdkExtractionService.extractBDKData(unsupported),
  ).length > 0);
});

test('une capture BDK qui traverse une ligne est détectée comme incohérente', () => {
  const ambiguous = [
    'BDK RAPPORT 05/08/2026',
    'OPENING BALANCE 05/08/2026 100',
    '18/05/2026 AUTRE LIGNE',
    'CLOSING BALANCE as per Book : C=(A-B) 100',
  ].join('\n');
  assert.ok(validateBdkUniversalReadOnlyResult(
    ambiguous,
    bdkExtractionService.extractBDKData(ambiguous),
  ).length > 0);
});
