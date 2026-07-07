/**
 * Tests synthétiques DAILY-INGESTION-0C — alignement de la classification des
 * fichiers entre les surfaces encore vivantes :
 *
 *  - `isCollectionReportExcelFile` / `partitionCollectionReportFiles`
 *    (collectionImportReviewService) : la partition qui protège la review
 *    PACK-C dans /upload ;
 *  - `fileProcessingService.detectFileTypeDetailed` : la classification legacy
 *    encore utilisée par le pipeline d'écriture pour les fichiers non
 *    Collection.
 *
 * Si ces deux logiques divergent sur ce qu'est un fichier Collection, un
 * fichier pourrait contourner la review et partir en écriture directe. Ce test
 * fige leur alignement sans supprimer le code legacy (hors périmètre 0C).
 *
 * Tous les noms et contenus sont synthétiques. Aucune donnée bancaire réelle,
 * aucun accès réseau, aucun Supabase live.
 *
 * Note runner : le client Supabase généré (`@/integrations/supabase/client`)
 * est Vite-only et crashe sous Node ; il est court-circuité par un stub inerte
 * via un hook de résolution auto-contenu (aucun fichier externe). Le stub
 * jette au moindre accès : ce test ne peut physiquement pas toucher Supabase.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import * as XLSX from 'xlsx';
import {
  isCollectionReportExcelFile,
  partitionCollectionReportFiles
} from './collectionImportReviewService';

const SUPABASE_CLIENT_SPECIFIER = '@/integrations/supabase/client';

const supabaseStubModuleUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    'export const supabase = new Proxy({}, {' +
      ' get() { throw new Error("synthetic test: supabase client must never be used"); }' +
      ' });'
  );

const resolverHooksUrl =
  'data:text/javascript,' +
  encodeURIComponent(
    `export function resolve(specifier, context, nextResolve) {
      if (specifier === ${JSON.stringify(SUPABASE_CLIENT_SPECIFIER)}) {
        return { shortCircuit: true, url: ${JSON.stringify(supabaseStubModuleUrl)} };
      }
      return nextResolve(specifier, context);
    }`
  );

register(resolverHooksUrl);

// Import dynamique APRÈS l'enregistrement du hook (chaîne legacy complète).
const legacyModulePromise = import('./fileProcessingService');

interface LegacyClassifier {
  detectFileTypeDetailed(file: File): Promise<string>;
}

async function legacyClassifier(): Promise<LegacyClassifier> {
  const mod = await legacyModulePromise;
  return mod.fileProcessingService as unknown as LegacyClassifier;
}

function xlsxFile(name: string, rows: unknown[][]): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Feuille1');
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buffer], name);
}

function csvFile(name: string, text: string): File {
  return new File([text], name);
}

// Contenu synthétique neutre : aucun marqueur Collection.
const NEUTRAL_ROWS: unknown[][] = [
  ['Rapport synthetique', ''],
  ['Valeur', 12345]
];

// Contenu synthétique portant les marqueurs Collection sniffés par les deux
// surfaces (COLLECTION / CLIENT CODE).
const COLLECTION_CONTENT_ROWS: unknown[][] = [
  ['COLLECTION'],
  ['CLIENT CODE', 'AMOUNT'],
  ['CLIENT_SYN_1', 100001]
];

interface ClassificationCase {
  label: string;
  makeFile: () => File;
  expectCollection: boolean;
}

const CLASSIFICATION_CASES: ClassificationCase[] = [
  {
    label: 'COLLECTION REPORT-2026.xlsx (nom explicite)',
    makeFile: () => xlsxFile('COLLECTION REPORT-2026.xlsx', NEUTRAL_ROWS),
    expectCollection: true
  },
  {
    label: 'FUND POSITION.xlsx',
    makeFile: () => xlsxFile('FUND POSITION.xlsx', NEUTRAL_ROWS),
    expectCollection: false
  },
  {
    label: '010726 BDK ONLINE.csv',
    makeFile: () => csvFile('010726 BDK ONLINE.csv', 'Date;Valeur;Libelle;Debit;Credit;Solde'),
    expectCollection: false
  },
  {
    label: '010726 BRIDGE ONLINE CSV.csv',
    makeFile: () => csvFile('010726 BRIDGE ONLINE CSV.csv', 'Date;Valeur;Libelle;Debit;Credit;Solde'),
    expectCollection: false
  },
  {
    label: 'Excel au nom non concluant mais contenu COLLECTION / CLIENT CODE',
    makeFile: () => xlsxFile('export-mensuel-divers.xlsx', COLLECTION_CONTENT_ROWS),
    expectCollection: true
  },
  {
    label: 'RELEVE 2026 BICIS.xlsx',
    makeFile: () => xlsxFile('RELEVE 2026 BICIS.xlsx', NEUTRAL_ROWS),
    expectCollection: false
  },
  {
    label: 'RELEVE 2026 BDK.xlsx',
    makeFile: () => xlsxFile('RELEVE 2026 BDK.xlsx', NEUTRAL_ROWS),
    expectCollection: false
  },
  {
    label: 'RELEVE 2026 ORA.xlsx',
    makeFile: () => xlsxFile('RELEVE 2026 ORA.xlsx', NEUTRAL_ROWS),
    expectCollection: false
  },
  {
    label: 'RELEVE 2026 BIS.xlsx',
    makeFile: () => xlsxFile('RELEVE 2026 BIS.xlsx', NEUTRAL_ROWS),
    expectCollection: false
  },
  {
    label: 'BANQUE ATLANTIQUE 2026.xlsx',
    makeFile: () => xlsxFile('BANQUE ATLANTIQUE 2026.xlsx', NEUTRAL_ROWS),
    expectCollection: false
  }
];

test('surface review : chaque cas synthétique est classé comme attendu', async () => {
  for (const classificationCase of CLASSIFICATION_CASES) {
    const detected = await isCollectionReportExcelFile(classificationCase.makeFile());
    assert.equal(
      detected,
      classificationCase.expectCollection,
      `review: "${classificationCase.label}" attendu ${classificationCase.expectCollection}, obtenu ${detected}`
    );
  }
});

test('surface legacy : detectFileTypeDetailed classe Collection exactement comme la review', async () => {
  const legacy = await legacyClassifier();

  for (const classificationCase of CLASSIFICATION_CASES) {
    const reviewSaysCollection = await isCollectionReportExcelFile(classificationCase.makeFile());
    const legacyType = await legacy.detectFileTypeDetailed(classificationCase.makeFile());
    const legacySaysCollection = legacyType === 'COLLECTION_REPORT';

    assert.equal(
      legacySaysCollection,
      reviewSaysCollection,
      `désalignement sur "${classificationCase.label}" : review=${reviewSaysCollection}, ` +
        `legacy=${legacyType}`
    );
    assert.equal(
      legacySaysCollection,
      classificationCase.expectCollection,
      `legacy: "${classificationCase.label}" attendu ${classificationCase.expectCollection}, obtenu ${legacyType}`
    );
  }
});

test('legacy : FUND POSITION et fichiers banque gardent leur catégorie non-Collection', async () => {
  const legacy = await legacyClassifier();

  assert.equal(
    await legacy.detectFileTypeDetailed(xlsxFile('FUND POSITION.xlsx', NEUTRAL_ROWS)),
    'FUND_POSITION'
  );
  assert.equal(
    await legacy.detectFileTypeDetailed(
      csvFile('010726 BDK ONLINE.csv', 'Date;Valeur;Libelle;Debit;Credit;Solde')
    ),
    'BANK_REPORT'
  );
});

test('partition : seuls les fichiers Collection partent en review, le reste va au pipeline legacy', async () => {
  const files = CLASSIFICATION_CASES.map((classificationCase) => classificationCase.makeFile());
  const { collectionFiles, otherFiles } = await partitionCollectionReportFiles(files);

  const expectedCollectionNames = CLASSIFICATION_CASES.filter(
    (classificationCase) => classificationCase.expectCollection
  ).map((classificationCase) => classificationCase.makeFile().name);

  assert.deepEqual(
    collectionFiles.map((file) => file.name).sort(),
    expectedCollectionNames.sort()
  );
  assert.equal(otherFiles.length, CLASSIFICATION_CASES.length - expectedCollectionNames.length);
});
