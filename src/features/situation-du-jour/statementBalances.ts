// Volet « soldes » : solde de clôture prouvé à la date comptable D, lu dans
// les relevés ONLINE par les lecteurs Daily v2 INCHANGÉS. Un solde n'entre
// dans le calcul que si la clôture à D est prouvée, que la chaîne des soldes
// du relevé est continue de bout en bout, que l'identité du compte et la
// devise sont corroborées et que la journée est close. Tout autre cas est
// affiché « à revoir » ou « indisponible », jamais additionné.
import { parseStructuredBankStatementCsv } from '@/services/structuredBankStatementCsvParser';
import type { StructuredBankStatementLine } from '@/services/structuredBankStatementCsvParser';
import { parseStructuredBankStatementExcel } from '@/services/structuredBankStatementExcelParser';
import { deriveStructuredBankStatementDailyAggregates } from '@/services/structuredBankStatementDailyAggregates';

import {
  SITUATION_BANKS,
  SITUATION_EXPECTED_CURRENCY,
  amountsEqual,
  amountsIdentical,
  cellAt,
  cellIsoDate,
  cellText,
  daysBetween,
  detectBankFromText,
  findDatesInText,
  formatIsoFr,
  frDateToIso,
  normalizeLabel,
  plainUpper,
  readWorkbook,
  sumAmounts,
} from './situationCore';
import type { InMemoryFile, Sheet, SituationBank } from './situationCore';

/** Limite de période d'un relevé quotidien (même valeur que Daily v2). */
export const STATEMENT_MAX_DAILY_PERIOD_DAYS = 45;

const CSV_BANKS: ReadonlySet<SituationBank> = new Set<SituationBank>(['BDK', 'ORA']);
const EXCEL_BANKS: ReadonlySet<SituationBank> = new Set<SituationBank>(['ATB', 'BICIS', 'BIS', 'BRIDGE']);
type ExcelBank = 'ATB' | 'BICIS' | 'BIS' | 'BRIDGE';

export type BalanceReason =
  | 'NO_STATEMENT'
  | 'NO_READER_FOR_BANK'
  | 'FORMAT_NOT_SUPPORTED_FOR_BANK'
  | 'PARSER_REFUSED'
  | 'STATEMENT_NEEDS_REVIEW'
  | 'PERIOD_OVER_DAILY_LIMIT'
  | 'IDENTITY_NOT_CORROBORATED'
  | 'CURRENCY_NOT_CORROBORATED'
  | 'DATE_NOT_COVERED'
  | 'DAY_NOT_CLOSED'
  | 'BALANCE_CHAIN_BROKEN'
  | 'CONFLICTING_STATEMENTS'
  | 'SEVERAL_ACCOUNTS_FOR_BANK'
  | 'SAME_STATEMENT_UNDER_SEVERAL_BANKS';

export const BALANCE_REASON_LABELS: Record<BalanceReason, string> = {
  NO_STATEMENT: 'Aucun relevé déposé pour ce compte',
  NO_READER_FOR_BANK: 'Aucun format de relevé qualifié pour cette banque',
  FORMAT_NOT_SUPPORTED_FOR_BANK: 'Format de fichier non prévu pour cette banque',
  PARSER_REFUSED: 'Relevé refusé par le lecteur',
  STATEMENT_NEEDS_REVIEW: 'Relevé à revoir (contrôles du lecteur)',
  PERIOD_OVER_DAILY_LIMIT: `Période du relevé, ou dates de son en-tête, de plus de ${STATEMENT_MAX_DAILY_PERIOD_DAYS} jours`,
  IDENTITY_NOT_CORROBORATED: 'Identité du compte non corroborée',
  CURRENCY_NOT_CORROBORATED: 'Devise non corroborée',
  DATE_NOT_COVERED: 'Date comptable non couverte par le relevé',
  DAY_NOT_CLOSED: 'Journée non close à la date du relevé',
  BALANCE_CHAIN_BROKEN: 'Rupture dans la chaîne des soldes du relevé',
  CONFLICTING_STATEMENTS: 'Relevés contradictoires pour le même compte',
  SEVERAL_ACCOUNTS_FOR_BANK: 'Plusieurs relevés pour cette banque sans identité de compte commune',
  SAME_STATEMENT_UNDER_SEVERAL_BANKS: 'Même relevé déposé sous plusieurs banques',
};

