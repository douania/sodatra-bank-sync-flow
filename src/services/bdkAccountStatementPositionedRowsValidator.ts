import type { PositionedBankStatementRow } from '@/types/bankStatementPositioning';

export interface BDKPositionedRowsValidationInput {
  openingBalance: number;
  closingBalance?: number;
  positionedRows: PositionedBankStatementRow[];
}

export interface BDKPositionedRowsValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  calculatedClosing?: number;
  lineCount: number;
}

export function validateBDKAccountStatementPositionedRows(
  input: BDKPositionedRowsValidationInput
): BDKPositionedRowsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let previousBalance = input.openingBalance;
  let calculatedClosing: number | undefined;

  if (input.positionedRows.length === 0) {
    errors.push('No BDK positioned transaction rows to validate.');
  }

  input.positionedRows.forEach((row) => {
    const amountColumn = row.amountColumn;
    const rowLabel = `Positioned row ${row.sourceRowIndex}`;

    if (amountColumn !== 'debit' && amountColumn !== 'credit') {
      errors.push(`${rowLabel} has no unambiguous debit or credit amount column.`);
      return;
    }

    if (row.direction !== amountColumn) {
      errors.push(`${rowLabel} direction does not match amount column.`);
      return;
    }

    const debit = parseBDKPositionedAmount(row.debit);
    const credit = parseBDKPositionedAmount(row.credit);
    const balance = parseBDKPositionedAmount(row.balance);

    if (debit !== undefined && credit !== undefined) {
      errors.push(`${rowLabel} has both debit and credit amounts.`);
      return;
    }

    if (balance === undefined) {
      errors.push(`${rowLabel} has no parsable running balance.`);
      return;
    }

    if (amountColumn === 'debit') {
      if (debit === undefined) {
        errors.push(`${rowLabel} has no parsable debit amount.`);
        return;
      }

      if (row.credit.trim()) {
        errors.push(`${rowLabel} has a credit amount on a debit row.`);
        return;
      }

      const expectedBalance = previousBalance - debit;
      if (balance !== expectedBalance) {
        errors.push(`${rowLabel} running balance does not match debit arithmetic.`);
        return;
      }

      previousBalance = balance;
      calculatedClosing = balance;
      return;
    }

    if (credit === undefined) {
      errors.push(`${rowLabel} has no parsable credit amount.`);
      return;
    }

    if (row.debit.trim()) {
      errors.push(`${rowLabel} has a debit amount on a credit row.`);
      return;
    }

    const expectedBalance = previousBalance + credit;
    if (balance !== expectedBalance) {
      errors.push(`${rowLabel} running balance does not match credit arithmetic.`);
      return;
    }

    previousBalance = balance;
    calculatedClosing = balance;
  });

  if (
    input.closingBalance !== undefined
    && calculatedClosing !== undefined
    && calculatedClosing !== input.closingBalance
  ) {
    errors.push('Calculated closing balance does not match declared closing balance.');
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    calculatedClosing,
    lineCount: input.positionedRows.length
  };
}

function parseBDKPositionedAmount(value: string): number | undefined {
  const normalized = value.trim().replace(/[\s\u00a0\u202f]+/g, '');

  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  return Number.parseInt(normalized, 10);
}
