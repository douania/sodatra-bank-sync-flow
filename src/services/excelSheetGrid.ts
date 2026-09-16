import * as XLSX from 'xlsx';

/**
 * Lecture bornée d'une feuille Excel sous forme de grille typée.
 *
 * Règles (Pack 2 — compatibilité formats réels) :
 * - une feuille est toujours choisie explicitement : un classeur à plusieurs
 *   feuilles exige une sélection nominative, aucune concaténation n'est faite ;
 * - la grille est bornée par les cellules réellement présentes, jamais par la
 *   plage déclarée (`!ref`) : une feuille déclarée sur 16 384 colonnes mais
 *   n'utilisant que 9 colonnes produit 9 colonnes ;
 * - une cellule numérique portant un format de date est convertie depuis son
 *   numéro de série Excel (base 1900, via `SSF.parse_date_code`) en date ISO
 *   `AAAA-MM-JJ`, jamais depuis son rendu texte (`m/d/yy`, ambigu) ;
 * - une cellule numérique sans format de date est un nombre exact ; un montant
 *   non entier ou hors entier sûr est refusé par les contrats aval ;
 * - une cellule d'erreur Excel (`#REF!`, `#DIV/0!`, …) est conservée comme
 *   `error` pour que les contrats financiers refusent le document ;
 * - une cellule texte est conservée telle quelle (espaces de bord retirés).
 */

export type ExcelGridCellKind = 'empty' | 'text' | 'number' | 'date' | 'error' | 'boolean';

export interface ExcelGridCell {
  kind: ExcelGridCellKind;
  /** Représentation textuelle canonique : texte, nombre décimal, date ISO ou code d'erreur. */
  text: string;
  number?: number;
  isoDate?: string;
  /** Format numérique Excel d'une cellule `number` (absent ou `General` = sans format). */
  numberFormat?: string;
}

/**
 * Cellule de montant : numérique et portant un format numérique explicite
 * (comptable, milliers…). Une cellule numérique `General` est une référence ou
 * un compteur, jamais un montant financier prioritaire.
 */
export function isFormattedAmountCell(cell: ExcelGridCell): boolean {
  return cell.kind === 'number'
    && typeof cell.numberFormat === 'string'
    && cell.numberFormat !== ''
    && cell.numberFormat !== 'General';
}

export interface ExcelSheetGrid {
  sheetName: string;
  rows: ExcelGridCell[][];
  usedRowCount: number;
  usedColumnCount: number;
  errorCellCount: number;
  /**
   * Cellules date parasites situées au-delà de la borne de colonnes
   * (`maxColumns`). Seule cette signature bénigne est tolérée : cellule
   * numérique au format date, portant une date calendaire valide, isolée en
   * fin de feuille (observée dans les classeurs réels). Elles ne sont ni lues
   * ni parcourues, seulement comptées. Toute autre cellule non vide hors borne
   * (texte, montant, nombre, erreur, booléen) refuse la feuille.
   */
  ignoredFarDateCellCount: number;
}

export interface ExcelGridLimits {
  maxRows: number;
  maxColumns: number;
  maxCells: number;
}

export const DEFAULT_EXCEL_GRID_LIMITS: ExcelGridLimits = {
  maxRows: 20_000,
  maxColumns: 512,
  maxCells: 1_000_000,
};

export type ExcelSheetSelectionErrorCode =
  | 'WORKBOOK_WITHOUT_SHEET'
  | 'SHEET_SELECTION_REQUIRED'
  | 'SHEET_NOT_FOUND'
  | 'SHEET_LIMIT_EXCEEDED';

export class ExcelSheetSelectionError extends Error {
  constructor(readonly code: ExcelSheetSelectionErrorCode, message: string) {
    super(message);
    this.name = 'ExcelSheetSelectionError';
  }
}

const EMPTY_CELL: ExcelGridCell = { kind: 'empty', text: '' };

