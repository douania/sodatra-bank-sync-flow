// Types et utilitaires communs de l'écran « Situation du jour ».
// Tout est calculé en mémoire à partir des fichiers déposés : aucune
// persistance, aucun appel réseau, aucun journal de données.
import * as XLSX from 'xlsx';

/** Emplacements de compte attendus (une banque = un compte XOF en V1 locale). */
export const SITUATION_BANKS = ['BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE', 'NSIA', 'SGBS'] as const;
export type SituationBank = (typeof SITUATION_BANKS)[number];

export const SITUATION_BANK_LABELS: Record<SituationBank, string> = {
  BDK: 'BDK',
  ORA: 'ORABANK',
  ATB: 'Banque Atlantique',
  BICIS: 'BICIS',
  BIS: 'BIS',
  BRIDGE: 'BRIDGE BANK',
  NSIA: 'NSIA',
  SGBS: 'SGBS',
};

export const SITUATION_EXPECTED_CURRENCY = 'XOF';

/** Jetons (mots entiers) reconnus dans un nom de fichier ou un titre de feuille. */
const BANK_TOKENS: Array<[SituationBank, string[]]> = [
  ['BDK', ['BDK']],
  ['ORA', ['ORA', 'ORAB', 'ORABANK']],
  ['ATB', ['ATB', 'ATLANTIK', 'ATLANTIQUE']],
  ['BICIS', ['BICIS']],
  ['BIS', ['BIS']],
  ['BRIDGE', ['BRIDGE']],
  ['NSIA', ['NSIA']],
  ['SGBS', ['SGBS', 'SGS']],
];

export function tokenize(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token !== '');
}

/** Banque désignée par un texte : exactement une banque, sinon `null` (absente ou ambiguë). */
export function detectBankFromText(value: string): SituationBank | null {
  const tokens = new Set(tokenize(value));
  const hits = BANK_TOKENS.filter(([, aliases]) => aliases.some((alias) => tokens.has(alias))).map(([bank]) => bank);
  return hits.length === 1 ? hits[0] : null;
}

/** Mots neutres admis à côté du nom d'une banque dans un libellé strict. */
const NEUTRAL_BANK_WORDS = new Set(['BANK', 'BANQUE', 'BQUE']);

/**
 * Banque désignée par un libellé STRICT (cellule de titre, ligne de synthèse,
 * banque de dépôt) : le libellé ne porte que le nom de la banque et des mots
 * neutres. Tout autre mot (devise, « TOTAL », seconde banque) rend `null`.
 */
export function detectBankFromStrictLabel(value: string): SituationBank | null {
  const tokens = tokenize(value);
  const bank = detectBankFromText(value);
  if (!bank) return null;
  const aliases = BANK_TOKENS.find(([candidate]) => candidate === bank)![1];
  return tokens.every((token) => aliases.includes(token) || NEUTRAL_BANK_WORDS.has(token)) ? bank : null;
}

export function isSituationBank(value: string): value is SituationBank {
  return (SITUATION_BANKS as readonly string[]).includes(value);
}

export interface InMemoryFile {
  name: string;
  bytes: ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Dates (ISO AAAA-MM-JJ partout dans le module)
// ---------------------------------------------------------------------------

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function isValidYmd(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toIso(year: number, month: number, day: number): string | null {
  if (!isValidYmd(year, month, day)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match !== null && isValidYmd(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** « JJ/MM/AAAA » strict → ISO. */
export function frDateToIso(value: string | undefined | null): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((value ?? '').trim());
  if (!match) return null;
  return toIso(Number(match[3]), Number(match[2]), Number(match[1]));
}

/** Nom d'onglet « JJMMAA » → ISO (années 20AA). */
export function sheetNameToIso(sheetName: string): string | null {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(sheetName.trim());
  if (!match) return null;
  return toIso(2000 + Number(match[3]), Number(match[2]), Number(match[1]));
}

/** Premier jeton « JJMMAA » d'un nom de fichier → ISO. */
export function fileNameDateToIso(fileName: string): string | null {
  const match = /^(\d{2})(\d{2})(\d{2})(?![0-9])/.exec(fileName.trim());
  if (!match) return null;
  return toIso(2000 + Number(match[3]), Number(match[2]), Number(match[1]));
}

export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 110_000) return null;
  const date = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * DAY_MS);
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function isoToExcelSerial(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - EXCEL_EPOCH_UTC) / DAY_MS);
}

