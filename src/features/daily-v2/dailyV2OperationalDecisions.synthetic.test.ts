import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  activeAttestations,
  activeRefutations,
  computeDailyV2BatchPlan,
  dailyV2AmountText,
  dailyV2CompareVersions,
  dailyV2FreshDeliveryBound,
  dailyV2PieceRequirements,
  dailyV2SourceVerdicts,
  dailyV2VersionCoherent,
  dailyV2VersionKey,
  dailyV2VersionSources,
  dakarDate,
  groupDailyV2DayVersions,
  isBalanceCorrectionCandidate,
  isDailyV2AmountText,
  isRefutable,
  stagingVersionFacts,
  type DailyV2AttemptAttestationRow,
  type DailyV2CanonicalUnitRow,
  type DailyV2ExportAttemptRow,
  type DailyV2StagingUnitRow,
  type DailyV2VersionFacts,
  type DailyV2VersionRefutationRow,
} from './dailyV2Types';

// Lot 1 opérationnel : règles de version côté interface, données fictives.
// La parité exacte avec le serveur est éprouvée par 43_version_parity.sql
// (2 000 cas, PostgreSQL 17) ; ici, les cas nommés de la R6.

const HA = 'a'.repeat(64);
const HB = 'b'.repeat(64);
const ACCOUNT = '20000000-0000-4000-8000-000000000001';

function facts(overrides: Partial<DailyV2VersionFacts> = {}): DailyV2VersionFacts {
  return { hash: HA, aggregates: 'derived', opening: 100, closing: 110, debits: 0, credits: 10, ...overrides };
}

function attempt(id: string, overrides: Partial<DailyV2ExportAttemptRow> = {}): DailyV2ExportAttemptRow {
  return {
    id, created_at: '2026-10-05T09:00:00.123456+00:00', created_by: null, requested_mode: 'daily',
    source_format: 'structured_bank_statement_xls', bank: 'ATB', currency: 'XOF', account_fingerprint: 'f'.repeat(64),
    account_registry_id: ACCOUNT, account_number_masked: null, source_file_name_redacted: null,
    raw_text_hash: id.slice(0, 1).repeat(64), export_period_start: '2026-10-01', export_period_end: '2026-10-05',
    statement_date: null, export_reference_date: null, parser_validation_status: 'valid', errors_count: 0,
    warnings_count: 0, runtime_version: null, parser_version: 'structured-excel-0q/atb-online-xls-v1',
    ingestion_ready: true, bridge_guard_passed: true, period_days: 5, backfill_grant_reference: null,
    backfill_grant_id: null, review_reason_codes: [], units_total: 1, ...overrides,
  };
}

function unit(id: string, attemptId: string, overrides: Partial<DailyV2StagingUnitRow> = {}): DailyV2StagingUnitRow {
  return {
    id, attempt_id: attemptId, day_unit_id: 'day-2026-10-02', bank: 'ATB', account_fingerprint: 'f'.repeat(64),
    account_registry_id: ACCOUNT, currency: 'XOF', accounting_date: '2026-10-02', day_content_hash: HA, line_count: 1,
    day_total_debits: 0, day_total_credits: 10, opening_balance_derived: 100, closing_balance_derived: 110,
    aggregates_status: 'derived', validation_status: 'valid', review_reason_codes: [], status: 'staged',
    created_at: '2026-10-05T09:00:00+00:00', created_by: null, ...overrides,
  };
}

function canonical(overrides: Partial<DailyV2CanonicalUnitRow> = {}): DailyV2CanonicalUnitRow {
  return {
    id: 'c0000000-0000-4000-8000-000000000001', promoted_from_staging_unit_id: 'u-promoted', day_unit_id: 'day-2026-10-02',
    bank: 'ATB', account_fingerprint: 'f'.repeat(64), account_registry_id: ACCOUNT, currency: 'XOF',
    accounting_date: '2026-10-02', active_day_content_hash: HA, line_count: 1, day_total_debits: 0, day_total_credits: 10,
    opening_balance_derived: 100, closing_balance_derived: 110, aggregates_status: 'derived', validation_status: 'valid',
    review_reason_codes: [], status: 'ingested', ingested_at: '2026-10-05T09:00:00+00:00', ingested_by: null,
    superseded_by: null, superseded_at: null, ...overrides,
  };
}

