// Volet « Fund Position » : lecture cellule par cellule de l'onglet du jour,
// utilisée comme RÉFÉRENCE COMPARATIVE seulement (son import n'est pas
// réactivé). Les valeurs déclarées et les valeurs recalculées restent
// distinctes. Une cellule absente ou ambiguë est signalée par un code et une
// adresse de cellule, sans jamais recopier le contenu d'une ligne source.
import {
  SITUATION_BANKS,
  SODATRA_CONVENTION,
  amountsEqual,
  cellAddress,
  cellAt,
  cellNumber,
  cellText,
  daysBetween,
  detectBankFromStrictLabel,
  cellIsoDate,
  establishWithConvention,
  findDatesInText,
  findUnreadableDates,
  hiddenSheetNames,
  normalizeLabel,
  plainUpper,
  readExplicitFields,
  readWorkbook,
  sheetNameToIso,
  tokenize,
  usefulBounds,
} from './situationCore';
import type { AmountUnit, FieldProvenance, FieldState, Sheet, SituationBank } from './situationCore';
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
   * Date de situation ÉTABLIE : le champ explicite « Situation au » quand il est valide ; sinon, quand ce
   * champ est absent, la date comptable CONFIRMÉE par l'opérateur pour l'onglet daté du lendemain. Jamais
   * déduite du seul nom de l'onglet. `null` tant que rien ne l'établit.
   */
  referenceDate: string | null;
  /** D'où vient la date établie : le fichier, ou la confirmation de l'opérateur. */
  dateProof: 'FILE' | 'OPERATOR' | null;
  /**
   * État de la date de position dans l'onglet : champ absent, valide, invalide (répété, mal formé), ou
   * contredit par une autre date écrite dans la zone de position (en-tête et lignes des banques) ou, plus
   * bas dans l'onglet, sous un libellé de date de position.
   */
  dateField: FieldState;
  /** Cellules dont la date écrite contredit la date de position (au plus quelques adresses, pour aller vérifier). */
  dateConflictCells: string[];
  /**
   * Vrai quand la confirmation de l'opérateur peut être demandée : champ « Situation au » ABSENT et onglet
   * lu daté exactement du lendemain calendaire de la date comptable.
   */
  needsDateAttestation: boolean;
  /** Devise ÉTABLIE : champ explicite « Devise », ou convention SODATRA si le champ est absent et non contredit. */
  currency: string | null;
  currencyProvenance: FieldProvenance | null;
  /** Unité ÉTABLIE : champ explicite « Unité », ou convention SODATRA si le champ est absent et non contredit. */
  unit: AmountUnit | null;
  unitProvenance: FieldProvenance | null;
  /** Vrai seulement si la date de situation établie est égale à D. */
  dateComparable: boolean;
  rows: FundPositionBankRow[];
  issues: FundPositionIssue[];
}

/**
 * Confirmation de l'opérateur, tenue en mémoire pour UN fichier : l'onglet nommé présente la situation à
 * cette date comptable. Elle ne vaut ni pour un autre onglet ni pour une autre date, et ne porte que sur
 * la date de la Fund Position.
 */
export interface FundPositionDateAttestation {
  tabName: string;
  accountingDate: string;
}

export type ComparisonStatus = 'EQUAL' | 'DIFFERENT' | 'NOT_COMPARABLE';
export type ComparisonReason = 'SOURCE_UNAVAILABLE' | 'DECLARED_ABSENT' | 'DATE_NOT_COMPARABLE' | 'CURRENCY_NOT_COMPARABLE'
  | 'UNIT_NOT_COMPARABLE';

export const FUND_POSITION_COMPARISON_REASON_LABELS: Record<ComparisonReason, string> = {
  SOURCE_UNAVAILABLE: 'source vérifiée indisponible',
  DECLARED_ABSENT: 'valeur déclarée absente',
  DATE_NOT_COMPARABLE: 'date non établie ou différente',
  CURRENCY_NOT_COMPARABLE: 'devise non établie, ou autre que XOF',
  UNIT_NOT_COMPARABLE: 'unité non établie, ou autre que francs entiers',
};

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
  return {
    available: false, reason, tabName: null, tabDate: null, referenceDate: null, dateProof: null, dateField: 'ABSENT', dateConflictCells: [],
    needsDateAttestation: false, currency: null, currencyProvenance: null, unit: null, unitProvenance: null, dateComparable: false,
    rows: [], issues: [],
  };
}

