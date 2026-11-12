// Volet « tombées » : lecture ISOLÉE du Collection Report (le pipeline Excel
// Lot 3, gelé, n'est ni importé ni modifié). L'échéance, la banque du client
// et la banque de dépôt sont conservées séparément. Chaque ligne reçoit un
// état fondé sur une preuve ; une information ambiguë reste « À vérifier »,
// hors de tout total prévisionnel. Un effet déjà crédité contribue ZÉRO aux
// entrées attendues : son échéance ne sert qu'au suivi du risque.
import {
  amountsEqual,
  cellAt,
  cellIsoDate,
  cellNumber,
  cellText,
  detectBankFromStrictLabel,
  hiddenSheetNames,
  normalizeLabel,
  readWorkbook,
  sumAmounts,
  tokenize,
  usefulBounds,
} from './situationCore';
import type { Sheet, SituationBank } from './situationCore';
import type { WorkbookEncours, WorkbookLine } from './monthlyWorkbook';

export type CollectionInstrument = 'EFFET' | 'CHEQUE' | 'AUTRE' | 'INCONNU';
export type CollectionState = 'CREDITE_DECLARE' | 'DEPOSE_EN_ATTENTE' | 'HORS_BANQUE' | 'A_VERIFIER';

export type CollectionCheckReason =
  | 'VALIDITY_BEFORE_RECEIPT'
  | 'VALIDITY_NOT_A_DATE'
  | 'VALIDITY_IN_FUTURE'
  | 'DEPOSIT_BANK_UNKNOWN'
  | 'NO_WORKBOOK_FOR_BANK'
  | 'NO_DEPOSIT_PROOF'
  | 'AMBIGUOUS_DEPOSIT_MATCH'
  | 'AMOUNT_MISSING'
  | 'AMOUNT_NOT_POSITIVE'
  | 'RECEIPT_DATE_MISSING'
  | 'RECEIPT_AFTER_ACCOUNTING_DATE'
  | 'INSTRUMENT_NOT_IDENTIFIED';

export const COLLECTION_STATE_LABELS: Record<CollectionState, string> = {
  CREDITE_DECLARE: 'Crédité déclaré',
  DEPOSE_EN_ATTENTE: 'Déposé, en attente de crédit',
  HORS_BANQUE: 'Hors banque',
  A_VERIFIER: 'À vérifier',
};

export const COLLECTION_CHECK_LABELS: Record<CollectionCheckReason, string> = {
  VALIDITY_BEFORE_RECEIPT: 'Date de validité antérieure à la date de la ligne',
  VALIDITY_NOT_A_DATE: 'Date de validité illisible',
  VALIDITY_IN_FUTURE: 'Date de validité postérieure au jour du calcul',
  DEPOSIT_BANK_UNKNOWN: 'Banque de dépôt absente, ambiguë ou inconnue',
  NO_WORKBOOK_FOR_BANK: 'Classeur de la banque de dépôt indisponible à cette date',
  NO_DEPOSIT_PROOF: 'Aucune trace de dépôt dans le classeur de la banque',
  AMBIGUOUS_DEPOSIT_MATCH: 'Plusieurs correspondances possibles avec les dépôts en attente',
  AMOUNT_MISSING: 'Montant absent',
  AMOUNT_NOT_POSITIVE: 'Montant nul ou négatif',
  RECEIPT_DATE_MISSING: 'Date de la ligne absente',
  RECEIPT_AFTER_ACCOUNTING_DATE: 'Ligne reçue après la date comptable',
  INSTRUMENT_NOT_IDENTIFIED: 'Ni numéro de chèque ni échéance d’effet : dépôt non rapprochable',
};

export interface CollectionRow {
  rowNumber: number;
  receiptDate: string | null;
  instrument: CollectionInstrument;
  /** Échéance de l'effet (colonne « No.CHq /Bd » quand elle porte une date). */
  dueDate: string | null;
  chequeNumber: string | null;
  /** Banque du client (colonne « BANK NAME »), distincte de la banque de dépôt. */
  clientBank: string;
  client: string;
  invoice: string;
  amount: number | null;
  /** Banque de dépôt telle que saisie (colonne « BANK »). */
  depositBankRaw: string;
  depositBank: SituationBank | null;
  /** Destination explicitement non bancaire (perception, douane, caisse). */
  nonBankDestination: boolean;
  validityDate: string | null;
  validityIsText: boolean;
  bankCommission: number | null;
  state: CollectionState;
  checkReason: CollectionCheckReason | null;
}

export type CollectionFileReason = 'WORKBOOK_UNREADABLE' | 'SHEET_NOT_FOUND' | 'SHEET_AMBIGUOUS';

