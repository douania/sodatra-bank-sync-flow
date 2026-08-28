import type { BankReport, FundPosition } from '../types/banking';
import type { OperationalBankCode } from './bankIdentity';
import { bankReportSectionExtractor } from './bankReportSectionExtractor';
import { corroborateBankIdentity } from './bankIdentity';
import { extractFundPosition } from './extractionService';

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
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function classifyError(message: string): RealFileQualificationErrorCode {
  const normalized = normalizeError(message);

  if (normalized.includes('IDENTITE BANCAIRE') || normalized.includes('BANQUE ABSENTE')) {
    return 'BANK_IDENTITY_UNCORROBORATED';
  }
  if (
    normalized.includes('STRUCTURE DE LIGNES')
    || normalized.includes('PDF_TEXT_POSITION_INCOMPLETE')
    || normalized.includes('PDF_NUMERIC_TOKEN_BOUNDARY_AMBIGUOUS')
  ) {
    return 'DOCUMENT_STRUCTURE_AMBIGUOUS';
  }
  if (normalized.includes('DATE') && normalized.includes('INVALIDE')) {
    return 'REPORT_DATE_INVALID';
  }
  if (normalized.includes("SOLDE D'OUVERTURE") || normalized.includes('SOLDE D’OUVERTURE')) {
    return 'OPENING_BALANCE_INVALID';
  }
  if (normalized.includes('SOLDE DE CLOTURE')) {
    return 'CLOSING_BALANCE_INVALID';
  }
  if (normalized.includes('GRAND TOTAL')) {
    return 'FUND_POSITION_GRAND_TOTAL_INVALID';
  }
  if (normalized.includes('FUND POSITION') || normalized.includes('DETAIL BANCAIRE')) {
    return 'FUND_POSITION_DETAILS_INVALID';
  }
  if (normalized.includes('HOLD')) {
    return 'FUND_POSITION_HOLD_INVALID';
  }
  if (normalized.includes('SECTION') || normalized.includes('LIGNE DE')) {
    return 'DECLARED_SECTION_INVALID';
  }
  if (normalized.includes('MONTANT') || normalized.includes('FINANCI')) {
    return 'FINANCIAL_VALUE_INVALID';
  }
  return 'EXTRACTION_REJECTED';
}

function uniqueErrorCodes(messages: readonly string[]): RealFileQualificationErrorCode[] {
  return [...new Set(messages.map(classifyError))];
}

function resultBase(input: RealFileQualificationInput): Omit<
  RealFileQualificationResult,
  'decision' | 'success' | 'evidence' | 'errorCodes'
> {
  return {
    schemaVersion: 1,
    caseId: input.caseId,
    family: input.family,
    format: input.format,
    inputSha256: input.inputSha256,
    byteLength: input.byteLength,
    extractedCharacterCount: input.extractedText.length,
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
  input: RealFileQualificationInput,
  errorCodes: RealFileQualificationErrorCode[],
): RealFileQualificationResult {
  return {
    ...resultBase(input),
    decision: 'FAIL_CLOSED',
    success: false,
    evidence: { ...EMPTY_EVIDENCE },
    errorCodes,
  };
}

/**
 * Qualification locale sans persistance d'un texte déjà extrait.
 *
 * La sortie est volontairement agrégée : aucune ligne, valeur financière,
 * identité, référence ou nom de fichier source ne peut quitter ce service.
 * Un PASS ne vaut jamais promotion et exige encore une revue staging dédiée.
 */
export async function qualifyOperationalImportRealFileText(
  input: RealFileQualificationInput,
): Promise<RealFileQualificationResult> {
  if (input.extractedText.trim().length < 100) {
    return rejected(input, ['CONTENT_TOO_SHORT']);
  }

  if (input.family === 'FUND_POSITION') {
    const extraction = extractFundPosition(input.extractedText);
    if (!extraction.success || !extraction.data) {
      return rejected(input, uniqueErrorCodes(extraction.errors ?? ['Extraction refusée.']));
    }

    return {
      ...resultBase(input),
      decision: 'LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW',
      success: true,
      evidence: fundPositionEvidence(extraction.data as FundPosition),
      errorCodes: [],
    };
  }

  const identity = corroborateBankIdentity(input.sourceFileName, input.extractedText);
  if (!identity.corroborated || identity.bank !== input.family) {
    return rejected(input, ['BANK_IDENTITY_UNCORROBORATED']);
  }

  const extraction = await bankReportSectionExtractor.extractBankReportSections(
    input.extractedText,
    input.family,
  );
  if (!extraction.success || !extraction.data) {
    return rejected(input, uniqueErrorCodes(extraction.errors ?? ['Extraction refusée.']));
  }

  return {
    ...resultBase(input),
    decision: 'LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW',
    success: true,
    evidence: bankEvidence(extraction.data),
    errorCodes: [],
  };
}
