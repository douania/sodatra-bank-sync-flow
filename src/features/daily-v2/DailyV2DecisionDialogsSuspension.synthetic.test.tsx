import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React from 'react';
import type {
  DailyV2AttemptAttestationRow,
  DailyV2CanonicalUnitRow,
  DailyV2ExportAttemptRow,
  DailyV2RefutationStatusRead,
  DailyV2ServerBatchPlan,
  DailyV2StagingUnitRow,
  DailyV2VersionRefutationRow,
} from './dailyV2Types';

// Formulaires de décision déjà ouverts (contre-revue CTO de 972baaf, P2) :
// lectures qui échouent, deviennent incomplètes ou sont relues ensuite, sujet
// modifié par une relecture complète, journée changée sous un dialogue resté
// monté. Interactions réelles avec les composants : chaque rendu exécute le
// composant et ses sous-composants, les gestionnaires sont ceux du dernier
// rendu (appelés même sur un bouton inactif), l'état local (useState) est
// conservé par position dans l'arbre. Seuls sont remplacés, au chargement des
// deux dialogues (hook de résolution Node) : les lectures (useQuery, pilotées
// par le test, par journée), la mutation (enregistrée, jamais envoyée), les
// services réseau (appels enregistrés), les primitives d'interface (éléments
// HTML simples). Données fictives.

type Props = Record<string, unknown>;
interface HostNode { type: string; props: Props; children: Array<HostNode | string> }
interface Instance { slots: Array<{ value: unknown }> }
interface ReadState { data?: unknown; error?: Error; fetching?: boolean }
interface RecordedMutation { signature?: unknown[]; attemptId?: string; run?: (key: string) => Promise<unknown> }

const ui = {
  instances: new Map<string, Instance>(),
  current: null as Instance | null,
  index: 0,
  reads: new Map<string, ReadState>(),
  mutations: [] as RecordedMutation[],
  calls: [] as Array<{ name: string; args: unknown[] }>,
  fileHash: '',
  useState(init: unknown) {
    const instance = ui.current;
    if (!instance) throw new Error('useState hors rendu');
    const position = ui.index++;
    if (!instance.slots[position]) {
      instance.slots[position] = { value: typeof init === 'function' ? (init as () => unknown)() : init };
    }
    const slot = instance.slots[position];
    const set = (next: unknown) => {
      slot.value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(slot.value) : next;
    };
    return [slot.value, set];
  },
  // Comportement de TanStack Query v5 : une relecture en échec conserve les
  // données précédentes (isError vrai) ; une relecture en cours aussi (isFetching).
  // Lecture propre à une journée (« nom:journée ») sinon commune (« nom »).
  useQuery(options: { queryKey: unknown[]; enabled?: boolean }) {
    const name = String(options.queryKey[1]);
    if (options.enabled === false) {
      return { data: undefined, error: null, isError: false, isLoading: false, isFetching: false };
    }
    const read = ui.reads.get(`${name}:${String(options.queryKey[2])}`) ?? ui.reads.get(name);
    if (!read) return { data: undefined, error: null, isError: false, isLoading: true, isFetching: true };
    return {
      data: read.data, error: read.error ?? null, isError: read.error !== undefined,
      isLoading: read.data === undefined && read.error === undefined, isFetching: read.fetching === true,
    };
  },
  useMutation() {
    return { isPending: false, mutate: (variables: RecordedMutation) => { ui.mutations.push(variables); } };
  },
};
const testGlobal = globalThis as unknown as Record<string, unknown>;
testGlobal.__dv2Ui = ui;
// JSX compilé par tsx en React.createElement : React réel, global pour les dialogues.
testGlobal.React = React;

const stub = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const services = [
  'attestDailyV2Attempt', 'getActiveDailyV2CanonicalUnit', 'getDailyV2AttemptBatchPlan', 'getDailyV2RefutationStatus',
  'listDailyV2AttemptAttestations', 'listDailyV2AttemptsUnits', 'listDailyV2DayDeliveries', 'listDailyV2VersionRefutations',
  'promoteDailyV2AttemptUnits', 'rejectDailyV2Unit', 'refuteDailyV2Version', 'revokeDailyV2AttemptAttestation',
  'revokeDailyV2VersionRefutation', 'supersedeDailyV2UnitBalances',
];
const replacements: Record<string, string> = {
  react: stub('export function useState(init) { return globalThis.__dv2Ui.useState(init); }'),
  '@tanstack/react-query': stub(`export function useQuery(options) { return globalThis.__dv2Ui.useQuery(options); }
    export function useQueryClient() { return { invalidateQueries: async () => {} }; }`),
  './session/dailyV2SessionScope': stub(
    'export function useDailyV2ScopedMutation(options) { return globalThis.__dv2Ui.useMutation(options); }'),
  './dailyV2SupabaseService': stub(services.map((name) =>
    `export async function ${name}(...args) { globalThis.__dv2Ui.calls.push({ name: '${name}', args }); return null; }`).join('\n')
    + '\nexport const dailyV2DecisionCommandKeys = { keyFor: () => "key", succeeded: () => {} };'),
  './dailyV2BrowserPipeline': stub('export async function buildRawBytesHash() { return globalThis.__dv2Ui.fileHash; }'),
  './DailyV2Tables': stub('export const ReviewReasonList = "span";'),
};
const uiPrimitives = stub(`export const Badge = 'span', Button = 'button', Dialog = 'section', DialogContent = 'div',
  DialogDescription = 'p', DialogFooter = 'footer', DialogHeader = 'header', DialogTitle = 'h2', Input = 'input',
  Textarea = 'textarea';`);
