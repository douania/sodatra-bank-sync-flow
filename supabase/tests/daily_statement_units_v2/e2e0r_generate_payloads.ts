/**
 * LOCAL-E2E-0R — GÉNÉRATEUR DE PAYLOADS RÉELS (TESTS UNIQUEMENT)
 * ============================================================================
 * Construit EN MÉMOIRE quatre classeurs 100 % synthétiques (ATB .xls,
 * BICIS .xls, BIS .xls, BRIDGE .xlsx), puis les fait traverser le VRAI pipeline
 * applicatif `prepareDailyV2BrowserDeposit` — celui que l'UI utilise.
 *
 * Anti-faux-E2E : ce fichier ne fabrique JAMAIS un payload à la main. Les
 * quatre arguments RPC (p_attempt / p_units / p_lines / p_guard_context) sont
 * exclusivement ceux retournés par le pipeline. L'artefact SQL émis ici est la
 * SEULE source de payloads consommée par `30_e2e0r_pipeline.sql` : il n'existe
 * pas de second jeu de fixtures côté SQL.
 *
 * Périmètre : aucune donnée bancaire réelle, aucun accès réseau, aucun Supabase,
 * aucun secret. Sortie déterministe (aucune horloge, aucun aléa).
 *
 * Usage : tsx supabase/tests/daily_statement_units_v2/e2e0r_generate_payloads.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import * as XLSX from 'xlsx';
import {
  prepareDailyV2BrowserDeposit,
  type DailyV2SupportedBank,
  type PrepareDailyV2BrowserResult,
} from '../../../src/features/daily-v2/dailyV2BrowserPipeline';

// --- Constantes de campagne 0R ---------------------------------------------
// Empreintes opaques propres à la campagne : elles n'entrent en collision avec
// aucune identité existante, et day_unit_id = H(bank, fingerprint, currency,
// date) en dépend directement.
const FP_ATB = 'a'.repeat(64);
const FP_BICIS = 'b'.repeat(64);
const FP_BIS = 'c'.repeat(64);
const FP_BRIDGE = 'd'.repeat(64);
const FP_PROV = 'e'.repeat(64);
const ACCOUNT_ATB = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT_BICIS = '00000000-0000-4000-8000-0000000000b1';
const ACCOUNT_BIS = '00000000-0000-4000-8000-0000000000c1';
const ACCOUNT_BRIDGE = '00000000-0000-4000-8000-0000000000d1';
const ACCOUNT_PROV = '00000000-0000-4000-8000-0000000000e1';
const CURRENCY = 'XOF';
const D1 = '09/07/2026';
const D2 = '10/07/2026';
const BACKFILL_GRANT = '00000000-0000-4000-8000-00000000f001';

// --- Fabriques de classeurs synthétiques ------------------------------------
function workbookBytes(rows: unknown[][], bookType: 'xls' | 'xlsx'): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'SYNTHETIC');
  const written = XLSX.write(workbook, { type: 'array', bookType, compression: false }) as
    | ArrayBuffer
    | Uint8Array;
  if (written instanceof ArrayBuffer) return written;
  return written.buffer.slice(
    written.byteOffset,
    written.byteOffset + written.byteLength,
  ) as ArrayBuffer;
}

function excelSerial(day: number, month: number, year: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function binaryFile(name: string, bytes: ArrayBuffer) {
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.slice(0);
    },
  };
}

/** ATB ONLINE .xls — montant signé, lignes en ordre descendant. */
function atbExcel(serial: number, credit: string, debit: string, hi: string, lo: string, tag: string) {
  return workbookBytes(
    [
      ['SYNTHETIC ONLINE EXPORT'],
      [],
      [],
      [],
      [],
      [],
      ['Référence', "Date de l'opération", 'Date Valeur', 'Montant', 'Solde', 'Devise', 'Libellé'],
      [`SYN-${tag}2`, serial, serial, credit, hi, CURRENCY, `E2E0R ATB CREDIT ${tag}`],
      [`SYN-${tag}1`, serial, serial, debit, lo, CURRENCY, `E2E0R ATB DEBIT ${tag}`],
    ],
    'xls',
  );
}

/** BICIS ONLINE .xls — montant signé, lignes en ordre descendant. */
function bicisExcel() {
  return workbookBytes(
    [
      ['SYNTHETIC ONLINE EXPORT'],
      [],
      [],
      [],
      [],
      [],
      [],
      ['Date Opération', 'Date Valeur', 'Référence', 'Montant', 'Libellé', 'Solde', 'Devise'],
      [D1, D1, 'SYN-B2', 250, 'E2E0R BICIS CREDIT', 1150, CURRENCY],
      [D1, D1, 'SYN-B1', -150, 'E2E0R BICIS DEBIT', 900, CURRENCY],
    ],
    'xls',
  );
}

