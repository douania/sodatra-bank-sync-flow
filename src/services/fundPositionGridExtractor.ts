import type { FundPosition, FundPositionDetail, FundPositionHold } from '@/types/banking';

import { normalizeBankIdentityText } from './bankIdentity';
import { corroboratingYears, parseCorroboratedDate, uniqueRowAmount } from './bankReportGridExtractor';
import { validateFundPositionExtraction } from './fundPositionExtractionContract';
import { isBlankRow, isFormattedAmountCell, type ExcelGridCell, type ExcelSheetGrid } from './excelSheetGrid';

export interface FundPositionGridExtractionOptions {
  /** Nom du fichier source : ses années sur quatre chiffres corroborent la date du nom de feuille. */
  fileName?: string;
}

/**
 * Extraction tabulaire de la Fund Position (Pack 2).
 *
 * La feuille réelle est un tableau : une ligne d'en-tête « Bank Balance |
 * Fund Applied | Net Balance | NonValidated Deposit | Grand Balance », une
 * ligne par banque, puis des blocs titrés (« Deposit for the day », « Payment
 * for the day », « TOTAL FUND AVAILABLE », « COLLECTION NOT DEPOSITED »,
 * « HOLD »).
 *
 * Règles déterministes :
 * - date du rapport = nom de feuille `JJMMAA` (année corroborée par les
 *   cellules date du document ou le nom du fichier), sinon cellule
 *   « FUND POSITION JJ/MM/AAAA » ou « REPORT DATE JJ/MM/AAAA », sinon refus ;
 * - une ligne banque porte les cinq montants sous les cinq colonnes d'en-tête ;
 *   cellule vide ou cellule d'erreur Excel = refus du document ;
 * - `totalFundAvailable` = montant de la ligne « TOTAL FUND AVAILABLE » sous
 *   la colonne « Net Balance » ; `grandTotal` = montant de la même ligne sous
 *   la colonne « Grand Balance » ; absence ou erreur = refus ;
 * - `depositForDay` / `paymentForDay` = somme des montants des lignes de leur
 *   bloc ; bloc absent ou sans montant = valeur absente (jamais zéro) ;
 * - `collectionsNotDeposited` = montant porté par la ligne du titre
 *   « COLLECTION NOT DEPOSITED » ; titre absent ou sans montant = refus
 *   (jamais zéro par défaut) ;
 * - tout montant de ligne est l'unique cellule formatée non nulle de la ligne ;
 *   plusieurs montants non nuls = ambiguïté = refus ;
 * - bloc HOLD : lignes datées jusqu'à une ligne non datée portant un unique
 *   montant, qui doit être égal à la somme des lignes.
 * Aucune valeur financière ni nom de banque ne figure dans les messages
 * d'erreur : seuls des numéros de ligne les localisent.
 */

export interface FundPositionGridExtractionResult {
  success: boolean;
  data?: FundPosition;
  errors?: string[];
}

const HEADER_COLUMNS = {
  balance: ['BANK BALANCE', 'BOOK BALANCE'],
  fundApplied: ['FUND APPLIED'],
  netBalance: ['NET BALANCE'],
  nonValidatedDeposit: ['NONVALIDATED DEPOSIT', 'NON VALIDATED DEPOSIT'],
  grandBalance: ['GRAND BALANCE'],
} as const;

type HeaderKey = keyof typeof HEADER_COLUMNS;
/** Colonnes exigées pour reconnaître l'en-tête ; `grandBalance` est signalée absente sans bloquer la lecture des autres. */
const REQUIRED_HEADER_KEYS: readonly HeaderKey[] = ['balance', 'fundApplied', 'netBalance', 'nonValidatedDeposit'];

const TOTAL_FUND_AVAILABLE = 'TOTAL FUND AVAILABLE';
const DEPOSIT_FOR_THE_DAY = 'DEPOSIT FOR THE DAY';
const PAYMENT_FOR_THE_DAY = 'PAYMENT FOR THE DAY';
const COLLECTION_NOT_DEPOSITED = ['COLLECTION NOT DEPOSITED', 'COLLECTIONS NOT DEPOSITED'];
const HOLD = 'HOLD';
const BLOCK_HEADINGS = new Set([TOTAL_FUND_AVAILABLE, DEPOSIT_FOR_THE_DAY, PAYMENT_FOR_THE_DAY, ...COLLECTION_NOT_DEPOSITED, HOLD]);

