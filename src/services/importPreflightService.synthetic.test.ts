import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildImportPreflight,
  detectImportDocument,
  detectImportDocumentFromText,
  type ImportFileDescriptor,
} from './importPreflightService';

test('Pack 2 : un classeur Excel de rapport bancaire ou de Fund Position exige une feuille choisie, liée à l’instance', () => {
  const bank = { name: '07-BDK 2026.xlsx', size: 10, lastModified: 1 };
  const fund = { name: 'FUND POSITION.xlsx', size: 20, lastModified: 1 };
  const pdf = { name: 'Releve BDK.pdf', size: 30, lastModified: 1 };

  // Garde obligatoire : sans inventaire, les classeurs Excel concernés sont bloqués.
  const pending = buildImportPreflight([bank, fund, pdf]);
  assert.equal(pending.canProcess, false);
  assert.deepEqual(pending.entries.map(entry => entry.issues.map(issue => issue.code)), [
    ['SHEET_INVENTORY_PENDING'],
    ['SHEET_INVENTORY_PENDING'],
    [],
  ]);

  // Noms de feuilles synthétiques.
  const inventory = new Map<ImportFileDescriptor, readonly string[]>([
    [bank, ['010126', '020126']],
    [fund, ['010126']],
  ]);
  const unselected = buildImportPreflight([bank, fund, pdf], { sheetInventory: inventory });
  assert.equal(unselected.entries[0].status, 'BLOCKED');
  assert.equal(unselected.entries[0].issues[0].code, 'SHEET_SELECTION_REQUIRED');
  assert.deepEqual(unselected.entries[0].sheetNames, ['010126', '020126']);
  assert.equal(unselected.entries[1].status, 'READY', 'une feuille unique est retenue implicitement');
  assert.equal(unselected.entries[1].selectedSheetName, '010126');

  const wrongSelection = buildImportPreflight([bank], {
    sheetInventory: inventory,
    sheetSelections: new Map([[bank, 'ABSENTE']]),
  });
  assert.equal(wrongSelection.entries[0].issues[0].code, 'SHEET_SELECTION_REQUIRED');

  const selected = buildImportPreflight([bank, fund, pdf], {
    sheetInventory: inventory,
    sheetSelections: new Map([[bank, '020126']]),
  });
  assert.equal(selected.canProcess, true);
  assert.equal(selected.entries[0].selectedSheetName, '020126');

  // Une autre instance de même nom, taille et date ne réutilise ni inventaire ni sélection.
  const replacement = { name: '07-BDK 2026.xlsx', size: 10, lastModified: 1 };
  const replaced = buildImportPreflight([replacement], {
    sheetInventory: inventory,
    sheetSelections: new Map([[bank, '020126']]),
  });
  assert.equal(replaced.entries[0].issues[0].code, 'SHEET_INVENTORY_PENDING');

  const unreadable = buildImportPreflight([bank], { sheetInventory: new Map([[bank, []]]) });
  assert.equal(unreadable.entries[0].issues[0].code, 'SHEET_SELECTION_REQUIRED');
});

test('Pack 2 : le repli de contenu lit l’identité bancaire dans l’en-tête, pas dans le corps', () => {
  const body = 'BDK\nDate\tCh.No\nOPENING BALANCE 09/07/26\nCHQ SGBS\nDEPOT CBAO\nVIREMENT ATB';
  assert.equal(detectImportDocumentFromText(body).kind, 'BANK_REPORT');
  assert.equal(detectImportDocumentFromText(body).label, 'Rapport bancaire BDK');
  assert.equal(detectImportDocumentFromText('BDK SGBS\nRAPPORT').kind, 'UNKNOWN');
});
import {
  COLLECTION_IMPORT_MAX_FILE_BYTES,
  COLLECTION_IMPORT_MAX_FILES,
} from './collectionImportLimits';

const file = (
  name: string,
  size = 1024,
  lastModified = 1,
): ImportFileDescriptor => ({ name, size, lastModified });