/** BIS ONLINE .xls — débit/crédit séparés, devise fixe XOF, ordre descendant. */
function bisExcel(rows: Array<{ date: string; debit: number; credit: number; balance: string; tag: string }>) {
  const header = new Array(15).fill('');
  header[1] = "Date de l'opération commerciale";
  header[3] = 'Date de valeur';
  header[5] = 'Description';
  header[10] = 'Débit(XOF)';
  header[12] = 'Crédit(XOF)';
  header[14] = 'Solde';
  const body = rows.map((entry) => {
    const line = new Array(15).fill('');
    line[1] = entry.date;
    line[3] = entry.date;
    line[5] = `E2E0R BIS ${entry.tag}`;
    line[10] = entry.debit;
    line[12] = entry.credit;
    line[14] = entry.balance;
    return line;
  });
  return workbookBytes(
    [['SYNTHETIC ONLINE EXPORT'], [], [], [], [], [], [], [], [], [], header, ...body],
    'xls',
  );
}

/** BRIDGE ONLINE .xlsx — aucune devise dans le fichier (=> needs_review). */
function bridgeExcel() {
  return workbookBytes(
    [
      ['Date Operation', 'Description', 'Reference', 'Date Valeur', 'Debit', 'Credit', ''],
      ['09 Jul 2026', 'E2E0R BRIDGE DEBIT', 'SYN-R1', '09 Jul 2026', '100', '', '900'],
      ['09 Jul 2026', 'E2E0R BRIDGE CREDIT', 'SYN-R2', '09 Jul 2026', '', '200', '1,100'],
    ],
    'xlsx',
  );
}

// --- Scénarios --------------------------------------------------------------
interface Scenario {
  key: string;
  bank: DailyV2SupportedBank;
  fileName: string;
  bytes: ArrayBuffer;
  accountFingerprint: string;
  accountRegistryId: string;
  exportReferenceDate?: string;
  requestedMode?: 'daily' | 'backfill';
  backfillGrantId?: string;
  /** Attentes vérifiées ici même : le générateur échoue si le pipeline dévie. */
  expect: {
    unitsCount: number;
    parserValidationStatus: 'valid' | 'needs_review';
    provisionalUnitsCount: number;
  };
}

const S1 = excelSerial(9, 7, 2026);
const S2 = excelSerial(10, 7, 2026);

