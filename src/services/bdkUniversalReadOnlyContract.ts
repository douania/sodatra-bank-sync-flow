import type { BDKParsedData } from './bdkExtractionService';
import { parseDocumentDate, parseFinancialInteger } from './bankReportExtractionContract';

export function validateBdkUniversalReadOnlyResult(
  content: string,
  data: BDKParsedData,
): string[] {
  const errors: string[] = [];
  const openingMatch = content.match(
    /OPENING\s+BALANCE\s+(\d{2}[/-]\d{2}[/-]\d{4})[ \t]+([+-]?\d[\d \t\u00a0\u202f,.]*)/i,
  );
  const closingMatch = content.match(
    /CLOSING\s+BALANCE\s+as\s+per\s+Book\s*:\s*C=\(A-B\)[ \t]+([+-]?\d[\d \t\u00a0\u202f,.]*)/i,
  );
  const reportDate = parseDocumentDate(data.reportDate);
  const openingDate = parseDocumentDate(openingMatch?.[1]);
  const openingBalance = parseFinancialInteger(openingMatch?.[2]);
  const closingBalance = parseFinancialInteger(closingMatch?.[1]);

  if (!reportDate || !openingDate) errors.push('Date BDK absente ou invalide.');
  if (openingBalance === null || closingBalance === null) {
    errors.push('Soldes BDK explicites absents ou invalides.');
  } else if (
    data.openingBalance.amount !== openingBalance
    || data.closingBalance !== closingBalance
  ) {
    errors.push('Les soldes BDK extraits ne concordent pas avec les lignes explicites.');
  }
  if (!data.validation.isValid || data.validation.calculatedClosing !== data.closingBalance) {
    errors.push('La validation mathématique BDK a échoué.');
  }

  return errors;
}