test('identifie les rapports métier et les banques autorisées sans faux positif court', () => {
  assert.deepEqual(detectImportDocument('Collection Report 2026.xlsx'), {
    kind: 'COLLECTION_REPORT',
    label: 'Collection Report',
  });
  assert.equal(detectImportDocument('Fund_Position_2026.pdf').kind, 'FUND_POSITION');
  assert.equal(detectImportDocument('Client_Recon_Aout.xlsx').kind, 'CLIENT_RECONCILIATION');
  assert.equal(detectImportDocument('synthetic-BDK-internal-book.xlsx').kind, 'INTERNAL_BOOK');
  assert.equal(detectImportDocument('Releve Bridge 2026.xlsx').kind, 'UNKNOWN');
  assert.equal(detectImportDocument('Releve Societe Generale.pdf').label, 'Rapport bancaire SGBS');
  assert.equal(detectImportDocument('Relevé Société Générale.pdf').label, 'Rapport bancaire SGBS');
  assert.equal(detectImportDocument('Releve BDK FP2026.pdf').label, 'Rapport bancaire BDK');
  assert.equal(detectImportDocument('publications.xlsx').kind, 'UNKNOWN');
  assert.equal(detectImportDocument('CORPORATE.pdf').kind, 'UNKNOWN');
  assert.equal(detectImportDocument('RUBICON.xlsx').kind, 'UNKNOWN');
  assert.equal(detectImportDocument('MSG.pdf').kind, 'UNKNOWN');
});

test('le repli de contenu réutilise la classification stricte sans sous-chaînes bancaires', () => {
  assert.equal(detectImportDocumentFromText('COLLECTION CLIENT CODE AMOUNT').kind, 'COLLECTION_REPORT');
  assert.equal(detectImportDocumentFromText('BOOK BALANCE AU 31/07/2026').kind, 'FUND_POSITION');
  assert.equal(detectImportDocumentFromText('RELEVÉ SOCIÉTÉ GÉNÉRALE').kind, 'BANK_REPORT');
  assert.equal(detectImportDocumentFromText('CORPORATE RUBICON MSG').kind, 'UNKNOWN');
});

test('bloque toute ambiguïté entre familles au lieu de choisir selon l’ordre des règles', () => {
  for (const detection of [
    detectImportDocument('Collection Bridge 2026.xlsx'),
    detectImportDocument('Collection Client Recon 2026.xlsx'),
    detectImportDocumentFromText('COLLECTION CLIENT CODE\nBRIDGE RELEVE\nBDK'),
    detectImportDocumentFromText('COLLECTION REPORT\nCLIENT RECONCILIATION\nBDK'),
  ]) {
    assert.equal(detection.kind, 'UNKNOWN');
    assert.match(detection.label, /ambigu/i);
  }
});

test('autorise un lot entièrement identifié et supporté', () => {
  const fundPosition = file('Fund Position.xlsx');
  const result = buildImportPreflight([
    file('Collection Report.xlsx'),
    file('Releve BDK.pdf'),
    fundPosition,
  ], { sheetInventory: new Map([[fundPosition, ['Feuil1']]]) });

  assert.equal(result.canProcess, true);
  assert.equal(result.readyCount, 3);
  assert.equal(result.blockedCount, 0);
});

test('bloque les fichiers vides, formats interdits et documents non identifiés', () => {
  const result = buildImportPreflight([
    file('Releve BDK.txt'),
    file('document.xlsx', 0),
  ]);

  assert.equal(result.canProcess, false);
  assert.deepEqual(
    result.entries.flatMap(entry => entry.issues.map(issue => issue.code)).sort(),
    ['EMPTY_FILE', 'UNIDENTIFIED_DOCUMENT', 'UNSUPPORTED_EXTENSION'],
  );
});

test('borne la taille et le nombre de fichiers avant parsing', () => {
  const oversized = buildImportPreflight([
    file('Collection Report.xlsx', COLLECTION_IMPORT_MAX_FILE_BYTES + 1),
  ]);
  assert.equal(oversized.canProcess, false);
  assert.ok(oversized.entries[0].issues.some(issue => issue.code === 'FILE_TOO_LARGE'));

  const tooMany = buildImportPreflight(
    Array.from({ length: COLLECTION_IMPORT_MAX_FILES + 1 }, (_, index) =>
      file(`Collection Report ${index}.xlsx`, 1024, index + 1)
    ),
  );
  assert.equal(tooMany.canProcess, false);
  assert.ok(tooMany.entries.every(entry => entry.issues.some(issue => issue.code === 'TOO_MANY_FILES')));
});

