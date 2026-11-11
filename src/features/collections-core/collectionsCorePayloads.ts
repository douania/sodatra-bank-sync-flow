import type { CollectionEntryInput, CreditLine, EvidenceBasis } from './collectionsCoreTypes';

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} est obligatoire.`);
  return normalized;
}

function positiveAmount(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} doit être positif.`);
  return Math.round(value * 100) / 100;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildCollectionEntryPayload(input: CollectionEntryInput) {
  const amount = positiveAmount(input.amount, 'Le montant');
  const currency = requiredText(input.currency, 'La devise').toUpperCase();
  const instrumentRequired = input.method === 'CHECK' || input.method === 'EFFECT';
  const instrumentReference = input.method === 'CHECK'
    ? requiredText(input.instrumentReference, 'Le numéro du chèque')
    : input.instrumentReference.trim();
  if (input.method === 'EFFECT') requiredText(input.maturityDate, 'L’échéance de l’effet');
  const identityMaterial = [
    input.method,
    instrumentReference.toUpperCase(),
    input.clientBank.trim().toUpperCase(),
    amount.toFixed(2),
    currency,
    input.maturityDate,
  ].join('|');

  return {
    receipt: {
      client_name: requiredText(input.clientName, 'Le client'),
      receipt_method: input.method,
      expected_amount: amount,
      currency,
      client_bank: input.clientBank.trim(),
      declared_credit_date: input.declaredCreditDate,
      source_report_date: input.depositDate,
      business_nature: input.businessNature,
      display_note: input.note.trim(),
    },
    remittance: {
      deposit_account_id: requiredText(input.depositAccountId, 'La banque de dépôt'),
      deposit_currency: currency,
      declared_total_amount: amount,
      deposit_date: requiredText(input.depositDate, 'La date de remise'),
      slip_reference: input.slipReference.trim(),
      remittance_kind:
        input.method === 'TRANSFER'
          ? 'LOGICAL_TRANSFER'
          : input.method === 'CASH'
            ? 'LOGICAL_CASH'
            : 'PHYSICAL',
      capture_mode: 'MANUAL',
      document_metadata: {},
    },
    item: {
      item_amount: amount,
      currency,
      instrument: instrumentRequired
        ? {
            instrument_type: input.method,
            identity_namespace: `${input.method}:${input.clientBank.trim().toUpperCase() || 'BANQUE_INCONNUE'}`,
            normalized_identity_hash: await sha256(identityMaterial),
            identity_strength:
              instrumentReference && input.clientBank.trim() ? 'STRONG_VERIFIED' : 'PROBABILISTIC',
            instrument_reference: instrumentReference,
            drawn_bank: input.clientBank.trim(),
            client_name: input.clientName.trim(),
            nominal_amount: amount,
            currency,
            maturity_date: input.method === 'EFFECT' ? input.maturityDate : '',
          }
        : null,
    },
  };
}

export function buildMatchPayload(input: {
  itemId: string;
  creditLine: CreditLine;
  creditConsumedAmount: number;
  settledGrossAmount: number;
  evidenceBasis: EvidenceBasis;
  reason: string;
}) {
  const credit = positiveAmount(input.creditConsumedAmount, 'Le crédit consommé');
  const gross = positiveAmount(input.settledGrossAmount, 'Le montant réglé');
  const fee = input.evidenceBasis === 'NET_OF_DISCOUNT' ? Math.round((gross - credit) * 100) / 100 : 0;
  if (fee < 0) throw new Error('Le montant net crédité ne peut pas dépasser le montant réglé.');
  if (input.evidenceBasis === 'EXACT_CREDIT' && gross !== credit) {
    throw new Error('Un rapprochement exact exige des montants identiques.');
  }

  return {
    credit_daily_line_id: requiredText(input.creditLine.id, 'La ligne bancaire'),
    expected_canonical_unit_id: input.creditLine.canonicalUnitId,
    expected_daily_line_hash: input.creditLine.dailyLineHash,
    expected_account_registry_id: input.creditLine.accountId,
    expected_accounting_date: input.creditLine.accountingDate,
    expected_credit_amount: input.creditLine.amount,
    expected_currency: input.creditLine.currency,
    expected_source_attempt_id: input.creditLine.sourceAttemptId,
    expected_source_raw_text_hash: input.creditLine.sourceRawTextHash,
    proposed_credit_consumed_amount: credit,
    proposed_fee_consumed_amount: 0,
    evidence_basis: input.evidenceBasis,
    allocation_mode: 'SINGLE_ITEM',
    reason: requiredText(input.reason, 'La justification'),
    fee_evidence_plan: [],
    allocation_plan: [
      {
        remittance_item_id: requiredText(input.itemId, 'La remise'),
        credit_line_consumed_amount: credit,
        settled_gross_amount: gross,
        observed_fee_amount: fee,
      },
    ],
  };
}
