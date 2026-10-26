import assert from 'node:assert/strict';
import test from 'node:test';
import {
  balanceDisplay,
  circulationDisplay,
  displayText,
  dueBucket,
  groupInvoicesByDue,
  indicativeDisplay,
  positionDates,
  positionKindLabel,
  reasonLabel,
  type AccountPositionRow,
  type InvoiceOverviewRow,
} from './operationalPositionModel';
import { payablesErrorCode, payablesErrorMessage, toPayablesError } from './payablesErrors';
import { validatePayablesRuntimeTarget } from './payablesRuntimeTarget';
import { buildWorkQueue, WORK_ITEM_LABELS } from './payablesWorkQueueModel';
import { allowedExitKinds, buildChequeRegister } from './chequeRegisterModel';
import type { ChequeFormRow, IssuanceRow } from './payablesChequesTypes';

function position(overrides: Partial<AccountPositionRow> = {}): AccountPositionRow {
  return {
    account_id: 'a', bank: 'BDK', account_alias: 'Compte fictif', currency: 'XOF', as_of: '2026-10-26', is_historical: false,
    current_state_date: '2026-10-26', last_statement_date: '2026-10-05',
    bank_balance: 5_000_000, balance_status: 'AVAILABLE', register_status: 'COMPLETE', takeover_cutoff: '2026-09-30',
    bank_qualified: true, coverage_status: 'PROVEN', coverage_issue_date: null, circulation_count: 1, circulation_amount: 40_000,
    circulation_unknown_count: 0, circulation_at_statement_amount: 40_000, unreflected_cheques_count: 1,
    unreflected_cheques_amount: 40_000, engaged_not_debited_amount: 40_000, transfers_pending_count: 1,
    transfers_pending_amount: 1000, pending_bank_items: 0, stale_match_evidence: 0, open_blocking_exceptions: 0,
    indicative_position: 4_960_000, indicative_reasons: [], ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceOverviewRow>): InvoiceOverviewRow {
  return {
    invoice_id: 'i', supplier_id: 's', supplier_name: 'Fournisseur fictif', reference_exact: 'R-1', collision_ordinal: 0,
    amount: 1000, currency: 'XOF', invoice_date: null, due_date: null, reserved_amount: 0, engaged_amount: 0,
    remaining_amount: 1000, blocked: false, row_version: 1, ...overrides,
  };
}

test('solde, circulation et position indicative : jamais un zéro de substitution', () => {
  assert.equal(displayText(balanceDisplay(position())).replace(new RegExp('[' + String.fromCharCode(0x202f, 0xa0) + ']', 'g'), ' '), '5 000 000 XOF');
  const unavailable = balanceDisplay(position({ bank_balance: null, balance_status: 'UNIT_NEEDS_REVIEW' }));
  assert.deepEqual(unavailable, { kind: 'unavailable', reason: 'dernier relevé en revue' });
  assert.equal(circulationDisplay(position({ circulation_amount: null })).kind, 'unavailable');
  const blocked = indicativeDisplay(position({ indicative_position: null, indicative_reasons: ['REGISTER_INCOMPLETE', 'BANK_FOLLOWUP_PENDING'] }));
  assert.equal(blocked.kind, 'unavailable');
  assert.match(displayText(blocked), /^Indisponible — reprise non attestée exhaustive ; suivi bancaire non à jour$/);
  // Une valeur sans motif mais aussi avec motif n'est jamais affichée.
  assert.equal(indicativeDisplay(position({ indicative_reasons: ['COVERAGE_UNPROVEN'] })).kind, 'unavailable');
});

test('chaque projection porte sa date ; une position historique n’est jamais « actuelle »', () => {
  const dates = positionDates(position());
  assert.equal(dates.balance, 'au relevé du 2026-10-05');
  assert.equal(dates.circulation, 'au 2026-10-26');
  assert.equal(dates.indicative, 'au 2026-10-26, sur le relevé du 2026-10-05');
  assert.equal(dates.current, 'état au 2026-10-26');
  assert.equal(positionKindLabel(position()), 'Position indicative au 2026-10-26');
  assert.equal(positionKindLabel(position({ as_of: '2026-10-02', is_historical: true })), 'Position historique au 2026-10-02');
  for (const code of ['COVERAGE_BROKEN', 'COVERAGE_UNPROVEN', 'MATCH_EVIDENCE_STALE']) {
    assert.notEqual(reasonLabel(code), code, `${code} has a closed label`);
  }
  assert.ok(WORK_ITEM_LABELS.MATCH_EVIDENCE_STALE);
});

function form(overrides: Partial<ChequeFormRow>): ChequeFormRow {
  return {
    id: 'f', bank_account_id: 'acc', cheque_number: '0000001', payment_id: 'p', provenance: 'NATIVE', state: 'ISSUED',
    presigned: false, unused_reason: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    row_version: 1, ...overrides,
  };
}

test('registre : reprise et émissions sans paiement consultables, zéros conservés', () => {
  const forms = [
    form({ id: 'native', cheque_number: '0000003' }),
    form({ id: 'takeover', cheque_number: '0000001', payment_id: null, provenance: 'TAKEOVER' }),
    form({ id: 'exception', cheque_number: '0000002', payment_id: null, provenance: 'EXCEPTION' }),
    form({ id: 'unused', cheque_number: '0000004', state: 'UNUSED' }),
  ];
  const issuances: IssuanceRow[] = [
    { id: 'i1', form_id: 'takeover', revision_no: 1, path: 'TAKEOVER', issue_date: '2026-09-20', amount: 7000, recorded_at: 'x' },
    { id: 'i2', form_id: 'exception', revision_no: 1, path: 'EXCEPTION', issue_date: '2026-10-20', amount: null, recorded_at: 'x' },
    { id: 'i3', form_id: 'exception', revision_no: 2, path: 'EXCEPTION', issue_date: '2026-10-20', amount: 9000, recorded_at: 'y' },
  ];
  const circulation = buildChequeRegister(forms, issuances, [], [], 'CIRCULATION');
  assert.deepEqual(circulation.map((e) => e.form.cheque_number), ['0000001', '0000002', '0000003']);
  assert.equal(circulation[1].issuance?.amount, 9000, 'latest revision of the issuance');
  assert.deepEqual(buildChequeRegister(forms, issuances, [], [], 'WITHOUT_PAYMENT').map((e) => e.form.id), ['takeover', 'exception']);
  assert.equal(buildChequeRegister(forms, issuances, [], [], 'ALL').length, 4);
  assert.deepEqual(allowedExitKinds(circulation[0]), ['CANCELLATION', 'CORRECTION'], 'no replacement without a payment');
  assert.deepEqual(allowedExitKinds(circulation[2]), ['CANCELLATION', 'REPLACEMENT', 'CORRECTION']);
  assert.deepEqual(allowedExitKinds(buildChequeRegister(forms, issuances, [], [], 'ALL')[3]), []);
});

test('échéances : inconnue conservée, aucune facture couverte comptée deux fois', () => {
  assert.equal(dueBucket(null, '2026-10-26'), 'UNKNOWN');
  assert.equal(dueBucket('2026-10-25', '2026-10-26'), 'OVERDUE');
  assert.equal(dueBucket('2026-11-02', '2026-10-26'), 'WITHIN_7_DAYS');
  assert.equal(dueBucket('2026-11-25', '2026-10-26'), 'WITHIN_30_DAYS');
  assert.equal(dueBucket('2026-12-26', '2026-10-26'), 'LATER');
  const groups = groupInvoicesByDue([
    invoice({ invoice_id: 'covered', engaged_amount: 1000, remaining_amount: 0, due_date: '2026-10-20' }),
    invoice({ invoice_id: 'partial', amount: 1000, engaged_amount: 400, remaining_amount: 600, due_date: '2026-10-20' }),
    invoice({ invoice_id: 'unknown-due', remaining_amount: 300, due_date: null }),
    invoice({ invoice_id: 'blocked', remaining_amount: null, blocked: true, due_date: null }),
  ], '2026-10-26');
  assert.deepEqual(groups.map((g) => g.bucket), ['OVERDUE', 'UNKNOWN']);
  assert.deepEqual(groups[0].invoices.map((i) => i.invoice_id), ['partial']);
  assert.equal(groups[0].remainingByCurrency.XOF, 600);
  assert.equal(groups[1].remainingByCurrency.XOF, null, 'blocked remaining is unavailable, never zero');
});

test('aucun total ne mélange deux devises', () => {
  const groups = groupInvoicesByDue([
    invoice({ invoice_id: 'x', currency: 'XOF', remaining_amount: 100 }),
    invoice({ invoice_id: 'e', currency: 'EUR', remaining_amount: 7 }),
  ], '2026-10-26');
  assert.deepEqual(groups[0].remainingByCurrency, { XOF: 100, EUR: 7 });
});

test('vocabulaire fermé des refus : jamais le texte serveur brut', () => {
  const raw = { message: 'PAYABLES_INVOICE_BLOCKED détail SENTINELLE-CLIENT' };
  assert.equal(payablesErrorCode(raw), 'PAYABLES_INVOICE_BLOCKED');
  const error = toPayablesError(raw);
  assert.equal(error.code, 'PAYABLES_INVOICE_BLOCKED');
  assert.doesNotMatch(error.message, /SENTINELLE/);
  assert.equal(payablesErrorCode('permission denied SENTINELLE'), null);
  assert.doesNotMatch(toPayablesError('permission denied SENTINELLE').message, /SENTINELLE/);
  assert.match(payablesErrorMessage('PAYABLES_CAPABILITY_REQUIRED'), /habilitation/);
});

test('cible d’exécution : production refusée, staging exact, local sur drapeau', () => {
  const prod = validatePayablesRuntimeTarget({ supabaseUrl: 'https://leakcdbbawzysfqyqsnr.supabase.co', projectId: 'leakcdbbawzysfqyqsnr',
    stagingEnabled: 'true', localEnabled: 'true' });
  assert.equal(prod.allowed, false);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'https://gbbsqcscryygqlmqncyv.supabase.co',
    projectId: 'gbbsqcscryygqlmqncyv', stagingEnabled: 'true' }).allowed, true);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'https://gbbsqcscryygqlmqncyv.supabase.co',
    projectId: 'gbbsqcscryygqlmqncyv' }).allowed, false);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'https://gbbsqcscryygqlmqncyv.supabase.co/rest',
    projectId: 'gbbsqcscryygqlmqncyv', stagingEnabled: 'true' }).allowed, false);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'http://localhost:54321', localEnabled: 'true' }).allowed, true);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'http://localhost:54321' }).allowed, false);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'http://localhost:54321', localEnabled: 'true',
    projectId: 'leakcdbbawzysfqyqsnr' }).allowed, false);
  assert.equal(validatePayablesRuntimeTarget({ supabaseUrl: 'not a url' }).allowed, false);
});

test('file de travail : ancienneté et verrous visibles', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const items = buildWorkQueue([
    { item_type: 'EXCEPTION_OPEN', object_id: 'e', related_id: null, since: '2026-10-20T08:00:00Z', lock_holder: 'u2',
      lock_expires_at: '2026-10-26T12:30:00Z' },
    { item_type: 'PAYMENT_TO_PRINT', object_id: 'p', related_id: 'i', since: '2026-10-25T08:00:00Z', lock_holder: 'u1',
      lock_expires_at: '2026-10-26T11:00:00Z' },
  ], 'u1', now);
  assert.deepEqual(items.map((i) => [i.item_type, i.ageDays, i.lockedByOther, i.lockedByMe]),
    [['EXCEPTION_OPEN', 6, true, false], ['PAYMENT_TO_PRINT', 1, false, false]]);
});
