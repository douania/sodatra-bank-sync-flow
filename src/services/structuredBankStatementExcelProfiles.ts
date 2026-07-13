export type StructuredBankStatementExcelBank = 'ATB' | 'BICIS' | 'BIS' | 'BRIDGE';

export type StructuredBankStatementExcelAmountModel =
  | { kind: 'signed'; amountColumn: number }
  | { kind: 'split'; debitColumn: number; creditColumn: number };

export interface StructuredBankStatementExcelProfile {
  bank: StructuredBankStatementExcelBank;
  version: string;
  allowedExtensions: readonly ('.xls' | '.xlsx')[];
  rowOrder: 'ascending' | 'descending';
  requiredHeaders: readonly {
    column: number;
    aliases: readonly string[];
  }[];
  columns: {
    operationDate: number;
    valueDate: number;
    description: number;
    reference?: number;
    balance: number;
    currency?: number;
  };
  amountModel: StructuredBankStatementExcelAmountModel;
  fixedCurrency?: string;
}

/**
 * Characterized from the four ONLINE exports supplied for pack 0Q.
 *
 * These are deliberately exact structural signatures. Generic DATE/AMOUNT
 * workbooks and the monthly Internal Book family must not be accepted by the
 * Daily v2 bank-statement path.
 */
export const STRUCTURED_BANK_STATEMENT_EXCEL_PROFILES = Object.freeze([
  {
    bank: 'ATB',
    version: 'atb-online-xls-v1',
    allowedExtensions: ['.xls'],
    rowOrder: 'descending',
    requiredHeaders: [
      { column: 0, aliases: ['reference'] },
      { column: 1, aliases: ['datedeloperation'] },
      { column: 2, aliases: ['datevaleur'] },
      { column: 3, aliases: ['montant'] },
      { column: 4, aliases: ['solde'] },
      { column: 5, aliases: ['devise'] },
      { column: 6, aliases: ['libelle'] },
    ],
    columns: {
      operationDate: 1,
      valueDate: 2,
      description: 6,
      reference: 0,
      balance: 4,
      currency: 5,
    },
    amountModel: { kind: 'signed', amountColumn: 3 },
  },
  {
    bank: 'BICIS',
    version: 'bicis-online-xls-v1',
    allowedExtensions: ['.xls'],
    rowOrder: 'descending',
    requiredHeaders: [
      { column: 0, aliases: ['dateoperation'] },
      { column: 1, aliases: ['datevaleur'] },
      { column: 2, aliases: ['reference'] },
      { column: 3, aliases: ['montant'] },
      { column: 4, aliases: ['libelle'] },
      { column: 5, aliases: ['solde'] },
      { column: 6, aliases: ['devise'] },
    ],
    columns: {
      operationDate: 0,
      valueDate: 1,
      description: 4,
      reference: 2,
      balance: 5,
      currency: 6,
    },
    amountModel: { kind: 'signed', amountColumn: 3 },
  },
  {
    bank: 'BIS',
    version: 'bis-online-xls-v1',
    allowedExtensions: ['.xls'],
    rowOrder: 'descending',
    requiredHeaders: [
      { column: 1, aliases: ['datedeloperationcommerciale'] },
      { column: 3, aliases: ['datedevaleur'] },
      { column: 5, aliases: ['description'] },
      { column: 10, aliases: ['debitxof'] },
      { column: 12, aliases: ['creditxof'] },
      { column: 14, aliases: ['solde'] },
    ],
    columns: {
      operationDate: 1,
      valueDate: 3,
      description: 5,
      balance: 14,
    },
    amountModel: { kind: 'split', debitColumn: 10, creditColumn: 12 },
    fixedCurrency: 'XOF',
  },
  {
    bank: 'BRIDGE',
    version: 'bridge-online-xlsx-v1',
    allowedExtensions: ['.xlsx'],
    rowOrder: 'ascending',
    requiredHeaders: [
      { column: 0, aliases: ['dateoperation'] },
      { column: 1, aliases: ['description'] },
      { column: 2, aliases: ['reference'] },
      { column: 3, aliases: ['datevaleur'] },
      { column: 4, aliases: ['debit'] },
      { column: 5, aliases: ['credit'] },
    ],
    columns: {
      operationDate: 0,
      valueDate: 3,
      description: 1,
      reference: 2,
      // The characterized export carries running balances in the deliberately
      // unlabeled seventh column. The six preceding exact headers form the
      // fail-closed signature; generic unlabeled columns never do.
      balance: 6,
    },
    amountModel: { kind: 'split', debitColumn: 4, creditColumn: 5 },
  },
] as const satisfies readonly StructuredBankStatementExcelProfile[]);

export function normalizeStructuredExcelHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}
