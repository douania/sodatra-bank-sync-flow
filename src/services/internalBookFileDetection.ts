import * as XLSX from 'xlsx';

export interface InternalBookFileDetectionResult {
  isInternalBook: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  detectedDailySheets: string[];
  ignoredSheets: string[];
  matchedSignals: string[];
}

interface SignalDefinition {
  key: string;
  aliases: string[];
}

interface SheetSignalMatch {
  sheetName: string;
  signals: string[];
  coreSignals: string[];
}

const MINIMUM_SIGNAL_COUNT = 4;
const MINIMUM_CORE_SIGNAL_COUNT = 2;

const CORE_SIGNAL_KEYS = new Set(['openingBalance', 'totalBalanceA', 'totalB', 'closingBalance']);

const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  {
    key: 'openingBalance',
    aliases: ['OPENING BALANCE', 'SOLDE D OUVERTURE', 'SOLDE OUVERTURE'],
  },
  {
    key: 'depositsNotYetCleared',
    aliases: [
      'DEPOSIT NOT YET CLEARED',
      'DEPOSITS NOT YET CLEARED',
      'DEPOT NON ENCORE ENCAISSE',
      'DEPOTS NON ENCORE ENCAISSES',
      'DEPOTS PAS ENCORE ENCAISSE',
      'DEPOTS PAS ENCORE ENCAISSES',
      'DEPOTS NON CREDITES',
    ],
  },
  {
    key: 'totalBalanceA',
    aliases: ['TOTAL BALANCE A', 'TOTAL BALANCE (A)', 'SOLDE TOTAL A', 'TOTAL SOLDE A', 'TOTAL A', 'TOTAL (A)'],
  },
  {
    key: 'checksNotYetCleared',
    aliases: [
      'CHECK NOT YET CLEARED',
      'CHECKS NOT YET CLEARED',
      'CHEQUE NON ENCORE DEBITE',
      'CHEQUES NON ENCORE DEBITES',
      'CHEQUES NON DEBITES',
      'CHEQUES EN CIRCULATION',
      'LESS CHEQUES EMIS NON ENCAISSES',
      'CHEQUES EMIS NON ENCAISSES',
    ],
  },
  {
    key: 'totalB',
    aliases: ['TOTAL B', 'TOTAL (B)'],
  },
  {
    key: 'closingBalance',
    aliases: ['CLOSING BALANCE', 'SOLDE DE CLOTURE', 'SOLDE CLOTURE', 'CLOSING BALANCE C'],
  },
  {
    key: 'bankFacilities',
    aliases: ['BANK FACILITY', 'BANK FACILITIES', 'FACILITE BANCAIRE', 'FACILITES BANCAIRES'],
  },
  {
    key: 'impayes',
    aliases: ['IMPAYE', 'IMPAYES', 'UNPAID', 'UNPAID ITEMS'],
  },
];

export function detectInternalBookWorkbook(
  workbook: XLSX.WorkBook,
  sourceFile = 'workbook.xlsx',
): InternalBookFileDetectionResult {
  const sheetNames = workbook.SheetNames ?? [];
  const detectedDailySheets = sheetNames.filter(isValidDailySheetName);
  const ignoredSheets = sheetNames.filter((sheetName) => !isValidDailySheetName(sheetName));

  if (sheetNames.length === 0) {
    return createResult(false, 'low', 'Workbook has no sheets.', [], [], []);
  }

  if (detectedDailySheets.length === 0) {
    return createResult(false, 'low', 'No valid daily sheet name found.', [], ignoredSheets, []);
  }

  const matches = detectedDailySheets.map((sheetName) => matchSheetSignals(workbook.Sheets[sheetName], sheetName));
  const bestMatch = selectBestMatch(matches);
  const matchedSignals = unique(matches.flatMap((match) => match.signals));

  if (!bestMatch || bestMatch.signals.length === 0) {
    return createResult(
      false,
      'low',
      `No Internal Book section signal found in daily sheets for ${sourceFile}.`,
      detectedDailySheets,
      ignoredSheets,
      matchedSignals,
    );
  }

  const hasEnoughSignals = bestMatch.signals.length >= MINIMUM_SIGNAL_COUNT;
  const hasEnoughCoreSignals = bestMatch.coreSignals.length >= MINIMUM_CORE_SIGNAL_COUNT;
  const isInternalBook = hasEnoughSignals && hasEnoughCoreSignals;
  const confidence = resolveConfidence(bestMatch);

  if (!isInternalBook) {
    return createResult(
      false,
      'low',
      `Daily sheets found, but Internal Book shape is insufficient in ${bestMatch.sheetName}.`,
      detectedDailySheets,
      ignoredSheets,
      matchedSignals,
    );
  }

  return createResult(
    true,
    confidence,
    `Internal Book shape detected in daily sheet ${bestMatch.sheetName}.`,
    detectedDailySheets,
    ignoredSheets,
    matchedSignals,
  );
}

export async function detectInternalBookFile(file: File): Promise<InternalBookFileDetectionResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', raw: true, cellDates: false });
  return detectInternalBookWorkbook(workbook, file.name);
}

function createResult(
  isInternalBook: boolean,
  confidence: 'high' | 'medium' | 'low',
  reason: string,
  detectedDailySheets: string[],
  ignoredSheets: string[],
  matchedSignals: string[],
): InternalBookFileDetectionResult {
  return {
    isInternalBook,
    confidence,
    reason,
    detectedDailySheets,
    ignoredSheets,
    matchedSignals,
  };
}

function matchSheetSignals(worksheet: XLSX.WorkSheet | undefined, sheetName: string): SheetSignalMatch {
  const textContent = extractWorksheetText(worksheet);
  const signals = SIGNAL_DEFINITIONS.filter((definition) =>
    definition.aliases.some((alias) => textContent.includes(normalizeText(alias))),
  ).map((definition) => definition.key);
  const coreSignals = signals.filter((signal) => CORE_SIGNAL_KEYS.has(signal));

  return { sheetName, signals, coreSignals };
}

function extractWorksheetText(worksheet: XLSX.WorkSheet | undefined): string {
  if (!worksheet) {
    return '';
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null });
  return rows
    .flat()
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

function selectBestMatch(matches: SheetSignalMatch[]): SheetSignalMatch | undefined {
  return [...matches].sort((left, right) => {
    if (right.signals.length !== left.signals.length) {
      return right.signals.length - left.signals.length;
    }

    return right.coreSignals.length - left.coreSignals.length;
  })[0];
}

function resolveConfidence(match: SheetSignalMatch): 'high' | 'medium' | 'low' {
  if (match.signals.length >= 6 && match.coreSignals.length >= 3) {
    return 'high';
  }

  if (match.signals.length >= MINIMUM_SIGNAL_COUNT && match.coreSignals.length >= MINIMUM_CORE_SIGNAL_COUNT) {
    return 'medium';
  }

  return 'low';
}

function isValidDailySheetName(sheetName: string): boolean {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(sheetName.trim());
  if (!match) {
    return false;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = 2000 + Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return `${value}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[=()\-_/\\:;,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