function normalizeLabel(value: string): string {
  return normalizeBankIdentityText(value).replace(/\s*:\s*$/, '').trim();
}

function labelsOf(row: readonly ExcelGridCell[]): string[] {
  return row.filter(cell => cell.kind === 'text').map(cell => normalizeLabel(cell.text));
}

function rowHasLabel(row: readonly ExcelGridCell[], labels: readonly string[]): boolean {
  return labelsOf(row).some(label => labels.includes(label));
}

function rowIsBlockHeading(row: readonly ExcelGridCell[]): boolean {
  return labelsOf(row).some(label => BLOCK_HEADINGS.has(label));
}

function findHeaderColumns(rows: readonly ExcelGridCell[][]): {
  rowIndex: number;
  columns: Partial<Record<HeaderKey, number>> & Record<(typeof REQUIRED_HEADER_KEYS)[number], number>;
} | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const columns: Partial<Record<HeaderKey, number>> = {};
    rows[rowIndex].forEach((cell, columnIndex) => {
      if (cell.kind !== 'text') return;
      const label = normalizeLabel(cell.text);
      for (const key of Object.keys(HEADER_COLUMNS) as HeaderKey[]) {
        if ((HEADER_COLUMNS[key] as readonly string[]).includes(label) && columns[key] === undefined) {
          columns[key] = columnIndex;
        }
      }
    });
    if (REQUIRED_HEADER_KEYS.every(key => columns[key] !== undefined)) {
      return { rowIndex, columns: columns as ReturnType<typeof findHeaderColumns> extends infer R ? (R extends { columns: infer C } ? C : never) : never };
    }
  }
  return null;
}

function amountAt(row: readonly ExcelGridCell[], column: number): { value: number | null; error?: string } {
  const cell = row[column];
  if (!cell || cell.kind === 'empty') return { value: null, error: 'cellule de montant vide' };
  if (cell.kind === 'error') return { value: null, error: 'cellule d’erreur Excel' };
  if (cell.kind !== 'number' || !Number.isSafeInteger(cell.number ?? NaN)) return { value: null, error: 'montant non entier' };
  return { value: cell.number! };
}

/** Même règle que les rapports bancaires : unique cellule formatée non nulle, zéro si toutes nulles, ambiguïté refusée. */
function rowAmount(row: readonly ExcelGridCell[]): { value: number | null; error?: string } {
  const { amount, error } = uniqueRowAmount(row);
  return { value: amount, error };
}

function cellDate(cell: ExcelGridCell | undefined, years: ReadonlySet<number>): string | null {
  if (!cell) return null;
  if (cell.kind === 'date') return cell.isoDate ?? null;
  if (cell.kind === 'text') return parseCorroboratedDate(cell.text, years);
  return null;
}

function cellText(cell: ExcelGridCell | undefined): string {
  if (!cell || cell.kind === 'empty') return '';
  if (cell.kind === 'number') return Number.isSafeInteger(cell.number ?? NaN) ? String(cell.number) : cell.text;
  return cell.text;
}

function reportDateOf(grid: ExcelSheetGrid, years: ReadonlySet<number>): string | null {
  const fromSheetName = grid.sheetName.trim().match(/^(\d{2})(\d{2})(\d{2})$/);
  if (fromSheetName) {
    return parseCorroboratedDate(`${fromSheetName[1]}/${fromSheetName[2]}/${fromSheetName[3]}`, years);
  }
  for (const row of grid.rows) {
    for (const cell of row) {
      if (cell.kind !== 'text') continue;
      const match = normalizeLabel(cell.text).match(/^(?:FUND POSITION|REPORT DATE)\s+(\d{2}[/-]\d{2}[/-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2})$/);
      if (match) return parseCorroboratedDate(match[1], years);
    }
  }
  return null;
}

/**
 * Somme d'un bloc « … for the day » : lignes jusqu'au prochain titre ou ligne
 * vide. Une ligne sans aucune cellule de montant (libellé seul) ne porte rien
 * et est ignorée ; une cellule d'erreur, un montant ambigu ou non entier
 * refuse. Sans aucune ligne à montant, la valeur est absente (jamais zéro).
 */