const REFERENCE_SCAN_ROWS = 200;
const REFERENCE_SCAN_COLUMNS = 60;

/** Mots qui disent qu'une date écrite n'est PAS la date de position. */
const NON_POSITION_DATE_WORDS: ReadonlySet<string> = new Set([
  'ECHEANCE', 'ECHEANCES', 'MATURITY', 'MATURITE', 'IMPRIME', 'IMPRIMEE', 'IMPRESSION', 'PRINTED', 'PRINT', 'EDITE', 'EDITEE', 'EDITION',
  'VALEUR', 'VALUE', 'VALIDITE', 'VALABLE', 'VALID', 'EXPIRE', 'EXPIRATION', 'REVUE', 'REVIEW', 'TAUX', 'RATE',
]);

/** Mots qui disent qu'une date écrite EST une date de position, où qu'elle soit dans l'onglet. */
const POSITION_DATE_WORDS: ReadonlySet<string> = new Set([
  'SOLDE', 'SOLDES', 'BALANCE', 'BALANCES', 'POSITION', 'POSITIONS', 'SITUATION', 'SITUATIONS', 'TRESORERIE', 'TREASURY',
  'ARRETE', 'ARRETEE', 'ETAT', 'AS',
]);

/** Mots de liaison entre un libellé et sa date : ils ne disent pas ce que la date désigne. */
const DATE_LINK_WORDS: ReadonlySet<string> = new Set([
  'DATE', 'DATED', 'LE', 'LA', 'L', 'AU', 'DU', 'DE', 'D', 'DES', 'A', 'EN', 'ON', 'AT', 'OF', 'THE', 'JUSQU', 'UNTIL', 'TO', 'FOR', 'POUR',
  'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE',
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
]);

/**
 * Une date écrite dans l'onglet, rattachée à SON libellé. `iso` nul : écriture illisible (sans année, par
 * exemple). `label` : le mot qui la gouverne, `null` si rien ne la libelle.
 */
interface ZoneDate {
  address: string;
  row: number;
  iso: string | null;
  precision: 'DAY' | 'MONTH';
  label: string | null;
}

/**
 * Le mot qui gouverne une date : le dernier mot écrit avant elle, mots de liaison passés. Une date écrite
 * plus tôt dans la même cellule compte comme un mot : elle sépare les libellés.
 */
function governingWord(label: string): string | null {
  const words = tokenize(label).filter((token) => !DATE_LINK_WORDS.has(token));
  return words.length > 0 ? words[words.length - 1] : null;
}

/** Les dates écrites dans un texte, lisibles ou non, à leur place et dans l'ordre d'écriture. */
function writtenDates(text: string): Array<{ index: number; length: number; iso: string | null; precision: 'DAY' | 'MONTH' }> {
  return [
    ...findDatesInText(text).map((entry) => ({ index: entry.index, length: entry.length, iso: entry.iso as string | null, precision: entry.precision })),
    ...findUnreadableDates(text).map((entry) => ({ index: entry.index, length: entry.length, iso: null, precision: 'DAY' as const })),
  ].sort((a, b) => a.index - b.index);
}

/**
 * Toutes les dates écrites dans l'onglet (lignes 1 à `lastRow`), chacune avec le mot qui la gouverne : le
 * dernier mot écrit avant elle dans sa cellule ; à défaut, et pour une cellule date, le dernier mot de la
 * cellule de gauche. Un mot placé ailleurs dans la cellule ne libelle pas la date : dans « Soldes au
 * 02/06/2026 – imprimé le 04/06/2026 », seule la seconde est une date d'impression.
 */
