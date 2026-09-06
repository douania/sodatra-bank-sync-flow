import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';

import { excelProcessingService } from './excelProcessingService';
import { internalBookExcelParser } from './internalBookExcelParser';
import { characterizationFixtures } from './internalBookExcelParser.characterization.fixtures';
import { parseStructuredBankStatementExcel } from './structuredBankStatementExcelParser';
import { detectDocumentType } from './documentDetectionService';
import {
  DAILY_V2_SUMMARY_EXPORT_HEADERS,
  buildDailyV2SummaryExportRows,
} from '@/features/daily-v2/dailyV2SummaryExport';

// PACK 0 (D-0-2) — caractérisation avant/après mise à niveau de `xlsx`.
//
// Ce test fige, sur des fixtures exclusivement synthétiques, les résultats
// métier produits par les lecteurs Excel du dépôt (montants, dates, identités,
// nombre de lignes, statuts) et la relecture d'un export XLSX. Les valeurs
// attendues ont été enregistrées avec `xlsx@0.18.5` (lockfile canonique) puis
// doivent rester strictement identiques après la mise à niveau vers le tarball
// éditeur `xlsx@0.20.3`. Aucun parser FROZEN n'est modifié : ils sont exercés
// tels quels.
//
// Régénération contrôlée des attendus (uniquement pour documenter une
// divergence, jamais pour la masquer) : chaque section est écrite en JSON dans
// le dossier désigné, hors dépôt.
//   XLSX_CHARACTERIZATION_RECORD_DIR=<dossier> npx tsx --test src/services/xlsxUpgrade.characterization.test.ts

