import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  amountTextToMinorUnits,
  defaultAsOf,
  ERROR_MESSAGES,
  formatAmount,
  freshnessLabel,
  parseTreasuryBalances,
  presentConsolidation,
  reasonLabel,
  REASON_LABELS,
  treasuryErrorCode,
  TreasuryError,
  type TreasuryBalances,
} from './treasuryModel';
import { STRUCTURED_BANK_STATEMENT_EXCEL_PROFILES } from '@/services/structuredBankStatementExcelProfiles';

// Le lanceur de tests compile le JSX en React.createElement (transformation classique).
(globalThis as unknown as { React: typeof React }).React = React;
const { TreasuryBalancesView } = await import('./TreasuryBalancesView');

const FINGERPRINT = 'a'.repeat(64);

function account(overrides: Record<string, unknown>) {
  return {
    expected_account_id: '30000000-0000-4000-8000-000000000001',
    registry_account_id: '20000000-0000-4000-8000-000000000001',
    bank: 'ORA', currency: 'XOF', alias: 'ORA principal', status: 'AVAILABLE', reasons: [],
    balance_at_date: '1300.00', observed_balance: null, source_format: 'structured_bank_statement_csv',
    qualification: 'QUALIFIED', qualification_evidence: 'preuve synthétique',
    dates: { bank_date_covered: '2026-10-07', age_days: 26, bank_date_observed: '2026-10-07', balance_source_day: '2026-10-07' },
    sources: [
      { kind: 'CANONICAL_UNIT', role: 'CLOSING', unit_id: '40000000-0000-4000-8000-000000000007',
        export_id: '50000000-0000-4000-8000-000000000001', day: '2026-10-07', ingested_at: '2026-10-08T08:00:00+00:00',
        export_ingested_at: '2026-10-08T07:59:00+00:00', source_format: 'structured_bank_statement_csv' },
      { kind: 'CLOSURE_LATER_LINE', export_id: '5a000000-0000-4000-8000-000000000002', delivery: 'duplicate',
        later_line_day: '2026-10-08', export_ingested_at: '2026-10-09T07:00:00+00:00' },
      { kind: 'CHAIN_LINK', day: '2026-10-07', link: 'OK', reference_day: '2026-10-06' },
    ],
    value_dates: { total_lines: 3, lines_with_value_date: 2 },
    ...overrides,
  };
}

function result(overrides: Record<string, unknown> = {}, consolidation: Record<string, unknown> = {}): unknown {
  return {
    contract: 'treasury_balances_at_v1', as_of: '2026-10-07', today: '2026-11-02',
    read_at: '2026-11-02T10:00:00.123+00:00', timezone: 'Africa/Dakar', basis: 'ACCOUNTING_DATE',
    value_date_window_days: 90,
    inventory: { fingerprint: FINGERPRINT, active_accounts: 2, attested: true, attested_at: '2026-11-01T09:00:00+00:00',
      unlisted_registry_accounts: [] },
    accounts: [
      account({}),
      account({
        expected_account_id: '30000000-0000-4000-8000-000000000002', registry_account_id: null, bank: 'NSIA',
        alias: 'NSIA principal', status: 'NOT_COVERED', reasons: ['BANK_WITHOUT_FORMAT'], balance_at_date: null,
        source_format: null, qualification: 'NO_FORMAT', qualification_evidence: null,
        dates: { bank_date_covered: null, age_days: null, bank_date_observed: null, balance_source_day: null }, sources: [],
        value_dates: { total_lines: 0, lines_with_value_date: 0 },
      }),
    ],
    consolidation: {
      currency: 'XOF', status: 'PARTIAL', amount: '1300.00', accounts_expected: 2, accounts_available: 1,
      accounts_not_covered: 1, accounts_blocked: 0, accounts_out_of_scope: 0, registry_accounts_outside_inventory: 0,
      reasons: ['ACCOUNTS_NOT_COVERED'], ...consolidation,
    },
    ...overrides,
  };
}

