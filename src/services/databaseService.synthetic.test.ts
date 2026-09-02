/**
 * Tests synthétiques HOTFIX-FUND-POSITION-SIGN-0A.
 *
 * Contrat vérifié : les montants Fund Position ne perdent JAMAIS leur signe,
 * les valeurs non finies ou hors ±Number.MAX_SAFE_INTEGER sont refusées de
 * manière contrôlée (jamais converties silencieusement en 0), et les champs
 * nullable ne deviennent null que si la source est réellement absente.
 *
 * Toutes les valeurs ci-dessous sont synthétiques. Aucune donnée bancaire
 * réelle, aucun appel réseau, aucun Supabase live.
 *
 * Le mapping financier est isolé du client Supabase : ce test ne peut
 * physiquement effectuer aucun appel réseau.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CollectionReport, FundPosition } from '@/types/banking';
import {
  buildFundPositionInsertPayloads,
  sanitizeFundPositionAmount,
} from './financialAtomicPersistence';
import {
  buildHistoricalDashboardCollectionSnapshot,
  getHistoricalDashboardCollectionUserErrorMessage,
  HISTORICAL_DASHBOARD_COLLECTION_READ_FAILED,
  HISTORICAL_DASHBOARD_COLLECTION_SAMPLE_LIMIT,
  HISTORICAL_DASHBOARD_COLLECTION_USER_ERROR_MESSAGE,
} from './historicalDashboardCollectionRead';

const databaseServiceModule = Promise.resolve({
  buildFundPositionInsertPayloads,
  sanitizeFundPositionAmount,
});

function syntheticFundPosition(overrides: Partial<FundPosition> = {}): FundPosition {
  return {
    reportDate: '2026-01-15',
    totalFundAvailable: 1_000_000,
    collectionsNotDeposited: 250_000,
    grandTotal: 1_250_000,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// sanitizeFundPositionAmount — signe, entiers stricts, bornes, refus contrôlés
// ---------------------------------------------------------------------------

test('un montant négatif garde son signe et ne devient jamais positif', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  assert.equal(sanitizeFundPositionAmount(-12345, 'balance'), -12345);
  assert.equal(sanitizeFundPositionAmount(-1, 'balance'), -1);
  assert.notEqual(sanitizeFundPositionAmount(-12345, 'balance'), 12345);
});

test('décimales : refus contrôlé sans troncature silencieuse', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  for (const invalid of [12345.67, -12345.67, 0.99, -0.99]) {
    assert.throws(
      () => sanitizeFundPositionAmount(invalid, 'amount'),
      /montant décimal non autorisé pour "amount".*insertion refusée/,
    );
  }
});

test('zéro et zéro négatif se replient sur la forme canonique 0', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  assert.equal(Object.is(sanitizeFundPositionAmount(0, 'amount'), 0), true);
  assert.equal(Object.is(sanitizeFundPositionAmount(-0, 'amount'), 0), true);
});

test('NaN / Infinity / -Infinity : refus contrôlé, jamais 0 silencieux', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => sanitizeFundPositionAmount(invalid, 'grand_total'),
      /montant invalide pour "grand_total".*insertion refusée/
    );
  }
});

test('hors bornes ±Number.MAX_SAFE_INTEGER : refus contrôlé des deux signes', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  assert.throws(
    () => sanitizeFundPositionAmount(Number.MAX_SAFE_INTEGER + 10, 'amount'),
    /hors bornes sûres pour "amount"/
  );
  assert.throws(
    () => sanitizeFundPositionAmount(-Number.MAX_SAFE_INTEGER - 10, 'amount'),
    /hors bornes sûres pour "amount"/
  );

  // Les bornes exactes restent acceptées, signe compris.
  assert.equal(
    sanitizeFundPositionAmount(Number.MAX_SAFE_INTEGER, 'amount'),
    Number.MAX_SAFE_INTEGER
  );
  assert.equal(
    sanitizeFundPositionAmount(-Number.MAX_SAFE_INTEGER, 'amount'),
    -Number.MAX_SAFE_INTEGER
  );
});

test('valeur non numérique (undefined/null forcés) : refus contrôlé', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  assert.throws(
    () => sanitizeFundPositionAmount(undefined as unknown as number, 'balance'),
    /montant invalide pour "balance"/
  );
  assert.throws(
    () => sanitizeFundPositionAmount(null as unknown as number, 'balance'),
    /montant invalide pour "balance"/
  );
});

// ---------------------------------------------------------------------------
// buildFundPositionInsertPayloads — mapping complet avant insertion
// ---------------------------------------------------------------------------

test('payload principal : un découvert reste négatif de bout en bout', async () => {
  const { buildFundPositionInsertPayloads } = await databaseServiceModule;

  const { fundPositionRow } = buildFundPositionInsertPayloads(
    syntheticFundPosition({
      totalFundAvailable: -12345,
      collectionsNotDeposited: 500,
      grandTotal: -11845
    })
  );

  assert.equal(fundPositionRow.total_fund_available, -12345);
  assert.equal(fundPositionRow.grand_total, -11845);
  assert.equal(fundPositionRow.report_date, '2026-01-15');
});

test('champs nullable : null uniquement si la source est absente, un 0 réel reste 0', async () => {
  const { buildFundPositionInsertPayloads } = await databaseServiceModule;

  const absent = buildFundPositionInsertPayloads(syntheticFundPosition());
  assert.equal(absent.fundPositionRow.deposit_for_day, null);
  assert.equal(absent.fundPositionRow.payment_for_day, null);

  const present = buildFundPositionInsertPayloads(
    syntheticFundPosition({ depositForDay: 0, paymentForDay: -700 })
  );
  assert.equal(present.fundPositionRow.deposit_for_day, 0);
  assert.equal(present.fundPositionRow.payment_for_day, -700);
});

test('détails par banque : montants entiers négatifs préservés', async () => {
  const { buildFundPositionInsertPayloads } = await databaseServiceModule;

  const { detailRows } = buildFundPositionInsertPayloads(
    syntheticFundPosition({
      details: [
        {
          bankName: 'SYNTH BANK',
          balance: -5000,
          fundApplied: 100,
          netBalance: -5100,
          nonValidatedDeposit: 0,
          grandBalance: -5100
        }
      ]
    })
  );

  assert.equal(detailRows.length, 1);
  assert.equal(detailRows[0].bank_name, 'SYNTH BANK');
  assert.equal(detailRows[0].balance, -5000);
  assert.equal(detailRows[0].net_balance, -5100);
  assert.equal(detailRows[0].grand_balance, -5100);
});

test('holds : montant négatif préservé, métadonnées transmises telles quelles', async () => {
  const { buildFundPositionInsertPayloads } = await databaseServiceModule;

  const { holdRows } = buildFundPositionInsertPayloads(
    syntheticFundPosition({
      holdCollections: [
        {
          holdDate: '2026-01-10',
          chequeNumber: 'CHQ-SYNTH-1',
          clientBank: 'SYNTH BANK',
          clientName: 'CLIENT SYNTHETIQUE',
          factureReference: 'FA-SYNTH-1',
          amount: -42
        }
      ]
    })
  );

  assert.equal(holdRows.length, 1);
  assert.equal(holdRows[0].amount, -42);
  assert.equal(holdRows[0].cheque_number, 'CHQ-SYNTH-1');
  assert.equal(holdRows[0].deposit_date, null);
});

test('un montant invalide dans les détails refuse tout le payload avant insertion', async () => {
  const { buildFundPositionInsertPayloads } = await databaseServiceModule;

  assert.throws(
    () =>
      buildFundPositionInsertPayloads(
        syntheticFundPosition({
          details: [
            {
              bankName: 'SYNTH BANK',
              balance: Number.NaN,
              fundApplied: 0,
              netBalance: 0,
              nonValidatedDeposit: 0,
              grandBalance: 0
            }
          ]
        })
      ),
    /montant invalide pour "details\[0\]\.balance"/
  );
});

test('détails et holds absents : tableaux vides, aucune fabrication', async () => {
  const { buildFundPositionInsertPayloads } = await databaseServiceModule;

  const { detailRows, holdRows } = buildFundPositionInsertPayloads(syntheticFundPosition());
  assert.deepEqual(detailRows, []);
  assert.deepEqual(holdRows, []);
});

// ---------------------------------------------------------------------------
// Dashboard historique — total exact distinct de l'échantillon chargé
// ---------------------------------------------------------------------------

test('le snapshot conserve le total exact au-delà de la limite de lignes chargées', () => {
  const reports = Array.from(
    { length: HISTORICAL_DASHBOARD_COLLECTION_SAMPLE_LIMIT },
    (_, index) => ({ id: `synthetic-${index}` }) as CollectionReport,
  );

  const snapshot = buildHistoricalDashboardCollectionSnapshot(reports, 1_250);

  assert.equal(snapshot.totalCount, 1_250);
  assert.equal(snapshot.loadedCount, HISTORICAL_DASHBOARD_COLLECTION_SAMPLE_LIMIT);
  assert.equal(snapshot.isPartial, true);
  assert.equal(snapshot.reports, reports);
});

test('le snapshot marque une lecture complète lorsque total et lignes correspondent', () => {
  const reports = [{ id: 'synthetic-1' }, { id: 'synthetic-2' }] as CollectionReport[];
  const snapshot = buildHistoricalDashboardCollectionSnapshot(reports, reports.length);

  assert.equal(snapshot.totalCount, 2);
  assert.equal(snapshot.loadedCount, 2);
  assert.equal(snapshot.isPartial, false);
});

test('le snapshot refuse tout compteur absent, invalide ou inférieur aux lignes chargées', () => {
  const reports = [{ id: 'synthetic-1' }] as CollectionReport[];

  for (const invalidCount of [null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => buildHistoricalDashboardCollectionSnapshot(reports, invalidCount),
      /HISTORICAL_DASHBOARD_COLLECTION_COUNT_INVALID/,
    );
  }

  assert.throws(
    () => buildHistoricalDashboardCollectionSnapshot(reports, 0),
    /HISTORICAL_DASHBOARD_COLLECTION_COUNT_INVALID/,
  );
});

test('le dashboard traduit l’échec technique Collection Report en message utilisateur sûr', () => {
  assert.equal(
    getHistoricalDashboardCollectionUserErrorMessage(
      new Error(HISTORICAL_DASHBOARD_COLLECTION_READ_FAILED),
    ),
    HISTORICAL_DASHBOARD_COLLECTION_USER_ERROR_MESSAGE,
  );
  assert.equal(
    getHistoricalDashboardCollectionUserErrorMessage(new Error('OTHER_DASHBOARD_FAILURE')),
    null,
  );
  assert.equal(getHistoricalDashboardCollectionUserErrorMessage('unexpected'), null);
});

test('le contrat runtime demande un count exact et le dashboard n’utilise plus array.length comme total', () => {
  const serviceSource = readFileSync(new URL('./databaseService.ts', import.meta.url), 'utf8');
  const dashboardSource = readFileSync(new URL('../pages/Dashboard.tsx', import.meta.url), 'utf8');

  assert.match(serviceSource, /\.select\('\*', \{ count: 'exact' \}\)/);
  assert.match(serviceSource, /\.limit\(HISTORICAL_DASHBOARD_COLLECTION_SAMPLE_LIMIT\)/);
  assert.match(
    serviceSource,
    /throw new Error\('HISTORICAL_DASHBOARD_COLLECTION_READ_FAILED'\)/,
  );
  assert.match(dashboardSource, /collectionSnapshot\.totalCount/);
  assert.match(dashboardSource, /collections au total/);
  assert.match(dashboardSource, /getHistoricalDashboardCollectionUserErrorMessage\(error\)/);
  assert.doesNotMatch(dashboardSource, /\{collectionReports\.length\} collections(?:\s|<)/);
});
