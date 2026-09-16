/**
 * Règle déterministe des dates textuelles (Pack 2) :
 * - `JJ/MM/AAAA` ou `JJ-MM-AAAA` : jour en premier ;
 * - `AAAA-MM-JJ` : ISO ;
 * - `JJ/MM/AA` ou `JJ-MM-AA` : jour en premier, année `AA` = 2000 + AA
 *   (les libellés de solde des rapports réels sont saisis ainsi) ;
 * - toute autre forme (jour ou mois sur un chiffre, `M/D/YY` de SheetJS,
 *   texte) est refusée : une date de cellule Excel doit être convertie depuis
 *   son numéro de série (voir `excelSheetGrid`), jamais depuis son rendu.
 */
export function parseDocumentDate(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const french = cleaned.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  const frenchShortYear = cleaned.match(/^(\d{2})[/-](\d{2})[/-](\d{2})$/);
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (french) {
    day = Number(french[1]);
    month = Number(french[2]);
    year = Number(french[3]);
  } else if (frenchShortYear) {
    day = Number(frenchShortYear[1]);
    month = Number(frenchShortYear[2]);
    year = 2000 + Number(frenchShortYear[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseFinancialInteger(value: string | undefined): number | null {
  if (!value) return null;
  if (/[\r\n\t]/.test(value)) return null;
  const trimmed = value.trim();
  if (/[ \u00a0\u202f]/.test(trimmed)) {
    const groupedInteger = /^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+$/;
    if (!groupedInteger.test(trimmed)) return null;
  }
  const compact = trimmed.replace(/[ \u00a0\u202f]/g, '');
  if (!/^[+-]?\d+(?:[.,]\d+)*$/.test(compact)) return null;

  const sign = compact.startsWith('-') ? -1 : 1;
  const unsigned = compact.replace(/^[+-]/, '');
  let digits: string;

  if (!/[.,]/.test(unsigned)) {
    digits = unsigned;
  } else {
    const separators = new Set(unsigned.match(/[.,]/g));
    const lastSeparatorIndex = Math.max(unsigned.lastIndexOf(','), unsigned.lastIndexOf('.'));
    const fractional = unsigned.slice(lastSeparatorIndex + 1);

    if (separators.size > 1) {
      if (fractional.length < 1 || fractional.length > 2 || !/^0+$/.test(fractional)) return null;
      const integerPart = unsigned.slice(0, lastSeparatorIndex);
      const thousandsSeparator = integerPart.includes(',') ? ',' : '.';
      const thousandsGroups = integerPart.split(thousandsSeparator);
      if (
        thousandsGroups[0].length < 1
        || thousandsGroups[0].length > 3
        || !thousandsGroups.slice(1).every(group => group.length === 3)
      ) return null;
      digits = thousandsGroups.join('');
    } else {
      const groups = unsigned.split(/[.,]/);
      if (groups.length > 2 || fractional.length === 3) {
        if (groups[0].length < 1 || groups[0].length > 3) return null;
        if (!groups.slice(1).every(group => group.length === 3)) return null;
        digits = groups.join('');
      } else {
        if (fractional.length < 1 || fractional.length > 2 || !/^0+$/.test(fractional)) return null;
        digits = groups[0];
      }
    }
  }

  const parsed = sign * Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function hasStructuredLines(text: string, minimumNonEmptyLines = 2): boolean {
  return text.split(/\r?\n/).filter(line => line.trim().length > 0).length >= minimumNonEmptyLines;
}
