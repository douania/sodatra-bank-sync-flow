export interface PositionedPdfTextItem {
  str?: string;
  transform?: readonly number[];
  width?: number;
  hasEOL?: boolean;
}

interface PositionedToken {
  text: string;
  x: number;
  y: number;
  width?: number;
  index: number;
}

const FINANCIAL_TOKEN = /^[+-]?\d[\d \u00a0\u202f,.]*$/;

export function reconstructPdfTextLines(
  items: readonly unknown[],
  yTolerance = 2,
): string {
  const positioned: PositionedToken[] = [];
  const textItems = items.flatMap<PositionedPdfTextItem>(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as PositionedPdfTextItem;
    return typeof candidate.str === 'string' && candidate.str.trim() ? [candidate] : [];
  });

  textItems.forEach((item, index) => {
    const text = item.str?.trim();
    if (!text) return;
    const x = item.transform?.[4];
    const y = item.transform?.[5];

    if (Number.isFinite(x) && Number.isFinite(y)) {
      positioned.push({
        text,
        x: Number(x),
        y: Number(y),
        width: Number.isFinite(item.width) ? Number(item.width) : undefined,
        index,
      });
    }
  });

  if (textItems.length === 0) return '';

  if (positioned.length !== textItems.length) {
    throw new Error('PDF_TEXT_POSITION_INCOMPLETE: reconstruction financière ambiguë.');
  }

  if (positioned.length > 0) {
    const lines: PositionedToken[][] = [];
    for (const token of positioned.sort((a, b) => b.y - a.y || a.x - b.x || a.index - b.index)) {
      const line = lines.find(candidate => Math.abs(candidate[0].y - token.y) <= yTolerance);
      if (line) line.push(token);
      else lines.push([token]);
    }
    return lines.map(line => {
      const ordered = line.sort((a, b) => a.x - b.x || a.index - b.index);
      return ordered.reduce((rendered, token, index) => {
        if (index === 0) return token.text;
        const previous = ordered[index - 1];
        const previousEnd = previous.width === undefined ? undefined : previous.x + previous.width;
        const gap = previousEnd === undefined ? undefined : token.x - previousEnd;
        const adjacentFinancialTokens = FINANCIAL_TOKEN.test(previous.text) && FINANCIAL_TOKEN.test(token.text);
        if (adjacentFinancialTokens && (gap === undefined || gap <= 2)) {
          throw new Error('PDF_NUMERIC_TOKEN_BOUNDARY_AMBIGUOUS: colonnes financières non séparables.');
        }
        const separator = (adjacentFinancialTokens || (gap !== undefined && gap > 12)) ? '\t' : ' ';
        return `${rendered}${separator}${token.text}`;
      }, '');
    }).join('\n');
  }

  return '';
}