export function listWorkbookSheetNames(bytes: Uint8Array | ArrayBuffer): string[] {
  const workbook = XLSX.read(bytes, { type: 'array', bookSheets: true });
  return [...workbook.SheetNames];
}

/**
 * Résout la feuille à traiter. Une seule feuille est implicitement la feuille
 * choisie ; plusieurs feuilles exigent un nom explicite présent dans le classeur.
 */
export function resolveSelectedSheetName(
  sheetNames: readonly string[],
  requestedSheetName: string | undefined,
): string {
  if (sheetNames.length === 0) {
    throw new ExcelSheetSelectionError('WORKBOOK_WITHOUT_SHEET', 'Le classeur ne contient aucune feuille.');
  }
  if (requestedSheetName !== undefined && requestedSheetName !== '') {
    if (!sheetNames.includes(requestedSheetName)) {
      throw new ExcelSheetSelectionError(
        'SHEET_NOT_FOUND',
        'La feuille demandée est absente du classeur.',
      );
    }
    return requestedSheetName;
  }
  if (sheetNames.length === 1) return sheetNames[0];
  throw new ExcelSheetSelectionError(
    'SHEET_SELECTION_REQUIRED',
    `Le classeur contient ${sheetNames.length} feuilles : choisissez explicitement la feuille à traiter.`,
  );
}