function datesWrittenInTab(sheet: Sheet, lastRow: number, lastColumn: number): ZoneDate[] {
  const dates: ZoneDate[] = [];
  for (let row = 1; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const address = cellAddress(row, column);
      const cell = cellAt(sheet, row, column);
      const text = cellText(cell);
      const cellDate = cellIsoDate(cell);
      const written = writtenDates(text);
      if (!cellDate && written.length === 0) continue;
      const left = column > 1 ? cellText(cellAt(sheet, row, column - 1)) : '';
      const fromLeft = governingWord(left);
      if (cellDate) dates.push({ address, row, iso: cellDate, precision: 'DAY', label: fromLeft });
      const plain = plainUpper(text);
      for (const entry of written) {
        dates.push({ address, row, iso: entry.iso, precision: entry.precision, label: governingWord(plain.slice(0, entry.index)) ?? fromLeft });
      }
    }
  }
  return dates;
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
 * Lit le premier onglet visible daté strictement après la date comptable D
 * (au plus tard `today`) comme RÉFÉRENCE. Le nom de l'onglet ne prouve pas la
 * date de la situation. Elle est établie :
 * - par le champ explicite de date de position (« Situation au », « Position
 *   arrêtée au », « As at »…), s'il est valide (il doit alors être égal à D
 *   pour ouvrir la comparaison ; contraire à D, il la bloque) ;
 * - sinon, quand ce champ est ABSENT et que l'onglet lu est daté exactement
 *   du lendemain calendaire de D, par la confirmation de l'opérateur pour ce
 *   fichier, cet onglet et cette date.
 * Un champ invalide (répété, mal formé, illisible comme « N/A ») ou contraire
 * bloque la comparaison : aucune confirmation n'est alors proposée. Il en va
 * de même de TOUTE autre date écrite dans la zone de position — l'en-tête et
 * les lignes des banques — dès qu'elle n'est pas D, même si elle est la date
 * du nom de l'onglet : seule une date que SON libellé dit être une échéance,
 * une impression, une valeur, une validité ou un taux est ignorée. Sous le
 * bloc des banques (échéances des facilités), seule compte une date que son
 * libellé dit être une date de position. Le champ de date n'est lu que dans
 * les lignes d'en-tête. Devise et unité : champ explicite, sinon convention
 * SODATRA quand rien ne la contredit dans l'onglet.
 */
