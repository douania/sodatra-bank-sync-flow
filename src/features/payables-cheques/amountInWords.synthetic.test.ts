import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AmountInWordsRangeError, amountInWordsFr, chequeAmountWords, groupDigits } from './amountInWords';
import { readSqlCorpus } from './sqlCorpus';

const sqlCorpus = readFileSync(
  new URL('../../../supabase/tests/payables_cheques_core/15_amount_words_corpus.sql', import.meta.url),
  'utf8',
);

test('le montant en lettres est identique au serveur sur tout le corpus commun', () => {
  const corpus = readSqlCorpus(sqlCorpus, 'WORDS');
  assert.ok(corpus.length >= 40, `corpus trop court (${corpus.length})`);
  for (const [amount, words] of corpus) {
    assert.equal(amountInWordsFr(amount as number), words, `montant ${amount}`);
  }
});

test('les règles d’accord des montants ronds sont respectées', () => {
  assert.equal(amountInWordsFr(80), 'quatre-vingts');
  assert.equal(amountInWordsFr(80_000), 'quatre-vingt mille');
  assert.equal(amountInWordsFr(80_000_000), 'quatre-vingts millions');
  assert.equal(amountInWordsFr(300), 'trois cents');
  assert.equal(amountInWordsFr(300_000), 'trois cent mille');
  assert.equal(amountInWordsFr(300_000_000), 'trois cents millions');
  assert.equal(amountInWordsFr(1_000), 'mille');
  assert.equal(amountInWordsFr(1_000_000), 'un million');
});

test('hors bornes, décimales ou valeurs non entières : refus fermé, jamais un libellé approché', () => {
  for (const value of [-1, 0.5, 10.25, 1_000_000_000_000, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => amountInWordsFr(value), AmountInWordsRangeError, String(value));
  }
});

test('libellé imprimé avec suffixe et casse du profil, chiffres groupés', () => {
  assert.equal(chequeAmountWords(1_000_000, 'francs CFA', 'UPPER'), 'UN MILLION FRANCS CFA');
  assert.equal(chequeAmountWords(21, 'francs CFA', 'AS_IS'), 'vingt et un francs CFA');
  assert.equal(groupDigits(1_234_567), '1 234 567');
  assert.equal(groupDigits(999), '999');
  assert.equal(groupDigits(1000), '1 000');
});