export const COLLECTION_FILE_REASON_LABELS: Record<CollectionFileReason, string> = {
  WORKBOOK_UNREADABLE: 'fichier illisible',
  SHEET_NOT_FOUND: 'aucune feuille visible ne porte les colonnes attendues',
  SHEET_AMBIGUOUS: 'plusieurs feuilles visibles portent les colonnes attendues',
};

export interface CollectionReading {
  available: boolean;
  reason: CollectionFileReason | null;
  sheetName: string | null;
  rows: CollectionRow[];
}

export interface MaturityBucket {
  dueDate: string;
  bank: SituationBank;
  count: number;
  amount: number;
}

export interface CollectionSummary {
  totalRows: number;
  countByState: Record<CollectionState, number>;
  /** Entrées attendues : uniquement les dépôts en attente de crédit, par banque. */
  expectedInflows: Array<{ bank: SituationBank; count: number; amount: number }>;
  expectedInflowsTotal: number;
  /** Montant des lignes « À vérifier », tenu HORS du total prévisionnel. */
  toVerifyAmount: number;
  /** Échéances futures d'effets déjà crédités : suivi du risque, jamais une entrée. */
  creditedEffetMaturities: MaturityBucket[];
}

interface ColumnMap {
  date: number;
  instrument: number | null;
  clientBank: number;
  client: number;
  invoice: number | null;
  amount: number;
  depositBank: number;
  validity: number | null;
  commission: number | null;
}

/** Destinations explicitement hors banque ; toute autre valeur non reconnue reste « À vérifier ». */
const NON_BANK_TOKENS = new Set(['PDP', 'UEMOA', 'CEDEAO', 'CASH', 'CAISSE', 'DOUANE', 'PERCEPTION', 'TRESOR']);

function isNonBankDestination(value: string): boolean {
  const tokens = tokenize(value);
  return tokens.length > 0 && tokens.every((token) => NON_BANK_TOKENS.has(token));
}

function headerKey(value: string): string {
  return normalizeLabel(value).replace(/[^A-Z0-9]/g, '');
}

const HEADER_ALIASES: Record<keyof ColumnMap, string[]> = {
  date: ['DATE'],
  instrument: ['NOCHQBD'],
  clientBank: ['BANKNAME'],
  client: ['CLIENTNAME'],
  invoice: ['FACTUREN', 'FACTURENO'],
  amount: ['AMOUNT'],
  depositBank: ['BANK'],
  validity: ['DATEOFVALIDITY'],
  commission: ['BANKCOMMISSION'],
};

function mapColumns(sheet: Sheet, lastColumn: number): ColumnMap | null {
  const found: Partial<Record<keyof ColumnMap, number>> = {};
  for (let column = 1; column <= lastColumn; column += 1) {
    const key = headerKey(cellText(cellAt(sheet, 1, column)));
    if (!key) continue;
    for (const field of Object.keys(HEADER_ALIASES) as Array<keyof ColumnMap>) {
      if (HEADER_ALIASES[field].includes(key)) {
        // Un en-tête répété rend la structure ambiguë : la feuille est refusée.
        if (found[field] !== undefined) return null;
        found[field] = column;
      }
    }
  }
  if (found.date === undefined || found.clientBank === undefined || found.client === undefined
    || found.amount === undefined || found.depositBank === undefined) {
    return null;
  }
  return {
    date: found.date, instrument: found.instrument ?? null, clientBank: found.clientBank, client: found.client,
    invoice: found.invoice ?? null, amount: found.amount, depositBank: found.depositBank,
    validity: found.validity ?? null, commission: found.commission ?? null,
  };
}

function textOrNumber(sheet: Sheet, row: number, column: number | null): string {
  if (column === null) return '';
  const cell = cellAt(sheet, row, column);
  const text = cellText(cell);
  if (text) return text;
  const value = cellNumber(cell);
  return value !== null ? String(value) : '';
}

