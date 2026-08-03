import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionReceiptIdentity,
  missingCollectionReceiptIdentity,
} from './collectionReceiptIdentity';
import type {
  CollectionInstrumentRow,
  CollectionReceiptRow,
} from './collectionsTypes';

const commonReceipt: CollectionReceiptRow = {
  id: '11111111-1111-4111-8111-111111111111',
  source_type: 'MANUAL',
  client_reference: 'CLIENT-E2E',
  client_name_snapshot: 'CLIENT SYNTHETIQUE',
  method: 'CHEQUE',
  business_nature: 'INVOICE_SETTLEMENT',
  amount: 1000,
  currency: 'XOF',
  bank_submission_date: '2026-08-03',
  counterparty_bank_snapshot: 'BANQUE CLIENT TEST',
  deposit_account_registry_id: null,
  declared_bank_credit_date: null,
  routing_state: 'DEPOSITED',
  settlement_state: 'PENDING',
  recourse_state: 'NONE',
  version: 1,
  created_at: '2026-08-03T10:00:00Z',
};

const chequeInstrument: CollectionInstrumentRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  receipt_id: commonReceipt.id,
  instrument_type: 'CHEQUE',
  nominal_amount: 1000,
  currency: 'XOF',
  cheque_number: 'CHQ-E2E-001',
  effect_reference: null,
  maturity_date: null,
  drawee_bank_snapshot: 'BANQUE CLIENT TEST',
  settlement_state: 'PENDING',
  settled_amount: 0,
  version: 1,
  created_at: '2026-08-03T10:00:00Z',
};

test('affiche une identité métier complète et stable de la remise', () => {
  assert.equal(
    collectionReceiptIdentity(commonReceipt, [chequeInstrument]),
    'CLIENT SYNTHETIQUE · Réf. client CLIENT-E2E · Chèque · Remise 03/08/2026 · Titre CHQ-E2E-001 · ID 11111111',
  );
});

test('distingue deux remises de même client et de même montant', () => {
  const effectReceipt: CollectionReceiptRow = {
    ...commonReceipt,
    id: '22222222-2222-4222-8222-222222222222',
    method: 'EFFECT',
    bank_submission_date: '2026-08-04',
  };
  const effectInstrument: CollectionInstrumentRow = {
    ...chequeInstrument,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    receipt_id: effectReceipt.id,
    instrument_type: 'EFFECT',
    cheque_number: null,
    effect_reference: 'EFFET-E2E-001',
    maturity_date: '2026-09-30',
  };

  assert.notEqual(
    collectionReceiptIdentity(commonReceipt, [chequeInstrument, effectInstrument]),
    collectionReceiptIdentity(effectReceipt, [chequeInstrument, effectInstrument]),
  );
  assert.match(
    collectionReceiptIdentity(effectReceipt, [chequeInstrument, effectInstrument]),
    /Effet · Remise 04\/08\/2026 · Titre EFFET-E2E-001 · ID 22222222$/,
  );
});

test('rend explicite une remise liée devenue non visible', () => {
  assert.equal(
    missingCollectionReceiptIdentity('33333333-3333-4333-8333-333333333333'),
    'Remise liée non visible · ID 33333333',
  );
});
