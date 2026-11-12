// Volet « Fund Position » : lecture cellule par cellule de l'onglet du jour,
// utilisée comme RÉFÉRENCE COMPARATIVE seulement (son import n'est pas
// réactivé). Les valeurs déclarées et les valeurs recalculées restent
// distinctes. Une cellule absente ou ambiguë est signalée par un code et une
// adresse de cellule, sans jamais recopier le contenu d'une ligne source.
import {
  SITUATION_BANKS,
  amountsEqual,
  cellAddress,
  cellAt,
  cellNumber,
  cellText,
  SITUATION_EXPECTED_CURRENCY,
  detectBankFromStrictLabel,
  hiddenSheetNames,
  normalizeLabel,
  onlyWeekendBetween,
  readWorkbook,
  sheetNameToIso,
  usefulBounds,
} from './situationCore';
import type { Sheet, SituationBank } from './situationCore';
import type { AccountBalance } from './statementBalances';
import type { WorkbookEncours } from './monthlyWorkbook';

export type FundPositionReason = 'WORKBOOK_UNREADABLE' | 'TAB_ABSENT' | 'TAB_AMBIGUOUS' | 'HEADER_NOT_FOUND';

export const FUND_POSITION_REASON_LABELS: Record<FundPositionReason, string> = {
  WORKBOOK_UNREADABLE: 'Classeur Fund Position illisible',
  TAB_ABSENT: 'Aucun onglet daté après la date comptable',
  TAB_AMBIGUOUS: 'Plusieurs onglets portent la même date',
  HEADER_NOT_FOUND: 'En-tête de la Fund Position introuvable ou ambigu dans l’onglet',
};

export type FundPositionIssueCode =
  | 'CELL_ABSENT'
  | 'CELL_NOT_NUMERIC'
  | 'BANK_ROW_AMBIGUOUS'
  | 'BANK_LABEL_UNKNOWN'
  | 'DECLARED_NET_DIFFERS_FROM_RECALCULATED'
  | 'DECLARED_TOTAL_DIFFERS_FROM_RECALCULATED';

export interface FundPositionIssue {
  code: FundPositionIssueCode;
  /** Adresse de cellule (ex. « C4 ») ; jamais le contenu de la ligne. */
  address: string;
  bank: SituationBank | null;
}

export interface FundPositionCell {
  address: string;
  /** `null` : cellule absente ou non numérique. `0` : zéro explicitement saisi. */
  value: number | null;
}

export interface FundPositionBankRow {
  bank: SituationBank;
  rowNumber: number;
  declared: {
    bankBalance: FundPositionCell;
    fundApplied: FundPositionCell;
    netBalance: FundPositionCell;
    nonValidatedDeposit: FundPositionCell;
    position: FundPositionCell;
  };
  recalculated: {
    /** Bank Balance − Fund Applied, quand les deux sont présents. */
    netBalance: number | null;
    /** Net recalculé + NonValidated Deposit. */
    position: number | null;
  };
}

export interface FundPositionReading {
  available: boolean;
  reason: FundPositionReason | null;
  tabName: string | null;
  tabDate: string | null;
  /**
   * Vrai seulement si l'onglet suit D au jour ouvré près (aucun jour de semaine
   * entre les deux) : sinon un onglet manque et aucun écart n'est calculé.
   */
  dateComparable: boolean;
  rows: FundPositionBankRow[];
  issues: FundPositionIssue[];
}

export type ComparisonStatus = 'EQUAL' | 'DIFFERENT' | 'NOT_COMPARABLE';
export type ComparisonReason = 'SOURCE_UNAVAILABLE' | 'DECLARED_ABSENT' | 'DATE_NOT_COMPARABLE' | 'CURRENCY_NOT_COMPARABLE';

export interface FundPositionComparison {
  bank: SituationBank;
  indicator: 'BANK_BALANCE_VS_STATEMENT' | 'BANK_BALANCE_VS_WORKBOOK' | 'FUND_APPLIED_VS_WORKBOOK' | 'NON_VALIDATED_VS_WORKBOOK';
  status: ComparisonStatus;
  reason: ComparisonReason | null;
  declared: number | null;
  source: number | null;
  /** Déclaré − source, seulement quand la comparaison est possible. */
  delta: number | null;
}

export const FUND_POSITION_INDICATOR_LABELS: Record<FundPositionComparison['indicator'], string> = {
  BANK_BALANCE_VS_STATEMENT: 'Bank Balance / relevé',
  BANK_BALANCE_VS_WORKBOOK: 'Bank Balance / classeur',
  FUND_APPLIED_VS_WORKBOOK: 'Fund Applied / chèques non débités',
  NON_VALIDATED_VS_WORKBOOK: 'NonValidated Deposit / dépôts en attente',
};

