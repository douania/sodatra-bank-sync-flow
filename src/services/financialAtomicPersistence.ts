import type { BankReport, FundPosition } from '@/types/banking';

interface RandomUuidProvider {
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
}

function sanitizeIntegerAmount(value: number, context: string, fieldLabel: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `${context}: montant invalide pour "${fieldLabel}" (${String(value)}) — insertion refusée.`,
    );
  }
  const truncated = Math.trunc(value);
  if (truncated > Number.MAX_SAFE_INTEGER || truncated < -Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `${context}: montant hors bornes sûres pour "${fieldLabel}" (${String(value)}) — insertion refusée.`,
    );
  }
  return truncated === 0 ? 0 : truncated;
}

export function sanitizeFundPositionAmount(value: number, fieldLabel: string): number {
  return sanitizeIntegerAmount(value, 'Fund Position', fieldLabel);
}

export function sanitizeBankReportAmount(value: number, fieldLabel: string): number {
  return sanitizeIntegerAmount(value, 'Rapport bancaire', fieldLabel);
}

export function createFinancialWriteCommandKey(
  provider: RandomUuidProvider | null = globalThis.crypto,
): string {
  if (!provider || typeof provider.randomUUID !== 'function') {
    throw new Error('Générateur UUID sécurisé indisponible — écriture financière refusée.');
  }
  return provider.randomUUID();
}

export function buildBankReportAtomicPayloads(report: BankReport) {
  const reportRow = {
    bank_name: report.bank,
    report_date: report.date,
    opening_balance: sanitizeBankReportAmount(report.openingBalance, 'opening_balance'),
    closing_balance: sanitizeBankReportAmount(report.closingBalance, 'closing_balance'),
  };

  const facilityRows = (report.bankFacilities ?? []).map((facility, index) => ({
    facility_type: facility.facilityType,
    limit_amount: sanitizeBankReportAmount(facility.limitAmount, `facilities[${index}].limit_amount`),
    used_amount: sanitizeBankReportAmount(facility.usedAmount, `facilities[${index}].used_amount`),
    available_amount: sanitizeBankReportAmount(
      facility.availableAmount,
      `facilities[${index}].available_amount`,
    ),
  }));

  const depositRows = (report.depositsNotCleared ?? []).map((deposit, index) => ({
    date_depot: deposit.dateDepot,
    date_valeur: deposit.dateValeur ?? null,
    type_reglement: deposit.typeReglement,
    client_code: deposit.clientCode ?? null,
    reference: deposit.reference ?? null,
    montant: sanitizeBankReportAmount(deposit.montant, `deposits[${index}].montant`),
  }));

  const impayeRows = (report.impayes ?? []).map((impaye, index) => ({
    date_echeance: impaye.dateEcheance,
    date_retour: impaye.dateRetour ?? null,
    client_code: impaye.clientCode,
    description: impaye.description ?? null,
    montant: sanitizeBankReportAmount(impaye.montant, `impayes[${index}].montant`),
  }));

  return { reportRow, facilityRows, depositRows, impayeRows };
}

export function buildFundPositionInsertPayloads(fundPosition: FundPosition) {
  const fundPositionRow = {
    report_date: fundPosition.reportDate,
    total_fund_available: sanitizeFundPositionAmount(
      fundPosition.totalFundAvailable,
      'total_fund_available',
    ),
    collections_not_deposited: sanitizeFundPositionAmount(
      fundPosition.collectionsNotDeposited,
      'collections_not_deposited',
    ),
    grand_total: sanitizeFundPositionAmount(fundPosition.grandTotal, 'grand_total'),
    deposit_for_day: fundPosition.depositForDay != null
      ? sanitizeFundPositionAmount(fundPosition.depositForDay, 'deposit_for_day')
      : null,
    payment_for_day: fundPosition.paymentForDay != null
      ? sanitizeFundPositionAmount(fundPosition.paymentForDay, 'payment_for_day')
      : null,
  };

  const detailRows = (fundPosition.details ?? []).map((detail, index) => ({
    bank_name: detail.bankName,
    balance: sanitizeFundPositionAmount(detail.balance, `details[${index}].balance`),
    fund_applied: sanitizeFundPositionAmount(detail.fundApplied, `details[${index}].fund_applied`),
    net_balance: sanitizeFundPositionAmount(detail.netBalance, `details[${index}].net_balance`),
    non_validated_deposit: sanitizeFundPositionAmount(
      detail.nonValidatedDeposit,
      `details[${index}].non_validated_deposit`,
    ),
    grand_balance: sanitizeFundPositionAmount(
      detail.grandBalance,
      `details[${index}].grand_balance`,
    ),
  }));

  const holdRows = (fundPosition.holdCollections ?? []).map((hold, index) => ({
    hold_date: hold.holdDate,
    cheque_number: hold.chequeNumber ?? null,
    client_bank: hold.clientBank ?? null,
    client_name: hold.clientName,
    facture_reference: hold.factureReference ?? null,
    amount: sanitizeFundPositionAmount(hold.amount, `holdCollections[${index}].amount`),
    deposit_date: hold.depositDate ?? null,
    days_remaining: hold.daysRemaining ?? null,
  }));

  return { fundPositionRow, detailRows, holdRows };
}