export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return null;
  const { y, m, d } = parsed;
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) {
    return null;
  }
  const candidate = new Date(Date.UTC(y, m - 1, d));
  if (candidate.getUTCFullYear() !== y || candidate.getUTCMonth() !== m - 1 || candidate.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isDateFormat(format: unknown): boolean {
  if (typeof format !== 'string' || format === '' || format === 'General') return false;
  try {
    return XLSX.SSF.is_date(format);
  } catch {
    return false;
  }
}

function convertCell(cell: XLSX.CellObject): ExcelGridCell {
  switch (cell.t) {
    case 'e':
      return { kind: 'error', text: String(cell.w ?? cell.v ?? '#ERROR').trim() };
    case 'b':
      return { kind: 'boolean', text: cell.v ? 'TRUE' : 'FALSE' };
    case 'd': {
      const value = cell.v instanceof Date ? cell.v : new Date(String(cell.v));
      if (Number.isNaN(value.getTime())) return { kind: 'error', text: '#DATE' };
      const iso = `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
      return { kind: 'date', text: iso, isoDate: iso };
    }
    case 'n': {
      const value = typeof cell.v === 'number' ? cell.v : Number(cell.v);
      if (!Number.isFinite(value)) return { kind: 'error', text: '#NUM' };
      if (isDateFormat(cell.z)) {
        const iso = excelSerialToIsoDate(value);
        if (iso) return { kind: 'date', text: iso, isoDate: iso };
        return { kind: 'error', text: '#DATE' };
      }
      return {
        kind: 'number',
        text: String(value),
        number: value,
        numberFormat: typeof cell.z === 'string' ? cell.z : undefined,
      };
    }
    case 's':
    default: {
      const text = cell.v === undefined || cell.v === null ? '' : String(cell.v).trim();
      return text ? { kind: 'text', text } : EMPTY_CELL;
    }
  }
}

/**
 * Construit la grille de la feuille demandée, bornée par les cellules présentes.
 * Le classeur est lu avec `sheets: [name]` pour que les autres feuilles ne
 * soient pas analysées quand le format le permet (XLSX) ; pour un XLS, SheetJS
 * analyse toutes les feuilles mais seule la feuille choisie est convertie.
 */
export function readSelectedSheetGrid(
  bytes: Uint8Array | ArrayBuffer,
  sheetName: string,
  limits: ExcelGridLimits = DEFAULT_EXCEL_GRID_LIMITS,
): ExcelSheetGrid {
  const workbook = XLSX.read(bytes, {
    type: 'array',
    sheets: [sheetName],
    cellDates: false,
    cellNF: true,
    cellText: false,
  });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new ExcelSheetSelectionError('SHEET_NOT_FOUND', 'La feuille demandée est absente du classeur.');
  }
  return worksheetToGrid(worksheet, sheetName, limits);
}

export function worksheetToGrid(
  worksheet: XLSX.WorkSheet,
  sheetName: string,
  limits: ExcelGridLimits = DEFAULT_EXCEL_GRID_LIMITS,
): ExcelSheetGrid {
  const addresses = Object.keys(worksheet).filter(key => !key.startsWith('!'));
  let maxRow = -1;
  let maxColumn = -1;
  let ignoredFarDateCellCount = 0;
  const decoded: Array<{ r: number; c: number; key: string }> = [];
  for (const key of addresses) {
    const cell = worksheet[key] as XLSX.CellObject | undefined;
    if (!cell || typeof cell !== 'object' || !('t' in cell)) continue;
    // Une cellule sans valeur (format seul, cellule vidée) ne borne pas la grille.
    if (cell.t !== 'e' && (cell.v === undefined || cell.v === null || cell.v === '')) continue;
    // Une cellule au format date sans date calendaire valide (série nulle,
    // négative ou hors calendrier) est une cellule vidée conservant son format :
    // Excel n'affiche rien, elle ne borne pas la grille.
    if (cell.t === 'n' && isDateFormat(cell.z) && excelSerialToIsoDate(Number(cell.v)) === null) continue;
    const address = XLSX.utils.decode_cell(key);
    if (address.r < 0 || address.c < 0) continue;
    // Hors borne de colonnes : seule une cellule date parasite (signature
    // bénigne) est tolérée et comptée ; toute autre cellule non vide refuse.
    if (address.c >= limits.maxColumns) {
      if (cell.t === 'n' && isDateFormat(cell.z)) {
        ignoredFarDateCellCount += 1;
        continue;
      }
      throw new ExcelSheetSelectionError(
        'SHEET_LIMIT_EXCEEDED',
        'Cellule non vide au-delà de la borne de colonnes.',
      );
    }
    decoded.push({ r: address.r, c: address.c, key });
    if (address.r > maxRow) maxRow = address.r;
    if (address.c > maxColumn) maxColumn = address.c;
  }

  const usedRowCount = maxRow + 1;
  const usedColumnCount = maxColumn + 1;
  if (usedRowCount > limits.maxRows) {
    throw new ExcelSheetSelectionError(
      'SHEET_LIMIT_EXCEEDED',
      'La feuille dépasse la borne autorisée de lignes.',
    );
  }
  if (usedRowCount * usedColumnCount > limits.maxCells) {
    throw new ExcelSheetSelectionError('SHEET_LIMIT_EXCEEDED', 'La feuille dépasse la borne de cellules autorisée.');
  }

  const rows: ExcelGridCell[][] = Array.from({ length: usedRowCount }, () => (
    Array.from({ length: usedColumnCount }, () => EMPTY_CELL)
  ));
  let errorCellCount = 0;
  for (const { r, c, key } of decoded) {
    const converted = convertCell(worksheet[key] as XLSX.CellObject);
    if (converted.kind === 'error') errorCellCount += 1;
    rows[r][c] = converted;
  }

  return { sheetName, rows, usedRowCount, usedColumnCount, errorCellCount, ignoredFarDateCellCount };
}

/** Rendu texte canonique (tabulations, dates ISO, nombres exacts) d'une grille. */
export function sheetGridToText(grid: ExcelSheetGrid): string {
  return grid.rows.map(row => row.map(cell => cell.text).join('\t')).join('\n') + (grid.rows.length ? '\n' : '');
}

export function isBlankRow(row: readonly ExcelGridCell[]): boolean {
  return row.every(cell => cell.kind === 'empty');
}

export function lastNonEmptyIndex(row: readonly ExcelGridCell[]): number {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if (row[index].kind !== 'empty') return index;
  }
  return -1;
}
