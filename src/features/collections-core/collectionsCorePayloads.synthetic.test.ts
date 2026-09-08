import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCollectionEntryPayload, buildMatchPayload } from './collectionsCorePayloads';
import type { CollectionEntryInput, CreditLine } from './collectionsCoreTypes';

const base: CollectionEntryInput = {
  clientName: 'CLIENT TEST', method: 'CHECK', amount: 100_000, currency: 'XOF',
  clientBank: 'BANQUE CLIENT', depositAccountId: '11111111-1111-4111-8111-111111111111',
  depositDate: '2026-08-04', declaredCreditDate: '', instrumentReference: 'CHQ-42',
  maturityDate: '', invoiceReference: 'FAC-01', slipReference: 'BR-01',
  businessNature: 'STANDARD', note: '',
};

const creditLine: CreditLine = {
  id: '22222222-2222-4222-8222-222222222222',
  canonicalUnitId: '33333333-3333-4333-8333-333333333333',
  dailyLineHash: 'a'.repeat(64), accountingDate: '2026-08-05', valueDate: '2026-08-05',
  description: 'CREDIT SYNTHETIQUE', amount: 97_500, unallocatedAmount: 97_500, currency: 'XOF',
  accountId: '44444444-4444-4444-8444-444444444444',
  sourceAttemptId: '55555555-5555-4555-8555-555555555555', sourceRawTextHash: 'b'.repeat(64),
  referenceSignal: 'REFERENCE_NOT_FOUND', reasonCodes: ['EXACT_ACCOUNT', 'EXACT_CURRENCY'],
};

test('transpose les colonnes métier dans les contrats Core', async () => {
  const payload = await buildCollectionEntryPayload(base);
  assert.equal(payload.receipt.client_name, 'CLIENT TEST');
  assert.equal(payload.receipt.client_bank, 'BANQUE CLIENT');
  assert.equal(payload.remittance.deposit_account_id, base.depositAccountId);
  assert.equal(payload.remittance.deposit_date, '2026-08-04');
  assert.equal(payload.item.instrument?.instrument_reference, 'CHQ-42');
  assert.match(payload.item.instrument?.normalized_identity_hash ?? '', /^[0-9a-f]{64}$/);
});

test('un effet conserve sa date d’échéance', async () => {
  const payload = await buildCollectionEntryPayload({ ...base, method: 'EFFECT', instrumentReference: '', maturityDate: '2026-09-30' });
  assert.equal(payload.item.instrument?.instrument_type, 'EFFECT');
  assert.equal(payload.item.instrument?.maturity_date, '2026-09-30');
  assert.equal(payload.item.instrument?.identity_strength, 'PROBABILISTIC');
});

test('virement et espèces ne fabriquent pas de titre', async () => {
  for (const method of ['TRANSFER', 'CASH'] as const) {
    const payload = await buildCollectionEntryPayload({ ...base, method, instrumentReference: '' });
    assert.equal(payload.item.instrument, null);
    assert.equal(payload.remittance.remittance_kind, method === 'TRANSFER' ? 'LOGICAL_TRANSFER' : 'LOGICAL_CASH');
  }
});

test('le crédit au nominal exige l’égalité des montants', () => {
  assert.throws(() => buildMatchPayload({ itemId: 'item', creditLine, creditConsumedAmount: 90, settledGrossAmount: 100, evidenceBasis: 'EXACT_CREDIT', reason: 'preuve' }));
});

test('le crédit net conserve la retenue bancaire observée séparément', () => {
  const payload = buildMatchPayload({ itemId: 'item', creditLine, creditConsumedAmount: 97_500, settledGrossAmount: 100_000, evidenceBasis: 'NET_OF_DISCOUNT', reason: 'crédit net après retenue bancaire' });
  assert.equal(payload.allocation_plan[0].observed_fee_amount, 2_500);
  assert.equal(payload.proposed_credit_consumed_amount, 97_500);
  assert.equal(payload.proposed_fee_consumed_amount, 0);
  assert.equal(payload.expected_daily_line_hash, creditLine.dailyLineHash);
  assert.equal(payload.expected_source_raw_text_hash, creditLine.sourceRawTextHash);
});