const HEADERS = {
  bankBalance: 'BANK BALANCE',
  fundApplied: 'FUND APPLIED',
  netBalance: 'NET BALANCE',
  nonValidatedDeposit: 'NONVALIDATED DEPOSIT',
} as const;

const BLOCK_END = /DEPOSIT FOR THE DAY|PAYMENT FOR THE DAY|TOTAL FUND AVAILABLE/;

function unavailable(reason: FundPositionReason): FundPositionReading {
  return { available: false, reason, tabName: null, tabDate: null, dateComparable: false, rows: [], issues: [] };
}

function findHeader(sheet: Sheet, lastColumn: number): { row: number; columns: Record<keyof typeof HEADERS, number> } | null {
  for (let row = 1; row <= 6; row += 1) {
    const columns: Partial<Record<keyof typeof HEADERS, number>> = {};
    for (let column = 1; column <= lastColumn; column += 1) {
      const label = normalizeLabel(cellText(cellAt(sheet, row, column))).replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
      for (const key of Object.keys(HEADERS) as Array<keyof typeof HEADERS>) {
        if (label === HEADERS[key] || label.replace(/ /g, '') === HEADERS[key].replace(/ /g, '')) {
          // Un en-tête répété rend la lecture ambiguë : l'onglet est refusé.
          if (columns[key] !== undefined) return null;
          columns[key] = column;
        }
      }
    }
    if (columns.bankBalance && columns.fundApplied && columns.netBalance && columns.nonValidatedDeposit) {
      return { row, columns: columns as Record<keyof typeof HEADERS, number> };
    }
  }
  return null;
}

function readCell(sheet: Sheet, row: number, column: number, bank: SituationBank, issues: FundPositionIssue[]): FundPositionCell {
  const address = cellAddress(row, column);
  const cell = cellAt(sheet, row, column);
  if (!cell || cell.v === undefined || cell.v === null || String(cell.v).trim() === '') {
    issues.push({ code: 'CELL_ABSENT', address, bank });
    return { address, value: null };
  }
  const value = cellNumber(cell);
  if (value === null) {
    issues.push({ code: 'CELL_NOT_NUMERIC', address, bank });
    return { address, value: null };
  }
  return { address, value };
}

/**
 * Lit le premier onglet daté strictement après la date comptable D (au plus
 * tard `today`). Il n'est COMPARABLE à D que s'il la suit au jour ouvré près ;
 * sinon la lecture reste disponible mais aucun écart n'est calculé.
 */
export function readFundPosition(bytes: ArrayBuffer, accountingDate: string, today: string): FundPositionReading {
  let workbook;
  try {
    workbook = readWorkbook(bytes.slice(0));
  } catch {
    return unavailable('WORKBOOK_UNREADABLE');
  }
  const hidden = hiddenSheetNames(workbook);
  const tabs = workbook.SheetNames
    .filter((name) => !hidden.has(name))
    .map((name) => ({ name, date: sheetNameToIso(name) }))
    .filter((tab) => tab.date !== null && tab.date > accountingDate && tab.date <= today)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));
  const tab = tabs[0];
  if (!tab) return unavailable('TAB_ABSENT');
  // Deux onglets ramenés à la même date : impossible de savoir lequel fait foi.
  if (tabs.filter((candidate) => candidate.date === tab.date).length > 1) return unavailable('TAB_AMBIGUOUS');
  const dateComparable = onlyWeekendBetween(accountingDate, tab.date as string);

  const sheet = workbook.Sheets[tab.name];
  const bounds = usefulBounds(sheet, 200, 16);
  const header = findHeader(sheet, bounds.lastColumn);
  if (!header) {
    return { available: false, reason: 'HEADER_NOT_FOUND', tabName: tab.name, tabDate: tab.date, dateComparable, rows: [], issues: [] };
  }
  const positionColumn = header.columns.nonValidatedDeposit + 1;
  const issues: FundPositionIssue[] = [];
  const seen = new Map<SituationBank, number[]>();
  for (let row = header.row + 1; row <= bounds.lastRow; row += 1) {
    const labels = [cellText(cellAt(sheet, row, 1)), cellText(cellAt(sheet, row, 2))];
    if (labels.some((label) => BLOCK_END.test(normalizeLabel(label)))) break;
    const bankLabel = labels[1] || '';
    if (!bankLabel) continue;
    // Libellé strict : « BDK USD » ou « TOTAL BDK » ne sont pas la ligne de la banque BDK.
    const bank = detectBankFromStrictLabel(bankLabel);
    if (!bank && /TOTAL/.test(normalizeLabel(bankLabel))) continue;
    if (!bank) {
      issues.push({ code: 'BANK_LABEL_UNKNOWN', address: cellAddress(row, 2), bank: null });
      continue;
    }
    seen.set(bank, [...(seen.get(bank) ?? []), row]);
  }
  const rows: FundPositionBankRow[] = [];
  for (const bank of SITUATION_BANKS) {
    const bankRows = seen.get(bank) ?? [];
    if (bankRows.length === 0) continue;
    if (bankRows.length > 1) {
      issues.push({ code: 'BANK_ROW_AMBIGUOUS', address: cellAddress(bankRows[1], 2), bank });
      continue;
    }
    const row = bankRows[0];
    const declared = {
      bankBalance: readCell(sheet, row, header.columns.bankBalance, bank, issues),
      fundApplied: readCell(sheet, row, header.columns.fundApplied, bank, issues),
      netBalance: readCell(sheet, row, header.columns.netBalance, bank, issues),
      nonValidatedDeposit: readCell(sheet, row, header.columns.nonValidatedDeposit, bank, issues),
      position: readCell(sheet, row, positionColumn, bank, issues),
    };
    const net = declared.bankBalance.value !== null && declared.fundApplied.value !== null
      ? declared.bankBalance.value - declared.fundApplied.value
      : null;
    const position = net !== null && declared.nonValidatedDeposit.value !== null ? net + declared.nonValidatedDeposit.value : null;
    if (net !== null && declared.netBalance.value !== null && !amountsEqual(net, declared.netBalance.value)) {
      issues.push({ code: 'DECLARED_NET_DIFFERS_FROM_RECALCULATED', address: declared.netBalance.address, bank });
    }
    if (position !== null && declared.position.value !== null && !amountsEqual(position, declared.position.value)) {
      issues.push({ code: 'DECLARED_TOTAL_DIFFERS_FROM_RECALCULATED', address: declared.position.address, bank });
    }
    rows.push({ bank, rowNumber: row, declared, recalculated: { netBalance: net, position } });
  }
  return { available: true, reason: null, tabName: tab.name, tabDate: tab.date, dateComparable, rows, issues };
}

