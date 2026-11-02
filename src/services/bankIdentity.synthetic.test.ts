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

test('ATB désigne la seule banque Atlantique, jamais un autre établissement', () => {
  for (const label of ['Banque Atlantique', 'ATLANTIQUE BANK', 'Atlantik Bank', 'ATB']) {
    assert.equal(detectBankFromFileName(`Rapport ${label} 2026.xlsx`), 'ATB', label);
  }
  for (const label of ['Banque Atlantique', 'ATB']) {
    assert.equal(detectBankFromContent(`${label}\nRAPPORT BANCAIRE`), 'ATB', label);
  }
  assert.equal(detectBankFromFileName('5-ATLANTIK BANK 2026.xlsx'), 'ATB');
  // Ancien alias ambigu : établissement distinct, plus rattaché à ATB.
  assert.equal(detectBankFromFileName('Rapport Arab Tunisian Bank.pdf'), null);
  assert.equal(detectBankFromContent('ARAB TUNISIAN BANK\nRAPPORT BANCAIRE'), null);
  assert.equal(corroborateBankIdentity('Rapport Arab Tunisian Bank.pdf', 'ARAB TUNISIAN BANK\nRAPPORT').corroborated, false);
  // Non-régression : un libellé d'opération citant la banque Atlantique ne rend
  // pas ambigu le document d'une autre banque.
  for (const label of ['ATLANTIQUE BANK', 'ATLANTIK BANK']) {
    assert.equal(detectBankFromContent(`BANQUE DE DAKAR\nVIREMENT RECU ${label}`), 'BDK', label);
    assert.equal(detectBankFromContent(`ORABANK\nVIREMENT EMIS ${label}`), 'ORA', label);
    assert.equal(corroborateBankIdentity('Rapport BDK 2026.pdf', `BDK\nVIREMENT ${label}`).bank, 'BDK', label);
  }
  assert.equal(corroborateBankIdentity('Rapport Banque Atlantique.pdf', 'BANQUE ATLANTIQUE\nRAPPORT').bank, 'ATB');
  assert.equal(corroborateBankIdentity('Rapport ATLANTIQUE BANK.pdf', 'BDK\nRAPPORT').corroborated, false);
});
