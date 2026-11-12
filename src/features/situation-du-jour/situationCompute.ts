// Orchestration en mémoire de la « Situation du jour » : classe les fichiers
// déposés, appelle les quatre volets et assemble le résultat. Aucun fichier,
// aucune ligne et aucun montant ne quitte la mémoire de l'onglet du navigateur.
import {
  classifyCollectionRows,
  readCollectionReport,
  summarizeCollections,
} from './collectionReading';
import type { CollectionReading, CollectionRow, CollectionSummary } from './collectionReading';
import { compareFundPosition, readFundPosition } from './fundPositionReading';
import type { FundPositionComparison, FundPositionReading } from './fundPositionReading';
import { readMonthlyWorkbook } from './monthlyWorkbook';
import type { WorkbookEncours } from './monthlyWorkbook';
import { detectBankFromText, isIsoDate, tokenize } from './situationCore';
import type { InMemoryFile, SituationBank } from './situationCore';
import { buildAccountBalances, consolidateBalances, evaluateStatement } from './statementBalances';
import type { AccountBalance, CurrencyConsolidation, StatementAttestation, StatementEvaluation } from './statementBalances';

export type SituationFileKind = 'STATEMENT' | 'MONTHLY_WORKBOOK' | 'COLLECTION_REPORT' | 'FUND_POSITION' | 'UNRECOGNIZED';

export const SITUATION_FILE_KIND_LABELS: Record<SituationFileKind, string> = {
  STATEMENT: 'Relevé bancaire',
  MONTHLY_WORKBOOK: 'Classeur mensuel',
  COLLECTION_REPORT: 'Collection Report',
  FUND_POSITION: 'Fund Position',
  UNRECOGNIZED: 'Non reconnu',
};

export interface ClassifiedFile {
  name: string;
  kind: SituationFileKind;
  bank: SituationBank | null;
}

/** Classement par le seul nom du fichier ; la structure est vérifiée ensuite par chaque lecteur. */
export function classifySituationFile(name: string): ClassifiedFile {
  const tokens = new Set(tokenize(name));
  const lower = name.toLowerCase();
  const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');
  const isCsv = lower.endsWith('.csv');
  const bank = detectBankFromText(name);
  if (isExcel && tokens.has('COLLECTION')) return { name, kind: 'COLLECTION_REPORT', bank: null };
  if (isExcel && tokens.has('FUND') && tokens.has('POSITION')) return { name, kind: 'FUND_POSITION', bank: null };
  if ((isExcel || isCsv) && tokens.has('ONLINE') && bank) return { name, kind: 'STATEMENT', bank };
  if (isExcel && bank) return { name, kind: 'MONTHLY_WORKBOOK', bank };
  return { name, kind: 'UNRECOGNIZED', bank };
}

export interface SituationInput {
  files: InMemoryFile[];
  /** Date comptable D (ISO) : date des soldes. */
  accountingDate: string;
  /** Jour du calcul (ISO) : borne les onglets datés dans le futur. */
  today: string;
  /** Attestations de l'opérateur par nom de fichier, pour la seule session. */
  attestations?: Record<string, StatementAttestation>;
}

export interface SituationCollection {
  reading: CollectionReading;
  rows: CollectionRow[];
  summary: CollectionSummary | null;
}

export interface SituationFundPosition {
  reading: FundPositionReading;
  comparisons: FundPositionComparison[];
}

export interface SituationResult {
  accountingDate: string;
  today: string;
  files: ClassifiedFile[];
  statements: StatementEvaluation[];
  balances: AccountBalance[];
  consolidation: CurrencyConsolidation[];
  workbooks: WorkbookEncours[];
  collection: SituationCollection | null;
  fundPosition: SituationFundPosition | null;
  /** Fichiers en double qui rendent une section ambiguë : elle n'est alors pas calculée. */
  ambiguities: SituationAmbiguity[];
}

export type SituationAmbiguity = 'SEVERAL_COLLECTION_REPORTS' | 'SEVERAL_FUND_POSITIONS' | 'SEVERAL_WORKBOOKS_FOR_A_BANK';

