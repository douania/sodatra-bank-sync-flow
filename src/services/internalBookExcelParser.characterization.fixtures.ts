import * as XLSX from 'xlsx';
import type { InternalBookBank } from '@/types/internalBook';

export interface CharacterizationFixture {
  bank: Exclude<InternalBookBank, 'UNKNOWN'>;
  sourceFile: string;
  workbook: XLSX.WorkBook;
  expected: {
    status: 'valid' | 'needs_review';
    issueCodes: string[];
    deposits: number;
    checks: number;
    facilities: number;
    impayes: number;
  };
}

function createWorkbook(rows: unknown[][]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const dailySheet = XLSX.utils.aoa_to_sheet(rows);
  const ignoredSheet = XLSX.utils.aoa_to_sheet([
    ['ANONYMIZED NOTES'],
    ['This sheet intentionally does not match the daily Internal Book shape.'],
  ]);

  XLSX.utils.book_append_sheet(workbook, dailySheet, '050526');
  XLSX.utils.book_append_sheet(workbook, ignoredSheet, 'README');

  return workbook;
}

function baseRows(overrides: Partial<{
  sourceOpening: number;
  depositHeader: unknown[];
  depositRows: unknown[][];
  totalDepositRow: unknown[];
  totalBalanceA: number;
  checksHeader: unknown[];
  checkRows: unknown[][];
  totalB: number;
  closingBalance: number;
  facilityHeader: unknown[];
  facilityRows: unknown[][];
  impayeHeader: unknown[];
  impayeRows: unknown[][];
  totalImpayes: number;
}> = {}): unknown[][] {
  const opening = overrides.sourceOpening ?? 1_000_000;
  const depositHeader = overrides.depositHeader ?? ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'];
  const depositRows = overrides.depositRows ?? [['05/05/2026', 'DEP-SYN-001', 'Synthetic deposit', 100_000]];
  const totalDepositRow = overrides.totalDepositRow ?? ['TOTAL DEPOSIT', 100_000];
  const totalBalanceA = overrides.totalBalanceA ?? 1_100_000;
  const checksHeader = overrides.checksHeader ?? ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'];
  const checkRows = overrides.checkRows ?? [
    ['05/05/2026', 'CHK-SYN-001', 'Synthetic check A', 50_000],
    ['05/05/2026', 'CHK-SYN-002', 'Synthetic check B', 25_000],
  ];
  const totalB = overrides.totalB ?? 75_000;
  const closingBalance = overrides.closingBalance ?? 1_025_000;
  const facilityHeader = overrides.facilityHeader ?? ['FACILITY', 'LIMIT', 'USED', 'BALANCE'];
  const facilityRows = overrides.facilityRows ?? [
    ['Synthetic facility', 500_000, '-', 500_000],
    ['TOTAL', 500_000, 0, 500_000],
  ];
  const impayeHeader = overrides.impayeHeader ?? ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'];
  const impayeRows = overrides.impayeRows ?? [
    ['05/05/2026', 'UNP-SYN-001', 'Synthetic unpaid A', 10_000],
    ['05/05/2026', 'UNP-SYN-002', 'Synthetic unpaid B', 20_000],
  ];
  const totalImpayes = overrides.totalImpayes ?? 30_000;

  return [
    ['OPENING BALANCE', opening],
    ['DEPOSIT NOT YET CLEARED'],
    depositHeader,
    ...depositRows,
    totalDepositRow,
    ['TOTAL BALANCE (A)', totalBalanceA],
    ['CHECK NOT YET CLEARED'],
    checksHeader,
    ...checkRows,
    ['TOTAL (B)', totalB],
    ['CLOSING BALANCE C', closingBalance],
    ['BANK FACILITY'],
    facilityHeader,
    ...facilityRows,
    ['IMPAYE'],
    impayeHeader,
    ...impayeRows,
    ['TOTAL IMPAYES', totalImpayes],
  ];
}