test('clé de version : texte exact des colonnes numeric(18,2), absence distincte de zéro', () => {
  assert.equal(dailyV2VersionKey(facts()), `${HA}|derived|100.00|110.00|0.00|10.00`);
  assert.equal(dailyV2VersionKey(facts({ aggregates: 'unavailable', opening: null, closing: null })),
    `${HA}|unavailable|-|-|0.00|10.00`);
  assert.notEqual(dailyV2VersionKey(facts({ opening: 0 })), dailyV2VersionKey(facts({ opening: null })));
  assert.equal(dailyV2AmountText(-5.5), '-5.50');
  assert.throws(() => dailyV2AmountText(1e13), /DAILY_V2_AMOUNT_OUT_OF_EXACT_RANGE/);
  assert.throws(() => dailyV2AmountText(Number.NaN), /DAILY_V2_AMOUNT_OUT_OF_EXACT_RANGE/);
});

test('cohérence financière, unité seule comprise (réserve 4.1)', () => {
  assert.equal(dailyV2VersionCoherent(facts()), true);
  // Ouverture 100, crédit 10, clôture 120 : jamais un solde utilisable.
  assert.equal(dailyV2VersionCoherent(facts({ closing: 120 })), false);
  assert.equal(dailyV2VersionCoherent(facts({ aggregates: 'unavailable', opening: null, closing: null })), true);
  assert.equal(dailyV2VersionCoherent(facts({ aggregates: 'unavailable', opening: 100, closing: null })), false);
  assert.equal(dailyV2VersionCoherent(facts({ debits: -1, closing: 111 })), false);
  assert.equal(dailyV2VersionCoherent(facts({ credits: null })), false);
  assert.equal(dailyV2VersionCoherent(facts({ opening: 0.1, credits: 0.2, closing: 0.3 })), true, 'centimes exacts');
});

test('comparaison à trois issues : accord, contradiction, données insuffisantes', () => {
  const r = facts();
  assert.equal(dailyV2CompareVersions(facts(), r), 'SAME_VERSION');
  assert.equal(dailyV2CompareVersions(facts({ opening: 200, closing: 210 }), r), 'CONTRADICTION', 'soldes seuls différents');
  assert.equal(dailyV2CompareVersions(facts({ credits: 20, closing: 120 }), r), 'CONTRADICTION', 'net différent');
  assert.equal(dailyV2CompareVersions(facts({ hash: HB, debits: 5, credits: 15 }), r), 'AGREEMENT_BREAKDOWN');
  assert.equal(dailyV2CompareVersions(facts({ hash: HB }), r), 'AGREEMENT_DETAIL');
  assert.equal(dailyV2CompareVersions(facts({ hash: HB, aggregates: 'unavailable', opening: null, closing: null }), r),
    'INSUFFICIENT_UNAVAILABLE');
  assert.equal(dailyV2CompareVersions(facts({ hash: HB, closing: 999 }), r), 'INSUFFICIENT_INCOHERENT');
  // Relation 5 : mêmes mouvements, totaux différents au même net.
  assert.equal(dailyV2CompareVersions(facts({ debits: 5, credits: 15 }), r), 'INSUFFICIENT_INCOHERENT');
});

