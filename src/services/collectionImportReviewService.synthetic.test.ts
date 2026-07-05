import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import {
  buildCollectionRowId,
  buildReviewFromExcelResults,
  isCollectionReportExcelFile,
  partitionCollectionReportFiles,
  prepareCollectionImportReview,
  type NamedExcelResult,
} from './collectionImportReviewService';
import { assertPromotionAllowed } from './collectionImportPromotionService';
import type { CollectionReport } from '@/types/banking';

// ⭐ PACK-C — Tests synthétiques du staging/review Collection Report.
// Aucune donnée bancaire réelle : clients, banques et montants fictifs.
// Le fait même que ces tests s'exécutent sous Node sans variables Supabase
// prouve que le service de review n'importe aucun client DB statiquement.

const VALID_HEADERS = [
  'DATE',
  'CLIENT NAME',
  'AMOUNT',
  'BANK NAME',
  'FACTURE N°',
  'No.CHq /Bd',
  'Date of VAlidity',
];

function createExcelFile(rows: unknown[][], name: string, sheetName = 'DATA'): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  // Shim minimal : excelProcessingService n'utilise que name + arrayBuffer().
  return {
    name,
    arrayBuffer: async () => output as ArrayBuffer,
  } as unknown as File;
}

function createValidCollectionFile(name = 'COLLECTION_REPORT_SYNTHETIC.xlsx'): File {
  return createExcelFile(
    [
      VALID_HEADERS,
      ['05/06/2026', 'CLIENT_SYN_A', 150000, 'BANQUE_SYNTHETIQUE_1', 'FAC-SYN-001', '123456', '10/06/2026'],
      ['06/06/2026', 'CLIENT_SYN_B', 275000, 'BANQUE_SYNTHETIQUE_2', 'FAC-SYN-002', '654321', '11/06/2026'],
    ],
    name
  );
}

function syntheticCollection(sourceRow: number, overrides: Partial<CollectionReport> = {}): CollectionReport {
  return {
    reportDate: '2026-06-05',
    clientCode: `CLIENT_SYN_${sourceRow}`,
    collectionAmount: 100000 + sourceRow,
    bankName: 'BANQUE_SYNTHETIQUE_1',
    status: 'pending',
    excelFilename: 'COLLECTION_REPORT_SYNTHETIC.xlsx',
    excelSourceRow: sourceRow,
    ...overrides,
  };
}

// --- Cas 1 : fichier valide → staging créé, aucune promotion automatique ----

test('fichier valide → staging créé en mémoire, aucune promotion automatique', async () => {
  const review = await prepareCollectionImportReview([createValidCollectionFile()]);

  assert.equal(review.reviewReady, true);
  assert.equal(review.acceptedRows.length, 2);
  assert.equal(review.rejectedRows.length, 0);
  assert.equal(review.fileLevelErrors.length, 0);

  assert.equal(review.counters.files_processed, 1);
  assert.equal(review.counters.accepted_rows, 2);
  assert.equal(review.counters.rejected_rows, 0);
  assert.equal(review.counters.file_level_rejections, 0);

  // Traçabilité alignée sur la clé d'idempotence (excel_filename, excel_source_row).
  const first = review.acceptedRows[0];
  assert.equal(first.rowId, buildCollectionRowId('COLLECTION_REPORT_SYNTHETIC.xlsx', 2));
  assert.equal(first.collection.excelFilename, 'COLLECTION_REPORT_SYNTHETIC.xlsx');
  assert.equal(first.collection.excelSourceRow, 2);
  assert.equal(first.collection.clientCode, 'CLIENT_SYN_A');
  assert.equal(first.collection.reportDate, '2026-06-05');
  assert.equal(first.collection.collectionAmount, 150000);

  // ⭐ PACK-C.1 : opt-in explicite — aucune ligne pré-sélectionnée, rien n'est
  // promu automatiquement. La review ne porte aucun résultat de sync ni effet DB.
  assert.ok(review.acceptedRows.every(row => row.selected === false));
  assert.ok(review.acceptedRows.every(row => row.proposedStatus === undefined));
  assert.ok(!('syncResult' in review));
});

// --- PACK-C.1 : une review fraîche n'est jamais promouvable sans sélection ---

test('review fraîche (opt-in par défaut) : promotion impossible sans sélection explicite', async () => {
  const review = await prepareCollectionImportReview([createValidCollectionFile()]);

  assert.equal(review.acceptedRows.length, 2);

  const gate = assertPromotionAllowed(review);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason ?? '', /Aucune ligne validée/);
});

