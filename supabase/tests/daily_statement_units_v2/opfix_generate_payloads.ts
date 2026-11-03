/**
 * Lot 1 opérationnel — GÉNÉRATEUR DE CHARGES RÉELLES (TESTS UNIQUEMENT).
 * Fait passer les classeurs synthétiques de `dailyV2OperationalFixtures` par le
 * VRAI pipeline `prepareDailyV2BrowserDeposit`, puis émet les quatre arguments
 * RPC exacts dans `opx.payloads`. Aucune donnée réelle, aucun réseau, aucun secret.
 * Usage : tsx supabase/tests/daily_statement_units_v2/opfix_generate_payloads.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { prepareOperationalPayloads } from '../../../src/features/daily-v2/dailyV2OperationalFixtures.synthetic';
import {
  dailyV2CompareVersions,
  dailyV2VersionCoherent,
  dailyV2VersionKey,
  type DailyV2VersionFacts,
} from '../../../src/features/daily-v2/dailyV2Types';

function literal(value: unknown, tag: string): string {
  const text = JSON.stringify(value);
  if (text.includes(`$${tag}$`)) throw new Error('dollar-quote collision');
  return `$${tag}$${text}$${tag}$::jsonb`;
}

// Test différentiel : les règles de version de l'interface (dailyV2Types)
// face aux fonctions du serveur, sur des cas pseudo-aléatoires déterministes.
// Valeurs synthétiques, colonnes numeric(18,2) comme les vraies.
function parityCases(count: number): string {
  let seed = 0x5eed1234;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(values: T[]): T => values[Math.floor(rand() * values.length)];
  const amounts = [0, 10, 10.5, 20, 30.5, 100, 99.99, -5.25, 1000000.01, 123456789.12];
  const facts = (): DailyV2VersionFacts => {
    const aggregates = pick(['derived', 'derived', 'derived', 'unavailable']);
    const debits = rand() < 0.03 ? null : pick(amounts.filter((value) => value >= 0));
    const credits = rand() < 0.03 ? null : pick(amounts.filter((value) => value >= 0));
    const opening = aggregates === 'unavailable' && rand() < 0.85 ? null : pick(amounts);
    let closing: number | null = aggregates === 'unavailable' && rand() < 0.85 ? null : pick(amounts);
    if (aggregates === 'derived' && opening !== null && debits !== null && credits !== null && rand() < 0.7) {
      closing = Math.round((opening + credits - debits) * 100) / 100;
    }
    return { hash: pick(['a'.repeat(64), 'b'.repeat(64)]), aggregates, opening, closing, debits, credits };
  };
  const sqlAmount = (value: number | null) => (value === null ? 'NULL' : `'${value.toFixed(2)}'`);
  const rows: string[] = [];
  for (let n = 1; n <= count; n += 1) {
    const w = facts();
    let r = facts();
    if (rand() < 0.45) {
      // Variante proche : même version, ou un seul fait modifié.
      r = { ...w };
      const field = pick(['none', 'hash', 'opening', 'closing', 'debits', 'credits', 'both-totals']);
      if (field === 'hash') r.hash = w.hash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
      if (field === 'opening' || field === 'closing') r[field] = pick(amounts);
      if (field === 'debits' || field === 'credits') r[field] = pick(amounts.filter((value) => value >= 0));
      if (field === 'both-totals' && w.debits !== null && w.credits !== null) {
        // Autres mouvements, même net : ventilation différente.
        r.hash = w.hash === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
        r.debits = Math.round((w.debits + 5) * 100) / 100;
        r.credits = Math.round((w.credits + 5) * 100) / 100;
      }
    }
    const args = (f: DailyV2VersionFacts) => `'${f.hash}', '${f.aggregates}', ${sqlAmount(f.opening)}, ${sqlAmount(f.closing)}, `
      + `${sqlAmount(f.debits)}, ${sqlAmount(f.credits)}`;
    rows.push(`(${n}, ${args(w)}, ${args(r)}, '${dailyV2CompareVersions(w, r)}', '${dailyV2VersionKey(w)}', `
      + `${dailyV2VersionCoherent(w)})`);
  }
  return [
    '-- Parité interface / serveur des règles de version (générée).',
    'CREATE TABLE opx.version_parity (n integer PRIMARY KEY,',
    '  wh text, wa text, wo numeric(18,2), wc numeric(18,2), wd numeric(18,2), wk numeric(18,2),',
    '  rh text, ra text, ro numeric(18,2), rc numeric(18,2), rd numeric(18,2), rk numeric(18,2),',
    '  expected_comparison text, expected_key text, expected_coherent boolean);',
    `INSERT INTO opx.version_parity VALUES\n${rows.join(',\n')};`,
  ].join('\n');
}

async function main(): Promise<void> {
  const outDir = argv[2];
  if (!outDir) {
    console.error('GENERATOR_FAILED: outDir argument is required.');
    exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const payloads = await prepareOperationalPayloads();
  const rows: string[] = [
    '-- Charges produites par le pipeline réel (générées, jamais écrites à la main).',
    'CREATE SCHEMA IF NOT EXISTS opx;',
    'CREATE TABLE IF NOT EXISTS opx.payloads (key text PRIMARY KEY, attempt jsonb NOT NULL, units jsonb NOT NULL,',
    '  lines jsonb NOT NULL, guard jsonb NOT NULL);',
  ];
  for (const [key, result] of payloads) {
    const p = result.payload;
    rows.push(`INSERT INTO opx.payloads VALUES ('${key}', ${literal(p.p_attempt, 'A')}, ${literal(p.p_units, 'U')}, `
      + `${literal(p.p_lines, 'L')}, ${literal(p.p_guard_context, 'G')});`);
  }
  writeFileSync(join(outDir, 'opfix_payloads.sql'), rows.join('\n') + '\n');
  console.log(`OPFIX_PAYLOADS ${payloads.size} scenarios generated by the real pipeline`);
  writeFileSync(join(outDir, 'opfix_version_parity.sql'), parityCases(2000) + '\n');
  console.log('OPFIX_VERSION_PARITY cases generated from the interface rules');
}

main().catch((error) => {
  console.error(`GENERATOR_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  exit(1);
});