test('sources : empreinte brute et compte, première apparition, provisoires et remplacées exclues', () => {
  const a1 = attempt('11111111-0000-4000-8000-000000000001', { created_at: '2026-10-05T09:00:00.500001+00:00' });
  const a2 = attempt('21111111-0000-4000-8000-000000000002', { raw_text_hash: a1.raw_text_hash,
    created_at: '2026-10-04T23:59:59.999999+00:00' });
  const a3 = attempt('31111111-0000-4000-8000-000000000003');
  const units = [
    unit('u1', a1.id, { opening_balance_derived: 200, closing_balance_derived: 210, status: 'conflict' }),
    unit('u2', a2.id, { opening_balance_derived: 200, closing_balance_derived: 210, status: 'duplicate' }),
    unit('u3', a3.id, { opening_balance_derived: 200, closing_balance_derived: 210, status: 'provisional' }),
  ];
  const key = dailyV2VersionKey(stagingVersionFacts(units[0]));
  const sources = dailyV2VersionSources(units, [a1, a2, a3], key);
  assert.equal(sources.length, 1, 'redépôt identique : une seule source');
  assert.equal(sources[0].deliveries, 2);
  assert.equal(sources[0].first_seen_at, '2026-10-04T23:59:59.999999+00:00', 'instant serveur conservé tel quel');
});

test('justification source par source : strictement postérieure, au jour près, à Dakar', () => {
  const source = { raw_text_hash: HA, account_registry_id: ACCOUNT, first_seen_at: '2026-10-05T23:30:00+00:00', deliveries: 1 };
  assert.equal(dakarDate(source.first_seen_at), '2026-10-05');
  assert.deepEqual(dailyV2SourceVerdicts([source], '2026-10-05').map((v) => v.justified), [false], 'même jour : non');
  assert.deepEqual(dailyV2SourceVerdicts([source], '2026-10-06').map((v) => v.justified), [true]);
  assert.deepEqual(dailyV2SourceVerdicts([source], null).map((v) => v.justified), [false]);
  assert.deepEqual(dailyV2SourceVerdicts([source], '06/10/2026').map((v) => v.justified), [false], 'ISO strict');
  // F1 -> C -> F2 : une preuve antérieure à F2 ne la justifie pas.
  const f1 = { ...source, raw_text_hash: HA, first_seen_at: '2026-10-03T10:00:00+00:00' };
  const f2 = { ...source, raw_text_hash: HB, first_seen_at: '2026-10-10T10:00:00+00:00' };
  const verdicts = dailyV2SourceVerdicts([f1, f2], '2026-10-08');
  assert.deepEqual(verdicts.map((v) => v.justified), [true, false]);
});

test('borne d’une livraison fraîche : dernière journée livrée au plus tard le jour du dépôt', () => {
  const proof = attempt('41111111-0000-4000-8000-000000000004', { created_at: '2026-10-09T08:00:00+00:00' });
  const units = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].map((day, index) =>
    unit(`p${index}`, proof.id, { accounting_date: day }));
  assert.equal(dailyV2FreshDeliveryBound(proof, units), '2026-10-09');
  assert.equal(dailyV2FreshDeliveryBound(proof, []), null);
});

test('pièce corrective : valeurs exigées et format strict', () => {
  const retained = facts();
  assert.deepEqual(dailyV2PieceRequirements(facts({ opening: 200, closing: 210 }), retained, 'CONTRADICTION'),
    { balances: true, totals: false });
  // Net et clôture différents : les deux couples s'additionnent.
  assert.deepEqual(dailyV2PieceRequirements(facts({ credits: 20, closing: 120 }), retained, 'CONTRADICTION'),
    { balances: true, totals: true });
  // Net différent sans soldes comparables : les seuls totaux.
  assert.deepEqual(dailyV2PieceRequirements(facts({ hash: HB, aggregates: 'unavailable', opening: null, closing: null,
    credits: 20 }), retained, 'CONTRADICTION'), { balances: false, totals: true });
  assert.deepEqual(dailyV2PieceRequirements(facts({ aggregates: 'unavailable', opening: null, closing: null, hash: HB }),
    retained, 'INSUFFICIENT_UNAVAILABLE'), { balances: true, totals: false });
  for (const ok of ['1300', '-5.5', '0.01']) assert.equal(isDailyV2AmountText(ok), true, ok);
  for (const bad of ['1 300', '1,5', '1e3', '', '1.234']) assert.equal(isDailyV2AmountText(bad), false, bad);
});

