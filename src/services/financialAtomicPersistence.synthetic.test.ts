import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { BankReport, FundPosition } from '@/types/banking';
import {
  buildBankReportAtomicPayloads,
  buildFundPositionInsertPayloads,
  createFinancialWriteCommandKey,
  sanitizeBankReportAmount,
} from './financialAtomicPersistence';

function bankReport(overrides: Partial<BankReport> = {}): BankReport {
  return {
    bank: 'SYNTH BANK',
    date: '2026-08-11',
    openingBalance: -1_000,
    closingBalance: 250,
    bankFacilities: [],
    depositsNotCleared: [],
    impayes: [],
    ...overrides,
  };
}

function fundPosition(overrides: Partial<FundPosition> = {}): FundPosition {
  return {
    reportDate: '2026-08-11',
    totalFundAvailable: -2_000,
    collectionsNotDeposited: 500,
    grandTotal: -1_500,
    ...overrides,
  };
}

test('génère une clé UUID sécurisée injectable et refuse tout fallback faible', () => {
  const expected = '00000000-0000-4000-8000-000000000001';
  assert.equal(createFinancialWriteCommandKey({ randomUUID: () => expected }), expected);
  assert.throws(
    () => createFinancialWriteCommandKey(null),
    /UUID sécurisé indisponible/,
  );
});

test('construit le payload bancaire complet sans identifiants enfants fabriqués', () => {
  const payload = buildBankReportAtomicPayloads(bankReport({
    bankFacilities: [{ facilityType: 'SYNTH', limitAmount: 100, usedAmount: 40, availableAmount: 60 }],
    depositsNotCleared: [{ dateDepot: '2026-08-10', typeReglement: 'VIREMENT', montant: 25 }],
    impayes: [{ dateEcheance: '2026-08-09', clientCode: 'SYNTH-1', montant: 15 }],
  }));

  assert.equal(payload.reportRow.opening_balance, -1_000);
  assert.equal(payload.facilityRows.length, 1);
  assert.equal(payload.depositRows[0].date_valeur, null);
  assert.equal(payload.impayeRows[0].description, null);
  assert.equal('bank_report_id' in payload.facilityRows[0], false);
});

test('refuse tout montant bancaire non fini ou hors entier sûr avant RPC', () => {
  assert.throws(() => sanitizeBankReportAmount(Number.NaN, 'opening_balance'), /invalide/);
  assert.throws(
    () => sanitizeBankReportAmount(Number.MAX_SAFE_INTEGER + 1, 'closing_balance'),
    /hors bornes sûres/,
  );
});

test('préserve le signe et canonicalise les champs Fund Position optionnels', () => {
  const payload = buildFundPositionInsertPayloads(fundPosition({
    depositForDay: 0,
    paymentForDay: -250,
  }));

  assert.equal(payload.fundPositionRow.total_fund_available, -2_000);
  assert.equal(payload.fundPositionRow.deposit_for_day, 0);
  assert.equal(payload.fundPositionRow.payment_for_day, -250);
});

test('les deux sauvegardes runtime utilisent une seule RPC et une clé stable par retry', () => {
  const source = readFileSync(new URL('./databaseService.ts', import.meta.url), 'utf8');
  const bankMethod = source.slice(source.indexOf('async saveBankReport'), source.indexOf('async saveFundPosition'));
  const fundMethod = source.slice(source.indexOf('async saveFundPosition'), source.indexOf('async getTotalCollections'));

  assert.match(bankMethod, /createFinancialWriteCommandKey\(\)[\s\S]*executeWithRetry/);
  assert.match(bankMethod, /rpc\('save_bank_report_atomic_v1'/);
  assert.doesNotMatch(bankMethod, /\.from\('bank_reports'\)|\.from\('bank_facilities'\)/);
  assert.match(fundMethod, /createFinancialWriteCommandKey\(\)[\s\S]*executeWithRetry/);
  assert.match(fundMethod, /rpc\('save_fund_position_atomic_v1'/);
  assert.doesNotMatch(fundMethod, /\.from\('fund_position'\)|\.from\('fund_position_detail'\)/);
});

test('la migration ferme les RPC à PUBLIC, anon et service_role', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260811000000_ops_core_2_atomic_financial_writes.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /SECURITY DEFINER/g);
  assert.match(migration, /SET search_path = public, auth, pg_temp/g);
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role/g);
  assert.match(migration, /TO authenticated/g);
  assert.match(migration, /has_role\(v_actor, 'admin'/);
  assert.match(migration, /has_role\(v_actor, 'manager'/);
});

test('la migration borne les enfants et protège les clés de payload', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260811000000_ops_core_2_atomic_financial_writes.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /BANK_REPORT_CHILD_LIMIT_EXCEEDED/);
  assert.match(migration, /FUND_POSITION_CHILD_LIMIT_EXCEEDED/);
  assert.match(migration, /BANK_REPORT_KEYS_INVALID/);
  assert.match(migration, /FUND_POSITION_KEYS_INVALID/);
  assert.match(migration, /BANK_REPORT_VALUES_INVALID/);
  assert.match(migration, /FUND_POSITION_VALUES_INVALID/);
  assert.match(migration, /::numeric <> trunc/g);
});

test('le ledger idempotent est privé, sous RLS et verrouillé par commande', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260811000000_ops_core_2_atomic_financial_writes.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /financial_write_commands ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.financial_write_commands/);
  assert.match(migration, /ON CONFLICT DO NOTHING/g);
  assert.match(migration, /FOR UPDATE/g);
  assert.match(migration, /FINANCIAL_COMMAND_PAYLOAD_MISMATCH/g);
});
