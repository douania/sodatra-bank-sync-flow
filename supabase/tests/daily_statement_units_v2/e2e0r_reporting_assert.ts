/**
 * LOCAL-E2E-0R — REPORTING 0O SUR DONNÉES CANONICAL RÉELLES (TESTS UNIQUEMENT)
 * ============================================================================
 * Consomme les lignes canonical RÉELLEMENT extraites du conteneur Postgres
 * jetable (snapshots pris par 30_e2e0r_pipeline.sql, exportés par le runner) et
 * les fait traverser les VRAIES fonctions pures du reporting 0O :
 *   - validateDailyV2ReportingFilters
 *   - buildDailyV2ReportingSummaries
 *   - buildDailyV2SummaryExportRows / buildDailyV2SummaryCsv
 *
 * Aucune seconde fixture : les attendus monétaires sont dérivés de
 * e2e0r_payloads.json, c'est-à-dire de la sortie du pipeline Excel lui-même.
 *
 * FRONTIÈRE ASSUMÉE (documentée dans le README) : la lecture est faite en SQL
 * direct (psql), pas via PostgREST. Le snapshot reproduit exactement la
 * projection et le filtre de la requête page réelle (REPORTING_COLUMNS,
 * status='ingested', fenêtre). La couche PostgREST/JWT n'est PAS exercée ici.
 *
 * Usage :
 *   tsx .../e2e0r_reporting_assert.ts <snapshotsJson> <payloadsJson>
 */
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';
import {
  buildDailyV2ReportingSummaries,
  isDailyV2ReportingFiltersFailure,
  isDailyV2ReportingSummariesFailure,
  validateDailyV2ReportingFilters,
  type DailyV2ReportingGroupSummary,
} from '../../../src/features/daily-v2/dailyV2ReportingCalculations';
import {
  buildDailyV2SummaryCsv,
  buildDailyV2SummaryExportRows,
  DAILY_V2_SUMMARY_EXPORT_HEADERS,
} from '../../../src/features/daily-v2/dailyV2SummaryExport';
import { toDailyV2MinorUnits } from '../../../src/features/daily-v2/dailyV2Money';
import type { DailyV2ReportingUnitRow } from '../../../src/features/daily-v2/dailyV2Types';

interface PayloadUnit {
  day_total_debits: number;
  day_total_credits: number;
  line_count: number;
}
interface PayloadEntry {
  bank: string;
  units: PayloadUnit[];
}

let failures = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`OK: ${label}`);
    return;
  }
  failures += 1;
  console.error(`TEST_FAILED: ${label}`);
}

function groupOf(groups: readonly DailyV2ReportingGroupSummary[], bank: string) {
  return groups.find((entry) => entry.bank === bank);
}