test('versions d’une journée : retenue, réfutée, nouvelle source qui rouvre', () => {
  const a1 = attempt('11111111-0000-4000-8000-000000000001');
  const a2 = attempt('21111111-0000-4000-8000-000000000002');
  const active = canonical();
  const units = [
    unit('u-promoted', a1.id, { status: 'promoted' }),
    unit('u-wrong', a1.id, { opening_balance_derived: 200, closing_balance_derived: 210, status: 'conflict' }),
    unit('u-wrong-2', a2.id, { opening_balance_derived: 200, closing_balance_derived: 210, status: 'conflict' }),
    unit('u-old', a1.id, { status: 'superseded', day_content_hash: HB }),
  ];
  const wrongKey = dailyV2VersionKey(stagingVersionFacts(units[1]));
  const refutation = {
    id: 'r1', action: 'REFUTE', day_unit_id: 'day-2026-10-02', refuted_version_key: wrongKey,
    proof_kind: 'FRESH_DELIVERY', proof_bound_day: '2026-10-09',
  } as DailyV2VersionRefutationRow;
  const versions = groupDailyV2DayVersions({
    units, attempts: [a1, a2], active, refutations: [refutation],
    refutationSources: [{ refutation_id: 'r1', raw_text_hash: a1.raw_text_hash, account_registry_id: ACCOUNT,
      first_seen_at: a1.created_at, proof_bound_day: '2026-10-09', verdict: 'JUSTIFIED' }],
  });
  assert.equal(versions.length, 2, 'la livraison remplacée n’est plus une version affichée');
  assert.equal(versions[0].retained, true);
  assert.equal(versions[1].comparison, 'CONTRADICTION');
  assert.equal(versions[1].refutation?.id, 'r1');
  assert.equal(versions[1].uncoveredSources.length, 1, 'la source du second fichier rouvre la contradiction');
  assert.equal(isRefutable(versions[1], stagingVersionFacts(units[0])), true);
  assert.equal(isRefutable(versions[0], stagingVersionFacts(units[0])), false);
  const revoke = { id: 'r2', action: 'REVOKE', revokes_id: 'r1' } as DailyV2VersionRefutationRow;
  assert.deepEqual(activeRefutations([refutation, revoke]), []);
});

test('correction des seuls soldes : doublon de mêmes mouvements, version dérivée et cohérente', () => {
  const active = canonical();
  assert.equal(isBalanceCorrectionCandidate(unit('d', 'a', { status: 'duplicate', opening_balance_derived: 200,
    closing_balance_derived: 210 }), active), true);
  assert.equal(isBalanceCorrectionCandidate(unit('d', 'a', { status: 'duplicate' }), active), false, 'même version');
  assert.equal(isBalanceCorrectionCandidate(unit('d', 'a', { status: 'duplicate', opening_balance_derived: 200,
    closing_balance_derived: 220 }), active), false, 'version incohérente (réserve 4.1)');
  assert.equal(isBalanceCorrectionCandidate(unit('d', 'a', { status: 'duplicate', day_content_hash: HB,
    opening_balance_derived: 200, closing_balance_derived: 210 }), active), false, 'mouvements différents');
  assert.equal(isBalanceCorrectionCandidate(unit('d', 'a', { status: 'conflict', opening_balance_derived: 200,
    closing_balance_derived: 210 }), active), false);
  assert.equal(isBalanceCorrectionCandidate(unit('d', 'a', { status: 'duplicate' }), null), false);
});