function sumBlock(rows: readonly ExcelGridCell[][], start: number, errors: string[], label: string): number | undefined {
  let total: number | undefined;
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    if (isBlankRow(row) || rowIsBlockHeading(row)) break;
    if (!row.some(isFormattedAmountCell) && !row.some(cell => cell.kind === 'error')) continue;
    const amount = rowAmount(row);
    if (amount.value === null) {
      errors.push(`Ligne ${index + 1} du bloc ${label} : ${amount.error}.`);
      continue;
    }
    total = (total ?? 0) + amount.value;
  }
  return total;
}

/**
 * Bloc HOLD : colonnes fixées par sa ligne d'en-tête (DATE | N°CHEQUE/ECH |
 * BANQUE CLIENT | CLIENT | FACTURE | MONTANT | DATE DEPOT/NBRE JRS) ; à défaut
 * d'en-tête, positions A…H. Le montant est la colonne MONTANT (jamais la
 * dernière cellule formatée : la colonne des jours peut être formatée). La
 * date de dépôt et le nombre de jours sont facultatifs (souvent absents dans
 * les documents réels). Le bloc se termine par une ligne non datée portant un
 * unique montant, égal à la somme de la colonne MONTANT.
 */
function extractHold(
  rows: readonly ExcelGridCell[][],
  headingIndex: number,
  errors: string[],
  years: ReadonlySet<number>,
): FundPositionHold[] {
  const holds: FundPositionHold[] = [];
  let sum = 0;
  let index = headingIndex + 1;
  let amountColumn = 5;
  let daysColumn = 6;
  let depositDateColumn = 7;
  if (index < rows.length && !cellDate(rows[index][0], years)) {
    const headerLabels = rows[index].map(cell => (cell.kind === 'text' ? normalizeLabel(cell.text) : ''));
    const montantIndex = headerLabels.findIndex(label => label === 'MONTANT' || label === 'AMOUNT');
    if (headerLabels.some(label => label.startsWith('DATE')) && montantIndex !== -1) {
      amountColumn = montantIndex;
      const daysIndex = headerLabels.findIndex(label => /NBRE|JRS|DEPOT/.test(label));
      daysColumn = daysIndex === -1 ? montantIndex + 1 : daysIndex;
      depositDateColumn = daysColumn + 1;
      index += 1;
    }
  }
  for (; index < rows.length; index += 1) {
    const row = rows[index];
    if (isBlankRow(row)) continue;
    const holdDate = cellDate(row[0], years);
    if (!holdDate) {
      const amounts = row.filter(isFormattedAmountCell);
      if (amounts.length !== 1 || !Number.isSafeInteger(amounts[0].number ?? NaN)) {
        errors.push('Section HOLD déclarée mais total absent ou inexploitable.');
      } else if (amounts[0].number !== sum) {
        errors.push('Total de la section HOLD incohérent avec ses lignes.');
      }
      return holds;
    }
    if (row.some(cell => cell.kind === 'error')) {
      errors.push(`Ligne ${index + 1} HOLD : cellule d’erreur Excel.`);
      continue;
    }
    const amountCell = row[amountColumn];
    if (!amountCell || amountCell.kind !== 'number' || !Number.isSafeInteger(amountCell.number ?? NaN)) {
      errors.push(`Ligne ${index + 1} HOLD : montant invalide.`);
      continue;
    }
    const daysCell = row[daysColumn];
    const days = daysCell?.kind === 'number' && Number.isSafeInteger(daysCell.number ?? NaN) ? daysCell.number : undefined;
    const depositDate = cellDate(row[depositDateColumn], years) ?? cellDate(daysCell, years) ?? undefined;
    sum += amountCell.number!;
    holds.push({
      holdDate,
      chequeNumber: cellText(row[1]),
      clientBank: cellText(row[2]),
      clientName: cellText(row[3]),
      factureReference: cellText(row[4]),
      amount: amountCell.number!,
      depositDate,
      daysRemaining: days,
    });
  }
  errors.push('Section HOLD déclarée mais total absent ou inexploitable.');
  return holds;
}

