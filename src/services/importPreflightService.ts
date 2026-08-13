export type ImportDocumentKind =
  | 'COLLECTION_REPORT'
  | 'FUND_POSITION'
  | 'CLIENT_RECONCILIATION'
  | 'INTERNAL_BOOK'
  | 'BANK_REPORT'
  | 'UNKNOWN';

export type ImportPreflightStatus = 'READY' | 'BLOCKED';

export interface ImportFileDescriptor {
  name: string;
  size: number;
  lastModified: number;
  type?: string;
}

export interface ImportPreflightIssue {
  code:
    | 'EMPTY_FILE'
    | 'UNSUPPORTED_EXTENSION'
    | 'UNSUPPORTED_DOCUMENT_FORMAT'
    | 'FEATURE_NOT_OPERATIONAL'
    | 'UNIDENTIFIED_DOCUMENT'
    | 'DUPLICATE_FILE'
    | 'MULTIPLE_SINGLETON_DOCUMENTS';
  message: string;
}

export interface ImportPreflightEntry<TFile extends ImportFileDescriptor = ImportFileDescriptor> {
  file: TFile;
  documentKind: ImportDocumentKind;
  documentLabel: string;
  status: ImportPreflightStatus;
  issues: ImportPreflightIssue[];
}

export interface ImportPreflightResult<TFile extends ImportFileDescriptor = ImportFileDescriptor> {
  entries: ImportPreflightEntry<TFile>[];
  readyCount: number;
  blockedCount: number;
  canProcess: boolean;
}

const SUPPORTED_EXTENSIONS = new Set(['xlsx', 'xls', 'csv', 'pdf']);

const BANK_PATTERNS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: 'BDK', patterns: [/\bBDK\b/, /BANQUE\s+DE\s+DAKAR/] },
  { label: 'ATB', patterns: [/\bATB\b/, /ARAB\s+TUNISIAN/, /BANQUE\s+ATLANTIQUE/] },
  { label: 'BICIS', patterns: [/\bBICIS\b/] },
  { label: 'ORA', patterns: [/\bORA\b/, /\bORABANK\b/] },
  { label: 'SGBS', patterns: [/\bSGBS\b/, /\bSGS\b/, /SOCIETE\s+GENERALE/] },
  { label: 'BIS', patterns: [/\bBIS\b/, /BANQUE\s+ISLAMIQUE/] },
];

function normalizeDocumentText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFileStem(fileName: string): string {
  return normalizeDocumentText(fileName.replace(/\.[^.]+$/, ''));
}

function getExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] ?? '';
}

export function getImportDocumentCompatibilityIssue(
  kind: ImportDocumentKind,
  fileName: string,
): ImportPreflightIssue | null {
  const extension = getExtension(fileName);

  if (kind === 'CLIENT_RECONCILIATION') {
    return {
      code: 'FEATURE_NOT_OPERATIONAL',
      message: 'Le moteur Client Reconciliation réel n’est pas encore connecté ; import désactivé.',
    };
  }

  if (
    (kind === 'COLLECTION_REPORT' || kind === 'INTERNAL_BOOK')
    && extension !== 'xlsx'
    && extension !== 'xls'
  ) {
    return {
      code: 'UNSUPPORTED_DOCUMENT_FORMAT',
      message: 'Ce document est accepté uniquement au format XLSX ou XLS.',
    };
  }

  if (
    (kind === 'FUND_POSITION' || kind === 'BANK_REPORT')
    && extension !== 'xlsx'
    && extension !== 'xls'
    && extension !== 'pdf'
  ) {
    return {
      code: 'UNSUPPORTED_DOCUMENT_FORMAT',
      message: 'Ce document est accepté ici uniquement en XLSX, XLS ou PDF. Utilisez Daily v2 pour un relevé CSV structuré.',
    };
  }

  return null;
}

function getFingerprint(file: ImportFileDescriptor): string {
  return `${file.name.toLowerCase()}|${file.size}|${file.lastModified}`;
}

