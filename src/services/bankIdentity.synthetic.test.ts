import assert from 'node:assert/strict';
import test from 'node:test';

import {
  corroborateBankIdentity,
  detectBankFromContent,
  detectBankFromFileName,
  OPERATIONAL_BANK_CODES,
} from './bankIdentity';

const fixtures = [
  ['BDK', 'Banque de Dakar'],
  ['ATB', 'Banque Atlantique'],
  ['BICIS', 'BICIS'],
  ['ORA', 'Orabank'],
  ['SGBS', 'Société Générale'],
  ['BIS', 'Banque Islamique du Sénégal'],
] as const;

test('la taxonomie bancaire canonique couvre exactement les six banques opérationnelles', () => {
  assert.deepEqual(OPERATIONAL_BANK_CODES, ['BDK', 'ATB', 'BICIS', 'ORA', 'SGBS', 'BIS']);
  for (const [code, label] of fixtures) {
    assert.equal(detectBankFromFileName(`Rapport ${label}.pdf`), code);
    assert.equal(detectBankFromContent(`${label}\nRAPPORT BANCAIRE`), code);
  }
});

test('la corroboration exige une identité unique et identique dans le nom et le contenu', () => {
  assert.deepEqual(
    corroborateBankIdentity('Rapport ORA.pdf', 'ORABANK\nRAPPORT 05/08/2026').bank,
    'ORA',
  );
  assert.equal(corroborateBankIdentity('Rapport BDK.pdf', 'ATB\nRAPPORT 05/08/2026').corroborated, false);
  assert.equal(corroborateBankIdentity('Rapport bancaire.pdf', 'BDK\nRAPPORT 05/08/2026').corroborated, false);
  assert.equal(detectBankFromContent('BDK ATB RAPPORT'), null);
});

test('les sous-chaînes génériques ne sont pas prises pour des codes banque', () => {
  assert.equal(detectBankFromFileName('rapport public.pdf'), null);
  assert.equal(detectBankFromContent('BICYCLE ATLANTIQUE GENERALE'), null);
});
