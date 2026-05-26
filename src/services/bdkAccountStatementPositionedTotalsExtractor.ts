import type { TextItem } from './positionalExtractionService';

export interface BDKAccountStatementPositionedTotalsResult {
  totalDebits?: number;
  totalCredits?: number;
  totalDebitsFound: boolean;
  totalCreditsFound: boolean;
  errors: string[];
  warnings: string[];
}

interface PhysicalRow {
  y: number;
  items: TextItem[];
}

interface AmountCandidate {
  amount: number;
  item: TextItem;
}

interface AmountZones {
  debit: ColumnZone;
  credit: ColumnZone;
}

interface ColumnZone {
  xStart: number;
  xEnd: number;
}

const ROW_Y_TOLERANCE = 4;

export function extractBDKAccountStatementPositionedTotals(
  items: TextItem[]
): BDKAccountStatementPositionedTotalsResult {
  const warnings: string[] = [];
  const totalRows = groupByPhysicalRows(items).filter((row) => isTotalRow(row));

  if (totalRows.length === 0) {
    return buildRejectedResult('No BDK positioned declared totals row found.', warnings);
  }

  if (totalRows.length > 1) {
    return buildRejectedResult('Multiple BDK positioned declared totals rows found.', warnings);
  }

  const totalRow = totalRows[0];
  const candidates = totalRow.items.flatMap(extractAmountCandidates);

  if (candidates.length < 2) {
    return buildRejectedResult(
      'BDK positioned declared totals row must contain both debit and credit totals.',
      warnings
    );
  }

  if (candidates.length === 2) {
    return buildTotalsResult(candidates[0].amount, candidates[1].amount, warnings);
  }

  const zones = detectDebitCreditZones(items);
  if (!zones) {
    return buildRejectedResult(
      'BDK positioned declared totals row is ambiguous and debit/credit columns were not detected.',
      warnings
    );
  }

  const debitCandidates = candidates.filter((candidate) => isInZone(candidate.item, zones.debit));
  const creditCandidates = candidates.filter((candidate) => isInZone(candidate.item, zones.credit));

  if (debitCandidates.length !== 1 || creditCandidates.length !== 1) {
    return buildRejectedResult(
      'BDK positioned declared totals row is ambiguous for debit/credit columns.',
      warnings
    );
  }

  return buildTotalsResult(debitCandidates[0].amount, creditCandidates[0].amount, warnings);
}

function groupByPhysicalRows(items: TextItem[]): PhysicalRow[] {
  const rows: PhysicalRow[] = [];

  [...items]
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .forEach((item) => {
      const currentRow = rows.at(-1);

      if (!currentRow || Math.abs(item.y - currentRow.y) > ROW_Y_TOLERANCE) {
        rows.push({ y: item.y, items: [item] });
        return;
      }

      currentRow.items.push(item);
    });

  return rows;
}

function isTotalRow(row: PhysicalRow): boolean {
  const rowText = joinRowText(row);

  return row.items.some((item) => normalizeLabel(item.text) === 'total')
    || /^total\b/.test(normalizeWords(rowText));
}

function extractAmountCandidates(item: TextItem): AmountCandidate[] {
  const amountPattern = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+/g;
  return [...normalizeSpaces(item.text).matchAll(amountPattern)]
    .map((match) => parseAmount(match[0]))
    .filter((amount): amount is number => amount !== undefined)
    .map((amount) => ({ amount, item }));
}

function detectDebitCreditZones(items: TextItem[]): AmountZones | undefined {
  const debitHeader = findHeaderItem(items, 'debit');
  const creditHeader = findHeaderItem(items, 'credit');

  if (!debitHeader || !creditHeader || debitHeader.x >= creditHeader.x) {
    return undefined;
  }

  const sortedHeaderX = [...items]
    .filter((item) => item.y === debitHeader.y || item.y === creditHeader.y)
    .map((item) => item.x)
    .sort((left, right) => left - right);
  const debitIndex = sortedHeaderX.findIndex((x) => x === debitHeader.x);
  const creditIndex = sortedHeaderX.findIndex((x) => x === creditHeader.x);
  const debitPrevious = sortedHeaderX[debitIndex - 1];
  const creditNext = sortedHeaderX[creditIndex + 1];
  const debitCreditBoundary = midpoint(debitHeader.x, creditHeader.x);

  return {
    debit: {
      xStart: debitPrevious === undefined ? Number.NEGATIVE_INFINITY : midpoint(debitPrevious, debitHeader.x),
      xEnd: debitCreditBoundary
    },
    credit: {
      xStart: debitCreditBoundary,
      xEnd: creditNext === undefined ? Number.POSITIVE_INFINITY : midpoint(creditHeader.x, creditNext)
    }
  };
}

function findHeaderItem(items: TextItem[], header: 'debit' | 'credit'): TextItem | undefined {
  return items.find((item) => {
    const normalized = normalizeLabel(item.text);
    return normalized === header || new RegExp(`^${header}\\([a-z]{3}\\)$`).test(normalized);
  });
}

function isInZone(item: TextItem, zone: ColumnZone): boolean {
  return item.x >= zone.xStart && item.x < zone.xEnd;
}

function parseAmount(value: string): number | undefined {
  const normalized = value.replace(/[\s\u00a0\u202f]+/g, '');

  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  return Number.parseInt(normalized, 10);
}

function normalizeLabel(value: string): string {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeWords(value: string): string {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeSpaces(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, ' ').trim();
}

function joinRowText(row: PhysicalRow): string {
  return [...row.items]
    .sort((left, right) => left.x - right.x)
    .map((item) => item.text)
    .join(' ');
}

function midpoint(left: number, right: number): number {
  return left + (right - left) / 2;
}

function buildTotalsResult(
  totalDebits: number,
  totalCredits: number,
  warnings: string[]
): BDKAccountStatementPositionedTotalsResult {
  return {
    totalDebits,
    totalCredits,
    totalDebitsFound: true,
    totalCreditsFound: true,
    errors: [],
    warnings
  };
}

function buildRejectedResult(
  error: string,
  warnings: string[]
): BDKAccountStatementPositionedTotalsResult {
  return {
    totalDebitsFound: false,
    totalCreditsFound: false,
    errors: [error],
    warnings
  };
}
