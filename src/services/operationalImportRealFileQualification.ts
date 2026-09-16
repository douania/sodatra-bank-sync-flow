import type { BankReport, FundPosition } from '../types/banking';
import type { OperationalBankCode } from './bankIdentity';
import { bankReportSectionExtractor } from './bankReportSectionExtractor';
import { extractBankReportFromGrid } from './bankReportGridExtractor';
import { corroborateBankIdentity, detectBankFromFileName } from './bankIdentity';
import { sheetGridToText, type ExcelSheetGrid } from './excelSheetGrid';
import { extractFundPosition } from './extractionService';
import { extractFundPositionFromGrid } from './fundPositionGridExtractor';

export type RealFileQualificationFamily = OperationalBankCode | 'FUND_POSITION';
export type RealFileQualificationFormat = 'PDF' | 'XLSX' | 'XLS';

export type RealFileQualificationErrorCode =
  | 'CONTENT_TOO_SHORT'
  | 'BANK_IDENTITY_UNCORROBORATED'
  | 'DOCUMENT_STRUCTURE_AMBIGUOUS'
  | 'REPORT_DATE_INVALID'
  | 'OPENING_BALANCE_INVALID'
  | 'CLOSING_BALANCE_INVALID'
  | 'DECLARED_SECTION_INVALID'
  | 'FINANCIAL_VALUE_INVALID'
  | 'EXCEL_ERROR_CELL'
  | 'FUND_POSITION_GRAND_TOTAL_INVALID'
  | 'FUND_POSITION_DETAILS_INVALID'
  | 'FUND_POSITION_HOLD_INVALID'
  | 'EXTRACTION_REJECTED';

export interface RealFileQualificationInput {
  caseId: string;
  family: RealFileQualificationFamily;
  format: RealFileQualificationFormat;
  sourceFileName: string;
  extractedText: string;
  inputSha256: string;
  byteLength: number;
}

/** Entrée tabulaire (Pack 2) : une feuille Excel choisie, jamais un classeur concaténé. */
export interface RealFileGridQualificationInput {
  caseId: string;
  family: RealFileQualificationFamily;
  format: 'XLSX' | 'XLS';
  sourceFileName: string;
  grid: ExcelSheetGrid;
  inputSha256: string;
  byteLength: number;
}

export interface RealFileQualificationEvidence {
  reportDatePresent: boolean;
  openingBalancePresent: boolean;
  closingBalancePresent: boolean;
  bankDetailCount: number;
  depositCount: number;
  checkCount: number;
  facilityCount: number;
  unpaidCount: number;
  holdCount: number;
}

export interface RealFileQualificationResult {
  schemaVersion: 1;
  caseId: string;
  family: RealFileQualificationFamily;
  format: RealFileQualificationFormat;
  decision: 'LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW' | 'FAIL_CLOSED';
  success: boolean;
  inputSha256: string;
  byteLength: number;
  extractedCharacterCount: number;
  evidence: RealFileQualificationEvidence;
  errorCodes: RealFileQualificationErrorCode[];
  /** Compteurs non sensibles issus de l'extraction tabulaire (absent pour le texte). */
  gridEvidence?: {
    usedRowCount: number;
    usedColumnCount: number;
    errorCellCount: number;
    ignoredPostTotalRowCount: number;
  };
  containsRawBankingData: false;
  persistenceAttempted: false;
  environmentAccessed: false;
  promotionAuthorized: false;
}

const EMPTY_EVIDENCE: RealFileQualificationEvidence = {
  reportDatePresent: false,
  openingBalancePresent: false,
  closingBalancePresent: false,
  bankDetailCount: 0,
  depositCount: 0,
  checkCount: 0,
  facilityCount: 0,
  unpaidCount: 0,
  holdCount: 0,
};

