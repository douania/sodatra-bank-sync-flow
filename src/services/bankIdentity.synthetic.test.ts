import assert from 'node:assert/strict';
import test from 'node:test';

import {
  banksMentionedInHeader,
  corroborateBankIdentity,
  detectBankFromContent,
  detectBankFromFileName,
  detectBankFromHeader,
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

test('l’identité se lit dans l’en-tête : le corps peut citer d’autres banques, l’en-tête doit être unique', () => {
  const body = 'BDK\nDate\tCh.No\nOPENING BALANCE 09/07/26\t1 000\nCHQ SGBS 100\nDEPOT CBAO 200\nVIREMENT ATB 300\nCHQ ECOBANK 50';
  assert.equal(detectBankFromHeader(body), 'BDK');
  assert.equal(detectBankFromContent(body), null, 'la détection sur tout le contenu reste ambiguë');
  assert.equal(corroborateBankIdentity('07-BDK 2026.xlsx', body).corroborated, true);

  const ambiguousHeader = 'BDK SGBS\nRAPPORT';
  assert.equal(detectBankFromHeader(ambiguousHeader), null);
  assert.deepEqual(banksMentionedInHeader(ambiguousHeader), ['BDK', 'SGBS']);
  assert.match(corroborateBankIdentity('Rapport BDK.pdf', ambiguousHeader).error ?? '', /ambiguë dans l’en-tête/);

  const lateMention = 'ligne 1\nligne 2\nligne 3\nBDK RAPPORT';
  assert.equal(detectBankFromHeader(lateMention), null, 'au-delà des trois premières lignes, rien ne fait foi');
});

test('les alias ATB sont strictement listés : ATLANTIQUE BANK et ATLANTIK BANK', () => {
  assert.equal(detectBankFromFileName('7-ATLANTIK BANK 2026 (Réparé).xlsx'), 'ATB');
  assert.equal(detectBankFromFileName('Rapport ATLANTIQUE BANK.xlsx'), 'ATB');
  assert.equal(detectBankFromHeader('ATLANTIQUE BANK\nDate'), 'ATB');
  assert.equal(detectBankFromHeader('ATLANTIC BANK\nDate'), null, 'variante non listée refusée');
  assert.equal(detectBankFromFileName('ATLANTIC BANK.xlsx'), null);
});