/** Lecture brute des lignes ; les états sont attribués par `classifyCollectionRows`. */
export function readCollectionReport(bytes: ArrayBuffer): CollectionReading {
  let workbook;
  try {
    workbook = readWorkbook(bytes.slice(0));
  } catch {
    return { available: false, reason: 'WORKBOOK_UNREADABLE', sheetName: null, rows: [] };
  }
  const hidden = hiddenSheetNames(workbook);
  // Deux feuilles visibles aux en-têtes compatibles : impossible de savoir laquelle fait foi.
  const compatible = workbook.SheetNames.filter((sheetName) => {
    if (hidden.has(sheetName)) return false;
    const sheet = workbook.Sheets[sheetName];
    return mapColumns(sheet, usefulBounds(sheet, 20_000, 40).lastColumn) !== null;
  });
  if (compatible.length > 1) return { available: false, reason: 'SHEET_AMBIGUOUS', sheetName: null, rows: [] };
  for (const sheetName of compatible) {
    const sheet = workbook.Sheets[sheetName];
    const bounds = usefulBounds(sheet, 20_000, 40);
    const columns = mapColumns(sheet, bounds.lastColumn);
    if (!columns) continue;
    const rows: CollectionRow[] = [];
    for (let row = 2; row <= bounds.lastRow; row += 1) {
      const receiptDate = cellIsoDate(cellAt(sheet, row, columns.date));
      const amount = cellNumber(cellAt(sheet, row, columns.amount));
      const client = cellText(cellAt(sheet, row, columns.client));
      if (!receiptDate && amount === null && !client) continue;
      const instrumentCell = columns.instrument !== null ? cellAt(sheet, row, columns.instrument) : undefined;
      const dueDate = cellIsoDate(instrumentCell);
      const instrumentNumber = cellNumber(instrumentCell);
      const instrumentText = cellText(instrumentCell);
      const instrument: CollectionInstrument = dueDate ? 'EFFET' : instrumentNumber !== null ? 'CHEQUE' : instrumentText ? 'AUTRE' : 'INCONNU';
      const validityCell = columns.validity !== null ? cellAt(sheet, row, columns.validity) : undefined;
      const validityDate = cellIsoDate(validityCell);
      const depositBankRaw = cellText(cellAt(sheet, row, columns.depositBank));
      rows.push({
        rowNumber: row,
        receiptDate,
        instrument,
        dueDate,
        // Un numéro nul ou négatif n'identifie aucun chèque.
        chequeNumber: instrument === 'CHEQUE' && Math.round(instrumentNumber as number) > 0 ? String(Math.round(instrumentNumber as number)) : null,
        clientBank: cellText(cellAt(sheet, row, columns.clientBank)),
        client,
        invoice: textOrNumber(sheet, row, columns.invoice),
        amount,
        depositBankRaw,
        depositBank: detectBankFromStrictLabel(depositBankRaw),
        nonBankDestination: isNonBankDestination(depositBankRaw),
        validityDate,
        // Toute valeur non datée (texte, nombre, cellule d'erreur) rend la date de validité illisible.
        validityIsText: !validityDate && validityCell !== undefined && validityCell.v !== undefined
          && validityCell.v !== null && String(validityCell.v).trim() !== '',
        bankCommission: columns.commission !== null ? cellNumber(cellAt(sheet, row, columns.commission)) : null,
        state: 'A_VERIFIER',
        checkReason: null,
      });
    }
    return { available: true, reason: null, sheetName, rows };
  }
  return { available: false, reason: 'SHEET_NOT_FOUND', sheetName: null, rows: [] };
}

function clientKey(value: string): string {
  return normalizeLabel(value).replace(/[^A-Z0-9]/g, '');
}

function depositMatchesRow(deposit: WorkbookLine, row: CollectionRow): boolean {
  if (row.amount === null || !amountsEqual(deposit.amount, row.amount)) return false;
  if (!deposit.client || !row.client || clientKey(deposit.client) !== clientKey(row.client)) return false;
  // Effet : échéance concordante exigée. Chèque : numéro concordant exigé des deux côtés.
  if (row.instrument === 'EFFET') return deposit.dueDate !== null && deposit.dueDate === row.dueDate;
  if (row.instrument === 'CHEQUE') {
    return deposit.dueDate === null && row.chequeNumber !== null && deposit.number !== null && deposit.number === row.chequeNumber;
  }
  // Tout autre instrument (virement, espèces, inconnu) n'est jamais rapproché d'un dépôt.
  return false;
}

/**
 * Attribue un état à chaque ligne. Un dépôt en attente n'est reconnu que par
 * une correspondance UNIQUE, dans les deux sens, avec une ligne « dépôt en
 * attente » du classeur de la même banque (banque, client, nominal, échéance).
 */
