/**
 * Génère un payload BIS backfill 100 % synthétique ayant la même volumétrie
 * que la qualification réelle qui a révélé le timeout : 857 journées et
 * 4 798 lignes. Le classeur en mémoire traverse le vrai pipeline navigateur.
 * Aucune donnée bancaire réelle, aucun réseau, aucun secret.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import * as XLSX from 'xlsx';
import {
  prepareDailyV2BrowserDeposit,
  type PrepareDailyV2BrowserResult,
} from '../../../src/features/daily-v2/dailyV2BrowserPipeline';

const ACCOUNT_ID = '00000000-0000-4000-8000-0000000000f1';
const FINGERPRINT = 'f'.repeat(64);
const END = Date.UTC(2026, 7, 25);

interface SyntheticCampaign {
  table: 'bis_mass_payload' | 'bis_cap_payload';
  title: string;
  fileName: string;
  grantId: string;
  unitCount: number;
  lineCount: number;
  start: number;
  end: number;
}

const CAMPAIGNS: readonly SyntheticCampaign[] = [
  {
    table: 'bis_mass_payload',
    title: 'SYNTHETIC BIS MASS BACKFILL',
    fileName: 'SYNTHETIC BIS MASS ONLINE.xls',
    grantId: '00000000-0000-4000-8000-00000000f857',
    unitCount: 857,
    lineCount: 4_798,
    start: Date.UTC(2016, 7, 1),
    end: END,
  },
  {
    table: 'bis_cap_payload',
    title: 'SYNTHETIC BIS STRUCTURAL CAP',
    fileName: 'SYNTHETIC BIS CAP ONLINE.xls',
    grantId: '00000000-0000-4000-8000-000000004000',
    unitCount: 4_000,
    lineCount: 4_000,
    start: END - 3_999 * 24 * 60 * 60 * 1000,
    end: END,
  },
];

function fail(message: string): never {
  console.error(`BIS_MASS_GENERATOR_FAILED: ${message}`);
  return exit(1);
}

function formatDate(utcMs: number): string {
  const date = new Date(utcMs);
  return [
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    date.getUTCFullYear(),
  ].join('/');
}

function buildWorkbook(campaign: SyntheticCampaign): ArrayBuffer {
  const header = new Array(15).fill('');
  header[1] = "Date de l'opération commerciale";
  header[3] = 'Date de valeur';
  header[5] = 'Description';
  header[10] = 'Débit(XOF)';
  header[12] = 'Crédit(XOF)';
  header[14] = 'Solde';

  const rows: unknown[][] = [
    [campaign.title], [], [], [], [], [], [], [], [], [], header,
  ];
  let emitted = 0;
  const baseLinesPerDay = Math.floor(campaign.lineCount / campaign.unitCount);
  const extraLines = campaign.lineCount % campaign.unitCount;
  for (let dayIndex = campaign.unitCount - 1; dayIndex >= 0; dayIndex -= 1) {
    const utcMs = campaign.start
      + Math.floor(((campaign.end - campaign.start) * dayIndex) / (campaign.unitCount - 1));
    const date = formatDate(utcMs);
    const linesForDay = baseLinesPerDay + (dayIndex < extraLines ? 1 : 0);
    for (let lineIndex = linesForDay - 1; lineIndex >= 0; lineIndex -= 1) {
      const line = new Array(15).fill('');
      line[1] = date;
      line[3] = date;
      line[5] = `SYNTHETIC BIS MASS D${dayIndex} L${lineIndex}`;
      if ((dayIndex + lineIndex) % 2 === 0) {
        line[10] = 100 + (lineIndex % 7);
        line[12] = 0;
      } else {
        line[10] = 0;
        line[12] = 200 + (lineIndex % 11);
      }
      // Solde volontairement absent : même chemin needs_review que le fichier
      // réel, sans inventer une chaîne de soldes de dix années.
      rows.push(line);
      emitted += 1;
    }
  }
  if (emitted !== campaign.lineCount) {
    fail(`${campaign.table}: expected ${campaign.lineCount} rows, emitted ${emitted}.`);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'SYNTHETIC');
  const written = XLSX.write(workbook, { type: 'array', bookType: 'xls', compression: false }) as
    | ArrayBuffer
    | Uint8Array;
  if (written instanceof ArrayBuffer) return written;
  return written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
}

function binaryFile(bytes: ArrayBuffer, name: string) {
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.slice(0);
    },
  };
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

  const literal = (value: unknown) => {
    const json = JSON.stringify(value);
    if (json.includes('$bis857$')) fail('payload collides with SQL quoting tag.');
    return `$bis857$${json}$bis857$::jsonb`;
  };
  const sql = [
    '-- Generated from a synthetic BIS workbook by the real browser pipeline.',
    '\\set ON_ERROR_STOP on',
  ];

  for (const campaign of CAMPAIGNS) {
    const result = await prepareDailyV2BrowserDeposit({
      file: binaryFile(buildWorkbook(campaign), campaign.fileName),
      bank: 'BIS',
      currency: 'XOF',
      accountFingerprint: FINGERPRINT,
      accountRegistryId: ACCOUNT_ID,
      requestedMode: 'backfill',
      backfillGrantId: campaign.grantId,
    });
    if (!isSuccess(result)) fail(`${campaign.table}: ${result.errors.join(' | ')}`);
    const { payload } = result;
    if (
      payload.p_units.length !== campaign.unitCount
      || payload.p_lines.length !== campaign.lineCount
    ) {
      fail(
        `${campaign.table}: pipeline emitted ${payload.p_units.length} units / `
        + `${payload.p_lines.length} lines.`,
      );
    }
    if (
      payload.p_attempt.export_period_start !== formatDate(campaign.start)
      || payload.p_attempt.export_period_end !== formatDate(campaign.end)
    ) {
      fail(`${campaign.table}: pipeline period does not match the synthetic campaign.`);
    }
    if (payload.p_units.some((unit) => unit.review_reason_codes.length === 0)) {
      fail(`${campaign.table}: every backfill unit must remain review-required.`);
    }

    sql.push(
      `CREATE TABLE poc_test.${campaign.table} (`,
      '  p_attempt jsonb NOT NULL, p_units jsonb NOT NULL,',
      '  p_lines jsonb NOT NULL, p_guard jsonb NOT NULL',
      ');',
      `GRANT SELECT ON poc_test.${campaign.table} TO PUBLIC;`,
      `INSERT INTO poc_test.${campaign.table} VALUES (`,
      `  ${literal(payload.p_attempt)},`,
      `  ${literal(payload.p_units)},`,
      `  ${literal(payload.p_lines)},`,
      `  ${literal(payload.p_guard_context)}`,
      ');',
      '',
    );
    console.log(
      `${campaign.table}: ${campaign.unitCount} units / ${campaign.lineCount} lines emitted.`,
    );
  }

  writeFileSync(join(outDir, 'bis_mass_payload.sql'), sql.join('\n'), 'utf8');
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
