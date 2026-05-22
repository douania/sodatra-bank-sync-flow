import type { TextItem } from './positionalExtractionService';
import type {
  BankStatementProfile,
  PositionedBankStatementColumnKey,
  PositionedBankStatementExtractionResult,
  PositionedBankStatementRow
} from '@/types/bankStatementPositioning';

type BDKAccountStatementColumnKey = Extract<
  PositionedBankStatementColumnKey,
  'transactionDate' | 'valueDate' | 'description' | 'debit' | 'credit' | 'balance'
>;

interface ColumnAnchor {
  key: BDKAccountStatementColumnKey;
  item: TextItem;
}

interface ColumnZone {
  key: BDKAccountStatementColumnKey;
  xStart: number;
  xEnd: number;
}

interface PhysicalRow {
  y: number;
  items: TextItem[];
}

interface PositionedTransactionRow {
  sourceRowIndex: number;
  transactionDate: string;
  valueDate: string;
  descriptionParts: string[];
  debit: string;
  credit: string;
  balance: string;
}

export interface BDKAccountStatementPositionalRowsResult
  extends PositionedBankStatementExtractionResult {
  rows: string[];
  rowOrientedText: string;
}

const HEADER_LABELS: Record<BDKAccountStatementColumnKey, readonly string[]> = {
  transactionDate: ['date'],
  valueDate: ['valeur'],
  description: ['libelle'],
  debit: ['debit'],
  credit: ['credit'],
  balance: ['solde']
};

const HEADER_ORDER: readonly BDKAccountStatementColumnKey[] = [
  'transactionDate',
  'valueDate',
  'description',
  'debit',
  'credit',
  'balance'
];

export const BDK_ACCOUNT_STATEMENT_POSITIONAL_PROFILE: BankStatementProfile = {
  id: 'bdk-account-statement',
  bank: 'BDK',
  signMode: 'column',
  expectedColumns: HEADER_ORDER,
  headerAliases: HEADER_LABELS,
  dateFormat: 'dd/MM/yyyy',
  amountFormat: {
    thousandSeparators: [' ', '\u00a0', '\u202f']
  },
  summaryRules: {
    opening: ['Solde initial'],
    totals: ['Total'],
    closing: ['Solde (XOF) au']
  }
};

const DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;
const ROW_Y_TOLERANCE = 4;

export function reconstructBDKAccountStatementRows(
  items: TextItem[]
): BDKAccountStatementPositionalRowsResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const anchors = detectHeaderAnchors(items);

  if (anchors.length !== HEADER_ORDER.length) {
    const detectedKeys = new Set(anchors.map((anchor) => anchor.key));
    const missingHeaders = HEADER_ORDER.filter((key) => !detectedKeys.has(key));

    return buildResult([], [], [
      `Missing BDK account statement column headers: ${missingHeaders.join(', ')}.`
    ], warnings);
  }

  const headerItems = new Set(anchors.map((anchor) => anchor.item));
  const headerBottom = Math.max(...anchors.map((anchor) => anchor.item.y));
  const zones = createColumnZones(anchors);
  const bodyRows = groupByPhysicalRows(
    items.filter((item) => !headerItems.has(item) && item.y > headerBottom + ROW_Y_TOLERANCE)
  );
  const transactions: PositionedTransactionRow[] = [];
  let currentTransaction: PositionedTransactionRow | undefined;

  bodyRows.forEach((row, sourceRowIndex) => {
    const cells = readCells(row.items, zones);
    const transactionDate = cells.transactionDate;
    const valueDate = cells.valueDate;
    const description = cells.description;
    const hasTransactionDates = DATE_PATTERN.test(transactionDate) && DATE_PATTERN.test(valueDate);
    const hasAnyDate = Boolean(transactionDate || valueDate);
    const hasNumericColumns = Boolean(cells.debit || cells.credit || cells.balance);

    if (hasTransactionDates) {
      if (currentTransaction) {
        transactions.push(currentTransaction);
      }

      currentTransaction = {
        sourceRowIndex,
        transactionDate,
        valueDate,
        descriptionParts: description ? [description] : [],
        debit: cells.debit,
        credit: cells.credit,
        balance: cells.balance
      };

      validateTransactionCells(currentTransaction, errors);
      return;
    }

    if (hasAnyDate) {
      errors.push(`Physical row ${sourceRowIndex} has an incomplete transaction date pair.`);
      return;
    }

    if (description && !hasNumericColumns) {
      if (!currentTransaction) {
        errors.push(`Physical row ${sourceRowIndex} is an orphan description continuation.`);
        return;
      }

      currentTransaction.descriptionParts.push(description);
      return;
    }

    if (row.items.length > 0) {
      warnings.push(`Ignored non-transaction physical row ${sourceRowIndex}.`);
    }
  });

  if (currentTransaction) {
    transactions.push(currentTransaction);
  }

  if (transactions.length === 0) {
    errors.push('No positioned BDK account statement transaction rows reconstructed.');
  }

  const positionedRows = transactions.map(toPositionedRow);
  const rows = positionedRows.map(formatTransactionRow);
  return buildResult(positionedRows, rows, errors, warnings);
}