export function daysBetween(fromIso: string, toIsoDate: string): number {
  return isoToExcelSerial(toIsoDate) - isoToExcelSerial(fromIso);
}

export function formatIsoFr(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

/** Date libre dans un libellé : « JJ/MM/AA » ou « JJ/MM/AAAA » (jour en premier). */
export function findDayFirstDateInText(text: string): string | null {
  const match = /(?<![0-9])(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?![0-9])/.exec(text);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return toIso(year, Number(match[2]), Number(match[1]));
}

// ---------------------------------------------------------------------------
// Cellules Excel (lecture isolée, sans formule ni macro)
// ---------------------------------------------------------------------------

export type Sheet = XLSX.WorkSheet;

export function readWorkbook(bytes: ArrayBuffer): XLSX.WorkBook {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true, cellFormula: false, bookVBA: false });
  // Le système de dates 1904 décale toutes les dates : le classeur est refusé plutôt que mal lu.
  if (workbook.Workbook?.WBProps?.date1904) throw new Error('DATE_1904_UNSUPPORTED');
  return workbook;
}

/** Onglets masqués ou très masqués : jamais lus par la feature. */
export function hiddenSheetNames(workbook: XLSX.WorkBook): Set<string> {
  const hidden = new Set<string>();
  (workbook.Workbook?.Sheets ?? []).forEach((entry) => {
    if (entry.Hidden && entry.name) hidden.add(entry.name);
  });
  return hidden;
}

/** Vrai si tous les jours strictement compris entre deux dates sont un samedi ou un dimanche. */
export function onlyWeekendBetween(fromIso: string, toIsoDate: string): boolean {
  const start = isoToExcelSerial(fromIso);
  const end = isoToExcelSerial(toIsoDate);
  for (let serial = start + 1; serial < end; serial += 1) {
    const weekday = new Date(EXCEL_EPOCH_UTC + serial * DAY_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return false;
  }
  return end > start;
}

export function cellAt(sheet: Sheet, row: number, column: number): XLSX.CellObject | undefined {
  return sheet[XLSX.utils.encode_cell({ r: row - 1, c: column - 1 })] as XLSX.CellObject | undefined;
}

export function cellAddress(row: number, column: number): string {
  return XLSX.utils.encode_cell({ r: row - 1, c: column - 1 });
}

export function isDateCell(cell: XLSX.CellObject | undefined): boolean {
  if (!cell || cell.t !== 'n' || typeof cell.v !== 'number') return false;
  return typeof cell.z === 'string' ? XLSX.SSF.is_date(cell.z) : false;
}

export function cellIsoDate(cell: XLSX.CellObject | undefined): string | null {
  return isDateCell(cell) ? excelSerialToIso(cell!.v as number) : null;
}

/** Nombre porté par une cellule numérique non datée ; `null` si absente ou autre type. */
export function cellNumber(cell: XLSX.CellObject | undefined): number | null {
  if (!cell || cell.t !== 'n' || typeof cell.v !== 'number' || !Number.isFinite(cell.v)) return null;
  return isDateCell(cell) ? null : cell.v;
}

export function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 's') return String(cell.v).replace(/\s+/g, ' ').trim();
  return '';
}

export function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SheetBounds {
  lastRow: number;
  lastColumn: number;
}

/** Étendue utile plafonnée : une cellule parasite lointaine n'élargit pas la lecture. */
export function usefulBounds(sheet: Sheet, maxRows = 2_000, maxColumns = 26): SheetBounds {
  let lastRow = 0;
  let lastColumn = 0;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const position = XLSX.utils.decode_cell(key);
    if (position.c >= maxColumns || position.r >= maxRows) continue;
    const cell = sheet[key] as XLSX.CellObject;
    if (cell.v === undefined || cell.v === null || String(cell.v).trim() === '') continue;
    if (position.r + 1 > lastRow) lastRow = position.r + 1;
    if (position.c + 1 > lastColumn) lastColumn = position.c + 1;
  }
  return { lastRow, lastColumn };
}

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

export const AMOUNT_TOLERANCE = 0.5;

export function amountsEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < AMOUNT_TOLERANCE;
}

/** Égalité au centime : pour une chaîne de soldes, aucune tolérance n'est admise. */
export function amountsIdentical(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

/** Somme en centimes entiers pour éviter les dérives flottantes. */
export function sumAmounts(values: number[]): number {
  return values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
}
