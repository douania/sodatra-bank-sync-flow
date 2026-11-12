// Volet « encours » : classeurs mensuels de rapprochement (un onglet par jour).
// `internalBookExcelParser` est ENCADRÉ, jamais modifié : la feature choisit
// l'onglet qui correspond exactement à la date comptable D, ne soumet au
// lecteur que cet onglet, réutilise ses totaux vérifiables (ouverture, total
// dépôts, total A, total B, clôture) et lit elle-même les lignes à partir des
// cellules sources. Chaque section n'est rendue que si sa somme prouve le
// total déclaré ; sinon elle est indisponible.
import * as XLSX from 'xlsx';

import { internalBookExcelParser } from '@/services/internalBookExcelParser';
import type { InternalBook, InternalBookMoneyCell } from '@/types/internalBook';

import {
  amountsEqual,
  cellAt,
  cellIsoDate,
  cellNumber,
  cellText,
  daysBetween,
  detectBankFromStrictLabel,
  detectBankFromText,
  findDayFirstDateInText,
  hiddenSheetNames,
  normalizeLabel,
  readExplicitFields,
  readWorkbook,
  sheetNameToIso,
  sumAmounts,
  usefulBounds,
} from './situationCore';
import type { AmountUnit, InMemoryFile, Sheet, SituationBank } from './situationCore';

export type WorkbookReason =
  | 'WORKBOOK_UNREADABLE'
  | 'BANK_NOT_CORROBORATED'
  | 'TAB_ABSENT'
  | 'TAB_AMBIGUOUS'
  | 'TAB_LABEL_INCONSISTENT'
  | 'DUPLICATE_WORKBOOK'
  | 'TOTALS_NOT_READ'
  | 'TOTALS_INCONSISTENT';

export const WORKBOOK_REASON_LABELS: Record<WorkbookReason, string> = {
  WORKBOOK_UNREADABLE: 'Classeur illisible',
  BANK_NOT_CORROBORATED: 'Banque du classeur non corroborée (nom de fichier et titre de l’onglet)',
  TAB_ABSENT: 'Aucun onglet ne porte la position à la date comptable',
  TAB_AMBIGUOUS: 'Plusieurs onglets portent la position à la date comptable',
  TAB_LABEL_INCONSISTENT: 'Le nom de l’onglet est antérieur à la date de son libellé d’ouverture, ou trop éloigné d’elle',
  DUPLICATE_WORKBOOK: 'Plusieurs classeurs déposés pour la même banque',
  TOTALS_NOT_READ: 'Totaux de l’onglet non lus par le lecteur',
  TOTALS_INCONSISTENT: 'Totaux de l’onglet incohérents entre eux',
};

export type SectionReason = 'LINES_DO_NOT_PROVE_TOTAL' | 'SECTION_NOT_FOUND' | 'TOTAL_MISMATCH' | 'TOTAL_NOT_DECLARED'
  | 'TOTAL_COLUMN_AMBIGUOUS';

/** Première colonne des montants dans un onglet de rapprochement (A à F portent dates, numéros et libellés). */
const FIRST_AMOUNT_COLUMN = 7;

/** Écart maximal entre la date d'un onglet et la date de la position qu'il porte. */
export const WORKBOOK_MAX_TAB_LAG_DAYS = 7;

export interface WorkbookLine {
  date: string | null;
  /** Échéance (effet) quand la deuxième cellule est une date. */
  dueDate: string | null;
  /** Numéro (chèque) quand la deuxième cellule est un nombre. */
  number: string | null;
  description: string;
  counterparty: string;
  client: string;
  reference: string;
  amount: number;
  rowNumber: number;
}

export interface WorkbookSection {
  available: boolean;
  reason: SectionReason | null;
  /** Total DÉCLARÉ dans l'onglet ; `0` explicite distinct de `null` (absent). */
  declaredTotal: number | null;
  lines: WorkbookLine[];
}

export interface WorkbookFacilityLine {
  label: string;
  /** `null` : plafond non renseigné sur la ligne ; `0` : zéro explicitement saisi. */
  limit: number | null;
  used: number | null;
  nextDate: string | null;
  rowNumber: number;
}

export interface WorkbookFacilities {
  available: boolean;
  title: string | null;
  lines: WorkbookFacilityLine[];
  /** Lignes sans libellé écartées (totaux, plafond global, écart, ligne globale non nommée). */
  excludedUnlabeledRows: number;
  /** Lignes libellées dont les nombres n'ont pas pu être attribués sans en-tête. */
  unattributedRows: number;
}

