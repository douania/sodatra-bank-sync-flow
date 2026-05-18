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
  depositRows: unknown[][];
  totalDepositRow: unknown[];
  totalBalanceA: number;
  checkRows: unknown[][];
  totalB: number;
  closingBalance: number;
  facilityRows: unknown[][];
  impayeRows: unknown[][];
  totalImpayes: number;
}> = {}): unknown[][] {
  const opening = overrides.sourceOpening ?? 1_000_000;
  const depositRows = overrides.depositRows ?? [['05/05/2026', 'DEP-SYN-001', 'Synthetic deposit', 100_000]];
  const totalDepositRow = overrides.totalDepositRow ?? ['TOTAL DEPOSIT', 100_000];
  const totalBalanceA = overrides.totalBalanceA ?? 1_100_000;
  const checkRows = overrides.checkRows ?? [
    ['05/05/2026', 'CHK-SYN-001', 'Synthetic check A', 50_000],
    ['05/05/2026', 'CHK-SYN-002', 'Synthetic check B', 25_000],
  ];
  const totalB = overrides.totalB ?? 75_000;
  const closingBalance = overrides.closingBalance ?? 1_025_000;
  const facilityRows = overrides.facilityRows ?? [
    ['Synthetic facility', 500_000, '-', 500_000],
    ['TOTAL', 500_000, 0, 500_000],
  ];
  const impayeRows = overrides.impayeRows ?? [
    ['05/05/2026', 'UNP-SYN-001', 'Synthetic unpaid A', 10_000],
    ['05/05/2026', 'UNP-SYN-002', 'Synthetic unpaid B', 20_000],
  ];
  const totalImpayes = overrides.totalImpayes ?? 30_000;

  return [
    ['OPENING BALANCE', opening],
    ['DEPOSIT NOT YET CLEARED'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ...depositRows,
    totalDepositRow,
    ['TOTAL BALANCE (A)', totalBalanceA],
    ['CHECK NOT YET CLEARED'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ...checkRows,
    ['TOTAL (B)', totalB],
    ['CLOSING BALANCE C', closingBalance],
    ['BANK FACILITY'],
    ['FACILITY', 'LIMIT', 'USED', 'BALANCE'],
    ...facilityRows,
    ['IMPAYE'],
    ['DATE', 'REFERENCE', 'DESCRIPTION', 'AMOUNT'],
    ...impayeRows,
    ['TOTAL IMPAYES', totalImpayes],
  ];
}

export const characterizationFixtures: CharacterizationFixture[] = [
  {
    bank: 'BIS',
    sourceFile: '05-BIS 2026.xlsx',
    workbook: createWorkbook(baseRows()),
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
        checkRows: [['05/05/2026', 1001, 77, 75_000]],
        totalB: 75_000,
      }),
    ),
    expected: {
      status: 'needs_review',
      issueCodes: ['AMBIGUOUS_AMOUNT_COLUMN'],
      deposits: 1,
      checks: 1,
      facilities: 1,
      impayes: 2,
    },
  },
  {
    bank: 'ORABANK',
    sourceFile: '05- ORABANK 2026.xlsx',
    workbook: createWorkbook([
      ['OPENING BALANCE', 1_000_000],
      ['DEPOSIT NOT YET CLEARED'],
      ['TOTAL BALANCE (A)', 1_000_000],
      ['CHECK NOT YET CLEARED'],
      ['05/05/2026', 'CHK-SYN-001', 'Synthetic check', 50_000],
      ['TOTAL (B)', 50_000],
      ['CLOSING BALANCE C', 950_000],
    ]),
    expected: {
      status: 'needs_review',
      issueCodes: ['MISSING_REQUIRED_SECTION'],
      deposits: 0,
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
];