test('le contrat de réponse est vérifié strictement', () => {
  const parsed = parseTreasuryBalances(result());
  assert.equal(parsed.accounts.length, 2);
  for (const broken of [
    result({ contract: 'autre' }),
    result({ basis: 'VALUE_DATE' }),
    result({}, { status: 'TOTAL' }),
    result({}, { amount: 1300 }),
    result({ accounts: [account({ balance_at_date: '1 300' })] }),
    result({ accounts: [account({ status: 'DISPONIBLE' })] }),
    result({ accounts: [account({ dates: { bank_date_covered: null, age_days: null, balance_source_day: null } })] }),
    result({ accounts: [account({ sources: [{ kind: 'CLOSURE_LATER_LINE', delivery: 'duplicate',
      later_line_day: '2026-10-08', export_ingested_at: '2026-10-09T07:00:00+00:00' }] })] }),
    result({ accounts: [account({ sources: [{ kind: 'CHAIN_LINK', day: '2026-10-07', link: 'PEUT-ETRE', reference_day: null }] })] }),
    result({ accounts: [account({ sources: [{ kind: 'AUTRE_PREUVE' }] })] }),
    null,
  ]) {
    assert.throws(() => parseTreasuryBalances(broken), (error: unknown) =>
      error instanceof TreasuryError && error.code === 'TREASURY_RESPONSE_INVALID');
  }
});

test('montants exacts, jamais zéro par défaut', () => {
  assert.equal(amountTextToMinorUnits('1300.5'), 130050n);
  assert.equal(amountTextToMinorUnits('-0.01'), -1n);
  assert.equal(amountTextToMinorUnits('9999999999999999.99'), 999999999999999999n);
  assert.equal(formatAmount(null, 'XOF'), 'Indisponible');
  assert.equal(formatAmount(undefined, 'XOF'), 'Indisponible');
  assert.notEqual(formatAmount(null, 'XOF'), formatAmount('0', 'XOF'));
  assert.throws(() => amountTextToMinorUnits('1e3'));
  assert.throws(() => amountTextToMinorUnits(''));
});

test('un sous-total partiel ou bloqué n’est jamais présenté comme un total', () => {
  const partial = presentConsolidation(parseTreasuryBalances(result()));
  assert.match(partial.headline, /^Sous-total partiel à 2026-10-07 — 1 compte sur 2$/);
  assert.equal(partial.decisionGrade, false);
  const blocked = presentConsolidation(parseTreasuryBalances(result({}, { status: 'BLOCKED', accounts_blocked: 1 })));
  assert.match(blocked.headline, /non utilisable pour décider/);
  assert.doesNotMatch(blocked.headline, /^Total/);
  const complete = presentConsolidation(parseTreasuryBalances(result({}, { status: 'COMPLETE', accounts_available: 2 })));
  assert.equal(complete.headline, 'Total à 2026-10-07');
  assert.equal(complete.decisionGrade, true);
  const none = presentConsolidation(parseTreasuryBalances(result({}, { amount: null, accounts_available: 0 })));
  assert.equal(none.amount, 'Indisponible');
});

test('chaque motif du serveur a un libellé', () => {
  // Motifs relevés dans la migration elle-même : aucun motif émis sans libellé.
  const migration = readFileSync(resolve('supabase/migrations/20261102090000_treasury_v1_lot1_bank_balances.sql'), 'utf8');
  const emitted = new Set([
    ...[...migration.matchAll(/THEN '([A-Z_]+)' END/g)].map((match) => match[1]),
    ...[...migration.matchAll(/WHEN '[A-Z_]+' THEN '([A-Z_]+)'/g)].map((match) => match[1]),
    ...[...migration.matchAll(/ELSE '([A-Z_]+)'\s+END END/g)].map((match) => match[1]),
  ]);
  for (const code of ['CHAIN_BROKEN_AFTER_DATE', 'DAY_NOT_CLOSED', 'DAY_CONTESTED', 'DAY_CONFLICT',
    'PARSER_VERSION_UNSUPPORTED', 'FORMAT_NOT_QUALIFIED', 'ACCOUNTS_BLOCKED']) {
    assert.ok(emitted.has(code), `${code} relevé dans la migration`);
  }
  assert.ok(emitted.size >= 26, `motifs relevés : ${emitted.size}`);
  for (const code of emitted) {
    assert.ok(REASON_LABELS[code], code);
  }
  assert.equal(reasonLabel('INCONNU'), 'Motif INCONNU');
  assert.ok(ERROR_MESSAGES.TREASURY_MODULE_CLOSED);
  assert.ok(migration.includes("MESSAGE = 'TREASURY_MODULE_CLOSED'"));
  assert.equal(treasuryErrorCode({ message: 'TREASURY_MODULE_CLOSED' }), 'TREASURY_MODULE_CLOSED');
});