export function extractFundPositionFromGrid(
  grid: ExcelSheetGrid,
  options: FundPositionGridExtractionOptions = {},
): FundPositionGridExtractionResult {
  const errors: string[] = [];
  const rows = grid.rows;
  const years = corroboratingYears(grid, options.fileName);

  const header = findHeaderColumns(rows);
  if (!header) {
    return { success: false, errors: ['En-tête Fund Position (Bank Balance, Fund Applied, Net Balance, NonValidated Deposit) absent.'] };
  }
  const grandBalanceColumn = header.columns.grandBalance;
  if (grandBalanceColumn === undefined) {
    // Le document ne porte pas de colonne Grand Balance : ni le solde global
    // par banque ni le grand total ne peuvent être établis sans calcul, donc
    // refus explicite (aucune valeur dérivée n'est inventée).
    errors.push('Colonne Grand Balance absente : grand total Fund Position non établi.');
  }

  const reportDate = reportDateOf(grid, years);
  const details: FundPositionDetail[] = [];
  let index = header.rowIndex + 1;
  for (; index < rows.length; index += 1) {
    const row = rows[index];
    if (isBlankRow(row) || rowIsBlockHeading(row)) break;
    const bankName = row
      .slice(0, header.columns.balance)
      .filter(cell => cell.kind === 'text')
      .map(cell => cell.text.trim())
      .filter(Boolean)
      .pop();
    if (!bankName) {
      errors.push(`Ligne ${index + 1} Fund Position sans nom de banque.`);
      continue;
    }
    const values = REQUIRED_HEADER_KEYS.map(key => amountAt(row, header.columns[key]));
    const grand = grandBalanceColumn === undefined ? { value: null, error: 'colonne absente' } : amountAt(row, grandBalanceColumn);
    const invalid = [...values, grand].find(value => value.value === null);
    if (invalid) {
      errors.push(`Ligne ${index + 1} Fund Position : montant invalide (${invalid.error}).`);
      continue;
    }
    details.push({
      bankName,
      balance: values[0].value!,
      fundApplied: values[1].value!,
      netBalance: values[2].value!,
      nonValidatedDeposit: values[3].value!,
      grandBalance: grand.value!,
    });
  }

  let totalFundAvailable: number | null = null;
  let grandTotal: number | null = null;
  let grandTotalFound = false;
  let depositForDay: number | undefined;
  let paymentForDay: number | undefined;
  let collectionsNotDeposited: number | null = null;
  let collectionsLabelFound = false;
  let holdCollections: FundPositionHold[] = [];
  let holdFound = false;

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const labels = labelsOf(row);
    if (labels.includes(TOTAL_FUND_AVAILABLE)) {
      const net = amountAt(row, header.columns.netBalance);
      if (net.value === null) errors.push(`Total fonds disponibles invalide (${net.error}).`);
      totalFundAvailable = net.value;
      grandTotalFound = true;
      const grand = grandBalanceColumn === undefined
        ? { value: null, error: 'colonne Grand Balance absente' }
        : amountAt(row, grandBalanceColumn);
      if (grand.value === null) errors.push(`Grand total Fund Position invalide (${grand.error}).`);
      grandTotal = grand.value;
    } else if (labels.includes(DEPOSIT_FOR_THE_DAY)) {
      depositForDay = sumBlock(rows, rowIndex + 1, errors, 'Deposit for the day');
    } else if (labels.includes(PAYMENT_FOR_THE_DAY)) {
      paymentForDay = sumBlock(rows, rowIndex + 1, errors, 'Payment for the day');
    } else if (rowHasLabel(row, COLLECTION_NOT_DEPOSITED)) {
      collectionsLabelFound = true;
      const amount = rowAmount(row);
      if (amount.value === null) errors.push(`Collections non déposées : ${amount.error} sur la ligne du titre.`);
      collectionsNotDeposited = amount.value;
    } else if (labels.includes(HOLD)) {
      holdFound = true;
      holdCollections = extractHold(rows, rowIndex, errors, years);
    }
  }
  if (!collectionsLabelFound) errors.push('Ligne COLLECTION NOT DEPOSITED absente.');

  errors.push(...validateFundPositionExtraction({
    reportDate,
    grandTotalFound,
    grandTotal,
    details,
  }));
  if (grandTotalFound && totalFundAvailable === null) errors.push('Total fonds disponibles absent.');
  if (!grandTotalFound) errors.push('Ligne TOTAL FUND AVAILABLE absente.');

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) return { success: false, errors: uniqueErrors };

  return {
    success: true,
    data: {
      reportDate: reportDate!,
      totalFundAvailable: totalFundAvailable!,
      collectionsNotDeposited: collectionsNotDeposited!,
      grandTotal: grandTotal!,
      depositForDay,
      paymentForDay,
      details,
      holdCollections: holdFound ? holdCollections : [],
    },
  };
}