export interface WorkbookEncours {
  fileName: string;
  bank: SituationBank | null;
  available: boolean;
  reason: WorkbookReason | null;
  tabName: string | null;
  balanceDate: string | null;
  /**
   * Devise ÉTABLIE par l'onglet retenu : champ explicite « Devise » de son en-tête (au plus tard sur la
   * ligne d'ouverture), seule devise écrite dans tout l'onglet. `null` : absente, répétée ou contredite.
   */
  currency: string | null;
  /** Unité ÉTABLIE par l'onglet retenu : champ explicite « Unité » de son en-tête, non contredit ; sinon `null`. */
  unit: AmountUnit | null;
  ignoredFutureTabs: number;
  openingBalance: number | null;
  totalBalanceA: number | null;
  closingBookBalance: number | null;
  deposits: WorkbookSection;
  cheques: WorkbookSection;
  /** Chèques dont le montant est hors de la colonne du total (anciens, non déduits). */
  chequesOutsideTotal: number;
  facilities: WorkbookFacilities;
  impayes: WorkbookSection;
}

const OPENING_PATTERN = /OPENING BALANCE|SOLDE D.?\s?OUVERTURE/;
const FACILITY_PATTERN = /BANK FACILIT|FACILITE BANCAIRE/;
const IMPAYE_TITLES = new Set(['IMPAYE', 'IMPAYES']);

function emptySection(reason: SectionReason | null = 'SECTION_NOT_FOUND'): WorkbookSection {
  return { available: false, reason, declaredTotal: null, lines: [] };
}

function emptyEncours(fileName: string, bank: SituationBank | null, reason: WorkbookReason): WorkbookEncours {
  return {
    fileName, bank, available: false, reason, tabName: null, balanceDate: null, currency: null, unit: null, ignoredFutureTabs: 0,
    openingBalance: null, totalBalanceA: null, closingBookBalance: null, deposits: emptySection(),
    cheques: emptySection(), chequesOutsideTotal: 0,
    facilities: { available: false, title: null, lines: [], excludedUnlabeledRows: 0, unattributedRows: 0 }, impayes: emptySection(),
  };
}

function rowText(sheet: Sheet, row: number, lastColumn: number): string {
  const parts: string[] = [];
  for (let column = 1; column <= lastColumn; column += 1) {
    const text = cellText(cellAt(sheet, row, column));
    if (text) parts.push(text);
  }
  return normalizeLabel(parts.join(' '));
}

/** Date de la position portée par l'onglet : lue dans le libellé de la ligne d'ouverture. */
function readOpeningLabelDate(sheet: Sheet): string | null {
  const bounds = usefulBounds(sheet, 40, 12);
  for (let row = 1; row <= Math.min(bounds.lastRow, 20); row += 1) {
    for (let column = 1; column <= Math.min(bounds.lastColumn, 6); column += 1) {
      const raw = cellText(cellAt(sheet, row, column));
      if (raw && OPENING_PATTERN.test(normalizeLabel(raw))) return findDayFirstDateInText(raw);
    }
  }
  return null;
}

function readTitleBank(sheet: Sheet): SituationBank | null {
  const hits = new Set<SituationBank>();
  for (let row = 1; row <= 3; row += 1) {
    for (let column = 1; column <= 8; column += 1) {
      const bank = detectBankFromStrictLabel(cellText(cellAt(sheet, row, column)));
      if (bank) hits.add(bank);
    }
  }
  return hits.size === 1 ? Array.from(hits)[0] : null;
}

/** Largeur lue pour chercher une devise ou une unité contradictoire (au-delà des colonnes de montants). */
const CURRENCY_SCAN_COLUMNS = 60;

function readLine(sheet: Sheet, row: number, amount: number): WorkbookLine {
  const second = cellAt(sheet, row, 2);
  const secondNumber = cellNumber(second);
  return {
    date: cellIsoDate(cellAt(sheet, row, 1)),
    dueDate: cellIsoDate(second),
    number: secondNumber !== null ? String(Math.round(secondNumber)) : (cellText(second) || null),
    description: cellText(cellAt(sheet, row, 3)),
    counterparty: cellText(cellAt(sheet, row, 4)),
    client: cellText(cellAt(sheet, row, 5)),
    reference: cellText(cellAt(sheet, row, 6)) || (cellNumber(cellAt(sheet, row, 6)) !== null ? String(cellNumber(cellAt(sheet, row, 6))) : ''),
    amount,
    rowNumber: row,
  };
}

