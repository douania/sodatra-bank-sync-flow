// Mise en page de la formule à partir du profil d'impression VALIDÉ renvoyé par
// le serveur. Seuls les champs à remplir sont positionnés (en millimètres) ; le
// fond de la formule préimprimée n'est jamais reproduit, aucune signature non plus.

export const PRINTED_FIELD_KEYS = ['beneficiary', 'amount_figures', 'amount_words', 'issue_date', 'place'] as const;
export type PrintedFieldKey = (typeof PRINTED_FIELD_KEYS)[number];

export interface PrintFieldBox {
  x_mm: number;
  y_mm: number;
  max_chars: number;
  lines?: number;
  line_gap_mm?: number;
}

export interface PrintProfilePayload {
  profile_code: string;
  bank: string;
  page: { width_mm: number; height_mm: number };
  font: { family: string; size_pt: number };
  offset: { x_mm: number; y_mm: number };
  fields: Record<PrintedFieldKey, PrintFieldBox>;
  place_label: string;
  amount_words_suffix: string;
  amount_words_case: 'UPPER' | 'AS_IS';
  printer_model: string;
}

export interface ChequeContentFields {
  account: string;
  cheque_number: string;
  currency: string;
  beneficiary: string;
  amount: string;
  amount_figures: string;
  amount_words: string;
  amount_words_lines: string[];
  issue_date: string;
  issue_date_text: string;
  place: string;
  profile_code: string;
  profile_version_id: string;
}

export interface PositionedText {
  key: string;
  text: string;
  x_mm: number;
  y_mm: number;
}

export type ChequeLayoutResult =
  | {
      ok: true;
      page: { width_mm: number; height_mm: number };
      font: { family: string; size_pt: number };
      items: PositionedText[];
    }
  | { ok: false; reason: 'PAYABLES_PRINT_LAYOUT_OVERFLOW' | 'PAYABLES_PRINT_PROFILE_INVALID' };

// Type guard explicite : le projet n'est pas en mode strict et le rétrécissement
// d'union sur `!result.ok` n'y est pas fiable (docs/BASELINES.md §3).
export function isLayoutFailure(result: ChequeLayoutResult): result is Extract<ChequeLayoutResult, { ok: false }> {
  return result.ok === false;
}

export const PRINT_ROOT_CLASS = 'payables-cheque-print-root';

/** Feuille d'impression : seuls les champs du calque sont visibles, page au format du profil. */
export function chequePrintCss(widthMm: number, heightMm: number): string {
  return `@media print {
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  body * { visibility: hidden !important; }
  .${PRINT_ROOT_CLASS}, .${PRINT_ROOT_CLASS} * { visibility: visible !important; }
  .${PRINT_ROOT_CLASS} { position: fixed; left: 0; top: 0; border: none !important; box-shadow: none !important; }
}`;
}

/** Découpage glouton par mots, identique à payables_private.wrap_words. */
export function wrapWords(text: string, maxChars: number): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > maxChars) return null;
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= maxChars) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isProfilePayload(value: unknown): value is PrintProfilePayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<PrintProfilePayload>;
  if (!p.page || !finiteInRange(p.page.width_mm, 50, 300) || !finiteInRange(p.page.height_mm, 30, 300)) return false;
  if (!p.font || !finiteInRange(p.font.size_pt, 6, 16) || typeof p.font.family !== 'string') return false;
  if (!p.offset || !finiteInRange(p.offset.x_mm, -20, 20) || !finiteInRange(p.offset.y_mm, -20, 20)) return false;
  if (!p.fields) return false;
  return PRINTED_FIELD_KEYS.every((key) => {
    const box = p.fields?.[key];
    return box && finiteInRange(box.x_mm, 0, 300) && finiteInRange(box.y_mm, 0, 300) && finiteInRange(box.max_chars, 4, 120);
  });
}

/**
 * Positionne les champs imprimés. Le texte vient exclusivement du contenu
 * signable produit par le serveur ; le contrôle de débordement est rejoué ici
 * pour qu'aucun aperçu ne montre un texte tronqué.
 */
export function layoutCheque(fields: ChequeContentFields, profile: unknown): ChequeLayoutResult {
  if (!isProfilePayload(profile)) return { ok: false, reason: 'PAYABLES_PRINT_PROFILE_INVALID' };
  const dx = profile.offset.x_mm;
  const dy = profile.offset.y_mm;
  const single: Array<[PrintedFieldKey, string]> = [
    ['beneficiary', fields.beneficiary],
    ['amount_figures', fields.amount_figures],
    ['issue_date', fields.issue_date_text],
    ['place', fields.place],
  ];
  const items: PositionedText[] = [];
  for (const [key, text] of single) {
    const box = profile.fields[key];
    if (text.length > box.max_chars) return { ok: false, reason: 'PAYABLES_PRINT_LAYOUT_OVERFLOW' };
    items.push({ key, text, x_mm: box.x_mm + dx, y_mm: box.y_mm + dy });
  }
  const wordsBox = profile.fields.amount_words;
  const lines = wrapWords(fields.amount_words, wordsBox.max_chars);
  const maxLines = wordsBox.lines ?? 1;
  if (lines === null || lines.length > maxLines) return { ok: false, reason: 'PAYABLES_PRINT_LAYOUT_OVERFLOW' };
  // Le découpage serveur fait foi ; une divergence est un contenu incohérent.
  if (JSON.stringify(lines) !== JSON.stringify(fields.amount_words_lines)) {
    return { ok: false, reason: 'PAYABLES_PRINT_PROFILE_INVALID' };
  }
  lines.forEach((text, index) => {
    items.push({
      key: `amount_words_${index + 1}`,
      text,
      x_mm: wordsBox.x_mm + dx,
      y_mm: wordsBox.y_mm + dy + index * (wordsBox.line_gap_mm ?? 0),
    });
  });
  return { ok: true, page: profile.page, font: profile.font, items };
}
