import * as XLSX from 'xlsx';

import type { FileDetectionResult } from '@/types/processing';
import {
  detectImportDocument,
  detectImportDocumentFromText,
  type ImportDocumentKind,
} from './importPreflightService';
import { detectInternalBookRuntimeFile } from './internalBookRuntimeProcessingService';

const BANK_PATTERNS: ReadonlyArray<{ code: string; patterns: RegExp[] }> = [
  { code: 'BDK', patterns: [/\bBDK\b/, /BANQUE DE DAKAR/] },
  { code: 'ATB', patterns: [/\bATB\b/, /ATLANTIQUE/, /ARAB TUNISIAN/] },
  { code: 'BICIS', patterns: [/\bBICIS\b/] },
  { code: 'ORA', patterns: [/\bORA\b/, /\bORABANK\b/] },
  { code: 'SGBS', patterns: [/\bSGBS\b/, /\bSGS\b/, /SOCIETE GENERALE/] },
  { code: 'BIS', patterns: [/\bBIS\b/, /BANQUE ISLAMIQUE/] },
];

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectBankCode(value: string): string | undefined {
  const normalized = normalize(value);
  return BANK_PATTERNS.find(bank => bank.patterns.some(pattern => pattern.test(normalized)))?.code;
}

function mapDocumentKind(
  file: File,
  kind: ImportDocumentKind,
  confidence: FileDetectionResult['confidence'],
  sourceText: string,
): FileDetectionResult | null {
  if (kind === 'COLLECTION_REPORT') {
    return { file, detectedType: 'collectionReport', confidence };
  }
  if (kind === 'FUND_POSITION') {
    return { file, detectedType: 'fundsPosition', confidence };
  }
  if (kind === 'CLIENT_RECONCILIATION') {
    return { file, detectedType: 'clientReconciliation', confidence };
  }
  if (kind === 'INTERNAL_BOOK') {
    return { file, detectedType: 'internalBook', confidence };
  }
  if (kind === 'BANK_REPORT') {
    const bankCode = detectBankCode(sourceText);
    const normalized = normalize(sourceText);
    const isStatement = /\b(ONLINE|STATEMENT|RELEVE)\b/.test(normalized);
    return {
      file,
      detectedType: isStatement ? 'bankStatement' : 'bankAnalysis',
      confidence,
      bankType: bankCode ? `${bankCode} ${isStatement ? 'Relevé' : 'Rapport'}` : undefined,
    };
  }
  return null;
}

async function detectFromExcelContent(file: File): Promise<FileDetectionResult | null> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'buffer' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return null;

  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][];
  const content = rows
    .flat()
    .filter(value => value !== null && value !== undefined && value !== '')
    .join(' ');
  if (!content) return null;

  const detection = detectImportDocumentFromText(content);
  return mapDocumentKind(file, detection.kind, 'medium', content);
}

/** Détection read-only partagée par l'écran Document Understanding. */
export async function detectDocumentType(file: File): Promise<FileDetectionResult> {
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
  const nameDetection = detectImportDocument(file.name);
  const byName = mapDocumentKind(file, nameDetection.kind, 'high', file.name);
  if (byName) return byName;

  if (extension === 'xlsx' || extension === 'xls') {
    const internalBook = await detectInternalBookRuntimeFile(file);
    if (internalBook.isInternalBook) {
      return { file, detectedType: 'internalBook', confidence: internalBook.confidence };
    }

    try {
      const byContent = await detectFromExcelContent(file);
      if (byContent) return byContent;
    } catch {
      // Le détecteur reste read-only et fail-closed : un classeur illisible
      // n'est jamais transformé en type métier par défaut.
    }
  }

  return { file, detectedType: 'unknown', confidence: 'low' };
}

export const documentDetectionService = { detectFileType: detectDocumentType };