/** Lignes datées entre deux bornes, montant pris dans la colonne PROUVÉE (celle du total déclaré). */
function readProvenLines(
  sheet: Sheet,
  fromRowExclusive: number,
  toRowExclusive: number,
  provenColumn: number,
  lastColumn: number,
  declaredTotal: number,
): { section: WorkbookSection; outsideTotal: number } {
  const lines: WorkbookLine[] = [];
  let outsideTotal = 0;
  for (let row = fromRowExclusive + 1; row < toRowExclusive; row += 1) {
    if (!cellIsoDate(cellAt(sheet, row, 1))) continue;
    const proven = cellNumber(cellAt(sheet, row, provenColumn));
    if (proven !== null) {
      lines.push(readLine(sheet, row, proven));
      continue;
    }
    for (let column = FIRST_AMOUNT_COLUMN; column <= lastColumn; column += 1) {
      if (column !== provenColumn && cellNumber(cellAt(sheet, row, column)) !== null) {
        outsideTotal += 1;
        break;
      }
    }
  }
  const proved = amountsEqual(sumAmounts(lines.map((line) => line.amount)), declaredTotal);
  return {
    section: proved
      ? { available: true, reason: null, declaredTotal, lines }
      : { available: false, reason: 'LINES_DO_NOT_PROVE_TOTAL', declaredTotal, lines: [] },
    outsideTotal,
  };
}

function findRow(sheet: Sheet, fromRow: number, toRow: number, lastColumn: number, test: (text: string) => boolean): number | null {
  for (let row = fromRow; row <= toRow; row += 1) {
    if (test(rowText(sheet, row, lastColumn))) return row;
  }
  return null;
}

function readImpayes(sheet: Sheet, fromRow: number, lastRow: number, amountColumn: number): WorkbookSection {
  let titleRow: number | null = null;
  for (let row = fromRow; row <= lastRow && titleRow === null; row += 1) {
    if (cellIsoDate(cellAt(sheet, row, 1))) continue;
    for (let column = 1; column <= 7; column += 1) {
      if (IMPAYE_TITLES.has(normalizeLabel(cellText(cellAt(sheet, row, column))))) titleRow = row;
    }
  }
  if (titleRow === null) return emptySection('SECTION_NOT_FOUND');
  const lines: WorkbookLine[] = [];
  let declaredTotal: number | null = null;
  for (let row = titleRow + 1; row <= lastRow; row += 1) {
    const amount = cellNumber(cellAt(sheet, row, amountColumn));
    if (cellIsoDate(cellAt(sheet, row, 1))) {
      if (amount !== null) lines.push(readLine(sheet, row, amount));
      continue;
    }
    if (amount !== null) {
      declaredTotal = amount;
      break;
    }
  }
  // Comme les autres sections : les lignes ne sont rendues que si elles prouvent un total déclaré.
  if (declaredTotal === null) return { available: false, reason: 'TOTAL_NOT_DECLARED', declaredTotal: null, lines: [] };
  if (!amountsEqual(sumAmounts(lines.map((line) => line.amount)), declaredTotal)) {
    return { available: false, reason: 'TOTAL_MISMATCH', declaredTotal, lines: [] };
  }
  return { available: true, reason: null, declaredTotal, lines };
}

