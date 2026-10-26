import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chequeGrammarVersion, extractChequeReference, QUALIFIED_CHEQUE_BANKS } from './bankChequeGrammar';
import { readSqlCorpus } from './sqlCorpus';

const sqlTest = readFileSync(
  new URL('../../../supabase/tests/payables_cheques_core/60_bank_followup_position.sql', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../../supabase/migrations/20261026090100_payables_cheques_bank_followup.sql', import.meta.url),
  'utf8',
);

test('les grammaires TypeScript et SQL donnent le même résultat sur le corpus commun', () => {
  const corpus = readSqlCorpus(sqlTest, 'CORPUS');
  assert.ok(corpus.length >= 20, `corpus trop court (${corpus.length})`);
  for (const [bank, label, outcome, reference] of corpus) {
    const result = extractChequeReference(bank as string, label as string);
    assert.equal(result.outcome, outcome, `${bank} ${JSON.stringify(label)}`);
    assert.equal(result.referenceText, reference, `${bank} ${JSON.stringify(label)}`);
  }
});

test('les familles et versions déclarées sont identiques des deux côtés', () => {
  assert.deepEqual([...QUALIFIED_CHEQUE_BANKS], ['BDK', 'ORA', 'ATB', 'BICIS']);
  assert.match(migration, /p_bank IN \('BDK','ORA','ATB','BICIS'\)/);
  for (const family of ['BDK_CHEQUE_RECU_COMPENSE', 'ORA_CHQ_RECU_COMPENSE', 'ATB_REGLMT_CHEQUE_COMPENSE', 'BICIS_REGLMT_CHQ_COMPENSE']) {
    assert.ok(migration.includes(`'${family}'`), family);
  }
  assert.equal(chequeGrammarVersion('BDK'), 'PCG-BDK-V1');
  assert.equal(chequeGrammarVersion('BIS'), 'PCG-BIS-NOT-QUALIFIED');
  assert.equal(chequeGrammarVersion(undefined), 'PCG-UNKNOWN-NOT-QUALIFIED');
});

test('frais, retraits, formes inconnues et nombres concurrents ne produisent jamais de référence', () => {
  const cases: Array<[string, string]> = [
    ['BICIS', 'FRAIS SUR CHEQUE NO 0654321 CHEQUE NO 0654321'],
    ['BDK', 'RETRAIT ESPECES GUICHET CHQ N X 0123456'],
    ['BDK', 'CHEQUE DE GUICHET N 123456 FICTIF'],
    ['ORA', 'CHQ RECU COMPENSE 0012345 CHQ OCI N. 0012346'],
    ['BIS', 'CHÈQUE PAYE CHQ 0000123456'],
    ['BRIDGE', 'PAIEMENT CHQ NO 0123456 789012345678'],
    ['NSIA', 'CHQ 0123456'],
    ['SGBS', 'CHQ 0123456'],
  ];
  for (const [bank, label] of cases) {
    assert.equal(extractChequeReference(bank, label).referenceText, null, `${bank} ${label}`);
  }
});

test('les zéros initiaux sont conservés et aucune conversion numérique n’est faite', () => {
  const result = extractChequeReference('ATB', 'REGLMT CHEQUE COMPENSE CHEQUE REF 0000007');
  assert.equal(result.referenceText, '0000007');
  assert.equal(typeof result.referenceText, 'string');
  assert.equal(extractChequeReference('ATB', 'REGLMT CHEQUE COMPENSE CHEQUE REF 7').outcome, 'NO_REFERENCE');
});

test('le texte suivant FAVEUR (bénéficiaire) n’est jamais une source de numéro', () => {
  const result = extractChequeReference('BICIS', 'REGLMT CHQ COMPENSE NO 0654321 FAVEUR SOCIETE 1234567');
  assert.equal(result.referenceText, '0654321');
});
