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
  assert.match(source, /function fileOrdinal\(batch: readonly File\[\], file: File\): string/);
});

test('les journaux console des rapports bancaires et de la Fund Position ne portent ni nom de fichier ni valeur', () => {
  const bankStart = source.indexOf('private async processBankReports(');
  const clientStart = source.indexOf('private async processClientReconciliation(');
  const segment = source.slice(bankStart, clientStart);
  const consoleCalls = segment.match(/console\.(?:log|warn|error)\([^;]*\);/g) ?? [];
  assert.ok(consoleCalls.length > 0);
  for (const call of consoleCalls) {
    // Un compteur (`.length`) est admis ; le contenu d'un tableau d'erreurs ou d'avertissements ne l'est pas.
    assert.doesNotMatch(call, /\.name\b|toLocaleString|reportDate|grandTotal|totalFundAvailable|getBankReportSummary|,\s*processingResult\.errors\)|,\s*warnings\)|,\s*error\)/, call.slice(0, 80));
  }
  assert.doesNotMatch(source, /Fichiers reçus:', files\.map/);
});
