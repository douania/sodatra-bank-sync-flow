export type OperationalBankCode = 'BDK' | 'ATB' | 'BICIS' | 'ORA' | 'SGBS' | 'BIS';

interface BankIdentityDefinition {
  code: OperationalBankCode;
  namePatterns: readonly RegExp[];
  contentPatterns: readonly RegExp[];
}

export function normalizeBankIdentityText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Alias strictement listés (Pack 2). Toute variante absente de cette liste est
 * refusée : aucune détection floue.
 */
const BANK_IDENTITIES: readonly BankIdentityDefinition[] = [
  {
    code: 'BDK',
    namePatterns: [/\bBDK\b/, /\bBANQUE DE DAKAR\b/],
    contentPatterns: [/\bBDK\b/, /\bBANQUE DE DAKAR\b/],
  },
  {
    code: 'ATB',
    namePatterns: [
      /\bATB\b/,
      /\bARAB TUNISIAN BANK\b/,
      /\bBANQUE ATLANTIQUE\b/,
      /\bATLANTIQUE BANK\b/,
      /\bATLANTIK BANK\b/,
    ],
    contentPatterns: [
      /\bATB\b/,
      /\bARAB TUNISIAN BANK\b/,
      /\bBANQUE ATLANTIQUE\b/,
      /\bATLANTIQUE BANK\b/,
    ],
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

/**
 * Nombre de lignes non vides constituant l'en-tête d'identité d'un document
 * texte : titre (émetteur), en-têtes de colonnes, ligne du solde d'ouverture.
 * Un rapport bancaire réel cite d'autres banques dès ses premières lignes de
 * données (chèques et dépôts tirés sur d'autres établissements) : seul
 * l'émetteur déclaré dans ces trois lignes fait foi. Sur une grille Excel,
 * l'extracteur tabulaire utilise les lignes précédant le solde d'ouverture.
 */
export const BANK_IDENTITY_HEADER_LINE_COUNT = 3;

function detectBank(value: string, patterns: 'namePatterns' | 'contentPatterns'): OperationalBankCode | null {
  const normalized = normalizeBankIdentityText(value);
  const matches = BANK_IDENTITIES.filter(bank => bank[patterns].some(pattern => pattern.test(normalized)));
  return matches.length === 1 ? matches[0].code : null;
}

export function detectBankFromFileName(fileName: string): OperationalBankCode | null {
  return detectBank(fileName.replace(/\.[^.]+$/, ''), 'namePatterns');
}

/** Détection sur la totalité d'un contenu : unicité exigée sur tout le texte. */
export function detectBankFromContent(content: string): OperationalBankCode | null {
  return detectBank(content, 'contentPatterns');
}

/** Lignes non vides de l'en-tête d'identité (les premières lignes du document). */
export function identityHeaderLines(content: string, lineCount = BANK_IDENTITY_HEADER_LINE_COUNT): string[] {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, lineCount);
}

/**
 * Détection sur l'en-tête seul : exactement une banque doit y figurer.
 * Zéro banque ou plusieurs banques dans l'en-tête = identité non établie.
 */
export function detectBankFromHeader(content: string): OperationalBankCode | null {
  return detectBank(identityHeaderLines(content).join('\n'), 'contentPatterns');
}

/** Banques citées dans l'en-tête (diagnostic d'ambiguïté, sans valeur). */
export function banksMentionedInHeader(content: string): OperationalBankCode[] {
  const normalized = normalizeBankIdentityText(identityHeaderLines(content).join('\n'));
  return BANK_IDENTITIES
    .filter(bank => bank.contentPatterns.some(pattern => pattern.test(normalized)))
    .map(bank => bank.code);
}

export interface BankIdentityCorroboration {
  bank: OperationalBankCode | null;
  nameBank: OperationalBankCode | null;
  contentBank: OperationalBankCode | null;
  corroborated: boolean;
  error?: string;
}

/**
 * Corroboration nom de fichier × émetteur d'en-tête. Le corps du document
 * n'intervient pas : il peut citer d'autres banques sans invalider l'identité.
 */
export function corroborateBankIdentity(fileName: string, content: string): BankIdentityCorroboration {
  const nameBank = detectBankFromFileName(fileName);
  const contentBank = detectBankFromHeader(content);

  if (!nameBank) {
    return { bank: null, nameBank, contentBank, corroborated: false, error: 'Banque absente ou ambiguë dans le nom du fichier.' };
  }
  if (!contentBank) {
    const mentioned = banksMentionedInHeader(content);
    return {
      bank: null,
      nameBank,
      contentBank,
      corroborated: false,
      error: mentioned.length > 1
        ? `Banque ambiguë dans l’en-tête du document (${mentioned.join(', ')}).`
        : 'Banque absente ou ambiguë dans l’en-tête du document.',
    };
  }
  if (nameBank !== contentBank) {
    return {
      bank: null,
      nameBank,
      contentBank,
      corroborated: false,
      error: `Banque incohérente entre le nom (${nameBank}) et l’en-tête (${contentBank}).`,
    };
  }

  return { bank: nameBank, nameBank, contentBank, corroborated: true };
}

export const OPERATIONAL_BANK_CODES = BANK_IDENTITIES.map(bank => bank.code);