export const SITUATION_AMBIGUITY_LABELS: Record<SituationAmbiguity, string> = {
  SEVERAL_COLLECTION_REPORTS: 'Plusieurs Collection Reports déposés : les tombées ne sont pas calculées.',
  SEVERAL_FUND_POSITIONS: 'Plusieurs Fund Positions déposées : la comparaison n’est pas calculée.',
  SEVERAL_WORKBOOKS_FOR_A_BANK: 'Plusieurs classeurs pour une même banque : leurs encours ne sont pas retenus.',
};

export class SituationInputError extends Error {
  constructor(readonly code: 'ACCOUNTING_DATE_INVALID' | 'TODAY_INVALID' | 'ACCOUNTING_DATE_IN_FUTURE') {
    super(code);
    this.name = 'SituationInputError';
  }
}

export function computeSituation(input: SituationInput): SituationResult {
  if (!isIsoDate(input.accountingDate)) throw new SituationInputError('ACCOUNTING_DATE_INVALID');
  if (!isIsoDate(input.today)) throw new SituationInputError('TODAY_INVALID');
  if (input.accountingDate > input.today) throw new SituationInputError('ACCOUNTING_DATE_IN_FUTURE');

  const files = input.files.map((file) => classifySituationFile(file.name));
  const byKind = (kind: SituationFileKind) => input.files.filter((_, index) => files[index].kind === kind);

  const statements = byKind('STATEMENT').map((file) => evaluateStatement(
    { ...file, attestation: input.attestations?.[file.name] },
    input.accountingDate,
    input.today,
  ));
  const balances = buildAccountBalances(statements);
  const consolidation = consolidateBalances(balances);
  const ambiguities: SituationAmbiguity[] = [];
  const readWorkbooks = byKind('MONTHLY_WORKBOOK').map((file) => readMonthlyWorkbook(file, input.accountingDate, input.today));
  // Deux classeurs désignant la même banque, même si un seul est exploitable : aucun n'est retenu,
  // et aucun chiffre n'en est affiché.
  const duplicated = (workbook: WorkbookEncours) => workbook.bank !== null
    && readWorkbooks.filter((other) => other.bank === workbook.bank).length > 1;
  if (readWorkbooks.some(duplicated)) ambiguities.push('SEVERAL_WORKBOOKS_FOR_A_BANK');
  const workbooks = readWorkbooks.map((workbook) => (duplicated(workbook)
    ? { ...readMonthlyWorkbook({ name: workbook.fileName, bytes: new ArrayBuffer(0) }, input.accountingDate, input.today),
      bank: workbook.bank, reason: 'DUPLICATE_WORKBOOK' as const }
    : workbook));
  const usableWorkbooks = workbooks.filter((workbook) => workbook.available);

  const collectionFiles = byKind('COLLECTION_REPORT');
  let collection: SituationCollection | null = null;
  if (collectionFiles.length > 1) ambiguities.push('SEVERAL_COLLECTION_REPORTS');
  if (collectionFiles.length === 1) {
    const reading = readCollectionReport(collectionFiles[0].bytes);
    const rows = reading.available ? classifyCollectionRows(reading.rows, usableWorkbooks, input.accountingDate, input.today) : [];
    collection = { reading, rows, summary: reading.available ? summarizeCollections(rows, input.accountingDate) : null };
  }

  const fundPositionFiles = byKind('FUND_POSITION');
  let fundPosition: SituationFundPosition | null = null;
  if (fundPositionFiles.length > 1) ambiguities.push('SEVERAL_FUND_POSITIONS');
  if (fundPositionFiles.length === 1) {
    const reading = readFundPosition(fundPositionFiles[0].bytes, input.accountingDate, input.today);
    fundPosition = { reading, comparisons: compareFundPosition(reading, input.accountingDate, balances, usableWorkbooks) };
  }

  return {
    accountingDate: input.accountingDate,
    today: input.today,
    files,
    statements,
    balances,
    consolidation,
    workbooks,
    collection,
    fundPosition,
    ambiguities,
  };
}
