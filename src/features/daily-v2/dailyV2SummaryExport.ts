/**
 * CSV / XLSX summary export for the Daily v2 reporting
 * (DAILY-V2-CANONICAL-REPORTING-EXPORT-0O).
 *
 * Pure, testable builders (rows, CSV text, file name) are separated from the
 * browser-only download triggers. Every exported cell is TEXT: monetary
 * values are rendered from bigint minor units through
 * `dailyV2MinorUnitsToDecimalText` and never transit through a JS number, in
 * CSV as in XLSX.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - only the 14 authorized summary columns are exported — never an account
 *    identifier, technical id, UUID, hash, actor or transaction label;
 *  - CSV-injection protection: any cell whose first non-blank character is
 *    `=`, `+`, `-` or `@` (negative amounts included) is prefixed with an
 *    apostrophe;
 *  - an empty report is refused explicitly — no empty file is ever produced;
 *  - the file name carries only the requested period, never a bank or any
 *    account material;
 *  - the xlsx dependency is loaded lazily inside the download action only.
 */

import { dailyV2MinorUnitsToDecimalText } from './dailyV2Money';
import type {
  DailyV2ReportingFilters,
  DailyV2ReportingGroupSummary,
} from './dailyV2ReportingCalculations';

export const DAILY_V2_SUMMARY_EXPORT_SEPARATOR = ';';

export const DAILY_V2_SUMMARY_EXPORT_HEADERS = Object.freeze([
  'Banque',
  'Devise',
  'Alias compte',
  'Première date',
  'Dernière date',
  'Nombre de jours',
  'Nombre de lignes',
  'Total débits',
  'Total crédits',
  'Flux net',
  'Premier solde d’ouverture',
  'Dernier solde de clôture',
  'Jours à revoir',
  'Jours sans agrégats',
] as const);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FORMULA_FIRST_CHARS = new Set(['=', '+', '-', '@']);

/**
 * Neutralize spreadsheet formula injection: when the first non-blank
 * character of a cell is =, + , - or @, the cell is prefixed with an
 * apostrophe. Applied to EVERY exported cell, negative amounts included.
 */
export function protectDailyV2ExportCell(value: string): string {
  const firstNonBlank = value.trimStart().charAt(0);
  return FORMULA_FIRST_CHARS.has(firstNonBlank) ? `'${value}` : value;
}

/**
 * Build the export matrix (header + one row per group), all cells as text,
 * protection applied. Refuses an empty report explicitly.
 */
export function buildDailyV2SummaryExportRows(
  groups: readonly DailyV2ReportingGroupSummary[],
): string[][] {
  if (groups.length === 0) {
    throw new Error('EXPORT_EMPTY_REPORT_REFUSED');
  }

  const rows: string[][] = [[...DAILY_V2_SUMMARY_EXPORT_HEADERS]];
  for (const group of groups) {
    rows.push(
      [
        group.bank,
        group.currency,
        group.accountAlias,
        group.firstAccountingDate,
        group.lastAccountingDate,
        String(group.dayCount),
        String(group.lineCount),
        dailyV2MinorUnitsToDecimalText(group.totalDebitsMinor),
        dailyV2MinorUnitsToDecimalText(group.totalCreditsMinor),
        dailyV2MinorUnitsToDecimalText(group.netFlowMinor),
        group.firstOpeningBalanceMinor === null
          ? ''
          : dailyV2MinorUnitsToDecimalText(group.firstOpeningBalanceMinor),
        group.lastClosingBalanceMinor === null
          ? ''
          : dailyV2MinorUnitsToDecimalText(group.lastClosingBalanceMinor),
        String(group.needsReviewDayCount),
        String(group.unavailableAggregatesDayCount),
      ].map(protectDailyV2ExportCell),
    );
  }
  return rows;
}

/**
 * Serialize rows to CSV: `;` separator, RFC-style quoting (quotes doubled,
 * any cell containing separator/quote/newline is wrapped), CRLF row ends.
 * The UTF-8 BOM is added by the download trigger.
 */
export function buildDailyV2SummaryCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map(quoteDailyV2CsvCell).join(DAILY_V2_SUMMARY_EXPORT_SEPARATOR))
    .join('\r\n');
}

function quoteDailyV2CsvCell(value: string): string {
  if (
    value.includes(DAILY_V2_SUMMARY_EXPORT_SEPARATOR) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Safe file name: only the requested period — never a bank, an account alias
 * or any account material. Dates are re-validated fail-closed.
 */
export function buildDailyV2SummaryFileName(
  startDate: string,
  endDate: string,
  extension: 'csv' | 'xlsx',
): string {
  if (!ISO_DATE_PATTERN.test(startDate) || !ISO_DATE_PATTERN.test(endDate)) {
    throw new Error('EXPORT_FILE_NAME_DATES_INVALID');
  }
  return `daily-v2-report_${startDate}_${endDate}.${extension}`;
}

// ---------------------------------------------------------------------------
// Browser-only download triggers (never exercised by the Node test suite)
// ---------------------------------------------------------------------------

export function downloadDailyV2SummaryCsv(
  filters: DailyV2ReportingFilters,
  groups: readonly DailyV2ReportingGroupSummary[],
): void {
  const rows = buildDailyV2SummaryExportRows(groups);
  const csv = buildDailyV2SummaryCsv(rows);
  const fileName = buildDailyV2SummaryFileName(filters.startDate, filters.endDate, 'csv');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerBrowserDownload(blob, fileName);
}

export async function downloadDailyV2SummaryXlsx(
  filters: DailyV2ReportingFilters,
  groups: readonly DailyV2ReportingGroupSummary[],
): Promise<void> {
  const rows = buildDailyV2SummaryExportRows(groups);
  const fileName = buildDailyV2SummaryFileName(filters.startDate, filters.endDate, 'xlsx');
  // Lazy import: xlsx only enters the bundle path when an export is triggered.
  const { utils, writeFile } = await import('xlsx');
  // All cells are strings, so every generated cell is a text cell — no
  // bigint→number conversion and no floating-point amount can appear.
  const worksheet = utils.aoa_to_sheet(rows as string[][]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, 'Daily v2');
  writeFile(workbook, fileName);
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