/** Attestations de l'opérateur, tenues en mémoire pour la seule session de travail. */
export interface StatementAttestation {
  identityAttested?: boolean;
  currencyAttested?: string;
}

export interface StatementInput extends InMemoryFile {
  attestation?: StatementAttestation;
}

/**
 * Aucun relevé ne nomme sa banque dans son contenu de façon vérifiable ici :
 * la banque vient du nom du fichier. L'identité du compte n'est donc jamais
 * « prouvée par le contenu » ; elle est attestée par l'opérateur, fichier par fichier.
 */
export type IdentityProof = 'OPERATOR';
export type CurrencyProof = 'CONTENT' | 'OPERATOR';

export interface StatementEvaluation {
  fileName: string;
  bank: SituationBank | null;
  admissible: boolean;
  amount: number | null;
  /** Journée dont la clôture porte le solde (≤ D). */
  balanceDate: string | null;
  currency: string | null;
  identityProof: IdentityProof | null;
  currencyProof: CurrencyProof | null;
  needsIdentityAttestation: boolean;
  needsCurrencyAttestation: boolean;
  reasons: BalanceReason[];
  periodStart: string | null;
  periodEnd: string | null;
  lineCount: number;
  /** Empreinte du contenu : le même fichier sous deux banques est un conflit, pas deux soldes. */
  contentDigest: string;
  /** Empreinte du compte complet lu dans le contenu (CSV) ; `null` quand le fichier n'en porte pas. */
  accountKey: string | null;
  /** Compte masqué lu dans le contenu, montré à l'opérateur avant son attestation. */
  accountLabel: string | null;
}

export type BalanceStatus = 'AVAILABLE' | 'TO_REVIEW' | 'UNAVAILABLE';

export interface BalanceSource {
  fileName: string;
  role: 'retained' | 'duplicate' | 'conflict' | 'excluded';
}

export interface AccountBalance {
  bank: SituationBank;
  currency: string;
  status: BalanceStatus;
  amount: number | null;
  balanceDate: string | null;
  identityProof: IdentityProof | null;
  currencyProof: CurrencyProof | null;
  reasons: BalanceReason[];
  sources: BalanceSource[];
}

export type ConsolidationStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface CurrencyConsolidation {
  currency: string;
  status: ConsolidationStatus;
  /** `null` quand aucun solde n'est admissible : aucun chiffre n'est affiché. */
  amount: number | null;
  includedBanks: SituationBank[];
  missingBanks: SituationBank[];
}

interface DayUnit {
  date: string;
  derived: boolean;
  opening: number | null;
  closing: number | null;
}

interface DeclaredPeriod {
  start: string;
  end: string;
}

/** Familles de libellés d'un en-tête d'opérations. */
const OPERATION_HEADER_FAMILIES: Record<'DATE' | 'BALANCE' | 'AMOUNT' | 'LABEL', ReadonlyArray<string>> = {
  DATE: ['DATE'],
  BALANCE: ['SOLDE', 'SOLD'],
  AMOUNT: ['MONTANT', 'DEBIT', 'CREDIT'],
  LABEL: ['LIBELLE', 'DESCRIPTION', 'REFERENCE'],
};
const HEADER_SCAN_ROWS = 60;
const HEADER_SCAN_COLUMNS = 40;

export interface DeclaredPeriodReading {
  /** Période PROUVÉE : une seule formule stricte « du <date> au <date> » au-dessus de l'en-tête des opérations. */
  period: DeclaredPeriod | null;
  /** Première et dernière dates écrites dans l'en-tête, toutes écritures confondues (`null` si aucune). */
  earliestDate: string | null;
  latestDate: string | null;
}

/**
 * Ligne d'en-tête des opérations : au moins trois cellules libellées, de trois
 * familles distinctes, dont une date et un montant. Un préambule (« Date
 * édition | Solde initial ») ou une cellule isolée n'en est pas une.
 */
