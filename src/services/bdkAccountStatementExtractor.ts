export interface BDKAccountStatementValidation {
  calculatedClosing: number;
  isValid: boolean;
  discrepancy: number;
}

export interface BDKAccountStatementExtractionResult {
  success: boolean;
  reportDate?: string;
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  validation: BDKAccountStatementValidation;
  errors: string[];
}

interface ExtractedAmount {
  amount: number;
  found: boolean;
}

interface ExtractedClosing extends ExtractedAmount {
  reportDate?: string;
}

const AMOUNT_GROUP_PATTERN = /\d+/g;

export function extractBDKAccountStatement(textContent: string): BDKAccountStatementExtractionResult {
  const normalizedText = normalizeText(textContent);
  const opening = extractOpeningBalance(normalizedText);
  const totals = extractTotals(normalizedText);
  const closing = extractClosingBalance(normalizedText);
  const errors: string[] = [];

  if (!opening.found) {
    errors.push('Missing openingBalance from Solde initial (XOF).');
  }

  if (!totals.found) {
    errors.push('Missing totalDebits and totalCredits from Total line.');
  }

  if (!closing.found) {
    errors.push('Missing closingBalance from Solde (XOF) au date line.');
  }

  const calculatedClosing = opening.amount + totals.totalCredits - totals.totalDebits;
  const discrepancy = calculatedClosing - closing.amount;
  const isValid = Math.abs(discrepancy) < 1;

  if (opening.found && totals.found && closing.found && !isValid) {
    errors.push('Account statement balance validation failed.');
  }

  return {
    success: opening.found && totals.found && closing.found && isValid,
    reportDate: closing.reportDate,
    openingBalance: opening.amount,
    totalDebits: totals.totalDebits,
    totalCredits: totals.totalCredits,
    closingBalance: closing.amount,
    validation: {
      calculatedClosing,
      isValid,
      discrepancy
    },
    errors
  };
}

function extractOpeningBalance(textContent: string): ExtractedAmount {
  const match = textContent.match(/\bsolde initial\s*\(\s*xof\s*\)\s*:?\s*([\d ]+)/i);
  return extractMatchedAmount(match?.[1]);
}

function extractClosingBalance(textContent: string): ExtractedClosing {
  const match = textContent.match(/\bsolde\s*\(\s*xof\s*\)\s*au\s*(\d{2}\/\d{2}\/\d{4})\s*:?\s*([\d ]+)/i);
  const amount = extractMatchedAmount(match?.[2]);

  return {
    ...amount,
    reportDate: match?.[1]
  };
}

function extractTotals(textContent: string): { found: boolean; totalDebits: number; totalCredits: number } {
  const totalMatch = textContent.match(/\btotal\b([\s\S]*?)(?=\bsolde\s*\(\s*xof\s*\)\s*au\b|$)/i);
  const amountGroups = totalMatch?.[1].match(AMOUNT_GROUP_PATTERN) ?? [];
  const amountPair = splitAmountGroups(amountGroups);

  if (!amountPair) {
    return {
      found: false,
      totalDebits: 0,
      totalCredits: 0
    };
  }

  return {
    found: true,
    totalDebits: parseAmountGroups(amountPair[0]),
    totalCredits: parseAmountGroups(amountPair[1])
  };
}

function extractMatchedAmount(value: string | undefined): ExtractedAmount {
  if (!value) {
    return {
      amount: 0,
      found: false
    };
  }

  const amountGroups = value.match(AMOUNT_GROUP_PATTERN) ?? [];
  if (!isValidAmountGroups(amountGroups)) {
    return {
      amount: 0,
      found: false
    };
  }

  return {
    amount: parseAmountGroups(amountGroups),
    found: true
  };
}

function splitAmountGroups(groups: string[]): [string[], string[]] | undefined {
  let bestPair: [string[], string[]] | undefined;
  let bestScore = -1;

  for (let splitAt = 1; splitAt < groups.length; splitAt++) {
    const totalDebits = groups.slice(0, splitAt);
    const totalCredits = groups.slice(splitAt);

    if (!isValidAmountGroups(totalDebits) || !isValidAmountGroups(totalCredits)) {
      continue;
    }

    const score = scoreAmountGroups(totalDebits) + scoreAmountGroups(totalCredits);
    if (score > bestScore) {
      bestPair = [totalDebits, totalCredits];
      bestScore = score;
    }
  }

  return bestPair;
}

function isValidAmountGroups(groups: string[]): boolean {
  if (groups.length === 0) {
    return false;
  }

  if (groups.length === 1) {
    return /^\d+$/.test(groups[0]);
  }

  return /^\d{1,3}$/.test(groups[0])
    && !/^0+$/.test(groups[0])
    && groups.slice(1).every((group) => /^\d{3}$/.test(group));
}

function scoreAmountGroups(groups: string[]): number {
  return groups.length > 1 ? groups.length + 1 : 1;
}

function parseAmountGroups(groups: string[]): number {
  return Number.parseInt(groups.join(''), 10) || 0;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ');
}