export function readFundPosition(
  bytes: ArrayBuffer,
  accountingDate: string,
  today: string,
  attestation?: FundPositionDateAttestation,
): FundPositionReading {
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

  const sheet = workbook.Sheets[tab.name];
  const bounds = usefulBounds(sheet, 200, 16);
  const header = findHeader(sheet, bounds.lastColumn);
  if (!header) {
    return { ...unavailable('HEADER_NOT_FOUND'), tabName: tab.name, tabDate: tab.date };
  }
  const fieldBounds = usefulBounds(sheet, REFERENCE_SCAN_ROWS, REFERENCE_SCAN_COLUMNS);
  // Les champs explicites ne sont lus que dans les lignes d'en-tête ; les mentions contraires de devise et
  // d'unité, dans tout l'onglet.
  const fields = readExplicitFields(sheet, fieldBounds, header.row);
  const currency = establishWithConvention(fields.currency, fields.writtenCurrencies, SODATRA_CONVENTION.currency);
  const unit = establishWithConvention(fields.unit, fields.writtenUnits, SODATRA_CONVENTION.unit);
  // Zone de position : de la première ligne à la fin du bloc des banques.
  let positionZoneLastRow = bounds.lastRow;
  for (let row = header.row + 1; row <= bounds.lastRow; row += 1) {
    if ([cellText(cellAt(sheet, row, 1)), cellText(cellAt(sheet, row, 2))].some((label) => BLOCK_END.test(normalizeLabel(label)))) {
      positionZoneLastRow = row - 1;
      break;
    }
  }
  // Toute autre date écrite dans cette zone, qui n'est pas la date de position retenue, la contredit : la
  // comparaison est bloquée et aucune confirmation n'est proposée — y compris quand cette date est celle du
  // nom de l'onglet. Seule une date que SON libellé dit être autre chose (échéance, impression, valeur,
  // validité, taux) est ignorée. Une date au mois près s'accorde avec ce mois ; une date illisible ne
  // s'accorde avec rien. Sous le bloc des banques, seule compte une date que son libellé dit être une date
  // de position (« Soldes au », « Situation au », « As at »…).
  const stated = fields.situationDate.state === 'VALID' ? fields.situationDate.value : null;
  const expected = stated ?? accountingDate;
  const agrees = (date: ZoneDate) => date.iso !== null && (
    date.precision === 'MONTH' ? expected.slice(0, 7) === date.iso.slice(0, 7) : expected === date.iso
  );
  const countsAsPositionDate = (date: ZoneDate) => (date.row <= positionZoneLastRow
    ? date.label === null || !NON_POSITION_DATE_WORDS.has(date.label)
    : date.label !== null && POSITION_DATE_WORDS.has(date.label));
  const dateConflictCells = [
    ...datesWrittenInTab(sheet, fieldBounds.lastRow, fieldBounds.lastColumn)
      .filter((date) => countsAsPositionDate(date) && !agrees(date)).map((date) => date.address),
    ...fields.situationDatesBelowFields.filter((entry) => entry.date !== expected).map((entry) => entry.address),
  ].filter((address, index, all) => all.indexOf(address) === index).slice(0, 5);
  const contradicted = dateConflictCells.length > 0;
  const dateField: FieldState = fields.situationDate.state === 'INVALID' ? 'INVALID' : contradicted ? 'CONTRADICTED' : fields.situationDate.state;
  // Date de situation : le champ explicite s'il est valide ; s'il est ABSENT, la confirmation de l'opérateur,
  // proposée pour le seul onglet daté du lendemain calendaire de D. Un champ invalide ou contredit ne se confirme pas.
  const needsDateAttestation = dateField === 'ABSENT' && daysBetween(accountingDate, tab.date as string) === 1;
  const confirmed = needsDateAttestation && attestation !== undefined
    && attestation.tabName === tab.name && attestation.accountingDate === accountingDate;
  const referenceDate = dateField === 'VALID' ? stated : confirmed ? accountingDate : null;
  const dateProof = dateField === 'VALID' ? ('FILE' as const) : confirmed ? ('OPERATOR' as const) : null;
  const dateComparable = referenceDate !== null && referenceDate === accountingDate;
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
  return {
    available: true, reason: null, tabName: tab.name, tabDate: tab.date, referenceDate, dateProof,
    dateField, dateConflictCells, needsDateAttestation, currency: currency.value, currencyProvenance: currency.provenance,
    unit: unit.value, unitProvenance: unit.provenance, dateComparable, rows, issues,
  };
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
 * seulement à date, périmètre (même banque), devise et unité comparables.
 * Chaque source d'une comparaison — la Fund Position, le relevé, le classeur
 * mensuel — doit être ÉTABLIE en XOF et en francs entiers. Une autre devise ou
 * une autre unité, même déclarée à l'identique des deux côtés, donne « non
 * comparable » : aucune conversion d'unité n'est faite.
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
    // Chaque source d'une comparaison doit être en XOF et en francs entiers : aucune conversion n'est faite, et
    // deux documents qui déclarent la même autre unité (deux fois « milliers ») ne sont pas comparés non plus.
    // La Fund Position d'abord : date établie égale à D, devise XOF, unité francs entiers.
    const documentBlocking: ComparisonReason | null = !reading.dateComparable ? 'DATE_NOT_COMPARABLE'
      : reading.currency !== SODATRA_CONVENTION.currency ? 'CURRENCY_NOT_COMPARABLE'
        : reading.unit !== SODATRA_CONVENTION.unit ? 'UNIT_NOT_COMPARABLE' : null;
    // Relevé : en francs entiers par nature ; sa devise doit être XOF.
    const statementBlocking: ComparisonReason | null = documentBlocking
      ?? (statementUsable && balance!.currency !== SODATRA_CONVENTION.currency ? 'CURRENCY_NOT_COMPARABLE' : null);
    comparisons.push(compare(row.bank, 'BANK_BALANCE_VS_STATEMENT', row.declared.bankBalance.value,
      statementUsable ? balance!.amount : null, statementBlocking));
    // Classeur mensuel : même date de position, devise XOF et unité francs entiers établies pour son onglet.
    const workbookBlocking: ComparisonReason | null = documentBlocking
      ?? (workbook !== null && workbook.balanceDate !== accountingDate ? 'DATE_NOT_COMPARABLE' : null)
      ?? (workbook !== null && workbook.currency !== SODATRA_CONVENTION.currency ? 'CURRENCY_NOT_COMPARABLE' : null)
      ?? (workbook !== null && workbook.unit !== SODATRA_CONVENTION.unit ? 'UNIT_NOT_COMPARABLE' : null);
    comparisons.push(compare(row.bank, 'BANK_BALANCE_VS_WORKBOOK', row.declared.bankBalance.value,
      workbook ? workbook.openingBalance : null, workbookBlocking));
    comparisons.push(compare(row.bank, 'FUND_APPLIED_VS_WORKBOOK', row.declared.fundApplied.value,
      workbook && workbook.cheques.available ? workbook.cheques.declaredTotal : null, workbookBlocking));
    comparisons.push(compare(row.bank, 'NON_VALIDATED_VS_WORKBOOK', row.declared.nonValidatedDeposit.value,
      workbook && workbook.deposits.available ? workbook.deposits.declaredTotal : null, workbookBlocking));
  }
  return comparisons;
}
