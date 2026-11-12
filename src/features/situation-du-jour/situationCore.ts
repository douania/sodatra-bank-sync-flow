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

const CURRENCY_TOKENS: Record<string, string> = {
  XOF: 'XOF', FCFA: 'XOF', CFA: 'XOF', EUR: 'EUR', EURO: 'EUR', EUROS: 'EUR', USD: 'USD', DOLLAR: 'USD', DOLLARS: 'USD', GBP: 'GBP',
  // Autres codes reconnus : ils ne servent qu'à refuser (une seconde devise écrite retire toute preuve).
  XAF: 'XAF', CHF: 'CHF', JPY: 'JPY', CNY: 'CNY', CAD: 'CAD', MAD: 'MAD', AED: 'AED', NGN: 'NGN', GHS: 'GHS', GNF: 'GNF', MRU: 'MRU', ZAR: 'ZAR',
};
const CURRENCY_SYMBOLS: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' };

/** Vrai si le jeton (sans accents, en majuscules) désigne une devise. */
export function isCurrencyToken(token: string): boolean {
  return CURRENCY_TOKENS[token] !== undefined;
}

/** Devises ÉCRITES dans un texte, par leur nom (mot entier) ou leur symbole ; codes ISO, sans doublon. */
export function currenciesInText(text: string): string[] {
  const found = new Set<string>();
  for (const token of tokenize(text)) if (CURRENCY_TOKENS[token]) found.add(CURRENCY_TOKENS[token]);
  for (const symbol of Object.keys(CURRENCY_SYMBOLS)) if (text.includes(symbol)) found.add(CURRENCY_SYMBOLS[symbol]);
  return Array.from(found);
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

const MONTH_NAMES: Record<string, number> = {
  JANV: 1, JAN: 1, JANVIER: 1, JANUARY: 1, FEVR: 2, FEV: 2, FEVRIER: 2, FEB: 2, FEBRUARY: 2, MARS: 3, MAR: 3, MARCH: 3,
  AVR: 4, AVRIL: 4, APR: 4, APRIL: 4, MAI: 5, MAY: 5, JUIN: 6, JUN: 6, JUNE: 6, JUIL: 7, JUILLET: 7, JUL: 7, JULY: 7,
  AOUT: 8, AUG: 8, AUGUST: 8, SEPT: 9, SEP: 9, SEPTEMBRE: 9, SEPTEMBER: 9, OCT: 10, OCTOBRE: 10, OCTOBER: 10,
  NOV: 11, NOVEMBRE: 11, NOVEMBER: 11, DEC: 12, DECEMBRE: 12, DECEMBER: 12,
};

export interface DateInText {
  index: number;
  length: number;
  iso: string;
  /** `MONTH` : seuls le mois et l'année sont écrits (le premier jour est retenu, jamais comme preuve). */
  precision: 'DAY' | 'MONTH';
}

/** Texte sans accents, en majuscules : repère commun des positions rendues par `findDatesInText`. */
export function plainUpper(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

/** Vrai si le jeton (sans accents, en majuscules) est un nom de mois français ou anglais, abrégé ou non. */
export function isMonthName(token: string): boolean {
  return MONTH_NAMES[token] !== undefined;
}

/**
 * TOUTES les dates lisibles dans un texte libre, dans l'ordre d'écriture :
 * « AAAA-MM-JJ » (séparateur -, / ou .), « J/M/AA(AA) » (jour en premier),
 * « J[er] mois AAAA », « mois J, AAAA », « mois AAAA » (précision au mois,
 * premier jour retenu) et, quand une date complète suit dans le même texte,
 * « J/M » ou « J mois » sans année (l'année de la date suivante est reprise).
 * Lecture volontairement large : elle sert à REFUSER (limite quotidienne,
 * référence douteuse). Une preuve exige en plus une formule stricte autour des dates.
 */
export function findDatesInText(text: string): DateInText[] {
  const plain = plainUpper(text);
  const found: DateInText[] = [];
  const taken = (index: number, length: number) => found.some((entry) => index < entry.index + entry.length && entry.index < index + length);
  const keep = (index: number, length: number, iso: string | null, precision: DateInText['precision'] = 'DAY') => {
    if (iso && !taken(index, length)) found.push({ index, length, iso, precision });
  };
  const isoPattern = /(?<![0-9])(\d{4})([-/.])(\d{2})\2(\d{2})(?![0-9])/g;
  for (let match = isoPattern.exec(plain); match; match = isoPattern.exec(plain)) {
    keep(match.index, match[0].length, toIso(Number(match[1]), Number(match[3]), Number(match[4])));
  }
  const numeric = /(?<![0-9])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![0-9])/g;
  for (let match = numeric.exec(plain); match; match = numeric.exec(plain)) {
    const year = match[4].length === 2 ? 2000 + Number(match[4]) : Number(match[4]);
    keep(match.index, match[0].length, toIso(year, Number(match[3]), Number(match[1])));
  }
  const literal = /(?<![0-9])(\d{1,2})(?:ER|ST|ND|RD|TH)?\s+([A-Z]{3,9})\.?,?\s+(\d{4})(?![0-9])/g;
  for (let match = literal.exec(plain); match; match = literal.exec(plain)) {
    const month = MONTH_NAMES[match[2]];
    keep(match.index, match[0].length, month ? toIso(Number(match[3]), month, Number(match[1])) : null);
  }
  const monthFirst = /(?<![A-Z])([A-Z]{3,9})\.?\s+(\d{1,2})(?:ST|ND|RD|TH)?,?\s+(\d{4})(?![0-9])/g;
  for (let match = monthFirst.exec(plain); match; match = monthFirst.exec(plain)) {
    const month = MONTH_NAMES[match[1]];
    keep(match.index, match[0].length, month ? toIso(Number(match[3]), month, Number(match[2])) : null);
  }
  const monthYear = /(?<![A-Z])([A-Z]{3,9})\.?\s+(\d{4})(?![0-9])/g;
  for (let match = monthYear.exec(plain); match; match = monthYear.exec(plain)) {
    const month = MONTH_NAMES[match[1]];
    keep(match.index, match[0].length, month ? toIso(Number(match[2]), month, 1) : null, 'MONTH');
  }
  // Dates sans année : lues seulement si une date complète suit dans le même texte, dont l'année est reprise.
  const dated = [...found].sort((a, b) => a.index - b.index);
  const yearAfter = (index: number): number | null => {
    const next = dated.find((entry) => entry.index > index);
    return next ? Number(next.iso.slice(0, 4)) : null;
  };
  const shortNumeric = /(?<![0-9/.-])(\d{1,2})\/(\d{1,2})(?![0-9/.-])/g;
  for (let match = shortNumeric.exec(plain); match; match = shortNumeric.exec(plain)) {
    const year = yearAfter(match.index);
    keep(match.index, match[0].length, year ? toIso(year, Number(match[2]), Number(match[1])) : null);
  }
  const shortLiteral = /(?<![0-9])(\d{1,2})(?:ER)?\s+([A-Z]{3,9})(?![A-Z])/g;
  for (let match = shortLiteral.exec(plain); match; match = shortLiteral.exec(plain)) {
    const month = MONTH_NAMES[match[2]];
    const year = yearAfter(match.index);
    keep(match.index, match[0].length, month && year ? toIso(year, month, Number(match[1])) : null);
  }
  return found.sort((a, b) => a.index - b.index);
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
// Champs explicites de comparaison : date de situation, devise, unité
// ---------------------------------------------------------------------------

/** Unité dans laquelle un document exprime ses montants. */
export type AmountUnit = 'UNITS' | 'THOUSANDS' | 'MILLIONS';

export const AMOUNT_UNIT_LABELS: Record<AmountUnit, string> = {
  UNITS: 'francs entiers',
  THOUSANDS: 'milliers',
  MILLIONS: 'millions',
};

const UNIT_CLASS_TOKENS: Record<string, AmountUnit> = {
  ENTIER: 'UNITS', ENTIERS: 'UNITS', MILLIER: 'THOUSANDS', MILLIERS: 'THOUSANDS', THOUSAND: 'THOUSANDS', THOUSANDS: 'THOUSANDS',
  KXOF: 'THOUSANDS', KFCFA: 'THOUSANDS', MILLION: 'MILLIONS', MILLIONS: 'MILLIONS', MXOF: 'MILLIONS',
};
/** Mots admis autour de l'unité dans la valeur du champ (« francs entiers », « milliers de francs »). */
const UNIT_NEUTRAL_TOKENS: ReadonlySet<string> = new Set(['FRANC', 'FRANCS', 'EN', 'DE']);

type ExplicitFieldKind = 'situationDate' | 'currency' | 'unit';
/** Libellé du champ, en tête de cellule, sur le texte sans accents et en majuscules. */
const EXPLICIT_FIELD_LABELS: Record<ExplicitFieldKind, RegExp> = {
  situationDate: /^\s*(?:SITUATION\s+AU|DATE\s+DE\s+SITUATION)(?![A-Z0-9])\s*:?\s*/,
  currency: /^\s*DEVISE(?![A-Z0-9])\s*:?\s*/,
  unit: /^\s*UNITE(?:\s+DES\s+MONTANTS)?(?![A-Z0-9])\s*:?\s*/,
};

/** Une seule date, au jour près, et rien d'autre ; sinon `null`. */
function singleDayDate(text: string): string | null {
  const dates = findDatesInText(text);
  if (dates.length !== 1 || dates[0].precision !== 'DAY') return null;
  const plain = plainUpper(text);
  const rest = `${plain.slice(0, dates[0].index)}${plain.slice(dates[0].index + dates[0].length)}`.trim();
  return rest === '' ? dates[0].iso : null;
}

/** Une seule devise et rien d'autre ; sinon `null`. */
function singleCurrency(text: string): string | null {
  const currencies = currenciesInText(text);
  return currencies.length === 1 && tokenize(text).every(isCurrencyToken) ? currencies[0] : null;
}

/** Une seule unité, sans autre mot que des mots neutres ou une devise ; sinon `null`. */
function singleUnit(text: string): AmountUnit | null {
  const tokens = tokenize(text);
  const classes = new Set(tokens.filter((token) => UNIT_CLASS_TOKENS[token] !== undefined).map((token) => UNIT_CLASS_TOKENS[token]));
  if (classes.size !== 1) return null;
  return tokens.every((token) => UNIT_CLASS_TOKENS[token] !== undefined || UNIT_NEUTRAL_TOKENS.has(token) || isCurrencyToken(token))
    ? Array.from(classes)[0]
    : null;
}

export interface ExplicitFields {
  /** Champ « Situation au » (ou « Date de situation ») : une date au jour près. */
  situationDate: string | null;
  /** Champ « Devise ». */
  currency: string | null;
  /** Champ « Unité » (ou « Unité des montants »). */
  unit: AmountUnit | null;
}

/**
 * Champs EXPLICITES d'un onglet, renseignés par l'équipe : « Situation au »,
 * « Devise », « Unité ». Preuve stricte : le libellé ouvre la cellule, la
 * valeur le suit dans la même cellule ou occupe la cellule immédiatement à
 * droite, elle ne porte rien d'autre, et le champ n'est écrit qu'UNE fois
 * dans les lignes 1 à `fieldLastRow`. Refus large, sur tout l'onglet : une
 * autre devise ou une autre unité écrite où que ce soit retire la devise ou
 * l'unité. Les autres dates de l'onglet (échéances, validités) ne comptent
 * pas : seule la cellule libellée dit la date de situation. Un champ absent,
 * répété, mal formé ou contredit rend `null`.
 */
export function readExplicitFields(sheet: Sheet, bounds: SheetBounds, fieldLastRow: number): ExplicitFields {
  const found: Record<ExplicitFieldKind, Array<string | null>> = { situationDate: [], currency: [], unit: [] };
  const currencies = new Set<string>();
  const units = new Set<AmountUnit>();
  for (let row = 1; row <= bounds.lastRow; row += 1) {
    for (let column = 1; column <= bounds.lastColumn; column += 1) {
      const text = cellText(cellAt(sheet, row, column));
      if (!text) continue;
      for (const currency of currenciesInText(text)) currencies.add(currency);
      for (const token of tokenize(text)) if (UNIT_CLASS_TOKENS[token] !== undefined) units.add(UNIT_CLASS_TOKENS[token]);
      if (row > fieldLastRow) continue;
      const plain = plainUpper(text);
      for (const kind of Object.keys(EXPLICIT_FIELD_LABELS) as ExplicitFieldKind[]) {
        const label = EXPLICIT_FIELD_LABELS[kind].exec(plain);
        if (!label) continue;
        const own = plain.slice(label[0].length).trim();
        const right = cellAt(sheet, row, column + 1);
        const rightDate = cellIsoDate(right);
        const value = own !== '' ? own : rightDate ? formatIsoFr(rightDate) : cellText(right);
        found[kind].push(kind === 'situationDate' ? singleDayDate(value) : kind === 'currency' ? singleCurrency(value) : singleUnit(value));
      }
    }
  }
  const only = (values: Array<string | null>) => (values.length === 1 ? values[0] : null);
  const currency = only(found.currency);
  const unit = only(found.unit) as AmountUnit | null;
  return {
    situationDate: only(found.situationDate),
    currency: currency !== null && currencies.size === 1 ? currency : null,
    unit: unit !== null && units.size === 1 ? unit : null,
  };
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