test('les erreurs serveur sont réduites à un vocabulaire fermé', () => {
  assert.equal(treasuryErrorCode({ message: 'PAYABLES_CAPABILITY_REQUIRED:BANK_READ' }), 'PAYABLES_CAPABILITY_REQUIRED:BANK_READ');
  assert.equal(treasuryErrorCode({ message: 'TREASURY_FUTURE_DATE_FORBIDDEN' }), 'TREASURY_FUTURE_DATE_FORBIDDEN');
  assert.equal(treasuryErrorCode({ message: 'relation "x" does not exist' }), null);
  assert.equal(treasuryErrorCode('TREASURY_X'), null);
});

test('la date D par défaut est la veille à Dakar', () => {
  assert.equal(defaultAsOf(new Date('2026-11-02T10:00:00Z')), '2026-11-01');
  assert.equal(defaultAsOf(new Date('2026-03-01T00:30:00Z')), '2026-02-28');
  assert.equal(defaultAsOf(new Date('2027-01-01T00:00:00Z')), '2026-12-31');
});

test('la vue montre les comptes non couverts sans les additionner ni inventer de zéro', () => {
  const html = renderToStaticMarkup(<TreasuryBalancesView result={parseTreasuryBalances(result({
    accounts: [
      account({}),
      account({
        expected_account_id: '30000000-0000-4000-8000-000000000003', status: 'NOT_COVERED',
        reasons: ['DAY_WITHOUT_PROOF'], balance_at_date: null, observed_balance: { balance: '1150.00', date: '2026-10-05' },
      }),
    ],
  }))} />);
  assert.match(html, /Sous-total partiel à 2026-10-07/);
  assert.doesNotMatch(html, /Total à 2026-10-07/);
  assert.match(html, /Indisponible/);
  assert.match(html, /Dernier solde observé, non retenu : 1 150\.00 XOF au 2026-10-05/);
  assert.match(html, /Journée sans relevé ni preuve de couverture/);
  assert.match(html, /ne doit pas être lu comme un total/);
  assert.match(html, /date comptable/);
  assert.doesNotMatch(html, /Fund Applied/);
});

