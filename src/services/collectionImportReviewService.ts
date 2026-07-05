import * as XLSX from 'xlsx';
import { excelProcessingService, type ExcelProcessingResult } from './excelProcessingService';
import type {
  CollectionImportReview,
  CollectionProposedStatus,
  CollectionReviewRow,
  ExcelImportIssue,
} from '@/types/processing';

// ⭐ PACK-C — Service de staging/review pour l'import Collection Report Excel.
//
// Garantie centrale : ce module ne réalise AUCUNE écriture DB. Il ne doit
// jamais importer statiquement intelligentSyncService / supabaseClientService
// (le client Supabase échoue à l'import hors Vite, et la review doit rester
// possible sans DB). Le seul accès DB toléré est une LECTURE optionnelle via
// import dynamique dans attachProposedStatuses, en best-effort.

export interface NamedExcelResult {
  file: string;
  result: ExcelProcessingResult;
}

// Messages de rejet ligne à ligne produits par excelProcessingService.
const LINE_LEVEL_ERROR_PATTERN = /^Ligne \d+\s*:/i;

export function buildCollectionRowId(excelFilename: string, excelSourceRow: number): string {
  return `${excelFilename}::${excelSourceRow}`;
}

/**
 * Construction PURE de l'objet review à partir des résultats de parsing.
 * Aucun accès fichier, aucun accès DB : entièrement testable en synthétique.
 */
export function buildReviewFromExcelResults(results: NamedExcelResult[]): CollectionImportReview {
  const acceptedRows: CollectionReviewRow[] = [];
  const rejectedRows: ExcelImportIssue[] = [];
  const fileLevelErrors: ExcelImportIssue[] = [];
  const warnings: ExcelImportIssue[] = [];
  const files: string[] = [];

  for (const { file, result } of results) {
    files.push(file);

    for (const message of result.errors ?? []) {
      if (LINE_LEVEL_ERROR_PATTERN.test(message)) {
        rejectedRows.push({ file, message });
      } else {
        fileLevelErrors.push({ file, message });
      }
    }

    for (const message of result.warnings ?? []) {
      warnings.push({ file, message });
    }

    for (const collection of result.data ?? []) {
      // La traçabilité est garantie par excelMappingService (throw si absente).
      // Barrière défensive : une ligne sans traçabilité ne peut pas être stagée.
      if (!collection.excelFilename || !collection.excelSourceRow) {
        rejectedRows.push({
          file,
          message: `Ligne sans traçabilité Excel (clientCode="${collection.clientCode ?? ''}") — exclue de la review.`,
        });
        continue;
      }
      acceptedRows.push({
        rowId: buildCollectionRowId(collection.excelFilename, collection.excelSourceRow),
        collection,
        // ⭐ PACK-C.1 : opt-in explicite — aucune ligne pré-validée. L'utilisateur
        // doit sélectionner les lignes à promouvoir (case "tout sélectionner"
        // disponible dans l'en-tête du tableau de review).
        selected: false,
        proposedStatus: undefined,
      });
    }
  }

  return {
    reviewReady: true,
    files,
    acceptedRows,
    rejectedRows,
    fileLevelErrors,
    warnings,
    counters: {
      files_processed: results.length,
      accepted_rows: acceptedRows.length,
      rejected_rows: rejectedRows.length,
      file_level_rejections: fileLevelErrors.length,
      warnings: warnings.length,
    },
    preparedAt: new Date().toISOString(),
  };
}

/**
 * Phase A — "Analyser / Préparer la review".
 * Parsing contrôlé des fichiers Collection Report Excel, staging en mémoire.
 * Zéro écriture DB : seul excelProcessingService (xlsx pur) est appelé.
 */