const SCENARIOS: Scenario[] = [
  {
    key: 'atb_v1',
    bank: 'ATB',
    fileName: 'e2e 0r atb v1.xls',
    bytes: atbExcel(S1, '200', '-100', '1,100', '900', 'A'),
    accountFingerprint: FP_ATB,
    accountRegistryId: ACCOUNT_ATB,
    expect: { unitsCount: 1, parserValidationStatus: 'valid', provisionalUnitsCount: 0 },
  },
  {
    // Même journée / compte / devise que atb_v1, contenu différent => R2 conflict.
    key: 'atb_v2_conflict',
    bank: 'ATB',
    fileName: 'e2e 0r atb v2.xls',
    bytes: atbExcel(S1, '250', '-150', '1,150', '900', 'C'),
    accountFingerprint: FP_ATB,
    accountRegistryId: ACCOUNT_ATB,
    expect: { unitsCount: 1, parserValidationStatus: 'valid', provisionalUnitsCount: 0 },
  },
  {
    // Journée D2 du même compte : support de la sonde R3 (voir 30_*.sql).
    key: 'atb_d2',
    bank: 'ATB',
    fileName: 'e2e 0r atb d2.xls',
    bytes: atbExcel(S2, '300', '-100', '1,400', '1,100', 'D'),
    accountFingerprint: FP_ATB,
    accountRegistryId: ACCOUNT_ATB,
    expect: { unitsCount: 1, parserValidationStatus: 'valid', provisionalUnitsCount: 0 },
  },
  {
    // Journée non close : accounting_date >= export_reference_date => provisional.
    key: 'atb_provisional',
    bank: 'ATB',
    fileName: 'e2e 0r atb prov.xls',
    bytes: atbExcel(S1, '200', '-100', '1,100', '900', 'P'),
    accountFingerprint: FP_PROV,
    accountRegistryId: ACCOUNT_PROV,
    exportReferenceDate: D1,
    expect: { unitsCount: 1, parserValidationStatus: 'valid', provisionalUnitsCount: 1 },
  },
  {
    key: 'bicis_v1',
    bank: 'BICIS',
    fileName: 'e2e 0r bicis v1.xls',
    bytes: bicisExcel(),
    accountFingerprint: FP_BICIS,
    accountRegistryId: ACCOUNT_BICIS,
    expect: { unitsCount: 1, parserValidationStatus: 'valid', provisionalUnitsCount: 0 },
  },
  {
    key: 'bis_v1',
    bank: 'BIS',
    fileName: 'e2e 0r bis v1.xls',
    bytes: bisExcel([
      { date: D1, debit: 0, credit: 200, balance: '1,100 Créditeur', tag: 'CREDIT' },
      { date: D1, debit: 100, credit: 0, balance: '900 Créditeur', tag: 'DEBIT' },
    ]),
    accountFingerprint: FP_BIS,
    accountRegistryId: ACCOUNT_BIS,
    expect: { unitsCount: 1, parserValidationStatus: 'valid', provisionalUnitsCount: 0 },
  },
  {
    // Fenêtre > 45 jours : mode backfill obligatoire, grant obligatoire, admin seul.
    key: 'bis_backfill',
    bank: 'BIS',
    fileName: 'e2e 0r bis backfill.xls',
    bytes: bisExcel([
      { date: '20/02/2026', debit: 0, credit: 200, balance: '1,100 Créditeur', tag: 'CREDIT' },
      { date: '01/01/2026', debit: 100, credit: 0, balance: '900 Créditeur', tag: 'DEBIT' },
    ]),
    accountFingerprint: FP_BIS,
    accountRegistryId: ACCOUNT_BIS,
    requestedMode: 'backfill',
    backfillGrantId: BACKFILL_GRANT,
    expect: { unitsCount: 2, parserValidationStatus: 'valid', provisionalUnitsCount: 0 },
  },
  {
    // BRIDGE ne porte aucune devise => forceReviewAllUnits => needs_review.
    key: 'bridge_v1',
    bank: 'BRIDGE',
    fileName: 'e2e 0r bridge v1.xlsx',
    bytes: bridgeExcel(),
    accountFingerprint: FP_BRIDGE,
    accountRegistryId: ACCOUNT_BRIDGE,
    expect: { unitsCount: 1, parserValidationStatus: 'needs_review', provisionalUnitsCount: 0 },
  },
];

// --- Exécution du pipeline RÉEL ---------------------------------------------
function fail(message: string): never {
  console.error(`GENERATOR_FAILED: ${message}`);
  return exit(1);
}

function isSuccess(
  result: PrepareDailyV2BrowserResult,
): result is Extract<PrepareDailyV2BrowserResult, { success: true }> {
  return result.success === true;
}