function isOperationHeaderRow(sheet: Sheet, row: number): boolean {
  const families = new Set<string>();
  let labelledCells = 0;
  for (let column = 1; column <= HEADER_SCAN_COLUMNS; column += 1) {
    const tokens = normalizeLabel(cellText(cellAt(sheet, row, column))).split(/[^A-Z]+/);
    const mine = Object.entries(OPERATION_HEADER_FAMILIES).filter(([, words]) => words.some((word) => tokens.includes(word)));
    if (mine.length > 0) labelledCells += 1;
    for (const [family] of mine) families.add(family);
  }
  return labelledCells >= 3 && families.size >= 3 && families.has('DATE') && families.has('AMOUNT');
}

/**
 * Formule de période et RIEN d'autre : « [Période :] du|de <date> au <date> »,
 * deux dates au jour près, ordonnées. Tout autre texte portant deux dates
 * (date de valeur, échéance, validité, référence) n'est pas une période.
 */
function strictPeriod(text: string): DeclaredPeriod | null {
  const dates = findDatesInText(text);
  if (dates.length !== 2 || dates.some((date) => date.precision !== 'DAY')) return null;
  const plain = plainUpper(text);
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  const before = clean(plain.slice(0, dates[0].index));
  const between = clean(plain.slice(dates[0].index + dates[0].length, dates[1].index));
  const after = clean(plain.slice(dates[1].index + dates[1].length));
  if (!/^(?:PERIODE ?:? ?)?(?:DU|DE)$/.test(before) || between !== 'AU' || after !== '') return null;
  return dates[0].iso <= dates[1].iso ? { start: dates[0].iso, end: dates[1].iso } : null;
}

/**
 * Période DÉCLARÉE dans l'en-tête d'un relevé Excel (les lecteurs Daily v2 ne
 * l'exposent pas). Deux lectures de sens opposés, chacune fermée :
 * - PREUVE (`period`) : lecture stricte. Seules les lignes au-dessus de la
 *   PREMIÈRE ligne d'en-tête des opérations sont lues ; la ligne entière doit
 *   être la formule stricte, il faut une seule période distincte, et l'en-tête
 *   ne doit porter aucune autre date.
 *   Un libellé d'opération ou une mention datée ne prouve jamais une période.
 * - REFUS (`widestSpanDays`) : lecture large. Toutes les dates lisibles au-dessus
 *   de la DERNIÈRE ligne d'en-tête des opérations comptent, quelle que soit
 *   leur écriture : le relevé est exclu dès que ces dates et celles de ses
 *   lignes s'étendent sur plus de 45 jours.
 */