function readFacilities(sheet: Sheet, fromRow: number, lastRow: number, lastColumn: number): WorkbookFacilities {
  const titleRow = findRow(sheet, fromRow, lastRow, lastColumn, (text) => FACILITY_PATTERN.test(text));
  if (titleRow === null) return { available: false, title: null, lines: [], excludedUnlabeledRows: 0, unattributedRows: 0 };
  let endRow = lastRow;
  for (let row = titleRow + 1; row <= lastRow; row += 1) {
    const isImpayeTitle = !cellIsoDate(cellAt(sheet, row, 1))
      && [1, 2, 3, 4, 5, 6, 7].some((column) => IMPAYE_TITLES.has(normalizeLabel(cellText(cellAt(sheet, row, column)))));
    if (isImpayeTitle) {
      endRow = row - 1;
      break;
    }
  }
  // Colonnes Limit / Used : en-tête explicite s'il existe, sinon ordre des nombres de la ligne.
  let limitColumn: number | null = null;
  let usedColumn: number | null = null;
  for (let row = titleRow; row <= Math.min(titleRow + 2, endRow); row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const label = normalizeLabel(cellText(cellAt(sheet, row, column)));
      if (label === 'LIMIT' || label === 'LIMITE') limitColumn = column;
      if (label === 'USED' || label === 'UTILISE') usedColumn = column;
    }
  }
  interface Candidate { row: number; label: string | null; limit: number | null; used: number | null; nextDate: string | null; attributed: boolean }
  const candidates: Candidate[] = [];
  for (let row = titleRow + 1; row <= endRow; row += 1) {
    const texts: string[] = [];
    const numbers: Array<{ column: number; value: number }> = [];
    let nextDate: string | null = null;
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = cellAt(sheet, row, column);
      const date = cellIsoDate(cell);
      if (date) {
        if (!nextDate) nextDate = date;
        continue;
      }
      const value = cellNumber(cell);
      if (value !== null) numbers.push({ column, value });
      const text = cellText(cell);
      if (text) texts.push(text);
    }
    if (numbers.length === 0) continue;
    const labels = texts.filter((text) => !['LIMIT', 'LIMITE', 'USED', 'UTILISE', 'BALANCE', 'DISPONIBLE'].includes(normalizeLabel(text)));
    let limit: number | null = null;
    let used: number | null = null;
    let attributed = true;
    if (limitColumn !== null) {
      limit = cellNumber(cellAt(sheet, row, limitColumn));
      used = usedColumn !== null ? cellNumber(cellAt(sheet, row, usedColumn)) : null;
    } else if (numbers.length === 3 && amountsEqual(numbers[0].value - numbers[1].value, numbers[2].value)) {
      // Sans en-tête, l'ordre « plafond, utilisé, disponible » n'est admis que s'il se prouve : plafond − utilisé = disponible.
      limit = numbers[0].value;
      used = numbers[1].value;
    } else {
      attributed = false;
    }
    candidates.push({ row, label: labels.length > 0 ? labels.join(' ') : null, limit, used, nextDate, attributed });
  }
  // Une ligne sans libellé n'est JAMAIS une facilité (total, plafond global, écart, ligne non nommée).
  const labelled = candidates.filter((candidate) => candidate.label !== null);
  const lines: WorkbookFacilityLine[] = labelled
    .filter((candidate) => candidate.attributed && (candidate.limit !== null || candidate.used !== null))
    .map((candidate) => ({
      label: candidate.label as string,
      limit: candidate.limit,
      used: candidate.used,
      nextDate: candidate.nextDate,
      rowNumber: candidate.row,
    }));
  return {
    available: lines.length > 0,
    title: cellText(cellAt(sheet, titleRow, 4)) || null,
    lines,
    excludedUnlabeledRows: candidates.filter((candidate) => candidate.label === null).length,
    unattributedRows: labelled.filter((candidate) => !candidate.attributed).length,
  };
}

function moneyValue(cell: InternalBookMoneyCell | undefined): number | null {
  return cell && typeof cell.value === 'number' && Number.isFinite(cell.value) ? cell.value : null;
}

