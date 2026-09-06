import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  QUALITY_CONTROL_NOT_EVALUABLE_MESSAGE,
  QualityControlEngine,
  QualityControlNotImplementedError,
} from './qualityControlEngine';

// PACK 0 — contrôle qualité consultatif. Données synthétiques uniquement,
// aucun accès Supabase (le moteur n'importe plus le client).

const engine = new QualityControlEngine();

function excelRow(overrides: Record<string, unknown> = {}) {
  return {
    reportDate: '2026-06-05',
    clientCode: 'CLIENT_SYN_A',
    collectionAmount: 100_000,
    bankName: 'BANQUE_SYN',
    dateOfValidity: '2026-06-06',
    factureNo: 'FAC-SYN-001',
    ...overrides,
  };
}

/** Forme produite par databaseService.mapDbToBankReport (camelCase, dépôts non crédités). */
function mappedBankReportWithDepositsOnly() {
  return {
    id: 'report-syn-1',
    bank: 'BANQUE_SYN',
    date: '2026-06-05',
    openingBalance: 1_000_000,
    closingBalance: 1_100_000,
    bankFacilities: [],
    depositsNotCleared: [
      { dateDepot: '2026-06-05', dateValeur: '2026-06-06', typeReglement: 'CHEQUE', reference: 'DEP-SYN-1', clientCode: 'CLIENT_SYN_A', montant: 100_000 },
    ],
    checksNotCleared: [],
    impayes: [],
  };
}

function statementWithCredits(transactions: Array<Record<string, unknown>>) {
  return { bank: 'BANQUE_SYN', date: '2026-06-05', transactions };
}

test('sans relevé bancaire : contrôle non évaluable, aucune anomalie comptée, aucun score fabriqué', async () => {
  const report = await engine.analyzeQuality([excelRow()], []);
  assert.equal(report.evaluation.status, 'NOT_EVALUABLE');
  assert.equal(report.evaluation.reason, QUALITY_CONTROL_NOT_EVALUABLE_MESSAGE);
  assert.equal(report.evaluation.credit_evidence, 0);
  assert.equal(report.summary.errors_detected, 0);
  assert.equal(report.summary.confidence_score, null);
  assert.deepEqual(report.errors, []);
});

test('sans ligne Excel : contrôle non évaluable même si des crédits existent', async () => {
  const report = await engine.analyzeQuality([], [statementWithCredits([
    { date: '2026-06-05', description: 'VIR SYNTHETIQUE', amount: 100_000, type: 'CREDIT' },
  ])]);
  assert.equal(report.evaluation.status, 'NOT_EVALUABLE');
  assert.equal(report.evaluation.excel_rows, 0);
  assert.equal(report.summary.confidence_score, null);
});

test('un dépôt non crédité n’est jamais une preuve d’encaissement : non évaluable', async () => {
  const report = await engine.analyzeQuality([excelRow()], [mappedBankReportWithDepositsOnly()]);
  assert.equal(report.evaluation.status, 'NOT_EVALUABLE');
  assert.equal(report.evaluation.bank_reports, 1);
  assert.equal(report.evaluation.credit_evidence, 0);
  assert.equal(report.summary.errors_detected, 0);
  assert.equal(report.summary.confidence_score, null);
});

test('seuls les crédits explicites comptent : un débit ou un montant négatif ne sont pas des preuves', async () => {
  const debitOnly = await engine.analyzeQuality([excelRow()], [statementWithCredits([
    { date: '2026-06-05', description: 'PRELEVEMENT', amount: 100_000, type: 'DEBIT' },
    { date: '2026-06-05', description: 'FRAIS', amount: -500 },
  ])]);
  assert.equal(debitOnly.evaluation.status, 'NOT_EVALUABLE');
  assert.equal(debitOnly.evaluation.credit_evidence, 0);
});

test('avec un crédit explicite : anomalie de montant signalée avec la preuve rapprochée, mapping camelCase accepté', async () => {
  const report = await engine.analyzeQuality(
    [excelRow({ collectionAmount: 101_500 })],
    [statementWithCredits([
      { date: '2026-06-05', description: 'VIR REGLEMENT FACTURE FAC-SYN-001', amount: 100_000, type: 'CREDIT', clientCode: 'CLIENT_SYN_A' },
    ])],
  );
  assert.equal(report.evaluation.status, 'EVALUABLE');
  assert.equal(report.evaluation.credit_evidence, 1);
  const amountErrors = report.errors.filter(error => (error as { subtype?: string }).subtype === 'MONTANT_INCORRECT');
  assert.equal(amountErrors.length, 1);
  assert.equal(amountErrors[0].bank_transaction?.amount, 100_000);
  assert.equal(amountErrors[0].bank_transaction?.client_code, 'CLIENT_SYN_A');
  assert.equal(amountErrors[0].status, 'PENDING');
  assert.equal(typeof report.summary.confidence_score, 'number');
  assert.ok(report.summary.confidence_score! > 0 && report.summary.confidence_score! <= 100);
});

test('évaluable sans anomalie : aucune anomalie, mais aucun score artificiel de 100 %', async () => {
  const report = await engine.analyzeQuality(
    [excelRow()],
    [statementWithCredits([
      { date: '2026-06-05', description: 'VIR REGLEMENT FACTURE FAC-SYN-001', amount: 100_000, type: 'CREDIT', client_code: 'CLIENT_SYN_A' },
    ])],
  );
  assert.equal(report.evaluation.status, 'EVALUABLE');
  assert.equal(report.summary.errors_detected, 0);
  assert.equal(report.summary.confidence_score, null);
  assert.equal(report.summary.error_rate, 0);
});

test('les corrections non implémentées refusent explicitement au lieu de simuler un succès', async () => {
  await assert.rejects(engine.validateError('QE_SYN'), QualityControlNotImplementedError);
  await assert.rejects(engine.rejectError('QE_SYN', 'raison'), QualityControlNotImplementedError);
  await assert.rejects(engine.applyCorrection('QE_SYN', { collectionAmount: 1 }), QualityControlNotImplementedError);
  await assert.rejects(engine.validateError('QE_SYN'), /QUALITY_CONTROL_CORRECTION_NOT_IMPLEMENTED:validate/);
});

test('contrat source : moteur sans Supabase ni dépôts non crédités comme preuve ; écran consultatif sans faux succès', () => {
  const engineSource = readFileSync('src/services/qualityControlEngine.ts', 'utf8');
  assert.doesNotMatch(engineSource, /@\/integrations\/supabase\/client/);
  const extractor = engineSource.slice(engineSource.indexOf('private extractCreditTransactions'), engineSource.indexOf('private async detectSaisieErrors'));
  assert.doesNotMatch(extractor, /depositsNotCleared|deposits_not_cleared/);

  const page = readFileSync('src/pages/QualityControl.tsx', 'utf8');
  assert.doesNotMatch(page, /parfaitement conformes|validée et appliquée|Suggestion rejetée|Correction modifiée/);
  assert.doesNotMatch(page, /validateError|rejectError|applyCorrection/);
  assert.match(page, /evaluation\.status === 'NOT_EVALUABLE'/);
  assert.match(page, /toast\.warning\(report\.evaluation\.reason\)/);
  assert.doesNotMatch(page, /toast\.success/);

  const dashboard = readFileSync('src/components/QualityControlDashboard.tsx', 'utf8');
  assert.doesNotMatch(dashboard, /onValidateError|onRejectError|onModifyCorrection|Valider la correction|Confirmer le rejet/);
  assert.match(dashboard, /Contrôle non évaluable/);
  assert.match(dashboard, /n'est pas une attestation de conformité/);
});
