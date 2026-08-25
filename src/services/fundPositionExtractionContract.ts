import type { FundPositionDetail } from '@/types/banking';

export interface FundPositionExtractionEvidence {
  reportDate: string | null;
  grandTotalFound: boolean;
  grandTotal: number | null;
  details: readonly FundPositionDetail[];
}

export function validateFundPositionExtraction(
  evidence: FundPositionExtractionEvidence,
): string[] {
  const errors: string[] = [];
  if (!evidence.reportDate) errors.push('Date Fund Position absente ou invalide.');
  if (!evidence.grandTotalFound || evidence.grandTotal === null) {
    errors.push('Grand total Fund Position absent ou invalide.');
  }
  if (evidence.details.length === 0) {
    errors.push('Aucun détail bancaire Fund Position exploitable.');
  }
  if (evidence.details.some(detail => (
    !detail.bankName.trim()
    || ![
      detail.balance,
      detail.fundApplied,
      detail.netBalance,
      detail.nonValidatedDeposit,
      detail.grandBalance,
    ].every(Number.isSafeInteger)
  ))) {
    errors.push('Détail bancaire Fund Position invalide.');
  }
  return errors;
}
