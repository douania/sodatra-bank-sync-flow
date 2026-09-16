import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Pack 2 (contre-revue PR #149, finding 2) : les erreurs retournées par le
 * pipeline /upload et affichées par le toast ne portent aucun nom de fichier ;
 * un fichier est désigné par son rang dans le lot. Les journaux console des
 * chemins rapports bancaires et Fund Position ne portent ni nom ni valeur.
 */
const source = readFileSync('src/services/fileProcessingService.ts', 'utf8');

test('aucune erreur retournée par le pipeline /upload ne contient un nom de fichier', () => {
  // `results.errors` uniquement ; les diagnostics d'audit (`excel_errors`) sont un autre canal.
  const errorPushes = source.match(/(?<![_a-zA-Z])errors\??\.push\([^;]*\);/g) ?? [];
  assert.ok(errorPushes.length >= 6, 'les points d’erreur attendus existent');
  for (const statement of errorPushes) {
    assert.doesNotMatch(statement, /\.name\b/, `nom de fichier interdit dans : ${statement.slice(0, 80)}`);
  }
  assert.doesNotMatch(source, /const errorMsg = `[^`]*\$\{[a-zA-Z]*[fF]ile\.name\}/);
  assert.match(source, /function fileOrdinal\(batch: readonly File\[\], file: File, ordinals\?: ReadonlyMap<File, number>\): string/);
});

test('aucun journal console du pipeline ne porte de nom de fichier, de valeur, ni d’objet ou de liste d’erreurs', () => {
  const consoleCalls = source.match(/console\.(?:log|warn|error)\([\s\S]*?\);/g) ?? [];
  assert.ok(consoleCalls.length > 10, 'les journaux attendus existent');
  for (const call of consoleCalls) {
    // Un compteur (`.length`) est admis ; un nom, une valeur, un objet d'erreur ou une liste ne le sont pas.
    assert.doesNotMatch(
      call,
      /\.name\b|toLocaleString|reportDate|grandTotal|totalFundAvailable|getBankReportSummary|,\s*(?:processingResult|extractionResult|excelResult|syncResult)\.errors\s*\)|,\s*warnings\s*\)|,\s*(?:error|e|err)\s*\)/,
      call.slice(0, 100),
    );
  }
  assert.doesNotMatch(source, /Fichiers reçus:', files\.map/);
  assert.doesNotMatch(source, /'📁 Fichiers:'/);
});

test('l’interface /upload affiche le même rang « fichier n°N » que celui porté par les erreurs', () => {
  const page = readFileSync('src/pages/FileUpload.tsx', 'utf8');
  assert.match(page, /fichier n°\{index \+ 1\}/);
  assert.match(page, /const fileOrdinals = new Map\(selectedFiles\.map\(\(file, index\) => \[file, index \+ 1\] as const\)\)/);
  assert.match(page, /processFiles\(otherFiles, \{ sheetSelections, fileOrdinals \}\)/);
  assert.match(source, /fileOrdinal\(batch: readonly File\[\], file: File, ordinals\?: ReadonlyMap<File, number>\)/);
});