function detectHeaderAnchors(items: TextItem[]): ColumnAnchor[] {
  return HEADER_ORDER.flatMap((key) => {
    const item = items.find((candidate) => matchesHeaderLabel(key, candidate.text));
    return item ? [{ key, item }] : [];
  });
}

function matchesHeaderLabel(key: BDKAccountStatementColumnKey, value: string): boolean {
  const normalized = normalizeLabel(value);

  if (HEADER_LABELS[key].includes(normalized)) {
    return true;
  }

  if (key === 'description') {
    return normalizeLetters(normalized) === 'libelledeloperation';
  }

  if (key === 'debit' || key === 'credit' || key === 'balance') {
    return matchesCurrencyHeaderLabel(key, normalized);
  }

  return false;
}

function matchesCurrencyHeaderLabel(
  key: Extract<BDKAccountStatementColumnKey, 'debit' | 'credit' | 'balance'>,
  normalized: string
): boolean {
  const label = HEADER_LABELS[key][0];

  return new RegExp(`^${label}\\([a-z]{3}\\)$`).test(normalized);
}

function createColumnZones(anchors: ColumnAnchor[]): ColumnZone[] {
  const sortedAnchors = [...anchors].sort((left, right) => left.item.x - right.item.x);

  return sortedAnchors.map((anchor, index) => {
    const previous = sortedAnchors[index - 1]?.item.x;
    const next = sortedAnchors[index + 1]?.item.x;

    return {
      key: anchor.key,
      xStart: previous === undefined ? Number.NEGATIVE_INFINITY : midpoint(previous, anchor.item.x),
      xEnd: next === undefined ? Number.POSITIVE_INFINITY : midpoint(anchor.item.x, next)
    };
  });
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

function readCells(items: TextItem[], zones: ColumnZone[]): Record<BDKAccountStatementColumnKey, string> {
  const cellItems = new Map<BDKAccountStatementColumnKey, TextItem[]>(
    HEADER_ORDER.map((key) => [key, []])
  );

  items.forEach((item) => {
    const zone = zones.find((candidate) => item.x >= candidate.xStart && item.x < candidate.xEnd);
    if (zone) {
      cellItems.get(zone.key)?.push(item);
    }
  });

  return HEADER_ORDER.reduce((cells, key) => ({
    ...cells,
    [key]: joinTextItems(cellItems.get(key) ?? [])
  }), {} as Record<BDKAccountStatementColumnKey, string>);
}

function validateTransactionCells(row: PositionedTransactionRow, errors: string[]): void {
  if (row.descriptionParts.length === 0) {
    errors.push(`Transaction physical row ${row.sourceRowIndex} has no description.`);
  }

  if (!row.balance) {
    errors.push(`Transaction physical row ${row.sourceRowIndex} has no running balance.`);
  }

  if (!row.debit && !row.credit) {
    errors.push(`Transaction physical row ${row.sourceRowIndex} has no debit or credit amount.`);
  }

  if (row.debit && row.credit) {
    errors.push(`Transaction physical row ${row.sourceRowIndex} has both debit and credit amounts.`);
  }
}

function toPositionedRow(row: PositionedTransactionRow): PositionedBankStatementRow {
  const hasDebit = Boolean(row.debit);
  const hasCredit = Boolean(row.credit);

  return {
    sourceRowIndex: row.sourceRowIndex,
    transactionDate: row.transactionDate,
    valueDate: row.valueDate,
    description: row.descriptionParts.join(' ').trim(),
    debit: row.debit,
    credit: row.credit,
    balance: row.balance,
    amountColumn: hasDebit === hasCredit ? undefined : hasDebit ? 'debit' : 'credit',
    direction: hasDebit === hasCredit ? 'unknown' : hasDebit ? 'debit' : 'credit'
  };
}

function formatTransactionRow(row: PositionedBankStatementRow): string {
  const amount = row.debit && row.credit ? '' : row.debit || row.credit;

  return [
    row.transactionDate,
    row.valueDate,
    row.description,
    amount,
    row.balance
  ]
    .filter((value, index) => index < 3 || Boolean(value))
    .join('  ')
    .trim();
}

function joinTextItems(items: TextItem[]): string {
  return [...items]
    .sort((left, right) => left.x - right.x)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeLetters(value: string): string {
  return value.replace(/[^a-z]/g, '');
}

function midpoint(left: number, right: number): number {
  return left + (right - left) / 2;
}

function buildResult(
  positionedRows: PositionedBankStatementRow[],
  rows: string[],
  errors: string[],
  warnings: string[]
): BDKAccountStatementPositionalRowsResult {
  return {
    success: rows.length > 0 && errors.length === 0,
    profile: BDK_ACCOUNT_STATEMENT_POSITIONAL_PROFILE,
    positionedRows,
    rows,
    rowOrientedText: rows.join('\n'),
    errors,
    warnings
  };
}