test('réserve les bornes 15 Mo / 10 fichiers à Collection Report', () => {
  const oversizedBankReport = buildImportPreflight([
    file('Releve BDK.pdf', COLLECTION_IMPORT_MAX_FILE_BYTES + 1),
  ]);
  assert.equal(oversizedBankReport.canProcess, true);
  assert.ok(!oversizedBankReport.entries[0].issues.some(issue => issue.code === 'FILE_TOO_LARGE'));

  const elevenBankReports = buildImportPreflight(
    Array.from({ length: COLLECTION_IMPORT_MAX_FILES + 1 }, (_, index) =>
      file(`Releve BDK ${index}.pdf`, 1024, index + 1)
    ),
  );
  assert.equal(elevenBankReports.canProcess, true);
  assert.ok(elevenBankReports.entries.every(entry => (
    !entry.issues.some(issue => issue.code === 'TOO_MANY_FILES')
  )));
});

test('le scope production contrôlé autorise uniquement Collection Report', () => {
  const result = buildImportPreflight(
    [file('Collection Report.xlsx'), file('synthetic-BDK-internal-book.xlsx')],
    { deploymentTarget: 'production', allowedDocumentKinds: ['COLLECTION_REPORT'] },
  );
  assert.equal(result.canProcess, false);
  assert.equal(result.entries[0].status, 'READY');
  assert.ok(result.entries[1].issues.some(issue => issue.code === 'TARGET_NOT_AUTHORIZED'));
});

test('oriente explicitement les relevés BRIDGE vers Daily v2', () => {
  const result = buildImportPreflight([file('Releve Bridge 2026.xlsx')]);

  assert.equal(result.canProcess, false);
  assert.match(result.entries[0].issues[0].message, /Relevés quotidiens/);
});

test('applique la matrice format-document réelle du pipeline upload', () => {
  const result = buildImportPreflight([
    file('Collection Report.pdf'),
    file('Fund Position.csv'),
    file('Releve BDK.csv'),
    file('synthetic-BDK-internal-book.pdf'),
  ]);

  assert.equal(result.canProcess, false);
  assert.ok(result.entries.every(entry => (
    entry.issues.some(issue => issue.code === 'UNSUPPORTED_DOCUMENT_FORMAT')
  )));
});

test('désactive honnêtement Client Reconciliation tant que le moteur réel manque', () => {
  const result = buildImportPreflight([file('Client Reconciliation.xlsx')]);

  assert.equal(result.canProcess, false);
  assert.equal(result.entries[0].issues[0].code, 'FEATURE_NOT_OPERATIONAL');
});

test('bloque uniquement le second doublon probable et décrit son heuristique', () => {
  const duplicate = file('Releve ORA.pdf', 4000, 42);
  const result = buildImportPreflight([duplicate, { ...duplicate }]);

  assert.equal(result.readyCount, 1);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.entries[1].issues[0].code, 'DUPLICATE_FILE');
  assert.match(result.entries[1].issues[0].message, /même nom, même taille/i);
});

test('refuse de choisir silencieusement entre plusieurs rapports singleton', () => {
  const result = buildImportPreflight([
    file('Fund Position matin.xlsx', 1000, 1),
    file('Fund Position soir.xlsx', 1200, 2),
    file('Fund Position clôture.xlsx', 1400, 3),
  ]);

  assert.equal(result.canProcess, false);
  assert.equal(result.blockedCount, 3);
  assert.ok(result.entries.every(entry => (
    entry.issues.some(issue => issue.code === 'MULTIPLE_SINGLETON_DOCUMENTS')
  )));
});

test('la page upload applique le précontrôle avant toute mutation', () => {
  const pageSource = readFileSync(
    new URL('../pages/FileUpload.tsx', import.meta.url),
    'utf8',
  );

  assert.match(pageSource, /if \(!importPreflight\.canProcess\)[\s\S]*Lot d'import bloqué/);
  assert.match(pageSource, /disabled=\{processing \|\| !importPreflight\.canProcess\}/);
  assert.match(pageSource, /buildImportPreflight\(selectedFiles, \{/);
  assert.match(pageSource, /allowedDocumentKinds: deploymentTarget === 'production'/);
  assert.doesNotMatch(pageSource, /maxFiles: COLLECTION_IMPORT_MAX_FILES/);
  assert.doesNotMatch(pageSource, /maxSize: COLLECTION_IMPORT_MAX_FILE_BYTES/);
  assert.doesNotMatch(pageSource, /return 'Autre Document'/);
});