async function main(): Promise<void> {
  const snapshotsPath = argv[2];
  const payloadsPath = argv[3];
  if (!snapshotsPath || !payloadsPath) {
    console.error('TEST_FAILED: usage: e2e0r_reporting_assert.ts <snapshotsJson> <payloadsJson>');
    exit(1);
  }

  const snapshots = JSON.parse(readFileSync(snapshotsPath, 'utf8')) as Record<
    string,
    DailyV2ReportingUnitRow[]
  >;
  const payloads = JSON.parse(readFileSync(payloadsPath, 'utf8')) as Record<string, PayloadEntry>;

  // Attendus dérivés du pipeline Excel réel (jamais réécrits à la main).
  const expected = (key: string) => {
    const unit = payloads[key].units[0];
    return {
      debits: toDailyV2MinorUnits(unit.day_total_debits),
      credits: toDailyV2MinorUnits(unit.day_total_credits),
    };
  };

  // --- Contrat de filtre (fenêtre de la campagne) ---------------------------
  const filters = validateDailyV2ReportingFilters({
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  });
  check(!isDailyV2ReportingFiltersFailure(filters), '0R-R0: fenetre de reporting 2026-07 validee');

  // --- Checkpoint A : AVANT promotion, aucune donnee canonical --------------
  const a = snapshots.A_before_promotion ?? [];
  check(a.length === 0, '0R-R1: checkpoint A - aucune unite canonical avant promotion');
  const reportA = await buildDailyV2ReportingSummaries(a);
  check(
    !isDailyV2ReportingSummariesFailure(reportA) && reportA.groups.length === 0,
    '0R-R2: checkpoint A - le reporting ne produit aucun groupe',
  );
  let emptyExportRefused = false;
  try {
    buildDailyV2SummaryExportRows([]);
  } catch (error: unknown) {
    emptyExportRefused = error instanceof Error && error.message === 'EXPORT_EMPTY_REPORT_REFUSED';
  }
  check(emptyExportRefused, '0R-R3: checkpoint A - export d un rapport vide refuse');

  // --- Checkpoint B : APRES promotion des 4 banques -------------------------
  const b = snapshots.B_after_promotion ?? [];
  check(b.length === 4, '0R-R4: checkpoint B - 4 unites canonical presentes');
  const reportB = await buildDailyV2ReportingSummaries(b);
  if (isDailyV2ReportingSummariesFailure(reportB)) {
    console.error(`TEST_FAILED: 0R-R5 reporting B refuse (${reportB.safeCode})`);
    exit(1);
  }
  check(reportB.groups.length === 4, '0R-R5: checkpoint B - 4 groupes (ATB, BICIS, BIS, BRIDGE)');

  for (const [bank, key] of [
    ['ATB', 'atb_v1'],
    ['BICIS', 'bicis_v1'],
    ['BIS', 'bis_v1'],
    ['BRIDGE', 'bridge_v1'],
  ] as const) {
    const group = groupOf(reportB.groups, bank);
    const want = expected(key);
    check(
      group !== undefined &&
        group.totalDebitsMinor === want.debits &&
        group.totalCreditsMinor === want.credits &&
        group.dayCount === 1 &&
        group.lineCount === payloads[key].units[0].line_count,
      `0R-R6-${bank}: totaux et lignes du groupe ${bank} == classeur Excel reel`,
    );
  }

  const bridgeB = groupOf(reportB.groups, 'BRIDGE');
  check(
    bridgeB !== undefined && bridgeB.needsReviewDayCount === 1,
    '0R-R7: checkpoint B - BRIDGE compte 1 jour a revoir',
  );
  check(
    reportB.groups
      .filter((group) => group.bank !== 'BRIDGE')
      .every((group) => group.needsReviewDayCount === 0),
    '0R-R8: checkpoint B - ATB/BICIS/BIS ne comptent aucun jour a revoir',
  );
  check(
    reportB.groups.every((group) => group.unavailableAggregatesDayCount === 0),
    '0R-R9: checkpoint B - aucun jour sans agregats',
  );

  // Export réel sur les groupes réels.
  const rowsB = buildDailyV2SummaryExportRows(reportB.groups);
  check(
    rowsB.length === 5 && rowsB[0].length === DAILY_V2_SUMMARY_EXPORT_HEADERS.length,
    '0R-R10: checkpoint B - export = 1 entete + 4 lignes, 14 colonnes',
  );
  const csvB = buildDailyV2SummaryCsv(rowsB);
  check(
    csvB.includes(';') && !csvB.includes('fp_e2e_0r'),
    '0R-R11: checkpoint B - le CSV ne fuit jamais le fingerprint de compte',
  );

  // --- Checkpoint C : APRES supersede ---------------------------------------
  const c = snapshots.C_after_supersede ?? [];
  check(c.length === 4, '0R-R12: checkpoint C - toujours 4 unites actives apres supersede');
  const reportC = await buildDailyV2ReportingSummaries(c);
  if (isDailyV2ReportingSummariesFailure(reportC)) {
    console.error(`TEST_FAILED: 0R-R13 reporting C refuse (${reportC.safeCode})`);
    exit(1);
  }

  const atbC = groupOf(reportC.groups, 'ATB');
  const wantSuperseding = expected('atb_v2_conflict');
  const wantSuperseded = expected('atb_v1');
  check(
    atbC !== undefined &&
      atbC.totalDebitsMinor === wantSuperseding.debits &&
      atbC.totalCreditsMinor === wantSuperseding.credits,
    '0R-R13: checkpoint C - le groupe ATB porte le contenu de la REMPLACANTE',
  );
  check(
    atbC !== undefined && atbC.totalDebitsMinor !== wantSuperseded.debits,
    '0R-R14: checkpoint C - le contenu SUPERSEDED a disparu du reporting',
  );
  check(
    atbC !== undefined && atbC.dayCount === 1,
    '0R-R15: checkpoint C - une seule journee ATB active dans le rapport',
  );

  for (const [bank, key] of [
    ['BICIS', 'bicis_v1'],
    ['BIS', 'bis_v1'],
    ['BRIDGE', 'bridge_v1'],
  ] as const) {
    const group = groupOf(reportC.groups, bank);
    const want = expected(key);
    check(
      group !== undefined &&
        group.totalDebitsMinor === want.debits &&
        group.totalCreditsMinor === want.credits,
      `0R-R16-${bank}: checkpoint C - ${bank} inchange par le supersede ATB`,
    );
  }

  if (failures > 0) {
    console.error(`TEST_FAILED: ${failures} assertion(s) de reporting en echec`);
    exit(1);
  }
  console.log('ALL_E2E_0R_REPORTING_PASS');
}

main().catch((error: unknown) => {
  console.error(`TEST_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  exit(1);
});