export function readDeclaredPeriodFromExcelHeader(bytes: ArrayBuffer): DeclaredPeriodReading {
  const none: DeclaredPeriodReading = { period: null, earliestDate: null, latestDate: null };
  let workbook;
  try {
    workbook = readWorkbook(bytes);
  } catch {
    return none;
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return none;
  const headerRows: number[] = [];
  for (let row = 1; row <= HEADER_SCAN_ROWS; row += 1) if (isOperationHeaderRow(sheet, row)) headerRows.push(row);
  if (headerRows.length === 0) return none;
  const proofLimit = headerRows[0];
  const refusalLimit = headerRows[headerRows.length - 1];
  const periods: DeclaredPeriod[] = [];
  const writtenDates: string[] = [];
  for (let row = 1; row < refusalLimit; row += 1) {
    const texts: string[] = [];
    for (let column = 1; column <= HEADER_SCAN_COLUMNS; column += 1) {
      const cell = cellAt(sheet, row, column);
      const date = cellIsoDate(cell);
      const text = date ? formatIsoFr(date) : cellText(cell);
      if (text) texts.push(text);
    }
    // Lecture large : la ligne entière, pour qu'une année écrite plus loin sur la ligne serve aux dates sans année.
    for (const entry of findDatesInText(texts.join(' | '))) writtenDates.push(entry.iso);
    if (row >= proofLimit) continue;
    // La ligne ne doit rien porter d'autre que la formule (écrite dans une cellule ou répartie sur plusieurs) :
    // un libellé voisin (« Validité de la session », « Prochain relevé ») lui retire toute valeur de preuve.
    const wholeRow = strictPeriod(texts.join(' '));
    if (wholeRow) periods.push(wholeRow);
  }
  const sorted = [...writtenDates].sort();
  const distinct = new Set(periods.map((period) => `${period.start}|${period.end}`));
  const period = distinct.size === 1 ? periods[0] : null;
  // Toute autre date écrite dans l'en-tête (édition, valeur, validité) retire à la période sa valeur de preuve.
  const onlyDatesOfHeader = period !== null && writtenDates.every((date) => date === period.start || date === period.end);
  return {
    period: onlyDatesOfHeader ? period : null,
    earliestDate: sorted.length > 0 ? sorted[0] : null,
    latestDate: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
}

/**
 * Clé de compte tirée du contenu d'un relevé CSV : numéro de compte COMPLET,
 * réduit à une empreinte tenue en mémoire (jamais affichée). Deux comptes qui
 * ne partagent que leurs derniers chiffres restent distincts.
 */
function csvAccountKey(text: string): string | null {
  const reduce = (value: string) => plainUpper(value).replace(/[^A-Z0-9]/g, '');
  const lines = text.split(/\r?\n/).slice(0, 60);
  // Séparateur réel du fichier : le plus fréquent dans l'en-tête.
  const count = (separator: string) => lines.slice(0, 15).join('\n').split(separator).length - 1;
  const separator = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  for (const line of lines) {
    const cells = line.split(separator).map((cell) => cell.replace(/^\s*"?|"?\s*$/g, ''));
    for (let index = 0; index < cells.length - 1; index += 1) {
      const value = reduce(cells[index + 1]);
      if (value && reduce(cells[index]) === 'NUMERODECOMPTE') {
        return `acct-${digestBytes(new TextEncoder().encode(value).buffer as ArrayBuffer)}`;
      }
    }
  }
  return null;
}

function buildDayUnits(lines: StructuredBankStatementLine[]): DayUnit[] | null {
  const groups = new Map<string, StructuredBankStatementLine[]>();
  for (const line of lines) {
    const date = frDateToIso(line.operationDate);
    if (!date) return null;
    if (line.direction !== 'debit' && line.direction !== 'credit') return null;
    const current = groups.get(date) ?? [];
    current.push(line);
    groups.set(date, current);
  }
  const units: DayUnit[] = [];
  for (const [date, groupLines] of groups) {
    const aggregates = deriveStructuredBankStatementDailyAggregates(
      groupLines.map((line) => ({ direction: line.direction, signedAmount: line.signedAmount, runningBalance: line.balance })),
    );
    if (aggregates.errors.length > 0) return null;
    const derived = aggregates.aggregatesStatus === 'derived' && aggregates.validationStatus === 'valid'
      && typeof aggregates.closingBalanceDerived === 'number' && typeof aggregates.openingBalanceDerived === 'number';
    units.push({
      date,
      derived,
      opening: derived ? (aggregates.openingBalanceDerived as number) : null,
      closing: derived ? (aggregates.closingBalanceDerived as number) : null,
    });
  }
  return units.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Chaîne continue de bout en bout : chaque journée est dérivée et son
 * ouverture prolonge la clôture de la journée précédente du relevé. Une seule
 * rupture, où qu'elle soit, retire toute valeur de preuve au relevé.
 */
function isChainContinuous(units: DayUnit[]): boolean {
  return units.every((unit, index) => unit.derived && unit.opening !== null && unit.closing !== null
    && (index === 0 || (units[index - 1].closing !== null && amountsIdentical(unit.opening, units[index - 1].closing as number))));
}

/** Empreinte FNV-1a (deux graines) des octets : sert seulement à reconnaître un même fichier. */
function digestBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < view.length; index += 1) {
    first = Math.imul(first ^ view[index], 0x01000193) >>> 0;
    second = Math.imul(second ^ view[index], 0x85ebca6b) >>> 0;
  }
  return `${view.length}-${first.toString(16)}-${second.toString(16)}`;
}

function emptyEvaluation(file: InMemoryFile, bank: SituationBank | null): StatementEvaluation {
  return {
    fileName: file.name, bank, admissible: false, amount: null, balanceDate: null, currency: null, identityProof: null,
    currencyProof: null, needsIdentityAttestation: false, needsCurrencyAttestation: false, reasons: [],
    periodStart: null, periodEnd: null, lineCount: 0, contentDigest: digestBytes(file.bytes), accountKey: null, accountLabel: null,
  };
}

function refuse(evaluation: StatementEvaluation, reason: BalanceReason): StatementEvaluation {
  if (!evaluation.reasons.includes(reason)) evaluation.reasons.push(reason);
  evaluation.admissible = false;
  evaluation.amount = null;
  return evaluation;
}

/**
 * Évalue UN relevé : rend un solde admissible à D, ou les motifs du refus.
 * `today` borne les preuves de clôture : ni D ni la date d'un relevé ne
 * peuvent être dans le futur, et la journée en cours n'est jamais close.
 */
export function evaluateStatement(file: StatementInput, accountingDate: string, today: string): StatementEvaluation {
  const bank = detectBankFromText(file.name);
  const evaluation = emptyEvaluation(file, bank);
  if (!bank) return refuse(evaluation, 'IDENTITY_NOT_CORROBORATED');
  const lowerName = file.name.toLowerCase();
  const isCsv = lowerName.endsWith('.csv');
  const isExcel = lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx');
  if (!CSV_BANKS.has(bank) && !EXCEL_BANKS.has(bank)) return refuse(evaluation, 'NO_READER_FOR_BANK');
  if ((isCsv && !CSV_BANKS.has(bank)) || (isExcel && !EXCEL_BANKS.has(bank)) || (!isCsv && !isExcel)) {
    return refuse(evaluation, 'FORMAT_NOT_SUPPORTED_FOR_BANK');
  }

  let lines: StructuredBankStatementLine[] = [];
  let parsedCurrency: string | undefined;
  let declaredPeriod: DeclaredPeriod | null = null;
  let headerEarliest: string | null = null;
  let headerLatest: string | null = null;
  let closedBefore: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let declaredOpening: number | null = null;
  let declaredClosing: number | null = null;

  try {
    if (isCsv) {
      const text = new TextDecoder('windows-1252').decode(new Uint8Array(file.bytes));
      const document = parseStructuredBankStatementCsv(text, { sourceFileName: file.name });
      if (document.validation.status === 'needs_review') return refuse(evaluation, 'STATEMENT_NEEDS_REVIEW');
      if (document.validation.status !== 'valid' || document.errors.length > 0) return refuse(evaluation, 'PARSER_REFUSED');
      lines = document.lines;
      parsedCurrency = document.currency;
      if (document.bankHint !== bank) return refuse(evaluation, 'IDENTITY_NOT_CORROBORATED');
      evaluation.accountKey = document.accountNumberMasked ? csvAccountKey(text) : null;
      evaluation.accountLabel = document.accountNumberMasked ?? null;
      periodStart = frDateToIso(document.periodStart);
      periodEnd = frDateToIso(document.periodEnd);
      if (periodStart && periodEnd) declaredPeriod = { start: periodStart, end: periodEnd };
      closedBefore = frDateToIso(document.statementDate);
      declaredOpening = typeof document.openingBalance === 'number' ? document.openingBalance : null;
      declaredClosing = typeof document.declaredClosingBalance === 'number' ? document.declaredClosingBalance : null;
    } else {
      const document = parseStructuredBankStatementExcel(file.bytes.slice(0), {
        sourceFileName: file.name,
        expectedBank: bank as ExcelBank,
      });
      const status = document.validation.status;
      if ((status !== 'valid' && status !== 'needs_review') || document.errors.length > 0) {
        return refuse(evaluation, 'PARSER_REFUSED');
      }
      if (document.bankHint !== bank) return refuse(evaluation, 'IDENTITY_NOT_CORROBORATED');
      if (document.reviewReasonCodes.includes('RUNNING_BALANCE_CHAIN_INCOHERENT')) {
        return refuse(evaluation, 'BALANCE_CHAIN_BROKEN');
      }
      if (document.reviewReasonCodes.some((code) => code !== 'TRUSTED_CURRENCY_UNCORROBORATED')) {
        return refuse(evaluation, 'STATEMENT_NEEDS_REVIEW');
      }
      lines = document.lines;
      parsedCurrency = document.currency;
      periodStart = frDateToIso(document.periodStart);
      periodEnd = frDateToIso(document.periodEnd);
      const declared = readDeclaredPeriodFromExcelHeader(file.bytes.slice(0));
      declaredPeriod = declared.period;
      headerEarliest = declared.earliestDate;
      headerLatest = declared.latestDate;
    }
  } catch {
    return refuse(evaluation, 'PARSER_REFUSED');
  }

  evaluation.periodStart = periodStart;
  evaluation.periodEnd = periodEnd;
  evaluation.lineCount = lines.length;
  if (!periodStart || !periodEnd || lines.length === 0) return refuse(evaluation, 'PARSER_REFUSED');
  if (daysBetween(periodStart, periodEnd) + 1 > STATEMENT_MAX_DAILY_PERIOD_DAYS) {
    return refuse(evaluation, 'PERIOD_OVER_DAILY_LIMIT');
  }

  // Devise : lue dans le contenu, sinon attestée par l'opérateur pour ce fichier.
  if (parsedCurrency) {
    evaluation.currency = parsedCurrency;
    if (parsedCurrency === SITUATION_EXPECTED_CURRENCY) evaluation.currencyProof = 'CONTENT';
  } else {
    evaluation.needsCurrencyAttestation = true;
    if (file.attestation?.currencyAttested === SITUATION_EXPECTED_CURRENCY) {
      evaluation.currency = SITUATION_EXPECTED_CURRENCY;
      evaluation.currencyProof = 'OPERATOR';
    }
  }
  // Identité : la banque n'est désignée que par le nom du fichier ; l'opérateur atteste le compte, fichier par fichier.
  evaluation.needsIdentityAttestation = true;
  if (file.attestation?.identityAttested === true) evaluation.identityProof = 'OPERATOR';

  const units = buildDayUnits(lines);
  if (!units || units.length === 0) return refuse(evaluation, 'PARSER_REFUSED');

  // Chaîne des soldes : continue sur tout le relevé et raccordée aux soldes déclarés du CSV.
  const first = units[0];
  const last = units[units.length - 1];
  const chainProved = isChainContinuous(units)
    && (declaredOpening === null || (first.opening !== null && amountsIdentical(first.opening, declaredOpening)))
    && (declaredClosing === null || (last.closing !== null && amountsIdentical(last.closing, declaredClosing)));
  if (!chainProved) refuse(evaluation, 'BALANCE_CHAIN_BROKEN');

  // Une ligne datée après aujourd'hui rend le relevé incohérent : elle ne prouve aucune clôture.
  if (last.date > today) refuse(evaluation, 'STATEMENT_NEEDS_REVIEW');
  // Limite quotidienne : elle vaut pour l'étendue des lignes, élargie à toute date écrite dans l'en-tête
  // du relevé, quelle que soit son écriture.
  const spanStart = headerEarliest !== null && headerEarliest < first.date ? headerEarliest : first.date;
  const spanEnd = headerLatest !== null && headerLatest > last.date ? headerLatest : last.date;
  if (daysBetween(spanStart, spanEnd) + 1 > STATEMENT_MAX_DAILY_PERIOD_DAYS) {
    return refuse(evaluation, 'PERIOD_OVER_DAILY_LIMIT');
  }
  if (declaredPeriod !== null) {
    const coversLines = declaredPeriod.start <= declaredPeriod.end && declaredPeriod.start <= first.date && last.date <= declaredPeriod.end;
    // CSV : une période déclarée inversée ou qui n'englobe pas les lignes rend le relevé incohérent.
    if (isCsv && !coversLines) refuse(evaluation, 'STATEMENT_NEEDS_REVIEW');
    // Excel : elle n'est retenue comme preuve que si elle englobe toutes les lignes du relevé.
    if (!coversLines) declaredPeriod = null;
  }

  // Journée close : la preuve vient du RELEVÉ lui-même, jamais du nom du fichier. Sont admises la date
  // de relevé du CSV, la fin de la période déclarée d'un relevé Excel, ou une journée ultérieure raccordée
  // à la chaîne. La journée en cours n'est jamais close et une date future ne prouve rien.
  if (!closedBefore && !isCsv && declaredPeriod !== null) closedBefore = declaredPeriod.end;
  if (closedBefore && closedBefore > today) closedBefore = null;
  const next = units.find((unit) => unit.date > accountingDate) ?? null;
  const dayClosed = accountingDate < today && ((closedBefore !== null && accountingDate < closedBefore) || next !== null);
  if (!dayClosed) refuse(evaluation, 'DAY_NOT_CLOSED');

  const unitAtDate = units.find((unit) => unit.date === accountingDate) ?? null;
  const previous = [...units].reverse().find((unit) => unit.date < accountingDate) ?? null;
  let amount: number | null = null;
  let balanceDate: string | null = null;
  if (unitAtDate) {
    amount = unitAtDate.closing;
    balanceDate = unitAtDate.date;
  } else {
    // Jour sans mouvement : report de la clôture précédente seulement si la couverture de D est prouvée.
    const coveredByDeclaration = declaredPeriod !== null
      && declaredPeriod.start <= accountingDate && accountingDate <= declaredPeriod.end;
    const coveredByBracketing = previous !== null && next !== null;
    if (!previous || (!coveredByDeclaration && !coveredByBracketing)) {
      refuse(evaluation, 'DATE_NOT_COVERED');
    } else {
      amount = previous.closing;
      balanceDate = previous.date;
    }
  }

  if (!evaluation.currencyProof) refuse(evaluation, 'CURRENCY_NOT_CORROBORATED');
  if (!evaluation.identityProof) refuse(evaluation, 'IDENTITY_NOT_CORROBORATED');
  if (evaluation.reasons.length > 0 || amount === null || balanceDate === null) {
    evaluation.admissible = false;
    evaluation.amount = null;
    return evaluation;
  }
  evaluation.admissible = true;
  evaluation.amount = amount;
  evaluation.balanceDate = balanceDate;
  return evaluation;
}

function uniqueReasons(evaluations: StatementEvaluation[]): BalanceReason[] {
  const reasons: BalanceReason[] = [];
  for (const evaluation of evaluations) {
    for (const reason of evaluation.reasons) if (!reasons.includes(reason)) reasons.push(reason);
  }
  return reasons;
}

/** Noms des fichiers dont le contenu ou le compte apparaît sous plusieurs banques. */
function filesSharedAcrossBanks(evaluations: StatementEvaluation[]): Set<string> {
  const shared = new Set<string>();
  for (const left of evaluations) {
    for (const right of evaluations) {
      if (left === right || !left.bank || !right.bank || left.bank === right.bank) continue;
      const sameContent = left.contentDigest === right.contentDigest;
      const sameAccount = left.accountKey !== null && left.accountKey === right.accountKey;
      if (sameContent || sameAccount) shared.add(left.fileName);
    }
  }
  return shared;
}

/**
 * Un solde par compte attendu ; doublons comptés une fois, conflits exclus et
 * signalés. Un même relevé (mêmes octets, ou même compte) déposé sous deux
 * banques n'est retenu pour aucune des deux.
 */
export function buildAccountBalances(evaluations: StatementEvaluation[]): AccountBalance[] {
  const shared = filesSharedAcrossBanks(evaluations);
  return SITUATION_BANKS.map((bank) => {
    const mine = evaluations.filter((evaluation) => evaluation.bank === bank);
    const base: AccountBalance = {
      bank, currency: SITUATION_EXPECTED_CURRENCY, status: 'UNAVAILABLE', amount: null, balanceDate: null,
      identityProof: null, currencyProof: null, reasons: [], sources: [],
    };
    if (mine.length === 0) {
      base.reasons = [CSV_BANKS.has(bank) || EXCEL_BANKS.has(bank) ? 'NO_STATEMENT' : 'NO_READER_FOR_BANK'];
      return base;
    }
    if (mine.some((evaluation) => shared.has(evaluation.fileName))) {
      base.status = 'TO_REVIEW';
      base.reasons = ['SAME_STATEMENT_UNDER_SEVERAL_BANKS'];
      base.sources = mine.map((evaluation) => ({ fileName: evaluation.fileName, role: 'conflict' as const }));
      return base;
    }
    const admissible = mine.filter((evaluation) => evaluation.admissible && evaluation.amount !== null);
    if (admissible.length === 0) {
      base.status = mine.every((evaluation) => evaluation.reasons.includes('NO_READER_FOR_BANK')) ? 'UNAVAILABLE' : 'TO_REVIEW';
      base.reasons = uniqueReasons(mine);
      base.sources = mine.map((evaluation) => ({ fileName: evaluation.fileName, role: 'excluded' as const }));
      return base;
    }
    // Plusieurs relevés pour une banque : ils ne se confondent que s'ils sont le MÊME contenu ou portent la
    // même identité de compte corroborée. Deux comptes distincts, ou une identité indécidable, restent à revoir.
    const sameContent = mine.every((evaluation) => evaluation.contentDigest === mine[0].contentDigest);
    const sameAccount = mine.every((evaluation) => evaluation.accountKey !== null && evaluation.accountKey === mine[0].accountKey);
    if (mine.length > 1 && !sameContent && !sameAccount) {
      base.status = 'TO_REVIEW';
      base.reasons = ['SEVERAL_ACCOUNTS_FOR_BANK'];
      base.sources = mine.map((evaluation) => ({ fileName: evaluation.fileName, role: 'conflict' as const }));
      return base;
    }
    const reference = admissible[0];
    const agree = admissible.every((evaluation) => amountsEqual(evaluation.amount as number, reference.amount as number)
      && evaluation.balanceDate === reference.balanceDate);
    if (!agree) {
      base.status = 'TO_REVIEW';
      base.reasons = ['CONFLICTING_STATEMENTS'];
      base.sources = mine.map((evaluation) => ({
        fileName: evaluation.fileName,
        role: evaluation.admissible ? ('conflict' as const) : ('excluded' as const),
      }));
      return base;
    }
    base.status = 'AVAILABLE';
    base.amount = reference.amount;
    base.balanceDate = reference.balanceDate;
    base.identityProof = reference.identityProof;
    base.currencyProof = reference.currencyProof;
    base.sources = mine.map((evaluation) => ({
      fileName: evaluation.fileName,
      role: evaluation === reference ? ('retained' as const) : evaluation.admissible ? ('duplicate' as const) : ('excluded' as const),
    }));
    return base;
  });
}

/** Sous-total par devise : COMPLET, PARTIEL (comptes manquants nommés) ou INDISPONIBLE (aucun chiffre). */
export function consolidateBalances(balances: AccountBalance[]): CurrencyConsolidation[] {
  const currencies = Array.from(new Set(balances.map((balance) => balance.currency)));
  return currencies.map((currency) => {
    const accounts = balances.filter((balance) => balance.currency === currency);
    const included = accounts.filter((balance) => balance.status === 'AVAILABLE' && balance.amount !== null);
    const missing = accounts.filter((balance) => !included.includes(balance));
    if (included.length === 0) {
      return { currency, status: 'UNAVAILABLE' as const, amount: null, includedBanks: [], missingBanks: missing.map((b) => b.bank) };
    }
    return {
      currency,
      status: missing.length === 0 ? ('COMPLETE' as const) : ('PARTIAL' as const),
      amount: sumAmounts(included.map((balance) => balance.amount as number)),
      includedBanks: included.map((balance) => balance.bank),
      missingBanks: missing.map((balance) => balance.bank),
    };
  });
}