export async function prepareCollectionImportReview(files: File[]): Promise<CollectionImportReview> {
  const results: NamedExcelResult[] = [];

  for (const file of files) {
    try {
      const result = await excelProcessingService.processCollectionReportExcel(file);
      results.push({ file: file.name, result });
    } catch (error) {
      results.push({
        file: file.name,
        result: {
          success: false,
          errors: [
            `Erreur critique de lecture: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
          ],
        },
      });
    }
  }

  return buildReviewFromExcelResults(results);
}

/**
 * Enrichissement OPTIONNEL de la review avec les statuts proposés
 * (NEW / EXISTS_COMPLETE / EXISTS_INCOMPLETE) via une LECTURE SEULE de la base.
 * Best-effort : en cas d'échec (DB indisponible, environnement de test), la
 * review est retournée inchangée — les statuts restent simplement indisponibles.
 */
export async function attachProposedStatuses(review: CollectionImportReview): Promise<CollectionImportReview> {
  if (review.acceptedRows.length === 0) {
    return review;
  }

  try {
    // Import dynamique : évite de charger le client Supabase hors runtime navigateur.
    const { intelligentSyncService } = await import('./intelligentSyncService');
    const comparisons = await intelligentSyncService.analyzeExcelFile(
      review.acceptedRows.map(row => row.collection)
    );

    const statusByRowId = new Map<string, CollectionProposedStatus>();
    for (const comparison of comparisons) {
      const excelRow = comparison.excelRow;
      if (!excelRow?.excelFilename || !excelRow?.excelSourceRow) {
        continue;
      }
      if (
        comparison.status === 'NEW' ||
        comparison.status === 'EXISTS_COMPLETE' ||
        comparison.status === 'EXISTS_INCOMPLETE'
      ) {
        statusByRowId.set(
          buildCollectionRowId(excelRow.excelFilename, excelRow.excelSourceRow),
          comparison.status
        );
      }
    }

    return {
      ...review,
      acceptedRows: review.acceptedRows.map(row => ({
        ...row,
        proposedStatus: statusByRowId.get(row.rowId) ?? row.proposedStatus,
      })),
    };
  } catch (error) {
    console.warn(
      '⚠️ PACK-C: statuts proposés indisponibles (lecture DB impossible) — review conservée sans statut.',
      error
    );
    return review;
  }
}

// --- Détection / partition des fichiers Collection Report -------------------
// Miroir de la logique de fileProcessingService.detectFileTypeDetailed pour
// garantir qu'aucun fichier Collection n'atteint le flux legacy (écriture DB
// immédiate). Ordre de priorité identique au legacy.

const BANK_KEYWORDS: Record<string, string[]> = {
  BDK: ['BDK', 'BANQUE DE DAKAR'],
  ATB: ['ATB', 'ARAB TUNISIAN', 'ATLANTIQUE'],
  BICIS: ['BICIS', 'BIC'],
  ORA: ['ORA', 'ORABANK'],
  SGBS: ['SGBS', 'SOCIETE GENERALE', 'SG'],
  BIS: ['BIS', 'BANQUE ISLAMIQUE'],
};

export async function isCollectionReportExcelFile(file: File): Promise<boolean> {
  const filename = file.name.toUpperCase();

  if (filename.includes('COLLECTION') || filename.includes('COLLECT')) {
    return true;
  }

  // Types explicitement différents (mêmes règles que le legacy) : jamais en review.
  if (
    (filename.includes('FUND') && filename.includes('POSITION')) ||
    filename.includes('FP') ||
    filename.includes('FUND_POSITION')
  ) {
    return false;
  }
  if (filename.includes('CLIENT') && filename.includes('RECON')) {
    return false;
  }
  for (const keywords of Object.values(BANK_KEYWORDS)) {
    if (keywords.some(keyword => filename.includes(keyword))) {
      return false;
    }
  }

  // Nom de fichier non concluant : sniffing du contenu Excel (lecture locale, pas de DB).
  if (filename.endsWith('.XLSX') || filename.endsWith('.XLS')) {
    try {
      const buffer = await file.arrayBuffer();
      const textContent = extractTextFromExcelBuffer(buffer);
      if (textContent.includes('COLLECTION') || textContent.includes('CLIENT CODE')) {
        return true;
      }
    } catch (error) {
      console.warn('⚠️ PACK-C: analyse contenu Excel impossible pour la détection:', error);
    }
  }

  return false;
}

export async function partitionCollectionReportFiles(files: File[]): Promise<{
  collectionFiles: File[];
  otherFiles: File[];
}> {
  const collectionFiles: File[] = [];
  const otherFiles: File[] = [];

  for (const file of files) {
    if (await isCollectionReportExcelFile(file)) {
      collectionFiles.push(file);
    } else {
      otherFiles.push(file);
    }
  }

  return { collectionFiles, otherFiles };
}

function extractTextFromExcelBuffer(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(buffer, { type: 'array' });
  let allText = '';

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

    for (const row of sheetData) {
      if (Array.isArray(row)) {
        allText += row.join(' ') + '\n';
      }
    }
  }

  return allText;
}
