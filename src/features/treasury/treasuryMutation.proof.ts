// Preuve de mordant locale (hors suite de tests) : chaque mutant altère une
// règle critique côté interface, la suite ciblée doit échouer, puis le fichier
// d'origine est rétabli à l'identique (contrôlé). Exécution :
//   npx tsx src/features/treasury/treasuryMutation.proof.ts
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('src/features/treasury');
const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');
const ACCESS = resolve(dir, 'treasuryAccess.synthetic.test.tsx');
const MODEL = resolve(dir, 'treasuryModel.synthetic.test.tsx');
const TARGET = resolve(dir, 'treasuryRuntimeTarget.synthetic.test.ts');

const mutants = [
  {
    name: 't1_production_opened_by_admin_only_flag', file: 'treasuryRuntimeTarget.ts', test: TARGET,
    from: 'export function validateTreasuryRuntimeTarget(input: TreasuryRuntimeInput): TreasuryRuntimeVerdict {\n',
    to: 'export function validateTreasuryRuntimeTarget(input: TreasuryRuntimeInput): TreasuryRuntimeVerdict {\n'
      + "  if ((input as Record<string, string>).productionAdminOnly === 'true') return { allowed: true, environment: 'staging' };\n",
  },
  {
    name: 't2_production_host_not_refused', file: 'treasuryRuntimeTarget.ts', test: TARGET,
    from: 'if (input.projectId === TREASURY_PRODUCTION_PROJECT_REF) {', to: 'if (false) {',
  },
  { name: 't3_read_before_target_check', file: 'treasuryService.ts', test: ACCESS,
    from: 'export async function fetchTreasuryBalances(asOf: string): Promise<TreasuryBalances> {\n  assertTarget();',
    to: 'export async function fetchTreasuryBalances(asOf: string): Promise<TreasuryBalances> {\n  await db.rpc(\'treasury_balances_at_v1\', { p_as_of: asOf });\n  assertTarget();' },
  { name: 't4_admin_call_before_target_check', file: 'treasuryService.ts', test: ACCESS,
    from: 'Promise<AdminResult> {\n  assertTarget();', to: 'Promise<AdminResult> {' },
  { name: 't5_zero_default', file: 'treasuryModel.ts', test: MODEL,
    from: 'if (text === null || text === undefined) return UNAVAILABLE_LABEL;', to: "if (text === null || text === undefined) text = '0';" },
  { name: 't6_partial_as_total', file: 'treasuryModel.ts', test: MODEL,
    from: 'headline: `Sous-total partiel à ${result.as_of}', to: 'headline: `Total à ${result.as_of}' },
  { name: 't7_route_mounts_page_when_refused', file: 'TreasuryRoute.tsx', test: ACCESS,
    from: 'if (isTreasuryRuntimeRefused(verdict)) {', to: 'if (false) {' },
  { name: 't8_menu_always_visible', file: 'treasuryMenu.ts', test: ACCESS,
    from: 'return !isTreasuryRuntimeRefused(currentTreasuryRuntimeVerdict());', to: 'return true;' },
  { name: 't9_response_contract_relaxed', file: 'treasuryModel.ts', test: MODEL,
    from: "if (parsed.success !== true) {", to: "if (false) {" },
  { name: 't10_cache_key_without_user', file: 'treasuryService.ts', test: ACCESS,
    from: "queryKey: ['treasury-balances', userId, asOf] as const,", to: "queryKey: ['treasury-balances', asOf] as const," },
  { name: 't11_cache_kept_after_leaving', file: 'treasuryService.ts', test: ACCESS,
    from: 'gcTime: 0,', to: 'gcTime: 300_000,' },
  { name: 't12_read_without_session', file: 'treasuryService.ts', test: ACCESS,
    from: 'enabled: userId !== null,', to: 'enabled: true,' },
  { name: 't13_new_key_on_each_send', file: 'treasuryService.ts', test: ACCESS,
    from: '      if (known !== undefined) return known;\n', to: '' },
  { name: 't14_server_reason_without_label', file: 'treasuryModel.ts', test: MODEL,
    from: "  DAY_NOT_CLOSED: 'Journée non close lors de l’export',\n", to: '' },
  { name: 't15_pending_key_forgotten_by_other_decision', file: 'treasuryService.ts', test: ACCESS,
    from: '        if (pendingKey === key) pending.delete(signature);', to: '        pending.delete(signature);' },
  { name: 't16_observed_date_shown_as_covered', file: 'treasuryModel.ts', test: MODEL,
    from: 'const covered = account.dates.bank_date_covered;', to: 'const covered = account.dates.bank_date_observed;' },
  { name: 't17_closure_proofs_not_rendered', file: 'TreasuryBalancesView.tsx', test: MODEL,
    from: '{account.sources.map((source, index) =>',
    to: "{account.sources.filter((source) => source.kind === 'CANONICAL_UNIT').map((source, index) =>" },
  { name: 't18_proof_reference_optional', file: 'treasuryModel.ts', test: MODEL,
    from: "kind: z.literal('CLOSURE_LATER_LINE'),\n    export_id: z.string().uuid(),",
    to: "kind: z.literal('CLOSURE_LATER_LINE'),\n    export_id: z.string().uuid().optional()," },
];

let killed = 0;
for (const mutant of mutants) {
  const file = resolve(dir, mutant.file);
  const original = readFileSync(file, 'utf8');
  if (!original.includes(mutant.from)) throw new Error(`MUTANT_TARGET_NOT_FOUND ${mutant.name}`);
  writeFileSync(file, original.replace(mutant.from, mutant.to));
  let survived = false;
  try {
    execFileSync(process.execPath, [tsxCli, '--test', mutant.test], { stdio: 'pipe' });
    survived = true;
  } catch {
    survived = false;
  } finally {
    writeFileSync(file, original);
  }
  if (readFileSync(file, 'utf8') !== original) throw new Error(`RESTORE_FAILED ${mutant.name}`);
  if (survived) throw new Error(`MUTANT_SURVIVED ${mutant.name}`);
  killed += 1;
  console.log(`KILLED ${mutant.name} -> ${mutant.test.split(/[\\/]/).pop()}`);
}
console.log(`TS MUTANTS killed: ${killed} / ${mutants.length}`);
