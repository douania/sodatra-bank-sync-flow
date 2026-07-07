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
 * Note runner : le client Supabase généré (`@/integrations/supabase/client`)
 * est Vite-only (import.meta.env) et crashe sous Node. Il est court-circuité
 * ici par un stub inerte via un hook de résolution auto-contenu (data: URL,
 * aucun fichier externe). Le stub jette au moindre accès : ce test ne peut
 * physiquement pas toucher Supabase.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import type { FundPosition } from '@/types/banking';

const SUPABASE_CLIENT_SPECIFIER = '@/integrations/supabase/client';

const supabaseStubModuleUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    'export const supabase = new Proxy({}, {' +
      ' get() { throw new Error("synthetic test: supabase client must never be used"); }' +
      ' });'
  );

const resolverHooksUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    `export function resolve(specifier, context, nextResolve) {
      if (specifier === ${JSON.stringify(SUPABASE_CLIENT_SPECIFIER)}) {
        return { shortCircuit: true, url: ${JSON.stringify(supabaseStubModuleUrl)} };
      }
      return nextResolve(specifier, context);
    }`
  );

register(resolverHooksUrl);

// Import dynamique APRÈS l'enregistrement du hook : c'est lui qui permet de
// charger databaseService.ts sous Node sans le client Vite-only.
const databaseServiceModule = import('./databaseService');

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
// sanitizeFundPositionAmount — signe, troncature, bornes, refus contrôlés
// ---------------------------------------------------------------------------

test('un montant négatif garde son signe et ne devient jamais positif', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  assert.equal(sanitizeFundPositionAmount(-12345, 'balance'), -12345);
  assert.equal(sanitizeFundPositionAmount(-1, 'balance'), -1);
  assert.notEqual(sanitizeFundPositionAmount(-12345, 'balance'), 12345);
});

test('décimales : troncature vers zéro, signe préservé des deux côtés', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  assert.equal(sanitizeFundPositionAmount(12345.67, 'amount'), 12345);
  assert.equal(sanitizeFundPositionAmount(-12345.67, 'amount'), -12345);
  assert.equal(sanitizeFundPositionAmount(0.99, 'amount'), 0);
  assert.equal(sanitizeFundPositionAmount(-0.99, 'amount'), 0);
});

test('zéro et zéro négatif se replient sur la forme canonique 0', async () => {
  const { sanitizeFundPositionAmount } = await databaseServiceModule;

  assert.equal(Object.is(sanitizeFundPositionAmount(0, 'amount'), 0), true);
  assert.equal(Object.is(sanitizeFundPositionAmount(-0, 'amount'), 0), true);
  assert.equal(Object.is(sanitizeFundPositionAmount(-0.5, 'amount'), -0), false);
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

test('détails par banque : net_balance négatif préservé, décimales tronquées', async () => {
  const { buildFundPositionInsertPayloads } = await databaseServiceModule;

  const { detailRows } = buildFundPositionInsertPayloads(
    syntheticFundPosition({
      details: [
        {
          bankName: 'SYNTH BANK',
          balance: -5000.75,
          fundApplied: 100,
          netBalance: -5100,
          nonValidatedDeposit: 0,
          grandBalance: -5100.99
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
  assert.equal(holdRows[0].deposit_date, undefined);
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