function detectNormalizedImportDocument(normalized: string): {
  kind: ImportDocumentKind;
  label: string;
} {
  if (/\bCOLLECTIONS?\b/.test(normalized) || /\bCOLLECT\b/.test(normalized)) {
    return { kind: 'COLLECTION_REPORT', label: 'Collection Report' };
  }

  if (/\bFUND\s+POSITION\b/.test(normalized) || /\bFP\b/.test(normalized)) {
    return { kind: 'FUND_POSITION', label: 'Fund Position' };
  }

  if (/\bCLIENT\b/.test(normalized) && /\bRECON(?:CILIATION)?\b/.test(normalized)) {
    return { kind: 'CLIENT_RECONCILIATION', label: 'Client Reconciliation' };
  }

  if (/\bINTERNAL\s+BOOK\b/.test(normalized)) {
    return { kind: 'INTERNAL_BOOK', label: 'Internal Book' };
  }

  if (/\bBRIDGE\b/.test(normalized)) {
    return { kind: 'UNKNOWN', label: 'BRIDGE — utiliser Relevés quotidiens' };
  }

  for (const bank of BANK_PATTERNS) {
    if (bank.patterns.some(pattern => pattern.test(normalized))) {
      return { kind: 'BANK_REPORT', label: `Rapport bancaire ${bank.label}` };
    }
  }

  return { kind: 'UNKNOWN', label: 'Document non identifié' };
}

export function detectImportDocument(fileName: string): {
  kind: ImportDocumentKind;
  label: string;
} {
  return detectNormalizedImportDocument(normalizeFileStem(fileName));
}

export function detectImportDocumentFromText(text: string): {
  kind: ImportDocumentKind;
  label: string;
} {
  const normalized = normalizeDocumentText(text);

  if (/\bCLIENT\s+CODE\b/.test(normalized)) {
    return { kind: 'COLLECTION_REPORT', label: 'Collection Report' };
  }

  if (/\bBOOK\s+BALANCE\b/.test(normalized)) {
    return { kind: 'FUND_POSITION', label: 'Fund Position' };
  }

  return detectNormalizedImportDocument(normalized);
}

export function buildImportPreflight<TFile extends ImportFileDescriptor>(
  files: readonly TFile[],
): ImportPreflightResult<TFile> {
  const fingerprints = new Map<string, number>();
  const singletonCounts = new Map<ImportDocumentKind, number>();

  for (const file of files) {
    const fingerprint = getFingerprint(file);
    fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1);

    const detection = detectImportDocument(file.name);
    if (detection.kind === 'FUND_POSITION' || detection.kind === 'CLIENT_RECONCILIATION') {
      singletonCounts.set(detection.kind, (singletonCounts.get(detection.kind) ?? 0) + 1);
    }
  }

  const seenFingerprints = new Set<string>();
  const entries = files.map<ImportPreflightEntry<TFile>>(file => {
    const detection = detectImportDocument(file.name);
    const issues: ImportPreflightIssue[] = [];
    const extension = getExtension(file.name);
    const fingerprint = getFingerprint(file);

    if (file.size <= 0) {
      issues.push({ code: 'EMPTY_FILE', message: 'Le fichier est vide.' });
    }

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      issues.push({
        code: 'UNSUPPORTED_EXTENSION',
        message: 'Format non supporté. Utilisez XLSX, XLS, CSV ou PDF.',
      });
    }

    if (SUPPORTED_EXTENSIONS.has(extension)) {
      const compatibilityIssue = getImportDocumentCompatibilityIssue(
        detection.kind,
        file.name,
      );
      if (compatibilityIssue) {
        issues.push(compatibilityIssue);
      }
    }

    if (detection.kind === 'UNKNOWN') {
      issues.push({
        code: 'UNIDENTIFIED_DOCUMENT',
        message: detection.label.startsWith('BRIDGE')
          ? 'Les relevés BRIDGE structurés doivent être importés depuis « Relevés quotidiens ».'
          : 'Type non identifié : renommez le fichier avec le rapport ou la banque attendue.',
      });
    }

    if ((fingerprints.get(fingerprint) ?? 0) > 1 && seenFingerprints.has(fingerprint)) {
      issues.push({
        code: 'DUPLICATE_FILE',
        message: 'Doublon probable : même nom, même taille et même date de modification.',
      });
    }
    seenFingerprints.add(fingerprint);

    if (
      (detection.kind === 'FUND_POSITION' || detection.kind === 'CLIENT_RECONCILIATION')
      && (singletonCounts.get(detection.kind) ?? 0) > 1
    ) {
      issues.push({
        code: 'MULTIPLE_SINGLETON_DOCUMENTS',
        message: `Plusieurs fichiers « ${detection.label} » sont présents ; conservez uniquement celui à traiter.`,
      });
    }

    return {
      file,
      documentKind: detection.kind,
      documentLabel: detection.label,
      status: issues.length === 0 ? 'READY' : 'BLOCKED',
      issues,
    };
  });

  const readyCount = entries.filter(entry => entry.status === 'READY').length;
  const blockedCount = entries.length - readyCount;

  return {
    entries,
    readyCount,
    blockedCount,
    canProcess: entries.length > 0 && blockedCount === 0,
  };
}