register(stub(`
  const replacements = ${JSON.stringify(replacements)};
  const ui = ${JSON.stringify(uiPrimitives)};
  export function resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    if (parent.includes('/src/features/daily-v2/DailyV2DecisionDialogs.tsx')
      || parent.includes('/src/features/daily-v2/DailyV2BatchApprovalDialog.tsx')) {
      if (Object.prototype.hasOwnProperty.call(replacements, specifier)) {
        return { shortCircuit: true, url: replacements[specifier] };
      }
      if (specifier.startsWith('@/components/ui/')) return { shortCircuit: true, url: ui };
    }
    return nextResolve(specifier, context);
  }`));

const { DailyV2DayDecisionsDialog } = await import('./DailyV2DecisionDialogs');
const { DailyV2BatchApprovalDialog } = await import('./DailyV2BatchApprovalDialog');

// --- Rendu : composants exécutés, état conservé par position -----------------
function expand(node: unknown, path: string, seen: Set<string>): Array<HostNode | string> {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => expand(child, `${path}.${(child as { key?: string | null })?.key ?? index}`, seen));
  }
  const element = node as { type: unknown; props: Props };
  if (typeof element.type === 'function') {
    const id = `${path}:${(element.type as { name: string }).name}`;
    seen.add(id);
    const instance = ui.instances.get(id) ?? { slots: [] };
    ui.instances.set(id, instance);
    ui.current = instance;
    ui.index = 0;
    const rendered = (element.type as (props: Props) => unknown)(element.props);
    ui.current = null;
    return expand(rendered, `${id}>`, seen);
  }
  const { children, ...props } = element.props ?? {};
  const expanded = expand(children, `${path}/${String(element.type)}`, seen);
  return typeof element.type === 'string' ? [{ type: element.type, props, children: expanded }] : expanded;
}