test('les preuves de clôture et de continuité sont rendues avec leurs références et leurs dates', () => {
  const html = renderToStaticMarkup(<TreasuryBalancesView result={parseTreasuryBalances(result({
    accounts: [
      account({}),
      account({
        expected_account_id: '30000000-0000-4000-8000-000000000004', dates: { bank_date_covered: '2026-10-04',
          age_days: 29, bank_date_observed: '2026-10-04', balance_source_day: '2026-10-05' },
        sources: [
          { kind: 'CANONICAL_UNIT', role: 'OPENING', unit_id: '40000000-0000-4000-8000-000000000005',
            export_id: '5b000000-0000-4000-8000-000000000003', day: '2026-10-05', ingested_at: null,
            export_ingested_at: '2026-10-06T07:00:00+00:00', source_format: 'structured_bank_statement_csv' },
          { kind: 'CHAIN_LINK', day: '2026-10-05', link: 'CONTINUOUS_GAP', reference_day: '2026-10-01' },
          { kind: 'DECLARED_PERIOD', export_id: '5b000000-0000-4000-8000-000000000003', period_start: '2026-10-04',
            period_end: '2026-10-05', closed_until: '2026-10-04', export_ingested_at: '2026-10-06T07:00:00+00:00' },
        ],
      }),
      account({
        expected_account_id: '30000000-0000-4000-8000-000000000005',
        sources: [
          { kind: 'CANONICAL_UNIT', role: 'CLOSING', unit_id: '40000000-0000-4000-8000-000000000001',
            export_id: '5c000000-0000-4000-8000-000000000004', day: '2026-10-01', ingested_at: null,
            export_ingested_at: '2026-10-02T07:00:00+00:00', source_format: 'structured_bank_statement_csv' },
          { kind: 'CLOSURE_NEXT_OPENING', unit_id: '40000000-0000-4000-8000-000000000002',
            export_id: '5d000000-0000-4000-8000-000000000005', day: '2026-10-02', ingested_at: null,
            export_ingested_at: '2026-10-04T07:00:00+00:00' },
          { kind: 'CHAIN_LINK', day: '2026-10-01', link: 'ANCHOR', reference_day: null },
        ],
      }),
    ],
  }))} />);
  assert.match(html, /Clôture du relevé du 2026-10-07 \(fichier 50000000\)/);
  assert.match(html, /Clôture prouvée par le fichier 5a000000 \(relivraison, ligne ultérieure du 2026-10-08\) — importé le 2026-10-09T07:00:00\+00:00/);
  assert.match(html, /Ouverture du 2026-10-07 : égale au solde prouvé du 2026-10-06/);
  assert.match(html, /Ouverture du relevé du 2026-10-05 \(fichier 5b000000\)/);
  assert.match(html, /Ouverture du 2026-10-05 : égale à la clôture du 2026-10-01/);
  assert.match(html, /Période déclarée 2026-10-04 → 2026-10-05 \(close jusqu’au 2026-10-04, fichier 5b000000\)/);
  assert.match(html, /Clôture confirmée par l’ouverture du 2026-10-02 \(fichier 5d000000\) — importé le 2026-10-04T07:00:00\+00:00/);
  assert.match(html, /Ouverture du 2026-10-01 : premier relevé de la chaîne/);
});

test('une date seulement observée n’est jamais présentée comme couverte', () => {
  const blocked = parseTreasuryBalances(result({
    accounts: [account({
      status: 'BLOCKED', reasons: ['CHAIN_BROKEN'], balance_at_date: null, sources: [],
      dates: { bank_date_covered: null, age_days: null, bank_date_observed: '2026-10-02', balance_source_day: '2026-10-02' },
    })],
  })).accounts[0];
  assert.equal(freshnessLabel(blocked), 'Aucune date bancaire couverte · dernière date observée, non validée : 2026-10-02');
  const partial = parseTreasuryBalances(result({
    accounts: [account({ dates: { bank_date_covered: '2026-10-01', age_days: 32, bank_date_observed: '2026-10-04',
      balance_source_day: '2026-10-01' } })],
  })).accounts[0];
  assert.equal(freshnessLabel(partial), 'Couvert jusqu’au 2026-10-01 (il y a 32 jours) · dernière date observée, non validée : 2026-10-04');
  const fresh = parseTreasuryBalances(result()).accounts[0];
  assert.equal(freshnessLabel(fresh), 'Couvert jusqu’au 2026-10-07 (il y a 26 jours)');
  const html = renderToStaticMarkup(<TreasuryBalancesView result={parseTreasuryBalances(result({ accounts: [account({
    status: 'BLOCKED', reasons: ['CHAIN_BROKEN'], balance_at_date: null, sources: [],
    dates: { bank_date_covered: null, age_days: null, bank_date_observed: '2026-10-02', balance_source_day: '2026-10-02' },
  })] }))} />);
  assert.match(html, /Aucune date bancaire couverte · dernière date observée, non validée : 2026-10-02/);
  assert.doesNotMatch(html, /Couvert jusqu’au 2026-10-02/);
});

test('BIS : la devise XOF est corroborée par les en-têtes obligatoires du profil', () => {
  const bis = STRUCTURED_BANK_STATEMENT_EXCEL_PROFILES.find((profile) => profile.bank === 'BIS');
  assert.ok(bis);
  assert.equal(bis.fixedCurrency, 'XOF');
  const aliases = bis.requiredHeaders.flatMap((header) => header.aliases);
  assert.ok(aliases.includes('debitxof') && aliases.includes('creditxof'), 'en-têtes DEBIT XOF / CREDIT XOF exigés');
});