// --- Cas 2 : header obligatoire absent → rejet global visible ---------------

test('header obligatoire absent → rejet global du fichier visible, zéro ligne acceptée', async () => {
  const fileWithoutBank = createExcelFile(
    [
      ['DATE', 'CLIENT NAME', 'AMOUNT'],
      ['05/06/2026', 'CLIENT_SYN_A', 150000],
    ],
    'COLLECTION_SANS_HEADER_SYNTHETIC.xlsx'
  );

  const review = await prepareCollectionImportReview([fileWithoutBank]);

  assert.equal(review.acceptedRows.length, 0);
  assert.equal(review.counters.file_level_rejections >= 1, true);
  assert.equal(review.fileLevelErrors[0].file, 'COLLECTION_SANS_HEADER_SYNTHETIC.xlsx');
  assert.match(
    review.fileLevelErrors[0].message,
    /Aucune feuille de données valide|Headers obligatoires manquants/
  );
  // La review reste prête (l'utilisateur voit le rejet), mais sans ligne promouvable.
  assert.equal(review.reviewReady, true);
});

// --- Cas 3 : date invalide → ligne rejetée, lignes valides conservées -------

test('date invalide (31/02) → ligne rejetée visible, les lignes valides restent stagées', async () => {
  const file = createExcelFile(
    [
      VALID_HEADERS,
      ['05/06/2026', 'CLIENT_SYN_A', 150000, 'BANQUE_SYNTHETIQUE_1', 'FAC-SYN-001', '123456', '10/06/2026'],
      ['31/02/2026', 'CLIENT_SYN_B', 200000, 'BANQUE_SYNTHETIQUE_2', 'FAC-SYN-002', '654321', '11/06/2026'],
    ],
    'COLLECTION_DATE_INVALIDE_SYNTHETIC.xlsx'
  );

  const review = await prepareCollectionImportReview([file]);

  assert.equal(review.acceptedRows.length, 1);
  assert.equal(review.acceptedRows[0].collection.clientCode, 'CLIENT_SYN_A');
  assert.equal(review.rejectedRows.length, 1);
  assert.match(review.rejectedRows[0].message, /Ligne 3/);
  assert.match(review.rejectedRows[0].message, /reportDate/);
});

// --- Cas 4 : clientCode vide → ligne rejetée --------------------------------

test('clientCode vide → ligne rejetée visible, les lignes valides restent stagées', async () => {
  const file = createExcelFile(
    [
      VALID_HEADERS,
      ['05/06/2026', '', 150000, 'BANQUE_SYNTHETIQUE_1', 'FAC-SYN-001', '123456', '10/06/2026'],
      ['06/06/2026', 'CLIENT_SYN_B', 275000, 'BANQUE_SYNTHETIQUE_2', 'FAC-SYN-002', '654321', '11/06/2026'],
    ],
    'COLLECTION_CLIENT_VIDE_SYNTHETIC.xlsx'
  );

  const review = await prepareCollectionImportReview([file]);

  assert.equal(review.acceptedRows.length, 1);
  assert.equal(review.acceptedRows[0].collection.clientCode, 'CLIENT_SYN_B');
  assert.equal(review.rejectedRows.length, 1);
  assert.match(review.rejectedRows[0].message, /Ligne 2/);
  assert.match(review.rejectedRows[0].message, /clientCode/);
});

// --- Builder pur : classification des erreurs et warnings -------------------

test('buildReviewFromExcelResults : erreurs "Ligne N:" classées ligne, autres classées globales', () => {
  const results: NamedExcelResult[] = [
    {
      file: 'FICHIER_SYNTHETIC_1.xlsx',
      result: {
        success: true,
        data: [syntheticCollection(2)],
        errors: ['Ligne 3: reportDate obligatoire mais invalide.'],
        warnings: ['Header optionnel absent: FACTURE N° — colonne ignorée.'],
      },
    },
    {
      file: 'FICHIER_SYNTHETIC_2.xlsx',
      result: {
        success: false,
        errors: ['Headers obligatoires manquants: BANK NAME. Import annulé.'],
      },
    },
  ];

  const review = buildReviewFromExcelResults(results);

  assert.equal(review.acceptedRows.length, 1);
  assert.equal(review.rejectedRows.length, 1);
  assert.equal(review.rejectedRows[0].file, 'FICHIER_SYNTHETIC_1.xlsx');
  assert.equal(review.fileLevelErrors.length, 1);
  assert.equal(review.fileLevelErrors[0].file, 'FICHIER_SYNTHETIC_2.xlsx');
  assert.equal(review.warnings.length, 1);
  assert.equal(review.counters.files_processed, 2);
  assert.equal(review.counters.warnings, 1);
});

