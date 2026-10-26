// Lecture des corpus de parité écrits dans les fichiers de test SQL (tests
// uniquement). Les tuples sont des littéraux SQL simples : texte '…' ou E'…',
// nombre, ou NULL.

export type SqlCorpusValue = string | number | null;

function parseSqlLiteral(token: string): SqlCorpusValue {
  const trimmed = token.trim();
  if (/^NULL$/i.test(trimmed)) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const escaped = /^E'(.*)'$/s.exec(trimmed);
  if (escaped) {
    return escaped[1]
      .replace(/''/g, "'")
      .replace(/\\t/g, '\t')
      .replace(/\\n/g, '\n')
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\\/g, '\\');
  }
  const plain = /^'(.*)'$/s.exec(trimmed);
  if (plain) return plain[1].replace(/''/g, "'");
  throw new Error(`Unsupported SQL literal in corpus: ${trimmed}`);
}

function splitTuple(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "'") {
      if (inString && body[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inString = !inString;
    }
    if (ch === ',' && !inString) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Extrait les tuples situés entre `-- <MARKER>-BEGIN` et `-- <MARKER>-END`. */
export function readSqlCorpus(sql: string, marker: string): SqlCorpusValue[][] {
  const begin = sql.indexOf(`-- ${marker}-BEGIN`);
  const end = sql.indexOf(`-- ${marker}-END`);
  if (begin < 0 || end < begin) throw new Error(`Corpus markers ${marker} not found`);
  const block = sql.slice(begin, end);
  const tuples: SqlCorpusValue[][] = [];
  const tupleRe = /^\s*\((.*)\)\s*[,;]\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = tupleRe.exec(block)) !== null) {
    tuples.push(splitTuple(match[1]).map(parseSqlLiteral));
  }
  if (tuples.length === 0) throw new Error(`Corpus ${marker} is empty`);
  return tuples;
}