function normalizeError(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

function classifyError(message: string): RealFileQualificationErrorCode {
  const normalized = normalizeError(message);

  if (normalized.includes('ERREUR EXCEL')) {
    return 'EXCEL_ERROR_CELL';
  }
  if (normalized.includes('IDENTITE BANCAIRE') || normalized.includes('BANQUE ABSENTE') || normalized.includes('BANQUE AMBIGUE')) {
    return 'BANK_IDENTITY_UNCORROBORATED';
  }
  if (
    normalized.includes('STRUCTURE DE LIGNES')
    || normalized.includes('PDF_TEXT_POSITION_INCOMPLETE')
    || normalized.includes('PDF_NUMERIC_TOKEN_BOUNDARY_AMBIGUOUS')
  ) {
    return 'DOCUMENT_STRUCTURE_AMBIGUOUS';
  }
  if (
    normalized.includes('DATE')
    && (normalized.includes('INVALIDE') || normalized.includes('POSTERIEURE') || normalized.includes('INCOHERENTE'))
  ) {
    return 'REPORT_DATE_INVALID';
  }
  if (normalized.includes("SOLDE D'OUVERTURE") || normalized.includes('SOLDE D’OUVERTURE')) {
    return 'OPENING_BALANCE_INVALID';
  }
  if (normalized.includes('SOLDE DE CLOTURE')) {
    return 'CLOSING_BALANCE_INVALID';
  }
  if (normalized.includes('GRAND TOTAL') || normalized.includes('TOTAL FUND AVAILABLE') || normalized.includes('FONDS DISPONIBLES')) {
    return 'FUND_POSITION_GRAND_TOTAL_INVALID';
  }
  if (normalized.includes('FUND POSITION') || normalized.includes('DETAIL BANCAIRE') || normalized.includes('EN-TETE FUND')) {
    return 'FUND_POSITION_DETAILS_INVALID';
  }
  if (normalized.includes('HOLD')) {
    return 'FUND_POSITION_HOLD_INVALID';
  }
  if (normalized.includes('SECTION') || normalized.includes('LIGNE DE') || normalized.includes('HORS SECTION') || normalized.includes('LIGNE ') && normalized.includes('IMPAYES')) {
    return 'DECLARED_SECTION_INVALID';
  }
  if (normalized.includes('MONTANT') || normalized.includes('FINANCI') || normalized.includes('BLOC ')) {
    return 'FINANCIAL_VALUE_INVALID';
  }
  return 'EXTRACTION_REJECTED';
}

function uniqueErrorCodes(messages: readonly string[]): RealFileQualificationErrorCode[] {
  return [...new Set(messages.map(classifyError))];
}

function resultBase(input: {
  caseId: string;
  family: RealFileQualificationFamily;
  format: RealFileQualificationFormat;
  inputSha256: string;
  byteLength: number;
  extractedCharacterCount: number;
}): Omit<RealFileQualificationResult, 'decision' | 'success' | 'evidence' | 'errorCodes'> {
  return {
    schemaVersion: 1,
    caseId: input.caseId,
    family: input.family,
    format: input.format,
    inputSha256: input.inputSha256,
    byteLength: input.byteLength,
    extractedCharacterCount: input.extractedCharacterCount,
    containsRawBankingData: false,
    persistenceAttempted: false,
    environmentAccessed: false,
    promotionAuthorized: false,
  };
}

function bankEvidence(report: BankReport): RealFileQualificationEvidence {
  return {
    ...EMPTY_EVIDENCE,
    reportDatePresent: Boolean(report.date),
    openingBalancePresent: Number.isSafeInteger(report.openingBalance),
    closingBalancePresent: Number.isSafeInteger(report.closingBalance),
    depositCount: report.depositsNotCleared.length,
    checkCount: report.checksNotCleared?.length ?? 0,
    facilityCount: report.bankFacilities.length,
    unpaidCount: report.impayes.length,
  };
}

function fundPositionEvidence(position: FundPosition): RealFileQualificationEvidence {
  return {
    ...EMPTY_EVIDENCE,
    reportDatePresent: Boolean(position.reportDate),
    bankDetailCount: position.details?.length ?? 0,
    holdCount: position.holdCollections?.length ?? 0,
  };
}

function rejected(
  base: ReturnType<typeof resultBase>,
  errorCodes: RealFileQualificationErrorCode[],
  gridEvidence?: RealFileQualificationResult['gridEvidence'],
): RealFileQualificationResult {
  return {
    ...base,
    decision: 'FAIL_CLOSED',
    success: false,
    evidence: { ...EMPTY_EVIDENCE },
    errorCodes,
    gridEvidence,
  };
}

/**
 * Qualification locale sans persistance d'un texte déjà extrait (PDF).
 *
 * La sortie est volontairement agrégée : aucune ligne, valeur financière,
 * identité, référence ou nom de fichier source ne peut quitter ce service.
 * Un PASS ne vaut jamais promotion et exige encore une revue staging dédiée.
 */
export async function qualifyOperationalImportRealFileText(
  input: RealFileQualificationInput,
): Promise<RealFileQualificationResult> {
  const base = resultBase({ ...input, extractedCharacterCount: input.extractedText.length });
  if (input.extractedText.trim().length < 100) {
    return rejected(base, ['CONTENT_TOO_SHORT']);
  }

  if (input.family === 'FUND_POSITION') {
    const extraction = extractFundPosition(input.extractedText);
    if (!extraction.success || !extraction.data) {
      return rejected(base, uniqueErrorCodes(extraction.errors ?? ['Extraction refusée.']));
    }

    return {
      ...base,
      decision: 'LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW',
      success: true,
      evidence: fundPositionEvidence(extraction.data as FundPosition),
      errorCodes: [],
    };
  }

  const identity = corroborateBankIdentity(input.sourceFileName, input.extractedText);
  if (!identity.corroborated || identity.bank !== input.family) {
    return rejected(base, ['BANK_IDENTITY_UNCORROBORATED']);
  }

  const extraction = await bankReportSectionExtractor.extractBankReportSections(
    input.extractedText,
    input.family,
  );
  if (!extraction.success || !extraction.data) {
    return rejected(base, uniqueErrorCodes(extraction.errors ?? ['Extraction refusée.']));
  }

  return {
    ...base,
    decision: 'LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW',
    success: true,
    evidence: bankEvidence(extraction.data),
    errorCodes: [],
  };
}

/**
 * Qualification locale sans persistance d'UNE feuille Excel (Pack 2).
 * Mêmes garanties de sortie que la variante texte ; les seuls compteurs
 * ajoutés décrivent la structure de la grille (lignes, colonnes, erreurs).
 */
export async function qualifyOperationalImportRealFileGrid(
  input: RealFileGridQualificationInput,
): Promise<RealFileQualificationResult> {
  const text = sheetGridToText(input.grid);
  const base = resultBase({ ...input, extractedCharacterCount: text.length });
  const gridEvidence = {
    usedRowCount: input.grid.usedRowCount,
    usedColumnCount: input.grid.usedColumnCount,
    errorCellCount: input.grid.errorCellCount,
    ignoredPostTotalRowCount: 0,
  };
  if (text.trim().length < 100) {
    return rejected(base, ['CONTENT_TOO_SHORT'], gridEvidence);
  }

  if (input.family === 'FUND_POSITION') {
    const extraction = extractFundPositionFromGrid(input.grid);
    if (!extraction.success || !extraction.data) {
      return rejected(base, uniqueErrorCodes(extraction.errors ?? ['Extraction refusée.']), gridEvidence);
    }
    return {
      ...base,
      decision: 'LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW',
      success: true,
      evidence: fundPositionEvidence(extraction.data),
      errorCodes: [],
      gridEvidence,
    };
  }

  if (detectBankFromFileName(input.sourceFileName) !== input.family) {
    return rejected(base, ['BANK_IDENTITY_UNCORROBORATED'], gridEvidence);
  }

  const extraction = await extractBankReportFromGrid(input.grid, input.family);
  gridEvidence.ignoredPostTotalRowCount = extraction.evidence?.ignoredPostTotalRowCount ?? 0;
  if (!extraction.success || !extraction.data) {
    return rejected(base, uniqueErrorCodes(extraction.errors ?? ['Extraction refusée.']), gridEvidence);
  }

  return {
    ...base,
    decision: 'LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW',
    success: true,
    evidence: bankEvidence(extraction.data),
    errorCodes: [],
    gridEvidence,
  };
}