// Le client Supabase généré est Vite-only : stub inerte, jamais utilisé ici.
const SUPABASE_CLIENT_SPECIFIER = '@/integrations/supabase/client';
const supabaseStubModuleUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    'export const supabase = new Proxy({}, {' +
      ' get() { throw new Error("synthetic test: supabase client must never be used"); }' +
      ' });'
  );
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export function resolve(specifier, context, nextResolve) {
        if (specifier === ${JSON.stringify(SUPABASE_CLIENT_SPECIFIER)}) {
          return { shortCircuit: true, url: ${JSON.stringify(supabaseStubModuleUrl)} };
        }
        return nextResolve(specifier, context);
      }`
    ),
);

const RECORD_DIR = process.env.XLSX_CHARACTERIZATION_RECORD_DIR?.trim() || '';

function workbookFromRows(rows: unknown[][], sheetName = 'DATA'): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return workbook;
}

function workbookBytes(workbook: XLSX.WorkBook, bookType: 'xls' | 'xlsx'): ArrayBuffer {
  const written = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer | Uint8Array;
  if (written instanceof ArrayBuffer) return written;
  return written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
}

function fileShim(name: string, bytes: ArrayBuffer): File {
  // Les services n'utilisent que name + arrayBuffer().
  return { name, arrayBuffer: async () => bytes } as unknown as File;
}

function excelSerial(day: number, month: number, year: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Sérialisation stable : clés triées, undefined omis, bigint textuel. */
function stable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, inner) => {
    if (typeof inner === 'bigint') return `${inner.toString()}n`;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return inner;
  }));
}

function record(name: string, actual: unknown, expected: unknown) {
  const normalized = stable(actual);
  if (RECORD_DIR) {
    mkdirSync(RECORD_DIR, { recursive: true });
    writeFileSync(path.join(RECORD_DIR, `${name}.json`), JSON.stringify(normalized, null, 2));
    return;
  }
  assert.deepEqual(normalized, expected, `${name}: résultat métier divergent après changement de xlsx`);
}

// ---------------------------------------------------------------------------
// 1. Collection Report (parser Lot 3 FROZEN) — xlsx et xls
// ---------------------------------------------------------------------------

const COLLECTION_HEADERS = ['DATE', 'CLIENT NAME', 'AMOUNT', 'BANK NAME', 'FACTURE N°', 'No.CHq /Bd', 'Date of VAlidity'];
const COLLECTION_ROWS: unknown[][] = [
  COLLECTION_HEADERS,
  ['05/06/2026', 'CLIENT_SYN_A', 150000, 'BANQUE_SYNTHETIQUE_1', 'FAC-SYN-001', '123456', '10/06/2026'],
  [excelSerial(6, 6, 2026), 'CLIENT_SYN_B', '1,000,000.75', 'BANQUE_SYNTHETIQUE_2', 'FAC-SYN-002', 'BD 654321', excelSerial(11, 6, 2026)],
  ['07/06/2026', 'CLIENT_SYN_C', '1.000.000,25', 'BANQUE_SYNTHETIQUE_1', '', '', ''],
  [],
  ['08/06/2026', 'CLIENT SYN D', -2500.5, 'BANQUE SYNTHETIQUE 3', 'FAC-SYN-004', 'CHQ 000042', '12/06/2026'],
  ['not a date', 'CLIENT_SYN_E', 999, 'BANQUE_SYNTHETIQUE_1', 'FAC-SYN-005', '', ''],
  ['09/06/2026', 'CLIENT_SYN_F', 'abc', 'BANQUE_SYNTHETIQUE_1', 'FAC-SYN-006', '', ''],
];

function collectionSnapshot(result: Awaited<ReturnType<typeof excelProcessingService.processCollectionReportExcel>>) {
  return {
    success: result.success,
    totalProcessed: result.totalProcessed ?? null,
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    rows: (result.data ?? []).map(row => ({
      reportDate: row.reportDate,
      clientCode: row.clientCode,
      collectionAmount: row.collectionAmount,
      bankName: row.bankName ?? null,
      factureNo: row.factureNo ?? null,
      noChqBd: row.noChqBd ?? null,
      dateOfValidity: row.dateOfValidity ?? null,
      collectionType: row.collectionType ?? null,
      chequeNumber: row.chequeNumber ?? null,
      effetEcheanceDate: row.effetEcheanceDate ?? null,
      excelSourceRow: row.excelSourceRow ?? null,
      excelFilename: row.excelFilename ?? null,
    })),
  };
}

const EXPECTED_COLLECTION_XLSX = {
  "errors": [
    "Ligne 6: collectionAmount obligatoire, positif et valide (file=\"COLLECTION_REPORT_SYNTHETIC.xlsx\", row=6). Ligne rejetée.",
    "Ligne 7: reportDate obligatoire mais invalide (file=\"COLLECTION_REPORT_SYNTHETIC.xlsx\", row=7). Valeur reçue: \"not a date\". Formats acceptés : Date, Excel serial, DD/MM/YYYY, DD/MM/YY, YYYY-MM-DD.",
    "Ligne 8: collectionAmount obligatoire, positif et valide (file=\"COLLECTION_REPORT_SYNTHETIC.xlsx\", row=8). Ligne rejetée."
  ],
  "rows": [
    {
      "bankName": "BANQUE_SYNTHETIQUE_1",
      "chequeNumber": "123456",
      "clientCode": "CLIENT_SYN_A",
      "collectionAmount": 150000,
      "collectionType": "CHEQUE",
      "dateOfValidity": "2026-06-10",
      "effetEcheanceDate": null,
      "excelFilename": "COLLECTION_REPORT_SYNTHETIC.xlsx",
      "excelSourceRow": 2,
      "factureNo": "FAC-SYN-001",
      "noChqBd": "123456",
      "reportDate": "2026-06-05"
    },
    {
      "bankName": "BANQUE_SYNTHETIQUE_2",
      "chequeNumber": null,
      "clientCode": "CLIENT_SYN_B",
      "collectionAmount": 1000000.75,
      "collectionType": "UNKNOWN",
      "dateOfValidity": "2026-06-11",
      "effetEcheanceDate": null,
      "excelFilename": "COLLECTION_REPORT_SYNTHETIC.xlsx",
      "excelSourceRow": 3,
      "factureNo": "FAC-SYN-002",
      "noChqBd": "BD 654321",
      "reportDate": "2026-06-06"
    },
    {
      "bankName": "BANQUE_SYNTHETIQUE_1",
      "chequeNumber": null,
      "clientCode": "CLIENT_SYN_C",
      "collectionAmount": 1000000.25,
      "collectionType": "UNKNOWN",
      "dateOfValidity": null,
      "effetEcheanceDate": null,
      "excelFilename": "COLLECTION_REPORT_SYNTHETIC.xlsx",
      "excelSourceRow": 4,
      "factureNo": null,
      "noChqBd": null,
      "reportDate": "2026-06-07"
    }
  ],
  "success": true,
  "totalProcessed": 3,
  "warnings": []
};
const EXPECTED_COLLECTION_XLS = {
  "errors": [
    "Ligne 6: collectionAmount obligatoire, positif et valide (file=\"COLLECTION_REPORT_SYNTHETIC.xls\", row=6). Ligne rejetée.",
    "Ligne 7: reportDate obligatoire mais invalide (file=\"COLLECTION_REPORT_SYNTHETIC.xls\", row=7). Valeur reçue: \"not a date\". Formats acceptés : Date, Excel serial, DD/MM/YYYY, DD/MM/YY, YYYY-MM-DD.",
    "Ligne 8: collectionAmount obligatoire, positif et valide (file=\"COLLECTION_REPORT_SYNTHETIC.xls\", row=8). Ligne rejetée."
  ],
  "rows": [
    {
      "bankName": "BANQUE_SYNTHETIQUE_1",
      "chequeNumber": "123456",
      "clientCode": "CLIENT_SYN_A",
      "collectionAmount": 150000,
      "collectionType": "CHEQUE",
      "dateOfValidity": "2026-06-10",
      "effetEcheanceDate": null,
      "excelFilename": "COLLECTION_REPORT_SYNTHETIC.xls",
      "excelSourceRow": 2,
      "factureNo": "FAC-SYN-001",
      "noChqBd": "123456",
      "reportDate": "2026-06-05"
    },
    {
      "bankName": "BANQUE_SYNTHETIQUE_2",
      "chequeNumber": null,
      "clientCode": "CLIENT_SYN_B",
      "collectionAmount": 1000000.75,
      "collectionType": "UNKNOWN",
      "dateOfValidity": "2026-06-11",
      "effetEcheanceDate": null,
      "excelFilename": "COLLECTION_REPORT_SYNTHETIC.xls",
      "excelSourceRow": 3,
      "factureNo": "FAC-SYN-002",
      "noChqBd": "BD 654321",
      "reportDate": "2026-06-06"
    },
    {
      "bankName": "BANQUE_SYNTHETIQUE_1",
      "chequeNumber": null,
      "clientCode": "CLIENT_SYN_C",
      "collectionAmount": 1000000.25,
      "collectionType": "UNKNOWN",
      "dateOfValidity": null,
      "effetEcheanceDate": null,
      "excelFilename": "COLLECTION_REPORT_SYNTHETIC.xls",
      "excelSourceRow": 4,
      "factureNo": null,
      "noChqBd": null,
      "reportDate": "2026-06-07"
    }
  ],
  "success": true,
  "totalProcessed": 3,
  "warnings": []
};

test('Collection Report XLSX : montants, dates, identités et lignes identiques avant/après', async () => {
  const file = fileShim('COLLECTION_REPORT_SYNTHETIC.xlsx', workbookBytes(workbookFromRows(COLLECTION_ROWS), 'xlsx'));
  const result = await excelProcessingService.processCollectionReportExcel(file);
  record('collection-xlsx', collectionSnapshot(result), EXPECTED_COLLECTION_XLSX);
});

test('Collection Report XLS (BIFF8) : montants, dates, identités et lignes identiques avant/après', async () => {
  const file = fileShim('COLLECTION_REPORT_SYNTHETIC.xls', workbookBytes(workbookFromRows(COLLECTION_ROWS), 'xls'));
  const result = await excelProcessingService.processCollectionReportExcel(file);
  record('collection-xls', collectionSnapshot(result), EXPECTED_COLLECTION_XLS);
});

// ---------------------------------------------------------------------------
// 2. Internal Book (fixtures de caractérisation existantes, via bytes XLSX)
// ---------------------------------------------------------------------------

function internalBookSnapshot(result: ReturnType<typeof internalBookExcelParser.parseArrayBuffer>) {
  return {
    success: result.success,
    bank: result.bank,
    errors: result.errors.map(issue => issue.code),
    warnings: result.warnings.map(issue => issue.code),
    ignoredSheets: result.ignoredSheets.length,
    books: result.books.map(book => ({
      sheetName: book.sheetName,
      reportDate: book.reportDate,
      status: book.validation.status,
      issueCodes: book.validation.issues.map(issue => issue.code),
      openingBalance: book.openingBalance?.value ?? null,
      totalDeposits: book.totalDeposits?.value ?? null,
      totalBalanceA: book.totalBalanceA?.value ?? null,
      totalB: book.totalB?.value ?? null,
      closingBalanceC: book.closingBalanceC?.value ?? null,
      deposits: book.depositsNotYetCleared.map(line => [line.date ?? null, line.reference ?? null, line.amount.value]),
      checks: book.checksNotYetCleared.map(line => [line.date ?? null, line.reference ?? null, line.amount.value]),
      facilities: book.bankFacilities.map(line => [line.label, line.limit?.value ?? null, line.used?.value ?? null, line.balance?.value ?? null]),
      impayes: book.impayes.map(line => [line.date ?? null, line.reference ?? null, line.amount.value]),
    })),
  };
}

const EXPECTED_INTERNAL_BOOK = [
  {
    "parsed": {
      "bank": "BIS",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "300101",
              50000
            ],
            [
              "2026-05-06",
              "300102",
              25000
            ]
          ],
          "closingBalanceC": 1025000,
          "deposits": [
            [
              "2026-05-05",
              "100001",
              100000
            ]
          ],
          "facilities": [
            [
              "Synthetic facility",
              500000,
              0,
              500000
            ]
          ],
          "impayes": [
            [
              "2026-05-05",
              "400201",
              10000
            ],
            [
              "2026-05-06",
              "400202",
              20000
            ]
          ],
          "issueCodes": [],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "valid",
          "totalB": 75000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [],
      "ignoredSheets": 1,
      "success": true,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "05-BIS 2026.xlsx"
  },
  {
    "parsed": {
      "bank": "BICIS",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "880010",
              50000
            ],
            [
              "2026-05-05",
              "880011",
              25000
            ]
          ],
          "closingBalanceC": 1025000,
          "deposits": [
            [
              "2026-05-05",
              "210045",
              100000
            ]
          ],
          "facilities": [
            [
              "Synthetic facility",
              500000,
              0,
              500000
            ]
          ],
          "impayes": [
            [
              "2026-05-05",
              "UNP-SYN-001",
              10000
            ],
            [
              "2026-05-05",
              "UNP-SYN-002",
              20000
            ]
          ],
          "issueCodes": [],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "valid",
          "totalB": 75000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [],
      "ignoredSheets": 1,
      "success": true,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "05 - BICIS 2026.xlsx"
  },
  {
    "parsed": {
      "bank": "BICIS",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "CHK-SYN-001",
              50000
            ],
            [
              "2026-05-05",
              "CHK-SYN-002",
              25000
            ]
          ],
          "closingBalanceC": 1024000,
          "deposits": [
            [
              "2026-05-05",
              "DEP-SYN-001",
              100000
            ]
          ],
          "facilities": [
            [
              "Synthetic facility",
              500000,
              0,
              500000
            ]
          ],
          "impayes": [
            [
              "2026-05-05",
              "UNP-SYN-001",
              10000
            ],
            [
              "2026-05-05",
              "UNP-SYN-002",
              20000
            ]
          ],
          "issueCodes": [
            "A_MINUS_B_MISMATCH"
          ],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "needs_review",
          "totalB": 75000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [
        "A_MINUS_B_MISMATCH"
      ],
      "ignoredSheets": 1,
      "success": false,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "05 - BICIS 2026 mismatch.xlsx"
  },
  {
    "parsed": {
      "bank": "BDK",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "1001",
              75000
            ]
          ],
          "closingBalanceC": 1025000,
          "deposits": [
            [
              "2026-05-05",
              "770001",
              100000
            ]
          ],
          "facilities": [
            [
              "Synthetic facility",
              500000,
              0,
              500000
            ]
          ],
          "impayes": [
            [
              "2026-05-05",
              "UNP-SYN-001",
              10000
            ],
            [
              "2026-05-05",
              "UNP-SYN-002",
              20000
            ]
          ],
          "issueCodes": [],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "valid",
          "totalB": 75000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [],
      "ignoredSheets": 1,
      "success": true,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "05-BDK 2026.xlsx"
  },
  {
    "parsed": {
      "bank": "BDK",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "1001",
              50000
            ],
            [
              "2026-05-05",
              "1002",
              25000
            ]
          ],
          "closingBalanceC": 1025000,
          "deposits": [
            [
              "2026-05-05",
              "260581",
              100000
            ]
          ],
          "facilities": [],
          "impayes": [],
          "issueCodes": [],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "valid",
          "totalB": 75000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [],
      "ignoredSheets": 1,
      "success": true,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "05-BDK 2026 real-shape amount1 zero totals.xlsx"
  },
  {
    "parsed": {
      "bank": "ORABANK",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "902001",
              50000
            ]
          ],
          "closingBalanceC": 1050000,
          "deposits": [
            [
              "2026-05-05",
              "901001",
              100000
            ]
          ],
          "facilities": [],
          "impayes": [],
          "issueCodes": [],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "valid",
          "totalB": 50000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [],
      "ignoredSheets": 1,
      "success": true,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "05- ORABANK 2026.xlsx"
  },
  {
    "parsed": {
      "bank": "BRIDGE",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "620001",
              50000
            ],
            [
              "2026-05-06",
              "620002",
              25000
            ]
          ],
          "closingBalanceC": 1025000,
          "deposits": [
            [
              "2026-05-05",
              "610001",
              100000
            ]
          ],
          "facilities": [
            [
              "Synthetic bridge facility",
              200000,
              -50000,
              250000
            ]
          ],
          "impayes": [
            [
              "2026-05-05",
              "UNP-SYN-001",
              10000
            ],
            [
              "2026-05-05",
              "UNP-SYN-002",
              20000
            ]
          ],
          "issueCodes": [],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "valid",
          "totalB": 75000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [],
      "ignoredSheets": 1,
      "success": true,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "05 BRIDGE BANK 2026.xlsx"
  },
  {
    "parsed": {
      "bank": "ATLANTIK",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "720001",
              50000
            ],
            [
              "2026-05-06",
              "720002",
              25000
            ]
          ],
          "closingBalanceC": 1025000,
          "deposits": [
            [
              "2026-05-05",
              "710001",
              100000
            ]
          ],
          "facilities": [
            [
              "Synthetic facility",
              500000,
              0,
              500000
            ]
          ],
          "impayes": [
            [
              "2026-05-05",
              "740001",
              10000
            ],
            [
              "2026-05-05",
              "740002",
              20000
            ]
          ],
          "issueCodes": [],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "valid",
          "totalB": 75000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [],
      "ignoredSheets": 1,
      "success": true,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "5-ATLANTIK BANK 2026.xlsx"
  },
  {
    "parsed": {
      "bank": "ATLANTIK",
      "books": [
        {
          "checks": [
            [
              "2026-05-05",
              "CHK-SYN-001",
              50000
            ],
            [
              "2026-05-05",
              "CHK-SYN-002",
              25000
            ]
          ],
          "closingBalanceC": 1025000,
          "deposits": [
            [
              "2026-05-05",
              "DEP-SYN-001",
              100000
            ]
          ],
          "facilities": [
            [
              "Synthetic facility",
              500000,
              0,
              500000
            ]
          ],
          "impayes": [
            [
              "2026-05-05",
              "UNP-SYN-001",
              10000
            ],
            [
              "2026-05-05",
              "UNP-SYN-002",
              20000
            ]
          ],
          "issueCodes": [
            "IMPAYES_TOTAL_MISMATCH"
          ],
          "openingBalance": 1000000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "needs_review",
          "totalB": 75000,
          "totalBalanceA": 1100000,
          "totalDeposits": 100000
        }
      ],
      "errors": [
        "IMPAYES_TOTAL_MISMATCH"
      ],
      "ignoredSheets": 1,
      "success": false,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "5-ATLANTIK BANK 2026 impayes mismatch.xlsx"
  },
  {
    "parsed": {
      "bank": "BIS",
      "books": [
        {
          "checks": [
            [
              null,
              null,
              25
            ]
          ],
          "closingBalanceC": 975,
          "deposits": [],
          "facilities": [],
          "impayes": [],
          "issueCodes": [
            "AMBIGUOUS_AMOUNT_COLUMN"
          ],
          "openingBalance": 1000,
          "reportDate": "2026-05-05",
          "sheetName": "050526",
          "status": "needs_review",
          "totalB": 25,
          "totalBalanceA": 1000,
          "totalDeposits": 0
        }
      ],
      "errors": [
        "AMBIGUOUS_AMOUNT_COLUMN"
      ],
      "ignoredSheets": 1,
      "success": false,
      "warnings": [
        "INVALID_SHEET_DATE"
      ]
    },
    "sourceFile": "05-BIS 2026 residual ambiguous.xlsx"
  }
];

test('Internal Book : toutes les fixtures de caractérisation produisent des résultats identiques avant/après', () => {
  const actual = characterizationFixtures.map(fixture => ({
    sourceFile: fixture.sourceFile,
    parsed: internalBookSnapshot(
      internalBookExcelParser.parseArrayBuffer(workbookBytes(fixture.workbook, 'xlsx'), fixture.sourceFile),
    ),
  }));
  record('internal-book', actual, EXPECTED_INTERNAL_BOOK);
});

// ---------------------------------------------------------------------------
// 3. Relevés ONLINE Daily v2 (profils ATB / BICIS / BIS / BRIDGE)
// ---------------------------------------------------------------------------

function atbWorkbook(): XLSX.WorkBook {
  return workbookFromRows([
    ['SYNTHETIC ONLINE EXPORT'],
    [], [], [], [], [],
    ['Référence', "Date de l'opération", 'Date Valeur', 'Montant', 'Solde', 'Devise', 'Libellé'],
    ['SYN-002', excelSerial(9, 7, 2026), excelSerial(9, 7, 2026), '200', '1,100', 'XOF', 'SYNTHETIC CREDIT'],
    ['SYN-001', excelSerial(9, 7, 2026), excelSerial(9, 7, 2026), '-100', '900', 'XOF', 'SYNTHETIC DEBIT'],
  ], 'SYNTHETIC');
}

function bicisWorkbook(): XLSX.WorkBook {
  return workbookFromRows([
    ['SYNTHETIC ONLINE EXPORT'],
    [], [], [], [], [], [],
    ['Date Opération', 'Date Valeur', 'Référence', 'Montant', 'Libellé', 'Solde', 'Devise'],
    ['09/07/2026', '09/07/2026', 'SYN-002', 200, 'SYNTHETIC CREDIT', 1100, 'XOF'],
    ['09/07/2026', '09/07/2026', 'SYN-001', -100, 'SYNTHETIC DEBIT', 900, 'XOF'],
  ], 'SYNTHETIC');
}

function bisWorkbook(): XLSX.WorkBook {
  const header = new Array(15).fill('');
  header[1] = "Date de l'opération commerciale";
  header[3] = 'Date de valeur';
  header[5] = 'Description';
  header[10] = 'Débit(XOF)';
  header[12] = 'Crédit(XOF)';
  header[14] = 'Solde';
  const latest = new Array(15).fill('');
  latest[1] = '09/07/2026'; latest[3] = '09/07/2026'; latest[5] = 'SYNTHETIC CREDIT';
  latest[10] = 0; latest[12] = 200; latest[14] = '1,100 Créditeur';
  const earliest = new Array(15).fill('');
  earliest[1] = '09/07/2026'; earliest[3] = '09/07/2026'; earliest[5] = 'SYNTHETIC DEBIT';
  earliest[10] = 100; earliest[12] = 0; earliest[14] = '900 Créditeur';
  return workbookFromRows([
    ['SYNTHETIC ONLINE EXPORT'],
    [], [], [], [], [], [], [], [], [],
    header,
    latest,
    earliest,
  ], 'SYNTHETIC');
}

function bridgeWorkbook(): XLSX.WorkBook {
  return workbookFromRows([
    ['Date Operation', 'Description', 'Reference', 'Date Valeur', 'Debit', 'Credit', ''],
    ['09 Jul 2026', 'SYNTHETIC DEBIT', 'SYN-001', '09 Jul 2026', '100', '', '900'],
    ['09 Jul 2026', 'SYNTHETIC CREDIT', 'SYN-002', '09 Jul 2026', '', '200', '1,100'],
  ], 'SYNTHETIC');
}

function statementSnapshot(result: ReturnType<typeof parseStructuredBankStatementExcel>) {
  return {
    sourceFormat: result.sourceFormat,
    bankHint: result.bankHint,
    currency: result.currency ?? null,
    validationStatus: result.validation.status,
    lineBalancesConsistent: result.validation.lineBalancesConsistent ?? null,
    reviewReasonCodes: result.reviewReasonCodes ?? [],
    errors: result.errors,
    warnings: result.warnings,
    lines: result.lines.map(line => ({
      operationDate: (line as { operationDate?: string }).operationDate ?? null,
      valueDate: (line as { valueDate?: string }).valueDate ?? null,
      reference: (line as { reference?: string }).reference ?? null,
      description: (line as { description?: string }).description ?? null,
      signedAmount: line.signedAmount,
      balance: (line as { balance?: number }).balance ?? null,
    })),
  };
}

const EXPECTED_STATEMENTS = {
  "atb": {
    "bankHint": "ATB",
    "currency": "XOF",
    "errors": [],
    "lineBalancesConsistent": true,
    "lines": [
      {
        "balance": 900,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": -100,
        "valueDate": "09/07/2026"
      },
      {
        "balance": 1100,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": 200,
        "valueDate": "09/07/2026"
      }
    ],
    "reviewReasonCodes": [],
    "sourceFormat": "structured_bank_statement_xls",
    "validationStatus": "valid",
    "warnings": []
  },
  "atbXlsx": {
    "bankHint": "ATB",
    "currency": "XOF",
    "errors": [
      "The ATB ONLINE profile does not allow the .xlsx container."
    ],
    "lineBalancesConsistent": true,
    "lines": [
      {
        "balance": 900,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": -100,
        "valueDate": "09/07/2026"
      },
      {
        "balance": 1100,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": 200,
        "valueDate": "09/07/2026"
      }
    ],
    "reviewReasonCodes": [],
    "sourceFormat": "structured_bank_statement_xlsx",
    "validationStatus": "invalid",
    "warnings": []
  },
  "bicis": {
    "bankHint": "BICIS",
    "currency": "XOF",
    "errors": [],
    "lineBalancesConsistent": true,
    "lines": [
      {
        "balance": 900,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": -100,
        "valueDate": "09/07/2026"
      },
      {
        "balance": 1100,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": 200,
        "valueDate": "09/07/2026"
      }
    ],
    "reviewReasonCodes": [],
    "sourceFormat": "structured_bank_statement_xls",
    "validationStatus": "valid",
    "warnings": []
  },
  "bis": {
    "bankHint": "BIS",
    "currency": "XOF",
    "errors": [],
    "lineBalancesConsistent": true,
    "lines": [
      {
        "balance": 900,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": -100,
        "valueDate": "09/07/2026"
      },
      {
        "balance": 1100,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": 200,
        "valueDate": "09/07/2026"
      }
    ],
    "reviewReasonCodes": [],
    "sourceFormat": "structured_bank_statement_xls",
    "validationStatus": "valid",
    "warnings": []
  },
  "bridge": {
    "bankHint": "BRIDGE",
    "currency": null,
    "errors": [],
    "lineBalancesConsistent": true,
    "lines": [
      {
        "balance": 900,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": -100,
        "valueDate": "09/07/2026"
      },
      {
        "balance": 1100,
        "description": null,
        "operationDate": "09/07/2026",
        "reference": null,
        "signedAmount": 200,
        "valueDate": "09/07/2026"
      }
    ],
    "reviewReasonCodes": [
      "TRUSTED_CURRENCY_UNCORROBORATED"
    ],
    "sourceFormat": "structured_bank_statement_xlsx",
    "validationStatus": "needs_review",
    "warnings": [
      "The matched Excel profile carries no currency; trusted operator currency is required."
    ]
  }
};

test('Relevés ONLINE Daily v2 : profils ATB/BICIS/BIS/BRIDGE identiques avant/après', () => {
  const actual = {
    atb: statementSnapshot(parseStructuredBankStatementExcel(workbookBytes(atbWorkbook(), 'xls'), { sourceFileName: 'SYNTHETIC ATB ONLINE.xls', expectedBank: 'ATB' })),
    bicis: statementSnapshot(parseStructuredBankStatementExcel(workbookBytes(bicisWorkbook(), 'xls'), { sourceFileName: 'SYNTHETIC BICIS ONLINE.xls', expectedBank: 'BICIS' })),
    bis: statementSnapshot(parseStructuredBankStatementExcel(workbookBytes(bisWorkbook(), 'xls'), { sourceFileName: 'SYNTHETIC BIS ONLINE.xls', expectedBank: 'BIS' })),
    bridge: statementSnapshot(parseStructuredBankStatementExcel(workbookBytes(bridgeWorkbook(), 'xlsx'), { sourceFileName: 'SYNTHETIC BRIDGE ONLINE.xlsx', expectedBank: 'BRIDGE' })),
    atbXlsx: statementSnapshot(parseStructuredBankStatementExcel(workbookBytes(atbWorkbook(), 'xlsx'), { sourceFileName: 'SYNTHETIC ATB ONLINE.xlsx', expectedBank: 'ATB' })),
  };
  record('statements', actual, EXPECTED_STATEMENTS);
});

// ---------------------------------------------------------------------------
// 4. Détection documentaire read-only (XLSX.read type 'buffer')
// ---------------------------------------------------------------------------

const EXPECTED_DETECTION = {
  "collection": {
    "bankType": null,
    "confidence": "medium",
    "detectedType": "collectionReport"
  },
  "fundPosition": {
    "bankType": null,
    "confidence": "medium",
    "detectedType": "fundsPosition"
  }
};

test('Détection documentaire par contenu Excel identique avant/après', async () => {
  const collectionByContent = await detectDocumentType(fileShim('document-sans-nom-utile.xlsx', workbookBytes(workbookFromRows([
    ['COLLECTION REPORT'],
    COLLECTION_HEADERS,
    ['05/06/2026', 'CLIENT_SYN_A', 150000, 'BANQUE_SYNTHETIQUE_1', '', '', ''],
  ]), 'xlsx')));
  const fundPositionByContent = await detectDocumentType(fileShim('autre-document.xlsx', workbookBytes(workbookFromRows([
    ['FUND POSITION', '05/06/2026'],
    ['BANK', 'BALANCE', 'FUND APPLIED', 'NET BALANCE'],
    ['BANQUE_SYNTHETIQUE_1', 1000, 0, 1000],
    ['GRAND TOTAL', 1000, 0, 1000],
  ]), 'xlsx')));
  const actual = {
    collection: { detectedType: collectionByContent.detectedType, confidence: collectionByContent.confidence, bankType: collectionByContent.bankType ?? null },
    fundPosition: { detectedType: fundPositionByContent.detectedType, confidence: fundPositionByContent.confidence, bankType: fundPositionByContent.bankType ?? null },
  };
  record('detection', actual, EXPECTED_DETECTION);
});

// ---------------------------------------------------------------------------
// 5. Export Daily v2 : écriture XLSX puis relecture cellule par cellule
// ---------------------------------------------------------------------------

const EXPECTED_EXPORT = {
  "cellTypes": [
    [
      "A1",
      "s"
    ],
    [
      "A2",
      "s"
    ],
    [
      "A3",
      "s"
    ],
    [
      "B1",
      "s"
    ],
    [
      "B2",
      "s"
    ],
    [
      "B3",
      "s"
    ],
    [
      "C1",
      "s"
    ],
    [
      "C2",
      "s"
    ],
    [
      "C3",
      "s"
    ],
    [
      "D1",
      "s"
    ],
    [
      "D2",
      "s"
    ],
    [
      "D3",
      "s"
    ],
    [
      "E1",
      "s"
    ],
    [
      "E2",
      "s"
    ],
    [
      "E3",
      "s"
    ],
    [
      "F1",
      "s"
    ],
    [
      "F2",
      "s"
    ],
    [
      "F3",
      "s"
    ],
    [
      "G1",
      "s"
    ],
    [
      "G2",
      "s"
    ],
    [
      "G3",
      "s"
    ],
    [
      "H1",
      "s"
    ],
    [
      "H2",
      "s"
    ],
    [
      "H3",
      "s"
    ],
    [
      "I1",
      "s"
    ],
    [
      "I2",
      "s"
    ],
    [
      "I3",
      "s"
    ],
    [
      "J1",
      "s"
    ],
    [
      "J2",
      "s"
    ],
    [
      "J3",
      "s"
    ],
    [
      "K1",
      "s"
    ],
    [
      "K2",
      "s"
    ],
    [
      "K3",
      "s"
    ],
    [
      "L1",
      "s"
    ],
    [
      "L2",
      "s"
    ],
    [
      "L3",
      "s"
    ],
    [
      "M1",
      "s"
    ],
    [
      "M2",
      "s"
    ],
    [
      "M3",
      "s"
    ],
    [
      "N1",
      "s"
    ],
    [
      "N2",
      "s"
    ],
    [
      "N3",
      "s"
    ]
  ],
  "headers": [
    "Banque",
    "Devise",
    "Alias compte",
    "Première date",
    "Dernière date",
    "Nombre de jours",
    "Nombre de lignes",
    "Total débits",
    "Total crédits",
    "Flux net",
    "Premier solde d’ouverture",
    "Dernier solde de clôture",
    "Jours à revoir",
    "Jours sans agrégats"
  ],
  "reread": [
    [
      "Banque",
      "Devise",
      "Alias compte",
      "Première date",
      "Dernière date",
      "Nombre de jours",
      "Nombre de lignes",
      "Total débits",
      "Total crédits",
      "Flux net",
      "Premier solde d’ouverture",
      "Dernier solde de clôture",
      "Jours à revoir",
      "Jours sans agrégats"
    ],
    [
      "ORA",
      "XOF",
      "ALIAS SYNTHETIQUE",
      "2026-07-01",
      "2026-07-03",
      "3",
      "4",
      "123.45",
      "678.90",
      "555.45",
      "1000.00",
      "1555.45",
      "1",
      "0"
    ],
    [
      "BDK",
      "XOF",
      "'=ALIAS INJECTE",
      "2026-07-01",
      "2026-07-01",
      "1",
      "1",
      "5.00",
      "0.00",
      "'-5.00",
      "",
      "",
      "0",
      "1"
    ]
  ],
  "rows": [
    [
      "Banque",
      "Devise",
      "Alias compte",
      "Première date",
      "Dernière date",
      "Nombre de jours",
      "Nombre de lignes",
      "Total débits",
      "Total crédits",
      "Flux net",
      "Premier solde d’ouverture",
      "Dernier solde de clôture",
      "Jours à revoir",
      "Jours sans agrégats"
    ],
    [
      "ORA",
      "XOF",
      "ALIAS SYNTHETIQUE",
      "2026-07-01",
      "2026-07-03",
      "3",
      "4",
      "123.45",
      "678.90",
      "555.45",
      "1000.00",
      "1555.45",
      "1",
      "0"
    ],
    [
      "BDK",
      "XOF",
      "'=ALIAS INJECTE",
      "2026-07-01",
      "2026-07-01",
      "1",
      "1",
      "5.00",
      "0.00",
      "'-5.00",
      "",
      "",
      "0",
      "1"
    ]
  ],
  "sheetName": "Daily v2"
};

test('Export XLSX Daily v2 relu : cellules textuelles et protection des formules identiques avant/après', () => {
  const rows = buildDailyV2SummaryExportRows([
    {
      bank: 'ORA', currency: 'XOF', accountAlias: 'ALIAS SYNTHETIQUE', firstAccountingDate: '2026-07-01', lastAccountingDate: '2026-07-03',
      dayCount: 3, lineCount: 4, totalDebitsMinor: 12_345n, totalCreditsMinor: 67_890n, netFlowMinor: 55_545n,
      firstOpeningBalanceMinor: 100_000n, lastClosingBalanceMinor: 155_545n, needsReviewDayCount: 1, unavailableAggregatesDayCount: 0,
    },
    {
      bank: 'BDK', currency: 'XOF', accountAlias: '=ALIAS INJECTE', firstAccountingDate: '2026-07-01', lastAccountingDate: '2026-07-01',
      dayCount: 1, lineCount: 1, totalDebitsMinor: 500n, totalCreditsMinor: 0n, netFlowMinor: -500n,
      firstOpeningBalanceMinor: null, lastClosingBalanceMinor: null, needsReviewDayCount: 0, unavailableAggregatesDayCount: 1,
    },
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet(rows as string[][]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily v2');
  const reread = XLSX.read(workbookBytes(workbook, 'xlsx'), { type: 'array' });
  const sheet = reread.Sheets[reread.SheetNames[0]];
  const cells = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
  const cellTypes = Object.keys(sheet)
    .filter(address => !address.startsWith('!'))
    .sort()
    .map(address => [address, (sheet[address] as XLSX.CellObject).t]);
  const actual = { sheetName: reread.SheetNames[0], headers: [...DAILY_V2_SUMMARY_EXPORT_HEADERS], rows, reread: cells, cellTypes };
  record('export', actual, EXPECTED_EXPORT);
});