export function classifyCollectionRows(
  rows: CollectionRow[],
  workbooks: WorkbookEncours[],
  accountingDate: string,
  today: string,
): CollectionRow[] {
  const depositsByBank = new Map<SituationBank, WorkbookLine[]>();
  for (const workbook of workbooks) {
    if (workbook.available && workbook.bank && workbook.deposits.available) {
      depositsByBank.set(workbook.bank, workbook.deposits.lines);
    }
  }
  const classified = rows.map((row) => ({ ...row }));
  const pending: Array<{ row: CollectionRow; candidates: WorkbookLine[] }> = [];
  for (const row of classified) {
    row.checkReason = null;
    if (!row.depositBank && row.nonBankDestination) {
      row.state = 'HORS_BANQUE';
      continue;
    }
    row.state = 'A_VERIFIER';
    if (!row.depositBank) { row.checkReason = 'DEPOSIT_BANK_UNKNOWN'; continue; }
    if (row.amount === null) { row.checkReason = 'AMOUNT_MISSING'; continue; }
    // Un montant nul ou négatif n'est ni une tombée ni un crédit : jamais compté, dans aucun sens.
    if (row.amount <= 0) { row.checkReason = 'AMOUNT_NOT_POSITIVE'; continue; }
    if (!row.receiptDate) { row.checkReason = 'RECEIPT_DATE_MISSING'; continue; }
    // Une ligne reçue après D n'appartient pas à la situation à D : elle n'alimente aucune entrée attendue.
    if (row.receiptDate > accountingDate) { row.checkReason = 'RECEIPT_AFTER_ACCOUNTING_DATE'; continue; }
    if (row.validityIsText) { row.checkReason = 'VALIDITY_NOT_A_DATE'; continue; }
    if (row.validityDate) {
      if (row.validityDate < row.receiptDate) { row.checkReason = 'VALIDITY_BEFORE_RECEIPT'; continue; }
      if (row.validityDate > today) { row.checkReason = 'VALIDITY_IN_FUTURE'; continue; }
      // Crédité au plus tard à D ; un crédit daté après D n'était pas encore acquis à D.
      if (row.validityDate <= accountingDate) {
        row.state = 'CREDITE_DECLARE';
        continue;
      }
    }
    if (row.instrument !== 'EFFET' && row.instrument !== 'CHEQUE') { row.checkReason = 'INSTRUMENT_NOT_IDENTIFIED'; continue; }
    const deposits = depositsByBank.get(row.depositBank);
    if (!deposits) { row.checkReason = 'NO_WORKBOOK_FOR_BANK'; continue; }
    const candidates = deposits.filter((deposit) => depositMatchesRow(deposit, row));
    if (candidates.length === 0) { row.checkReason = 'NO_DEPOSIT_PROOF'; continue; }
    pending.push({ row, candidates });
  }
  for (const entry of pending) {
    const unique = entry.candidates.length === 1
      && pending.filter((other) => other.candidates.includes(entry.candidates[0])).length === 1;
    if (unique) entry.row.state = 'DEPOSE_EN_ATTENTE';
    else entry.row.checkReason = 'AMBIGUOUS_DEPOSIT_MATCH';
  }
  return classified;
}

export function summarizeCollections(rows: CollectionRow[], accountingDate: string): CollectionSummary {
  const countByState: Record<CollectionState, number> = { CREDITE_DECLARE: 0, DEPOSE_EN_ATTENTE: 0, HORS_BANQUE: 0, A_VERIFIER: 0 };
  const inflows = new Map<SituationBank, number[]>();
  const maturities = new Map<string, { dueDate: string; bank: SituationBank; amounts: number[] }>();
  const toVerify: number[] = [];
  for (const row of rows) {
    countByState[row.state] += 1;
    if (row.state === 'DEPOSE_EN_ATTENTE' && row.depositBank && row.amount !== null) {
      inflows.set(row.depositBank, [...(inflows.get(row.depositBank) ?? []), row.amount]);
    }
    // Montants positifs seulement : une ligne négative ne vient jamais en déduction d'une autre.
    if (row.state === 'A_VERIFIER' && row.amount !== null && row.amount > 0) toVerify.push(row.amount);
    if (row.state === 'CREDITE_DECLARE' && row.instrument === 'EFFET' && row.dueDate && row.dueDate > accountingDate
      && row.depositBank && row.amount !== null) {
      const key = `${row.dueDate}|${row.depositBank}`;
      const bucket = maturities.get(key) ?? { dueDate: row.dueDate, bank: row.depositBank, amounts: [] };
      bucket.amounts.push(row.amount);
      maturities.set(key, bucket);
    }
  }
  const expectedInflows = Array.from(inflows.entries())
    .map(([bank, amounts]) => ({ bank, count: amounts.length, amount: sumAmounts(amounts) }))
    .sort((a, b) => a.bank.localeCompare(b.bank));
  return {
    totalRows: rows.length,
    countByState,
    expectedInflows,
    expectedInflowsTotal: sumAmounts(expectedInflows.map((entry) => entry.amount)),
    toVerifyAmount: sumAmounts(toVerify),
    creditedEffetMaturities: Array.from(maturities.values())
      .map((bucket) => ({ dueDate: bucket.dueDate, bank: bucket.bank, count: bucket.amounts.length, amount: sumAmounts(bucket.amounts) }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.bank.localeCompare(b.bank)),
  };
}
