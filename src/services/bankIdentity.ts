export type OperationalBankCode = 'BDK' | 'ATB' | 'BICIS' | 'ORA' | 'SGBS' | 'BIS';

interface BankIdentityDefinition {
  code: OperationalBankCode;
  namePatterns: readonly RegExp[];
  contentPatterns: readonly RegExp[];
}

export function normalizeBankIdentityText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BANK_IDENTITIES: readonly BankIdentityDefinition[] = [
  {
    code: 'BDK',
    namePatterns: [/\bBDK\b/, /\bBANQUE DE DAKAR\b/],
    contentPatterns: [/\bBDK\b/, /\bBANQUE DE DAKAR\b/],
  },
  {
    code: 'ATB',
    namePatterns: [/\bATB\b/, /\bARAB TUNISIAN BANK\b/, /\bBANQUE ATLANTIQUE\b/],
    contentPatterns: [/\bATB\b/, /\bARAB TUNISIAN BANK\b/, /\bBANQUE ATLANTIQUE\b/],
  },
  {
    code: 'BICIS',
    namePatterns: [/\bBICIS\b/],
    contentPatterns: [/\bBICIS\b/, /\bBANQUE INTERNATIONALE POUR LE COMMERCE ET L INDUSTRIE DU SENEGAL\b/],
  },
  {
    code: 'ORA',
    namePatterns: [/\bORA\b/, /\bORABANK\b/, /\bORA BANK\b/],
    contentPatterns: [/\bORA\b/, /\bORABANK\b/, /\bORA BANK\b/],
  },
  {
    code: 'SGBS',
    namePatterns: [/\bSGBS\b/, /\bSGS\b/, /\bSOCIETE GENERALE\b/],
    contentPatterns: [/\bSGBS\b/, /\bSGS\b/, /\bSOCIETE GENERALE\b/],
  },
  {
    code: 'BIS',
    namePatterns: [/\bBIS\b/, /\bBANQUE ISLAMIQUE DU SENEGAL\b/, /\bBANQUE ISLAMIQUE\b/],
    contentPatterns: [/\bBIS\b/, /\bBANQUE ISLAMIQUE DU SENEGAL\b/, /\bBANQUE ISLAMIQUE\b/],
  },
] as const;

function detectBank(value: string, patterns: 'namePatterns' | 'contentPatterns'): OperationalBankCode | null {
  const normalized = normalizeBankIdentityText(value);
  const matches = BANK_IDENTITIES.filter(bank => bank[patterns].some(pattern => pattern.test(normalized)));
  return matches.length === 1 ? matches[0].code : null;
}

export function detectBankFromFileName(fileName: string): OperationalBankCode | null {
  return detectBank(fileName.replace(/\.[^.]+$/, ''), 'namePatterns');
}

export function detectBankFromContent(content: string): OperationalBankCode | null {
  return detectBank(content, 'contentPatterns');
}

export interface BankIdentityCorroboration {
  bank: OperationalBankCode | null;
  nameBank: OperationalBankCode | null;
  contentBank: OperationalBankCode | null;
  corroborated: boolean;
  error?: string;
}

export function corroborateBankIdentity(fileName: string, content: string): BankIdentityCorroboration {
  const nameBank = detectBankFromFileName(fileName);
  const contentBank = detectBankFromContent(content);

  if (!nameBank) {
    return { bank: null, nameBank, contentBank, corroborated: false, error: 'Banque absente ou ambiguë dans le nom du fichier.' };
  }
  if (!contentBank) {
    return { bank: null, nameBank, contentBank, corroborated: false, error: 'Banque absente ou ambiguë dans le contenu du document.' };
  }
  if (nameBank !== contentBank) {
    return {
      bank: null,
      nameBank,
      contentBank,
      corroborated: false,
      error: `Banque incohérente entre le nom (${nameBank}) et le contenu (${contentBank}).`,
    };
  }

  return { bank: nameBank, nameBank, contentBank, corroborated: true };
}

export const OPERATIONAL_BANK_CODES = BANK_IDENTITIES.map(bank => bank.code);