export const characterizationFixtures: CharacterizationFixture[] = [
  {
    bank: 'BIS',
    sourceFile: '05-BIS 2026.xlsx',
    workbook: createWorkbook(
      baseRows({
        depositHeader: ['DATE', 'REF', 'DESCRIPTION', 'AMOUNT'],
        depositRows: [
          ['05/05/2026', 100001, 'Synthetic BIS deposit', 100_000],
        ],
        checksHeader: ['DATE', 'CH NO', 'DESCRIPTION', 'AMOUNT'],
        checkRows: [
          ['05/05/2026', 300101, 'Synthetic BIS check A', 50_000],
          ['06/05/2026', 300102, 'Synthetic BIS check B', 25_000],
        ],
        impayeHeader: ['DATE', 'REFERENCE', 'DESCRIPTION', 'MONTANT'],
        impayeRows: [
          [46147, 400201, 'Synthetic BIS unpaid A', 10_000],
          [46148, 400202, 'Synthetic BIS unpaid B', 20_000],
        ],
      }),
    ),
    expected: {
      status: 'valid',
      issueCodes: [],
      deposits: 1,
      checks: 2,
      facilities: 1,
      impayes: 2,
    },
  },
  {
    bank: 'BICIS',
    sourceFile: '05 - BICIS 2026.xlsx',
    workbook: createWorkbook(
      baseRows({
        depositHeader: ['DATE', 'TR NO', 'LIBELLE', 'MONTANT'],
        depositRows: [
          [46147, 210045, 'Synthetic BICIS deposit', 100_000],
        ],
        checksHeader: ['DATE', 'FACT NO', 'DESCRIPTION', 'MONTANT'],
        checkRows: [
          ['05/05/2026', 880010, 'Synthetic BICIS check A', 50_000],
          ['05/05/2026', 880011, 'Synthetic BICIS check B', 25_000],
        ],
      }),
    ),
    expected: {
      status: 'valid',
      issueCodes: [],
      deposits: 1,
      checks: 2,
      facilities: 1,
      impayes: 2,
    },
  },
  {
    bank: 'BICIS',
    sourceFile: '05 - BICIS 2026 mismatch.xlsx',
    workbook: createWorkbook(baseRows({ closingBalance: 1_024_000 })),
    expected: {
      status: 'needs_review',
      issueCodes: ['A_MINUS_B_MISMATCH'],
      deposits: 1,
      checks: 2,
      facilities: 1,
      impayes: 2,
    },
  },
  {
    bank: 'BDK',
    sourceFile: '05-BDK 2026.xlsx',
    workbook: createWorkbook(
      baseRows({
        depositHeader: ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
        depositRows: [
          ['05/05/2026', 770001, 'Synthetic BDK deposit', 100_000],
        ],
        checksHeader: ['DATE', 'CH NO BD', 'FACT NO', 'AMOUNT'],
        checkRows: [['05/05/2026', 1001, 77, 75_000]],
        totalB: 75_000,
      }),
    ),
    expected: {
      status: 'valid',
      issueCodes: [],
      deposits: 1,
      checks: 1,
      facilities: 1,
      impayes: 2,
    },
  },
  {
    bank: 'BDK',
    sourceFile: '05-BDK 2026 real-shape amount1 zero totals.xlsx',
    workbook: createWorkbook([
      ['OPENING BALANCE 04/05/2026', '', '', '', '', '', 1_000_000, ''],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['DEPOSIT NOT YET CLEARED'],
      ['05/05/2026', '', 'Synthetic BDK deposit', 'Synthetic vendor', 'Synthetic client', 260581, 100_000, ''],
      ['', '', '', 'TOTAL DEPOSIT', '', '', 100_000, 0],
      ['', '', '', 'TOTAL  BALANCE  (A)', '', '', 1_100_000, ''],
      ['CHECK Not yet cleared'],
      ['DATE', 'CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT', 'TR No/FACT.No', 'AMOUNT', 'AMOUNT 1'],
      ['05/05/2026', 1001, 'Synthetic BDK check A', 'Synthetic vendor', 'Synthetic client', 87035, '', 50_000],
      ['05/05/2026', 1002, 'Synthetic BDK check B', 'Synthetic vendor', '', '', '', 25_000],
      ['', '', '', 'TOTAL (B)', '', '', '', 75_000],
      ['', '', '', 'CLOSING BALANCE', '', '', 1_025_000, ''],
    ]),
    expected: {
      status: 'needs_review',
      issueCodes: ['OPENING_PLUS_DEPOSITS_MISMATCH'],
      deposits: 1,
      checks: 2,
      facilities: 0,
      impayes: 0,
    },
  },
  {
    bank: 'ORABANK',
    sourceFile: '05- ORABANK 2026.xlsx',
    workbook: createWorkbook([
      ['OPENING BALANCE', 1_000_000],
      ['DEPOTS PAS ENCORE ENCAISSE'],
      ['DATE', 'REFERENCE', 'DESCRIPTION', 'MONTANT'],
      ['05/05/2026', 901001, 'Synthetic ORABANK deposit', 100_000],
      ['TOTAL DEPOSIT', 100_000],
      ['TOTAL (A)', 1_100_000],
      ['LESS CHEQUES EMIS NON ENCAISSES'],
      ['DATE', 'CH NO', 'DESCRIPTION', 'AMOUNT'],
      [46147, 902001, 'Synthetic ORABANK check', 50_000],
      ['TOTAL (B)', 50_000],
      ['CLOSING BALANCE C', 1_050_000],
    ]),
    expected: {
      status: 'valid',
      issueCodes: [],
      deposits: 1,
      checks: 1,
      facilities: 0,
      impayes: 0,
    },
  },
  {
    bank: 'BRIDGE',
    sourceFile: '05 BRIDGE BANK 2026.xlsx',
    workbook: createWorkbook(
      baseRows({
        depositHeader: ['DATE', 'REF', 'DESCRIPTION', 'AMOUNT'],
        depositRows: [
          [46147, 610001, 'Synthetic BRIDGE deposit', 100_000],
        ],
        checksHeader: ['DATE', 'TR NO', 'REFERENCE', 'AMOUNT'],
        checkRows: [
          ['05/05/2026', 620001, 620991, 50_000],
          ['06/05/2026', 620002, 620992, 25_000],
        ],
        facilityRows: [
          ['Synthetic bridge facility', 200_000, -50_000, 250_000],
          ['TOTAL', 200_000, -50_000, 250_000],
        ],
      }),
    ),
    expected: {
      status: 'valid',
      issueCodes: [],
      deposits: 1,
      checks: 2,
      facilities: 1,
      impayes: 2,
    },
  },
  {
    bank: 'ATLANTIK',
    sourceFile: '5-ATLANTIK BANK 2026.xlsx',
    workbook: createWorkbook(
      baseRows({
        depositHeader: ['DATE', 'REFERENCE', 'DESCRIPTION', 'MONTANT'],
        depositRows: [
          ['05/05/2026', 710001, 'Synthetic ATLANTIK deposit', 100_000],
        ],
        checksHeader: ['DATE', 'CH NO', 'FACT NO', 'MONTANT'],
        checkRows: [
          [46147, 720001, 730001, 50_000],
          [46148, 720002, 730002, 25_000],
        ],
        impayeHeader: ['DATE', 'REF', 'DESCRIPTION', 'AMOUNT'],
        impayeRows: [
          ['05/05/2026', 740001, 'Synthetic ATLANTIK unpaid A', 10_000],
          ['05/05/2026', 740002, 'Synthetic ATLANTIK unpaid B', 20_000],
        ],
      }),
    ),
    expected: {
      status: 'valid',
      issueCodes: [],
      deposits: 1,
      checks: 2,
      facilities: 1,
      impayes: 2,
    },
  },
  {
    bank: 'ATLANTIK',
    sourceFile: '5-ATLANTIK BANK 2026 impayes mismatch.xlsx',
    workbook: createWorkbook(baseRows({ totalImpayes: 35_000 })),
    expected: {
      status: 'needs_review',
      issueCodes: ['IMPAYES_TOTAL_MISMATCH'],
      deposits: 1,
      checks: 2,
      facilities: 1,
      impayes: 2,
    },
  },
  {
    bank: 'BIS',
    sourceFile: '05-BIS 2026 residual ambiguous.xlsx',
    workbook: createWorkbook([
      ['OPENING BALANCE', 1_000],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL DEPOSIT', 0],
      ['TOTAL BALANCE (A)', 1_000],
      ['CHECK NOT YET CLEARED'],
      ['AMOUNT', 'MONTANT'],
      [10, 25],
      ['TOTAL (B)', 25],
      ['CLOSING BALANCE C', 975],
    ]),
    expected: {
      status: 'needs_review',
      issueCodes: ['AMBIGUOUS_AMOUNT_COLUMN'],
      deposits: 0,
      checks: 1,
      facilities: 0,
      impayes: 0,
    },
  },
];