function compare(
  bank: SituationBank,
  indicator: FundPositionComparison['indicator'],
  declared: number | null,
  source: number | null,
  blocking: ComparisonReason | null,
): FundPositionComparison {
  if (blocking) return { bank, indicator, status: 'NOT_COMPARABLE', reason: blocking, declared, source, delta: null };
  if (declared === null) return { bank, indicator, status: 'NOT_COMPARABLE', reason: 'DECLARED_ABSENT', declared, source, delta: null };
  if (source === null) return { bank, indicator, status: 'NOT_COMPARABLE', reason: 'SOURCE_UNAVAILABLE', declared, source, delta: null };
  const delta = Math.round((declared - source) * 100) / 100;
  return { bank, indicator, status: amountsEqual(declared, source) ? 'EQUAL' : 'DIFFERENT', reason: null, declared, source, delta };
}

/**
 * Écarts entre la Fund Position déclarée et les sources vérifiées, calculés
 * seulement à date, périmètre (même banque) et devise comparables.
 */
export function compareFundPosition(
  reading: FundPositionReading,
  accountingDate: string,
  balances: AccountBalance[],
  workbooks: WorkbookEncours[],
): FundPositionComparison[] {
  if (!reading.available) return [];
  const comparisons: FundPositionComparison[] = [];
  for (const row of reading.rows) {
    const balance = balances.find((candidate) => candidate.bank === row.bank) ?? null;
    const workbook = workbooks.find((candidate) => candidate.bank === row.bank && candidate.available) ?? null;
    const statementUsable = balance !== null && balance.status === 'AVAILABLE';
    // La Fund Position est tenue en XOF : un solde d'une autre devise n'est jamais comparé.
    const statementBlocking: ComparisonReason | null = !reading.dateComparable ? 'DATE_NOT_COMPARABLE'
      : statementUsable && balance!.currency !== SITUATION_EXPECTED_CURRENCY ? 'CURRENCY_NOT_COMPARABLE' : null;
    comparisons.push(compare(row.bank, 'BANK_BALANCE_VS_STATEMENT', row.declared.bankBalance.value,
      statementUsable ? balance!.amount : null, statementBlocking));
    const workbookBlocking: ComparisonReason | null = !reading.dateComparable || (workbook !== null && workbook.balanceDate !== accountingDate)
      ? 'DATE_NOT_COMPARABLE' : null;
    comparisons.push(compare(row.bank, 'BANK_BALANCE_VS_WORKBOOK', row.declared.bankBalance.value,
      workbook ? workbook.openingBalance : null, workbookBlocking));
    comparisons.push(compare(row.bank, 'FUND_APPLIED_VS_WORKBOOK', row.declared.fundApplied.value,
      workbook && workbook.cheques.available ? workbook.cheques.declaredTotal : null, workbookBlocking));
    comparisons.push(compare(row.bank, 'NON_VALIDATED_VS_WORKBOOK', row.declared.nonValidatedDeposit.value,
      workbook && workbook.deposits.available ? workbook.deposits.declaredTotal : null, workbookBlocking));
  }
  return comparisons;
}
