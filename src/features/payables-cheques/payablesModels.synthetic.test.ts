import assert from 'node:assert/strict';
import test from 'node:test';
import {
  balanceDisplay,
  circulationDisplay,
  displayText,
  dueBucket,
  groupInvoicesByDue,
  indicativeDisplay,
  type AccountPositionRow,
  type InvoiceOverviewRow,
} from './operationalPositionModel';
import { payablesErrorCode, payablesErrorMessage, toPayablesError } from './payablesErrors';
import { validatePayablesRuntimeTarget } from './payablesRuntimeTarget';
import { buildWorkQueue } from './payablesWorkQueueModel';

function position(overrides: Partial<AccountPositionRow> = {}): AccountPositionRow {
  return {
    account_id: 'a', bank: 'BDK', account_alias: 'Compte fictif', currency: 'XOF', last_statement_date: '2026-10-05',
    bank_balance: 5_000_000, balance_status: 'AVAILABLE', register_status: 'COMPLETE', takeover_cutoff: '2026-09-30',
    bank_qualified: true, circulation_count: 1, circulation_amount: 40_000, circulation_unknown_count: 0,
    circulation_at_statement_amount: 40_000, engaged_not_debited_amount: 40_000, transfers_pending_count: 1,
    transfers_pending_amount: 1000, pending_bank_items: 0, open_blocking_exceptions: 0, coverage_gap_days: 3,
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
  assert.equal(indicativeDisplay(position({ indicative_reasons: ['COVERAGE_GAP'] })).kind, 'unavailable');
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
