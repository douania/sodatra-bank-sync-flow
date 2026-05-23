import type { TextItem } from './positionalExtractionService';

export interface BDKAccountStatementPositionedBalancesResult {
  openingBalance?: number;
  closingBalance?: number;
  closingDate?: string;
  openingBalanceFound: boolean;
  closingBalanceFound: boolean;
  errors: string[];
  warnings: string[];
}

interface PhysicalTextLine {
  y: number;
  items: TextItem[];
}

const ROW_Y_TOLERANCE = 4;
const AMOUNT_PATTERN = '([0-9][0-9\\s]*)';
const OPENING_BALANCE_PATTERN = new RegExp(
  `\\bsolde\\s+initial\\s*\\(\\s*xof\\s*\\)\\s*:?\\s*${AMOUNT_PATTERN}\\b`,
  'i'
);
const CLOSING_BALANCE_PATTERN = new RegExp(
  `\\bsolde\\s*\\(\\s*xof\\s*\\)\\s*au\\s*(\\d{2}/\\d{2}/\\d{4})\\s*:?\\s*${AMOUNT_PATTERN}\\b`,
  'i'
);

export function extractBDKAccountStatementPositionedBalances(
  items: TextItem[]
): BDKAccountStatementPositionedBalancesResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  let closingDate: string | undefined;
  let openingBalanceFound = false;
  let closingBalanceFound = false;

  groupByPhysicalLines(items)
    .map((line) => normalizeLine(joinTextItems(line.items)))
    .forEach((lineText) => {
      const openingMatch = lineText.match(OPENING_BALANCE_PATTERN);
      if (openingMatch) {
        openingBalanceFound = true;
        openingBalance = parseBDKAmount(openingMatch[1]);
      }

      const closingMatch = lineText.match(CLOSING_BALANCE_PATTERN);
      if (closingMatch) {
        closingBalanceFound = true;
        closingDate = closingMatch[1];
        closingBalance = parseBDKAmount(closingMatch[2]);
      }
    });

  if (!openingBalanceFound || openingBalance === undefined) {
    errors.push('Missing BDK positioned opening balance.');
  }

  if (!closingBalanceFound || closingBalance === undefined) {
    errors.push('Missing BDK positioned closing balance.');
  }

  return {
    openingBalance,
    closingBalance,
    closingDate,
    openingBalanceFound,
    closingBalanceFound,
    errors,
    warnings
  };
}

function groupByPhysicalLines(items: TextItem[]): PhysicalTextLine[] {
  const lines: PhysicalTextLine[] = [];

  [...items]
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .forEach((item) => {
      const currentLine = lines.at(-1);

      if (!currentLine || Math.abs(item.y - currentLine.y) > ROW_Y_TOLERANCE) {
        lines.push({ y: item.y, items: [item] });
        return;
      }

      currentLine.items.push(item);
    });

  return lines;
}

function joinTextItems(items: TextItem[]): string {
  return [...items]
    .sort((left, right) => left.x - right.x)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(' ');
}

function normalizeLine(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBDKAmount(value: string): number | undefined {
  const normalized = value.replace(/\s+/g, '');

  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  return Number.parseInt(normalized, 10);
}