/** Classeur réduit au seul onglet retenu, étendue plafonnée (cellule parasite ignorée). */
function singleSheetWorkbookBytes(sheet: Sheet, sheetName: string): ArrayBuffer {
  const bounds = usefulBounds(sheet);
  const copy: Sheet = {};
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const position = XLSX.utils.decode_cell(key);
    if (position.r < bounds.lastRow && position.c < bounds.lastColumn) copy[key] = sheet[key];
  }
  copy['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(bounds.lastRow - 1, 0), c: Math.max(bounds.lastColumn - 1, 0) } });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, copy, sheetName);
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/**
 * Encours d'un classeur mensuel à la date comptable D. `today` borne le choix
 * de l'onglet : un onglet au nom daté dans le futur (faute de saisie) est ignoré.
 */
export function readMonthlyWorkbook(file: InMemoryFile, accountingDate: string, today: string): WorkbookEncours {
  const nameBank = detectBankFromText(file.name);
  let workbook: XLSX.WorkBook;
  try {
    workbook = readWorkbook(file.bytes.slice(0));
  } catch {
    return emptyEncours(file.name, nameBank, 'WORKBOOK_UNREADABLE');
  }

  let ignoredFutureTabs = 0;
  let inconsistentTabs = 0;
  const hidden = hiddenSheetNames(workbook);
  const matches: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const tabDate = sheetNameToIso(sheetName);
    if (!tabDate || hidden.has(sheetName)) continue;
    if (tabDate > today) {
      ignoredFutureTabs += 1;
      continue;
    }
    if (readOpeningLabelDate(workbook.Sheets[sheetName]) !== accountingDate) continue;
    // L'onglet rend compte de la veille, ou porte lui-même la date de sa position : son nom est daté du
    // jour du libellé ou le suit de près. Un nom antérieur au libellé reste incohérent.
    const lag = daysBetween(accountingDate, tabDate);
    if (lag < 0 || lag > WORKBOOK_MAX_TAB_LAG_DAYS) {
      inconsistentTabs += 1;
      continue;
    }
    matches.push(sheetName);
  }
  if (matches.length !== 1) {
    const reason: WorkbookReason = matches.length > 1 ? 'TAB_AMBIGUOUS' : inconsistentTabs > 0 ? 'TAB_LABEL_INCONSISTENT' : 'TAB_ABSENT';
    const result = emptyEncours(file.name, nameBank, reason);
    result.ignoredFutureTabs = ignoredFutureTabs;
    return result;
  }
  const tabName = matches[0];
  const sheet = workbook.Sheets[tabName];
  const fail = (reason: WorkbookReason): WorkbookEncours => {
    const result = emptyEncours(file.name, nameBank, reason);
    result.tabName = tabName;
    result.balanceDate = accountingDate;
    result.ignoredFutureTabs = ignoredFutureTabs;
    return result;
  };

  // Banque : le nom de fichier et le titre de l'onglet doivent désigner la même banque.
  const titleBank = readTitleBank(sheet);
  if (!nameBank || !titleBank || nameBank !== titleBank) return fail('BANK_NOT_CORROBORATED');

  let book: InternalBook | undefined;
  try {
    const parsed = internalBookExcelParser.parseArrayBuffer(singleSheetWorkbookBytes(sheet, tabName), file.name);
    book = parsed.books.find((candidate) => candidate.sheetName === tabName);
  } catch {
    return fail('TOTALS_NOT_READ');
  }
  const opening = moneyValue(book?.openingBalance);
  const totalDeposits = moneyValue(book?.totalDeposits);
  const totalA = moneyValue(book?.totalBalanceA);
  const totalB = moneyValue(book?.totalB);
  const closing = moneyValue(book?.closingBalanceC);
  if (!book || opening === null || totalDeposits === null || totalA === null || totalB === null || closing === null) {
    return fail('TOTALS_NOT_READ');
  }
  const bounds = usefulBounds(sheet);
  const openingRow = book.openingBalance!.rowIndex;
  // Devise et unité : champs explicites de l'en-tête (au plus tard sur la ligne d'ouverture), non contredits ailleurs.
  const explicit = readExplicitFields(sheet, usefulBounds(sheet, 2_000, CURRENCY_SCAN_COLUMNS), openingRow);
  const depositsRow = book.totalDeposits!.rowIndex;
  const totalARow = book.totalBalanceA!.rowIndex;
  const totalBRow = book.totalB!.rowIndex;
  const closingRow = book.closingBalanceC!.rowIndex;

  // Total B : la ligne peut porter plusieurs montants (chèques courants, anciens chèques). La colonne
  // n'est PROUVÉE que si elle vérifie A − B = C ET si ses lignes somment le total ; elle doit être unique.
  const candidates: Array<{ column: number; value: number }> = [];
  for (let column = FIRST_AMOUNT_COLUMN; column <= bounds.lastColumn; column += 1) {
    const value = cellNumber(cellAt(sheet, totalBRow, column));
    if (value !== null) candidates.push({ column, value });
  }
  const consistent = candidates.filter((candidate) => amountsEqual(totalA - candidate.value, closing));
  if (!amountsEqual(opening + totalDeposits, totalA) || consistent.length === 0) {
    return fail('TOTALS_INCONSISTENT');
  }
  const proven = consistent
    .map((candidate) => readProvenLines(sheet, totalARow, totalBRow, candidate.column, bounds.lastColumn, candidate.value))
    .filter((reading) => reading.section.available);

  const deposits = readProvenLines(sheet, openingRow, depositsRow, book.totalDeposits!.columnIndex, bounds.lastColumn, totalDeposits);
  const cheques = proven.length === 1
    ? proven[0]
    : {
      section: {
        available: false,
        reason: (proven.length > 1 ? 'TOTAL_COLUMN_AMBIGUOUS' : 'LINES_DO_NOT_PROVE_TOTAL') as SectionReason,
        declaredTotal: consistent.length === 1 ? consistent[0].value : null,
        lines: [],
      },
      outsideTotal: 0,
    };

  return {
    fileName: file.name,
    bank: nameBank,
    available: true,
    reason: null,
    tabName,
    balanceDate: accountingDate,
    currency: explicit.currency,
    unit: explicit.unit,
    ignoredFutureTabs,
    openingBalance: opening,
    totalBalanceA: totalA,
    closingBookBalance: closing,
    deposits: deposits.section,
    cheques: cheques.section,
    chequesOutsideTotal: cheques.outsideTotal,
    facilities: readFacilities(sheet, closingRow + 1, bounds.lastRow, bounds.lastColumn),
    impayes: readImpayes(sheet, closingRow + 1, bounds.lastRow, book.closingBalanceC!.columnIndex),
  };
}