test('approbation groupée : fichier entier, attestations actives, liste exacte et ordonnée', () => {
  const file = attempt('51111111-0000-4000-8000-000000000005', { review_reason_codes: ['ACCOUNT_IDENTITY_NOT_CORROBORATED'] });
  const units = [
    unit('u-b', file.id, { day_unit_id: 'day-b', accounting_date: '2026-10-02', validation_status: 'needs_review',
      review_reason_codes: ['ACCOUNT_IDENTITY_NOT_CORROBORATED'] }),
    unit('u-a', file.id, { day_unit_id: 'day-a', accounting_date: '2026-10-01' }),
    unit('u-c', file.id, { day_unit_id: 'day-c', accounting_date: '2026-10-03', aggregates_status: 'unavailable',
      opening_balance_derived: null, closing_balance_derived: null }),
    unit('u-d', file.id, { day_unit_id: 'day-d', accounting_date: '2026-10-04', status: 'duplicate' }),
    unit('u-e', file.id, { day_unit_id: 'day-e', accounting_date: '2026-10-05', validation_status: 'needs_review',
      review_reason_codes: ['RUNNING_BALANCE_MISSING'] }),
  ];
  const unattested = computeDailyV2BatchPlan({ attempt: file, units, activeCanonicals: [], attestations: [] });
  assert.equal(unattested.fileHealthy, false);
  assert.equal(unattested.admissible.length, 0, 'un fichier non résolu ne rend propre aucune journée');

  const attestation = { id: 'att-1', attempt_id: file.id, attestation_type: 'ACCOUNT_IDENTITY', action: 'ATTEST' } as
    DailyV2AttemptAttestationRow;
  const plan = computeDailyV2BatchPlan({ attempt: file, units, activeCanonicals: [canonical({ day_unit_id: 'day-b',
    id: 'c-b', active_day_content_hash: HB })], attestations: [attestation] });
  assert.equal(plan.fileHealthy, true);
  assert.deepEqual(plan.admissible.map((u) => u.id), ['u-a', 'u-b']);
  assert.deepEqual(plan.inadmissible.map((entry) => [entry.unit.id, entry.reason]), [
    ['u-c', 'Soldes non dérivés'],
    ['u-d', 'Statut duplicate'],
    ['u-e', 'Motifs non résolus : RUNNING_BALANCE_MISSING'],
  ]);
  assert.deepEqual(plan.expected, {
    days: [
      { staging_unit_id: 'u-a', day_unit_id: 'day-a', day_content_hash: HA, canonical_unit_id: null, canonical_content_hash: null },
      { staging_unit_id: 'u-b', day_unit_id: 'day-b', day_content_hash: HA, canonical_unit_id: 'c-b', canonical_content_hash: HB },
    ],
    attestation_ids: ['att-1'],
  });
  const revoked = { id: 'att-2', attempt_id: file.id, attestation_type: 'ACCOUNT_IDENTITY', action: 'REVOKE',
    revokes_id: 'att-1' } as DailyV2AttemptAttestationRow;
  assert.deepEqual(activeAttestations([attestation, revoked]), []);
  assert.equal(computeDailyV2BatchPlan({ attempt: file, units, activeCanonicals: [], attestations: [attestation, revoked] })
    .admissible.length, 0, 'attestation révoquée : plus rien d’admissible');
});

test('interfaces : aucune écriture directe, pièce jamais téléversée, mention affichée, clé de commande par décision', () => {
  const dialogs = readFileSync('src/features/daily-v2/DailyV2DecisionDialogs.tsx', 'utf8');
  const batch = readFileSync('src/features/daily-v2/DailyV2BatchApprovalDialog.tsx', 'utf8');
  const types = readFileSync('src/features/daily-v2/dailyV2Types.ts', 'utf8');
  for (const source of [dialogs, batch]) {
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\s*\(/);
    assert.doesNotMatch(source, /\.storage\b|upload\(/i);
    assert.doesNotMatch(source, /from '@\/integrations\/supabase\/client'/);
    assert.match(source, /dailyV2DecisionCommandKeys\.keyFor\(/);
    assert.match(source, /dailyV2DecisionCommandKeys\.succeeded\(/);
  }
  assert.match(types, /DAILY_V2_PIECE_MENTION = 'attestation sur pièce archivée, contenu non vérifié automatiquement'/);
  assert.match(dialogs, /\{DAILY_V2_PIECE_MENTION\}/);
  assert.match(dialogs, /buildRawBytesHash\(await file\.arrayBuffer\(\)\)/);
  // Les valeurs lues sur la pièce ne sont jamais préremplies.
  assert.match(dialogs, /useState\(\{ opening: '', closing: '', debits: '', credits: '' \}\)/);
});
