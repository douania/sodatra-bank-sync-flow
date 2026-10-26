import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chequeAmountWords, groupDigits } from './amountInWords';
import { layoutCheque, wrapWords, type ChequeContentFields } from './chequeLayout';

const profile = {
  profile_code: 'ORA_CHQ_170X95',
  bank: 'ORA',
  state: 'ACTIVE',
  page: { width_mm: 170, height_mm: 95 },
  font: { family: 'Courier New', size_pt: 10 },
  offset: { x_mm: 1.5, y_mm: -0.5 },
  fields: {
    beneficiary: { x_mm: 25, y_mm: 38, max_chars: 48 },
    amount_figures: { x_mm: 130, y_mm: 18, max_chars: 18 },
    amount_words: { x_mm: 25, y_mm: 26, max_chars: 60, lines: 2, line_gap_mm: 6 },
    issue_date: { x_mm: 130, y_mm: 48, max_chars: 10 },
    place: { x_mm: 100, y_mm: 48, max_chars: 20 },
  },
  place_label: 'Dakar',
  amount_words_suffix: 'francs CFA',
  amount_words_case: 'UPPER' as const,
  printer_model: 'Synthetic laser printer',
};

function fields(amount: number, beneficiary = 'Bénéficiaire fictif'): ChequeContentFields {
  const words = chequeAmountWords(amount, 'francs CFA', 'UPPER');
  return {
    account: '00000000-0000-4000-8000-000000000000',
    cheque_number: '0001234',
    currency: 'XOF',
    beneficiary,
    amount: String(amount),
    amount_figures: groupDigits(amount),
    amount_words: words,
    amount_words_lines: wrapWords(words, 60) ?? [],
    issue_date: '2026-10-25',
    issue_date_text: '25/10/2026',
    place: 'Dakar',
    profile_code: 'ORA_CHQ_170X95',
    profile_version_id: '00000000-0000-4000-8000-000000000001',
  };
}

test('seuls les champs à remplir sont positionnés, décalage de calibration appliqué', () => {
  const result = layoutCheque(fields(250_000), profile);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.page, { width_mm: 170, height_mm: 95 });
  assert.deepEqual(result.items.map((i) => i.key).sort(),
    ['amount_figures', 'amount_words_1', 'beneficiary', 'issue_date', 'place'].sort());
  const beneficiary = result.items.find((i) => i.key === 'beneficiary');
  assert.deepEqual(beneficiary, { key: 'beneficiary', text: 'Bénéficiaire fictif', x_mm: 26.5, y_mm: 37.5 });
  assert.ok(!result.items.some((i) => /signature|account|cheque_number/.test(i.key)), 'no signature, no pre-printed field');
});

test('montant long sur deux lignes, interligne du profil', () => {
  const result = layoutCheque(fields(1_234_567), profile);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const lines = result.items.filter((i) => i.key.startsWith('amount_words_'));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].y_mm - lines[0].y_mm, 6);
});

test('débordement refusé : aucun aperçu tronqué', () => {
  assert.deepEqual(layoutCheque(fields(777_777_777), profile), { ok: false, reason: 'PAYABLES_PRINT_LAYOUT_OVERFLOW' });
  assert.deepEqual(layoutCheque(fields(1000, 'B'.repeat(49)), profile), { ok: false, reason: 'PAYABLES_PRINT_LAYOUT_OVERFLOW' });
});

test('profil incomplet ou découpage divergent du serveur : refus', () => {
  assert.deepEqual(layoutCheque(fields(1000), { ...profile, fields: { ...profile.fields, place: undefined } }),
    { ok: false, reason: 'PAYABLES_PRINT_PROFILE_INVALID' });
  const divergent = { ...fields(1000), amount_words_lines: ['MILLE', 'FRANCS CFA'] };
  assert.deepEqual(layoutCheque(divergent, profile), { ok: false, reason: 'PAYABLES_PRINT_PROFILE_INVALID' });
});

test('le découpage glouton est identique à payables_private.wrap_words', () => {
  assert.deepEqual(wrapWords('UN DEUX TROIS', 7), ['UN DEUX', 'TROIS']);
  assert.equal(wrapWords('ABCDEFGH', 7), null);
  const migration = readFileSync(
    new URL('../../../supabase/migrations/20261026090000_payables_cheques_core.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE FUNCTION payables_private\.wrap_words/);
  assert.match(migration, /char_length\(v_current\) \+ 1 \+ char_length\(v_word\) <= p_max/);
});