test('buildReviewFromExcelResults : ligne sans traçabilité exclue du staging (barrière défensive)', () => {
  const noTrace = syntheticCollection(5);
  delete (noTrace as Partial<CollectionReport>).excelFilename;
  delete (noTrace as Partial<CollectionReport>).excelSourceRow;

  const review = buildReviewFromExcelResults([
    {
      file: 'FICHIER_SYNTHETIC_3.xlsx',
      result: { success: true, data: [noTrace, syntheticCollection(6)] },
    },
  ]);

  assert.equal(review.acceptedRows.length, 1);
  assert.equal(review.acceptedRows[0].collection.excelSourceRow, 6);
  assert.equal(review.rejectedRows.length, 1);
  assert.match(review.rejectedRows[0].message, /traçabilité/i);
});

// --- Détection / partition : aucun fichier Collection vers le flux legacy ---

test('détection Collection : nom de fichier explicite → review, autres types → flux legacy', async () => {
  assert.equal(
    await isCollectionReportExcelFile(createValidCollectionFile('COLLECTION_JUIN_SYNTHETIC.xlsx')),
    true
  );
  assert.equal(
    await isCollectionReportExcelFile(
      createExcelFile([['FUND POSITION']], 'FUND_POSITION_SYNTHETIC.xlsx')
    ),
    false
  );
  assert.equal(
    await isCollectionReportExcelFile(
      createExcelFile([['CLIENT RECONCILIATION']], 'CLIENT_RECON_SYNTHETIC.xlsx')
    ),
    false
  );
  assert.equal(
    await isCollectionReportExcelFile(
      createExcelFile([['RELEVE']], 'BDK_RELEVE_SYNTHETIC.xlsx')
    ),
    false
  );
});

test('détection Collection : nom neutre mais contenu CLIENT CODE → review (sniffing contenu)', async () => {
  const neutralName = createExcelFile(
    [
      ['CLIENT CODE', 'MONTANT'],
      ['CLIENT_SYN_A', 150000],
    ],
    'RAPPORT_JUIN_SYNTHETIC.xlsx'
  );

  assert.equal(await isCollectionReportExcelFile(neutralName), true);
});

test('partition : les fichiers Collection sont séparés des autres fichiers', async () => {
  const collectionFile = createValidCollectionFile('COLLECTION_JUILLET_SYNTHETIC.xlsx');
  const fundFile = createExcelFile([['FUND POSITION']], 'FUND_POSITION_SYNTHETIC.xlsx');

  const { collectionFiles, otherFiles } = await partitionCollectionReportFiles([
    collectionFile,
    fundFile,
  ]);

  assert.equal(collectionFiles.length, 1);
  assert.equal(collectionFiles[0].name, 'COLLECTION_JUILLET_SYNTHETIC.xlsx');
  assert.equal(otherFiles.length, 1);
  assert.equal(otherFiles[0].name, 'FUND_POSITION_SYNTHETIC.xlsx');
});

// --- Multi-fichiers ----------------------------------------------------------

test('plusieurs fichiers Collection : compteurs agrégés et erreurs par fichier', async () => {
  const validFile = createValidCollectionFile('COLLECTION_A_SYNTHETIC.xlsx');
  const brokenFile = createExcelFile(
    [['DATE', 'CLIENT NAME', 'AMOUNT']],
    'COLLECTION_B_SYNTHETIC.xlsx'
  );

  const review = await prepareCollectionImportReview([validFile, brokenFile]);

  assert.equal(review.counters.files_processed, 2);
  assert.equal(review.counters.accepted_rows, 2);
  assert.equal(review.counters.file_level_rejections, 1);
  assert.deepEqual(review.files, ['COLLECTION_A_SYNTHETIC.xlsx', 'COLLECTION_B_SYNTHETIC.xlsx']);
  assert.equal(review.fileLevelErrors[0].file, 'COLLECTION_B_SYNTHETIC.xlsx');
});
