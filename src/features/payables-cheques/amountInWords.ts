// Montant en lettres (français, XOF entier) — miroir exact de
// payables_private.amount_in_words_fr. Le serveur reste la source qui fait foi
// pour le contenu signable ; ce module sert à l'aperçu et aux tests de parité.

const UNITS = [
  '', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
] as const;
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'] as const;

export const MAX_AMOUNT_IN_WORDS = 999_999_999_999;

export class AmountInWordsRangeError extends Error {
  constructor() {
    super('PAYABLES_AMOUNT_WORDS_RANGE');
    this.name = 'AmountInWordsRangeError';
  }
}

function wordsBelow100(n: number, final: boolean): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const t = Math.floor(n / 10);
  const r = n % 10;
  if (t >= 2 && t <= 6) {
    if (r === 0) return TENS[t];
    if (r === 1) return `${TENS[t]} et un`;
    return `${TENS[t]}-${UNITS[r]}`;
  }
  if (t === 7) {
    if (r === 1) return 'soixante et onze';
    return `soixante-${wordsBelow100(10 + r, final)}`;
  }
  if (t === 8) {
    if (r === 0) return final ? 'quatre-vingts' : 'quatre-vingt';
    return `quatre-vingt-${UNITS[r]}`;
  }
  return `quatre-vingt-${wordsBelow100(10 + r, final)}`;
}

function wordsBelow1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return wordsBelow100(r, final);
  const head = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 && final ? 's' : ''}`;
  return r === 0 ? head : `${head} ${wordsBelow100(r, final)}`;
}

/** Montant entier positif ou nul, borné à 999 999 999 999. */
export function amountInWordsFr(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT_IN_WORDS) {
    throw new AmountInWordsRangeError();
  }
  if (amount === 0) return 'zéro';
  const billions = Math.floor(amount / 1_000_000_000);
  const millions = Math.floor(amount / 1_000_000) % 1000;
  const thousands = Math.floor(amount / 1000) % 1000;
  const rest = amount % 1000;
  const parts: string[] = [];
  if (billions > 0) parts.push(billions === 1 ? 'un milliard' : `${wordsBelow1000(billions, true)} milliards`);
  if (millions > 0) parts.push(millions === 1 ? 'un million' : `${wordsBelow1000(millions, true)} millions`);
  if (thousands > 0) parts.push(thousands === 1 ? 'mille' : `${wordsBelow1000(thousands, false)} mille`);
  if (rest > 0) parts.push(wordsBelow1000(rest, true));
  return parts.join(' ');
}

/** Libellé imprimé : montant en lettres suivi du suffixe du profil validé. */
export function chequeAmountWords(amount: number, suffix: string, wordsCase: 'UPPER' | 'AS_IS'): string {
  const text = `${amountInWordsFr(amount)} ${suffix}`;
  return wordsCase === 'UPPER' ? text.toUpperCase() : text;
}

/** Regroupement des chiffres par milliers, identique à payables_private.group_digits. */
export function groupDigits(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new AmountInWordsRangeError();
  return String(amount).replace(/\B(?=(\d{3})+$)/g, ' ');
}