function textOf(node: HostNode | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

function findAll(nodes: Array<HostNode | string>, predicate: (node: HostNode) => boolean): HostNode[] {
  return nodes.flatMap((node) => (typeof node === 'string' ? []
    : [...(predicate(node) ? [node] : []), ...findAll(node.children, predicate)]));
}

class Screen {
  tree: Array<HostNode | string> = [];
  constructor(private root: React.ReactElement) { this.render(); }
  /** Nouvelles propriétés du même composant, resté monté (état local conservé). */
  rerender(root: React.ReactElement): this {
    this.root = root;
    return this.render();
  }
  render(): this {
    const seen = new Set<string>();
    this.tree = expand(this.root, 'root', seen);
    for (const id of [...ui.instances.keys()]) if (!seen.has(id)) ui.instances.delete(id);
    return this;
  }
  text(): string { return this.tree.map(textOf).join(' '); }
  /** Libellé exact, ou préfixe s'il se termine par « * ». */
  buttons(label: string, scope: Array<HostNode | string> = this.tree): HostNode[] {
    const matches = (text: string) => (label.endsWith('*') ? text.startsWith(label.slice(0, -1)) : text === label);
    return findAll(scope, (node) => node.type === 'button' && matches(textOf(node).trim()));
  }
  button(label: string, scope?: Array<HostNode | string>): HostNode {
    const found = this.buttons(label, scope);
    assert.equal(found.length, 1, `un seul bouton « ${label} » attendu, ${found.length} trouvé(s)`);
    return found[0];
  }
  labelled(label: string): HostNode {
    const found = findAll(this.tree, (node) => node.props['aria-label'] === label);
    assert.equal(found.length, 1, `un seul élément « ${label} » attendu`);
    return found[0];
  }
  version(closing: string): Array<HostNode | string> {
    const found = findAll(this.tree, (node) => node.props['data-version-retained'] !== undefined
      && textOf(node).includes(`Clôture : ${closing}`));
    assert.equal(found.length, 1, `version de clôture ${closing}`);
    return [found[0]];
  }
  panel(): HostNode | null {
    return findAll(this.tree, (node) => node.props['aria-label'] === 'Décision en cours')[0] ?? null;
  }
  click(label: string, scope?: Array<HostNode | string>): this {
    (this.button(label, scope).props.onClick as () => void)();
    return this.render();
  }
  async change(label: string, target: Record<string, unknown>): Promise<this> {
    await (this.labelled(label).props.onChange as (event: { target: Record<string, unknown> }) => unknown)({ target });
    return this.render();
  }
  check(label: string): this {
    const box = findAll(this.tree, (node) => node.type === 'label' && textOf(node).includes(label))[0];
    assert.ok(box, `case « ${label} »`);
    const input = findAll(box.children, (node) => node.type === 'input')[0];
    (input.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    return this.render();
  }
}

// --- Données fictives : une journée, trois livraisons, un fichier ------------
const DAY = '2026-10-05';
const DAY_ID = 'day-synthetic-2026-10-05';
const ACCOUNT = '20000000-0000-4000-8000-000000000001';
const HA = 'a'.repeat(64);
const HB = 'b'.repeat(64);
const INCOMPLETE = new Error('DAILY_V2_READ_INCOMPLETE');

function attempt(id: string, createdAt: string, overrides: Partial<DailyV2ExportAttemptRow> = {}): DailyV2ExportAttemptRow {
  return {
    id, created_at: createdAt, created_by: null, requested_mode: 'daily', source_format: 'structured_bank_statement_xls',
    bank: 'ATB', currency: 'XOF', account_fingerprint: 'f'.repeat(64), account_registry_id: ACCOUNT,
    account_number_masked: null, source_file_name_redacted: null, raw_text_hash: id.slice(0, 1).repeat(64),
    export_period_start: '2026-10-01', export_period_end: DAY, statement_date: null, export_reference_date: null,
    parser_validation_status: 'valid', errors_count: 0, warnings_count: 0, runtime_version: null,
    parser_version: 'structured-excel-0q/atb-online-xls-v1', ingestion_ready: true, bridge_guard_passed: true,
    period_days: 5, backfill_grant_reference: null, backfill_grant_id: null, review_reason_codes: [], units_total: 1,
    ...overrides,
  };
}

function unit(id: string, attemptId: string, overrides: Partial<DailyV2StagingUnitRow>): DailyV2StagingUnitRow {
  return {
    id, attempt_id: attemptId, day_unit_id: DAY_ID, bank: 'ATB', account_fingerprint: 'f'.repeat(64),
    account_registry_id: ACCOUNT, currency: 'XOF', accounting_date: DAY, day_content_hash: HA, line_count: 1,
    day_total_debits: 0, day_total_credits: 10, opening_balance_derived: 100, closing_balance_derived: 110,
    aggregates_status: 'derived', validation_status: 'valid', review_reason_codes: [], status: 'staged',
    created_at: '2026-10-06T08:00:00+00:00', created_by: null, ...overrides,
  };
}

// Fichier frais de la version retenue (déposé le 20/10), fichier d'un doublon aux
// soldes différents, fichier de la livraison en attente (attestations à poser).
const A_FRESH = attempt('1a000000-0000-4000-8000-000000000001', '2026-10-20T08:00:00+00:00');
const A_DUP = attempt('2a000000-0000-4000-8000-000000000002', '2026-10-07T08:00:00+00:00');
const A_STAGED = attempt('3a000000-0000-4000-8000-000000000003', '2026-10-06T08:00:00+00:00', {
  review_reason_codes: ['ACCOUNT_IDENTITY_NOT_CORROBORATED', 'TRUSTED_CURRENCY_UNCORROBORATED'],
} as Partial<DailyV2ExportAttemptRow>);
const U_PROMOTED = unit('51000000-0000-4000-8000-000000000001', A_FRESH.id, { status: 'promoted', created_at: A_FRESH.created_at });
const U_LATER = unit('51000000-0000-4000-8000-000000000009', A_FRESH.id, {
  status: 'promoted', accounting_date: '2026-10-19', day_unit_id: 'day-synthetic-2026-10-19', created_at: A_FRESH.created_at,
});
const U_DUP = unit('52000000-0000-4000-8000-000000000002', A_DUP.id, {
  status: 'duplicate', opening_balance_derived: 200, closing_balance_derived: 210, created_at: A_DUP.created_at,
});
const U_STAGED = unit('53000000-0000-4000-8000-000000000003', A_STAGED.id, {
  day_content_hash: HB, day_total_credits: 20, closing_balance_derived: 120, created_at: A_STAGED.created_at,
});
const ACTIVE: DailyV2CanonicalUnitRow = {
  id: 'c0000000-0000-4000-8000-000000000001', promoted_from_staging_unit_id: U_PROMOTED.id, day_unit_id: DAY_ID,
  bank: 'ATB', account_fingerprint: 'f'.repeat(64), account_registry_id: ACCOUNT, currency: 'XOF', accounting_date: DAY,
  active_day_content_hash: HA, line_count: 1, day_total_debits: 0, day_total_credits: 10, opening_balance_derived: 100,
  closing_balance_derived: 110, aggregates_status: 'derived', validation_status: 'valid', review_reason_codes: [],
  status: 'ingested', ingested_at: A_FRESH.created_at, ingested_by: null, superseded_by: null, superseded_at: null,
};
const DUP_KEY = `${HA}|derived|200.00|210.00|0.00|10.00`;
const REFUTATION = {
  id: 'r0000000-0000-4000-8000-000000000001', action: 'REFUTE', day_unit_id: DAY_ID, account_registry_id: ACCOUNT,
  accounting_date: DAY, refuted_version_key: DUP_KEY, retained_canonical_unit_id: ACTIVE.id,
  retained_version_key: `${HA}|derived|100.00|110.00|0.00|10.00`, comparison: 'CONTRADICTION', proof_kind: 'FRESH_DELIVERY',
  proof_staging_unit_id: U_PROMOTED.id, proof_bound_day: '2026-10-19', piece_id: null, revokes_id: null,
  after_revocation_id: null, reason: 'Motif synthétique', actor_id: 'actor', created_at: '2026-10-21T08:00:00+00:00',
} as DailyV2VersionRefutationRow;
const CURRENCY_ATTESTATION = {
  id: 'e0000000-0000-4000-8000-000000000001', attempt_id: A_STAGED.id, attestation_type: 'TRUSTED_CURRENCY',
  action: 'ATTEST', raw_text_hash: A_STAGED.raw_text_hash, account_registry_id: ACCOUNT, currency: 'XOF', revokes_id: null,
  after_revocation_id: null, evidence_ref: 'PREUVE-SYNTHETIQUE', reason: 'Motif synthétique', actor_id: 'actor',
  created_at: '2026-10-21T08:00:00+00:00',
} as DailyV2AttemptAttestationRow;
const STATUS: DailyV2RefutationStatusRead = {
  dayUnitId: DAY_ID, verifiable: true, readAt: '2026-11-04T10:00:00Z',
  refutations: [{ refutationId: REFUTATION.id, proofKind: 'FRESH_DELIVERY', state: 'EFFECTIVE', causes: [], uncoveredSources: 0 }],
};
const PLAN: DailyV2ServerBatchPlan = {
  attemptId: A_STAGED.id, maxDays: 31,
  expected: { days: [{ staging_unit_id: U_STAGED.id, day_unit_id: DAY_ID, day_content_hash: HB, canonical_unit_id: ACTIVE.id,
    canonical_content_hash: HA }], attestation_ids: [CURRENCY_ATTESTATION.id] },
  admissible: [{ stagingUnitId: U_STAGED.id, accountingDate: DAY, validationStatus: 'valid', reviewReasonCodes: [] }],
  inadmissible: [],
};

const DAY_READS = ['day-deliveries', 'day-active', 'day-refutations'] as const;

function validReads(): void {
  ui.reads.clear();
  ui.reads.set('day-deliveries', { data: { units: [U_PROMOTED, U_DUP, U_STAGED], attempts: [A_FRESH, A_DUP, A_STAGED] } });
  ui.reads.set('day-active', { data: ACTIVE });
  ui.reads.set('day-refutations', { data: { refutations: [REFUTATION] } });
  ui.reads.set('attestations', { data: [CURRENCY_ATTESTATION] });
  ui.reads.set('refutation-status', { data: STATUS });
  ui.reads.set('fresh-bounds', { data: [U_PROMOTED, U_LATER] });
  ui.reads.set('batch-plan', { data: PLAN });
}

function reset(): void {
  ui.instances.clear();
  ui.mutations.length = 0;
  ui.calls.length = 0;
  ui.fileHash = A_STAGED.raw_text_hash;
  validReads();
}

function dayElement(unitRow: DailyV2StagingUnitRow | null, onBatch: (attemptId: string) => void = () => {}) {
  return React.createElement(DailyV2DayDecisionsDialog, {
    unit: unitRow, onClose: () => {}, canDecide: true, canAdminister: true, onBatch, onChanged: () => {},
  });
}

function dayDialog(): Screen {
  return new Screen(dayElement(U_STAGED));
}

/** Rend une lecture en échec (données précédentes conservées) ou en cours. */
function degrade(name: string, mode: 'error' | 'fetching'): void {
  const read = ui.reads.get(name) ?? {};
  ui.reads.set(name, mode === 'error' ? { ...read, error: INCOMPLETE } : { ...read, fetching: true });
}

function restore(name: string): void {
  const read = ui.reads.get(name) ?? {};
  ui.reads.set(name, { data: read.data });
}

interface ActionCase {
  name: string;
  kind: string;
  submit: string;
  reads: readonly string[];
  open: (screen: Screen) => Promise<Screen>;
}

const reasonOf = (screen: Screen) => screen.change('Raison de la décision', { value: 'Motif synthétique de décision' });

const ACTIONS: ActionCase[] = [
  { name: 'écartement', kind: 'reject', submit: 'Confirmer', reads: DAY_READS,
    open: async (screen) => reasonOf(screen.click('Écarter')) },
  { name: 'correction des seuls soldes', kind: 'balances', submit: 'Confirmer', reads: DAY_READS,
    open: async (screen) => reasonOf(screen.click('Corriger les seuls soldes')) },
  { name: 'révocation de réfutation', kind: 'revoke-refutation', submit: 'Confirmer', reads: DAY_READS,
    open: async (screen) => reasonOf(screen.click('Révoquer la réfutation')) },
  { name: 'réfutation par livraison fraîche', kind: 'refute', submit: 'Réfuter (*', reads: [...DAY_READS, 'fresh-bounds'],
    open: async (screen) => {
      screen.click('Réfuter cette version', screen.version('120.00'));
      await screen.change('Livraison fraîche de la version retenue', { value: U_PROMOTED.id });
      return reasonOf(screen);
    } },
  { name: 'réfutation par pièce corrective', kind: 'refute', submit: 'Réfuter (*', reads: DAY_READS,
    open: async (screen) => {
      screen.click('Réfuter cette version', screen.version('120.00')).click('Pièce corrective');
      await screen.change('Fichier de la pièce corrective', { files: [{ arrayBuffer: async () => new ArrayBuffer(1) }] });
      await screen.change('Référence de la pièce', { value: 'PIECE-SYNTHETIQUE' });
      await screen.change('Référence d’archivage', { value: 'ARCHIVE-SYNTHETIQUE' });
      await screen.change('Date d’émission', { value: '2026-10-21' });
      await screen.change('Ouverture lue sur la pièce', { value: '100.00' });
      await screen.change('Clôture lue sur la pièce', { value: '110.00' });
      await screen.change('Total des débits lu sur la pièce', { value: '0.00' });
      await screen.change('Total des crédits lu sur la pièce', { value: '10.00' });
      return reasonOf(screen.check('J’atteste que cette pièce est archivée'));
    } },
  { name: 'attestation d’identité', kind: 'attest', submit: 'Attester', reads: [...DAY_READS, 'attestations'],
    open: async (screen) => {
      screen.click('Attester l’identité du compte');
      await screen.change('Fichier à resélectionner', { files: [{ arrayBuffer: async () => new ArrayBuffer(1) }] });
      await screen.change('Référence de preuve', { value: 'PREUVE-SYNTHETIQUE' });
      return reasonOf(screen);
    } },
  { name: 'révocation d’attestation', kind: 'revoke-attestation', submit: 'Confirmer', reads: [...DAY_READS, 'attestations'],
    open: async (screen) => reasonOf(screen.click('Révoquer')) },
];

function submitButton(screen: Screen, label: string): HostNode {
  const panel = screen.panel();
  assert.ok(panel, 'le formulaire de décision reste affiché');
  return screen.button(label, [panel]);
}

function press(button: HostNode): void {
  (button.props.onClick as () => void)();
}

test('séquence CTO : « Écarter » ouvert, relecture DAILY_V2_READ_INCOMPLETE, confirmation suspendue', async () => {
  reset();
  const screen = await reasonOf(dayDialog().click('Écarter'));
  assert.equal(submitButton(screen, 'Confirmer').props.disabled, false, 'lecture complète : confirmation possible');

  degrade('day-deliveries', 'error');
  screen.render();
  assert.match(screen.text(), /DAILY_V2_READ_INCOMPLETE Les décisions de la journée sont suspendues/);
  const confirm = submitButton(screen, 'Confirmer');
  assert.equal(confirm.props.disabled, true, 'bouton inactif après la lecture incomplète');
  assert.match(textOf(screen.panel()!), /Décision suspendue/);
  press(confirm);
  screen.render();
  assert.equal(ui.mutations.length, 0, 'le gestionnaire d’envoi n’envoie rien');
  assert.match(screen.text(), /Décision non envoyée/);

  restore('day-deliveries');
  screen.render();
  const again = submitButton(screen, 'Confirmer');
  assert.equal(again.props.disabled, false, 'lecture complète retrouvée : décision de nouveau possible');
  press(again);
  assert.equal(ui.mutations.length, 1);
  assert.equal(ui.mutations[0].signature?.[0], 'reject');
});

for (const action of ACTIONS) {
  test(`formulaire déjà ouvert — ${action.name} : suspendu sur chaque lecture nécessaire en échec ou en cours`, async () => {
    for (const read of action.reads) {
      for (const mode of ['error', 'fetching'] as const) {
        reset();
        const screen = await action.open(dayDialog());
        const label = `${action.name} / ${read} / ${mode}`;
        assert.equal(submitButton(screen, action.submit).props.disabled, false, `${label} : prêt avant la relecture`);

        degrade(read, mode);
        screen.render();
        const suspended = submitButton(screen, action.submit);
        assert.equal(suspended.props.disabled, true, `${label} : envoi inactif`);
        press(suspended);
        assert.equal(ui.mutations.length, 0, `${label} : aucun envoi par le gestionnaire`);

        restore(read);
        screen.render();
        const ready = submitButton(screen, action.submit);
        assert.equal(ready.props.disabled, false, `${label} : de nouveau prêt après une lecture complète`);
        press(ready);
        assert.equal(ui.mutations.length, 1, `${label} : un seul envoi`);
        assert.equal(ui.mutations[0].signature?.[0], action.kind, label);
      }
    }
  });
}

test('formulaire déjà ouvert : versions devenues non calculables après relecture, décision suspendue', async () => {
  reset();
  const screen = await reasonOf(dayDialog().click('Écarter'));
  assert.equal(submitButton(screen, 'Confirmer').props.disabled, false);
  // Relecture réussie mais contexte de source manquant : aucune version calculable.
  ui.reads.set('day-deliveries', { data: { units: [U_PROMOTED, U_DUP, U_STAGED],
    attempts: [A_FRESH, A_DUP, { ...A_STAGED, account_registry_id: null }] } });
  screen.render();
  assert.match(screen.text(), /Versions non calculables localement/);
  const confirm = submitButton(screen, 'Confirmer');
  assert.equal(confirm.props.disabled, true);
  press(confirm);
  assert.equal(ui.mutations.length, 0);
  // « Aucune décision possible » : aucune décision de fichier n'est non plus proposée.
  for (const label of ['Attester l’identité du compte', 'Révoquer', 'Approuver le fichier en groupe']) {
    assert.equal(screen.buttons(label).length, 0, label);
  }
});

test('suspension limitée aux lectures nécessaires : statut des réfutations et attestations sans effet sur l’écartement', async () => {
  reset();
  const screen = await reasonOf(dayDialog().click('Écarter'));
  degrade('refutation-status', 'error');
  degrade('attestations', 'error');
  screen.render();
  assert.match(screen.text(), /L’effectivité actuelle des réfutations n’est pas vérifiable/);
  assert.match(screen.text(), /Les attestations et l’approbation groupée sont suspendues/);
  const confirm = submitButton(screen, 'Confirmer');
  assert.equal(confirm.props.disabled, false, 'l’écartement ne dépend ni du statut des réfutations ni des attestations');
  press(confirm);
  assert.equal(ui.mutations.length, 1);
});

test('approbation groupée déjà ouverte : plan relu en échec ou en cours, confirmation suspendue', async () => {
  for (const mode of ['error', 'fetching'] as const) {
    reset();
    const screen = new Screen(React.createElement(DailyV2BatchApprovalDialog, {
      attemptId: A_STAGED.id, onClose: () => {}, canDecide: true, onChanged: () => {},
    }));
    await screen.change('Raison de l’approbation groupée', { value: 'Motif synthétique de décision' });
    assert.equal(screen.button('Confirmer l’approbation*').props.disabled, false);

    degrade('batch-plan', mode);
    screen.render();
    const confirm = screen.button('Confirmer l’approbation*');
    assert.equal(confirm.props.disabled, true, mode);
    press(confirm);
    assert.equal(ui.mutations.length, 0, mode);

    restore('batch-plan');
    screen.render();
    press(screen.button('Confirmer l’approbation*'));
    assert.equal(ui.mutations.length, 1, mode);
    assert.equal(ui.mutations[0].attemptId, A_STAGED.id);
  }
});

test('approbation groupée : le gestionnaire d’envoi applique la même condition que le bouton', async () => {
  reset();
  const screen = new Screen(React.createElement(DailyV2BatchApprovalDialog, {
    attemptId: A_STAGED.id, onClose: () => {}, canDecide: true, onChanged: () => {},
  }));
  const confirm = screen.button('Confirmer l’approbation*');
  assert.equal(confirm.props.disabled, true, 'raison absente');
  press(confirm);
  assert.equal(ui.mutations.length, 0, 'aucun envoi sans raison');
});

// --- Journée changée sous un dialogue resté monté (relecture indépendante) ---
const DAY_B_ID = 'day-synthetic-2026-10-06';
const A_B = attempt('4a000000-0000-4000-8000-000000000004', '2026-10-07T09:00:00+00:00');
const U_B = unit('54000000-0000-4000-8000-000000000004', A_B.id, {
  day_unit_id: DAY_B_ID, accounting_date: '2026-10-06', created_at: A_B.created_at,
});

function dayBReads(): void {
  ui.reads.set(`day-deliveries:${DAY_B_ID}`, { data: { units: [U_B], attempts: [A_B] } });
  ui.reads.set(`day-active:${DAY_B_ID}`, { data: null });
  ui.reads.set(`day-refutations:${DAY_B_ID}`, { data: { refutations: [] } });
}

test('formulaire ouvert sur une journée, puis approbation groupée et autre journée : rien d’affiché ni d’envoyable', async () => {
  reset();
  dayBReads();
  const batches: string[] = [];
  const screen = new Screen(dayElement(U_STAGED, (attemptId) => batches.push(attemptId)));
  await reasonOf(screen.click('Révoquer la réfutation'));
  assert.ok(screen.panel(), 'formulaire ouvert sur la première journée');
  // La page ferme le dialogue (unité nulle) et ouvre l'approbation groupée, puis une autre journée.
  screen.click('Approuver le fichier en groupe');
  assert.deepEqual(batches, [A_STAGED.id]);
  screen.rerender(dayElement(null));
  screen.rerender(dayElement(U_B));
  assert.equal(screen.buttons('Écarter').length, 1, 'lectures complètes de la seconde journée');
  assert.equal(screen.panel(), null, 'aucun formulaire de la première journée');
  assert.equal(screen.buttons('Confirmer').length, 0);
  // Retour à la première journée : le formulaire abandonné ne réapparaît pas.
  screen.rerender(dayElement(null));
  screen.rerender(dayElement(U_STAGED));
  assert.equal(screen.panel(), null, 'formulaire abandonné au passage à l’approbation groupée');
  assert.equal(ui.mutations.length, 0);
});

test('dialogue resté monté et journée changée sans fermeture : le formulaire de l’autre journée n’est ni affiché ni envoyable', async () => {
  reset();
  dayBReads();
  const screen = await reasonOf(dayDialog().click('Révoquer la réfutation'));
  assert.equal(submitButton(screen, 'Confirmer').props.disabled, false);
  screen.rerender(dayElement(U_B));
  assert.equal(screen.buttons('Écarter').length, 1, 'lectures complètes de la seconde journée');
  assert.equal(screen.panel(), null);
  assert.equal(screen.buttons('Confirmer').length, 0);
  assert.equal(ui.mutations.length, 0);
});

// --- Sujet modifié par une relecture complète de la même journée -------------
const REVOKED_REFUTATION = { ...REFUTATION, id: 'r0000000-0000-4000-8000-000000000002', action: 'REVOKE',
  revokes_id: REFUTATION.id } as DailyV2VersionRefutationRow;
const IDENTITY_ATTESTATION = { ...CURRENCY_ATTESTATION, id: 'e0000000-0000-4000-8000-000000000002',
  attestation_type: 'ACCOUNT_IDENTITY' } as DailyV2AttemptAttestationRow;
const REVOKED_ATTESTATION = { ...CURRENCY_ATTESTATION, id: 'e0000000-0000-4000-8000-000000000003', action: 'REVOKE',
  revokes_id: CURRENCY_ATTESTATION.id } as DailyV2AttemptAttestationRow;
const deliveriesWith = (units: DailyV2StagingUnitRow[]) => ({ data: { units, attempts: [A_FRESH, A_DUP, A_STAGED] } });

const SUBJECT_CHANGES: Array<{ action: string; change: string; apply: () => void }> = [
  { action: 'écartement', change: 'livraison écartée entre-temps',
    apply: () => ui.reads.set('day-deliveries', deliveriesWith([U_PROMOTED, U_DUP, { ...U_STAGED, status: 'rejected' }])) },
  { action: 'écartement', change: 'statut passé de staged à needs_review (toujours en attente)',
    apply: () => ui.reads.set('day-deliveries', deliveriesWith([U_PROMOTED, U_DUP, { ...U_STAGED, status: 'needs_review' }])) },
  { action: 'correction des seuls soldes', change: 'soldes de la livraison déjà retenus',
    apply: () => ui.reads.set('day-active', { data: { ...ACTIVE, opening_balance_derived: 200, closing_balance_derived: 210 } }) },
  { action: 'correction des seuls soldes', change: 'version retenue changée, livraison toujours candidate',
    apply: () => ui.reads.set('day-active', { data: { ...ACTIVE, opening_balance_derived: 300, closing_balance_derived: 310 } }) },
  { action: 'réfutation par pièce corrective', change: 'version retenue changée, version toujours réfutable',
    apply: () => ui.reads.set('day-active', { data: { ...ACTIVE, opening_balance_derived: 200, closing_balance_derived: 210 } }) },
  { action: 'révocation de réfutation', change: 'réfutation déjà révoquée',
    apply: () => ui.reads.set('day-refutations', { data: { refutations: [REFUTATION, REVOKED_REFUTATION] } }) },
  { action: 'réfutation par livraison fraîche', change: 'livraisons de la version remplacées',
    apply: () => ui.reads.set('day-deliveries', deliveriesWith([U_PROMOTED, U_DUP, { ...U_STAGED, status: 'superseded' }])) },
  { action: 'réfutation par pièce corrective', change: 'version devenue la version retenue',
    apply: () => ui.reads.set('day-active', { data: { ...ACTIVE, active_day_content_hash: HB, day_total_credits: 20,
      closing_balance_derived: 120 } }) },
  { action: 'attestation d’identité', change: 'identité attestée entre-temps',
    apply: () => ui.reads.set('attestations', { data: [CURRENCY_ATTESTATION, IDENTITY_ATTESTATION] }) },
  { action: 'révocation d’attestation', change: 'attestation déjà révoquée',
    apply: () => ui.reads.set('attestations', { data: [CURRENCY_ATTESTATION, REVOKED_ATTESTATION] }) },
];

for (const subject of SUBJECT_CHANGES) {
  test(`formulaire déjà ouvert — ${subject.action} : ${subject.change} (lecture complète), décision suspendue`, async () => {
    const action = ACTIONS.find((candidate) => candidate.name === subject.action);
    assert.ok(action, subject.action);
    reset();
    const screen = await action.open(dayDialog());
    assert.equal(submitButton(screen, action.submit).props.disabled, false, 'prêt avant la relecture');
    subject.apply();
    screen.render();
    const suspended = submitButton(screen, action.submit);
    assert.equal(suspended.props.disabled, true, 'envoi inactif');
    const notice = findAll([screen.panel()!], (node) => node.props.role === 'alert');
    assert.ok(notice.some((node) => /sujet de cette décision a changé/.test(textOf(node))), 'cause annoncée');
    press(suspended);
    assert.equal(ui.mutations.length, 0, 'aucun envoi par le gestionnaire');
  });
}

test('attestation ouverte, puis autre livraison de la même journée affichée : fichier différent, décision suspendue', async () => {
  const attest = ACTIONS.find((candidate) => candidate.name === 'attestation d’identité')!;
  reset();
  const screen = await attest.open(dayDialog());
  assert.equal(submitButton(screen, attest.submit).props.disabled, false);
  screen.rerender(dayElement(U_DUP));
  const suspended = submitButton(screen, attest.submit);
  assert.equal(suspended.props.disabled, true, 'le fichier affiché n’est plus celui du formulaire');
  press(suspended);
  assert.equal(ui.mutations.length, 0);
});

test('réfutation : la version retenue visée est celle de l’ouverture', async () => {
  const refute = ACTIONS.find((candidate) => candidate.name === 'réfutation par pièce corrective')!;
  reset();
  const screen = await refute.open(dayDialog());
  press(submitButton(screen, refute.submit));
  assert.equal(ui.mutations.length, 1);
  await ui.mutations[0].run!('cle-synthetique');
  const sent = ui.calls.find((call) => call.name === 'refuteDailyV2Version')?.args[1] as { expectedRetainedVersionKey: string };
  assert.equal(sent.expectedRetainedVersionKey, `${HA}|derived|100.00|110.00|0.00|10.00`);
});

test('réfutation : sources lues à jour — nouvelle source justifiée transmise, nouvelle source non justifiée bloquante', async () => {
  const refute = ACTIONS.find((candidate) => candidate.name === 'réfutation par livraison fraîche')!;
  const newSource = (createdAt: string) => {
    const file = attempt('5a000000-0000-4000-8000-000000000005', createdAt);
    const delivery = { ...U_STAGED, id: '55000000-0000-4000-8000-000000000005', attempt_id: file.id, created_at: createdAt };
    ui.reads.set('day-deliveries', { data: { units: [U_PROMOTED, U_DUP, U_STAGED, delivery],
      attempts: [A_FRESH, A_DUP, A_STAGED, file] } });
  };

  reset();
  let screen = await refute.open(dayDialog());
  newSource('2026-10-08T08:00:00+00:00');
  screen.render();
  const ready = submitButton(screen, refute.submit);
  assert.equal(ready.props.disabled, false, 'deux sources, toutes deux antérieures à la borne');
  press(ready);
  assert.equal(ui.mutations.length, 1);
  await ui.mutations[0].run!('cle-synthetique');
  const sent = ui.calls.find((call) => call.name === 'refuteDailyV2Version')?.args[1] as { expectedSources: unknown[] };
  assert.equal(sent.expectedSources.length, 2, 'sources de la lecture actuelle, pas celles de l’ouverture');

  reset();
  screen = await refute.open(dayDialog());
  newSource('2026-10-25T08:00:00+00:00');
  screen.render();
  const blocked = submitButton(screen, refute.submit);
  assert.equal(blocked.props.disabled, true, 'nouvelle source postérieure à la borne : non justifiée');
  press(blocked);
  assert.equal(ui.mutations.length, 0);
});