async function main(): Promise<void> {
  const outDir = argv[2];
  if (!outDir) fail('outDir argument is required.');
  mkdirSync(outDir, { recursive: true });

  const rows: string[] = [];
  const trace: Record<string, unknown> = {};

  // Garde anti-collision réelle : un daily_line_hash appartient à UNE seule
  // journée (le pipeline embarque le dayUnitId dans la préimage du hash).
  // Toute réutilisation sous un day_unit_id différent révèle un bug d'identité
  // et stoppe le générateur immédiatement (fail-closed). Une répétition sous le
  // MÊME day_unit_id (scénarios R1/R2 visant la même journée) reste permise.
  const lineHashOwner = new Map<string, string>();

  for (const scenario of SCENARIOS) {
    const result = await prepareDailyV2BrowserDeposit({
      file: binaryFile(scenario.fileName, scenario.bytes),
      bank: scenario.bank,
      currency: CURRENCY,
      accountFingerprint: scenario.accountFingerprint,
      accountRegistryId: scenario.accountRegistryId,
      exportReferenceDate: scenario.exportReferenceDate,
      requestedMode: scenario.requestedMode,
      backfillGrantId: scenario.backfillGrantId,
    });

    if (!isSuccess(result)) {
      fail(`${scenario.key}: the real pipeline refused the deposit — ${result.errors.join(' | ')}`);
    }

    const { payload, diagnostic } = result;

    // Le générateur est fail-closed : toute dérive du pipeline stoppe le lot.
    if (payload.p_units.length !== scenario.expect.unitsCount) {
      fail(
        `${scenario.key}: expected ${scenario.expect.unitsCount} unit(s), pipeline produced ${payload.p_units.length}.`,
      );
    }
    if (diagnostic.parserValidationStatus !== scenario.expect.parserValidationStatus) {
      fail(
        `${scenario.key}: expected parserValidationStatus=${scenario.expect.parserValidationStatus}, got ${diagnostic.parserValidationStatus}.`,
      );
    }
    if (diagnostic.provisionalUnitsCount !== scenario.expect.provisionalUnitsCount) {
      fail(
        `${scenario.key}: expected provisionalUnitsCount=${scenario.expect.provisionalUnitsCount}, got ${diagnostic.provisionalUnitsCount}.`,
      );
    }

    for (const line of payload.p_lines) {
      const owner = lineHashOwner.get(line.daily_line_hash);
      if (owner !== undefined && owner !== line.day_unit_id) {
        fail(
          `${scenario.key}: a daily_line_hash is reused under a different day_unit_id (identity bug, fail-closed).`,
        );
      }
      lineHashOwner.set(line.daily_line_hash, line.day_unit_id);
    }

    // Garde dollar-quoting : le JSON ne doit jamais contenir le délimiteur de
    // l'artefact SQL — sinon l'insertion serait syntaxiquement corrompue.
    const literal = (value: unknown) => {
      const json = JSON.stringify(value);
      if (json.includes('$e2e0r$')) {
        fail(`${scenario.key}: payload JSON contains the $e2e0r$ quoting tag (fail-closed).`);
      }
      return `$e2e0r$${json}$e2e0r$::jsonb`;
    };
    rows.push(
      `  ('${scenario.key}', ${literal(payload.p_attempt)}, ${literal(payload.p_units)}, ` +
        `${literal(payload.p_lines)}, ${literal(payload.p_guard_context)})`,
    );

    trace[scenario.key] = {
      bank: scenario.bank,
      accountFingerprint: scenario.accountFingerprint,
      accountRegistryId: scenario.accountRegistryId,
      requestedMode: payload.p_attempt.requested_mode,
      sourceFormat: payload.p_attempt.source_format,
      diagnostic,
      units: payload.p_units.map((unit) => ({
        day_unit_id: unit.day_unit_id,
        accounting_date: unit.accounting_date,
        day_content_hash: unit.day_content_hash,
        line_count: unit.line_count,
        day_total_debits: unit.day_total_debits,
        day_total_credits: unit.day_total_credits,
        opening_balance_derived: unit.opening_balance_derived,
        closing_balance_derived: unit.closing_balance_derived,
        aggregates_status: unit.aggregates_status,
        validation_status: unit.validation_status,
        requested_unit_status: unit.requested_unit_status,
      })),
    };
  }

  const sql = [
    '-- ==========================================================================',
    '-- LOCAL-E2E-0R — ARTEFACT GÉNÉRÉ (NE PAS ÉDITER À LA MAIN)',
    '-- ==========================================================================',
    '-- Produit par supabase/tests/daily_statement_units_v2/e2e0r_generate_payloads.ts',
    '-- Chaque ligne porte les QUATRE arguments RPC tels que retournés par le vrai',
    '-- pipeline TypeScript (prepareDailyV2BrowserDeposit) depuis un classeur Excel',
    '-- synthétique. Aucun payload n a ete ecrit a la main.',
    '-- ==========================================================================',
    '\\set ON_ERROR_STOP on',
    '',
    'CREATE TABLE poc_test.e2e0r_payload (',
    '  key       text PRIMARY KEY,',
    '  p_attempt jsonb NOT NULL,',
    '  p_units   jsonb NOT NULL,',
    '  p_lines   jsonb NOT NULL,',
    '  p_guard   jsonb NOT NULL',
    ');',
    'GRANT SELECT ON poc_test.e2e0r_payload TO PUBLIC;',
    '',
    'INSERT INTO poc_test.e2e0r_payload (key, p_attempt, p_units, p_lines, p_guard) VALUES',
    `${rows.join(',\n')};`,
    '',
    `SELECT poc_test.assert((SELECT count(*) FROM poc_test.e2e0r_payload) = ${SCENARIOS.length},`,
    `  '0R: ${SCENARIOS.length} payloads reels charges depuis le pipeline TypeScript');`,
    '',
  ].join('\n');

  writeFileSync(join(outDir, 'e2e0r_payloads.sql'), sql, 'utf8');
  writeFileSync(join(outDir, 'e2e0r_payloads.json'), `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

  console.log(`0R generator: ${SCENARIOS.length} real payloads emitted to ${outDir}`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
