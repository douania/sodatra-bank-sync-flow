import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React from 'react';
import type { DailyV2AccountRegistryRow, DailyV2StagingUnitRow } from '../features/daily-v2/dailyV2Types';
import { createDailyV2SessionLifetime } from '../features/daily-v2/session/dailyV2SessionLifetime';

// Page Daily v2 (pack DAILY-V2-BDK-ORABANK-OPERATIONAL-READINESS) : interactions réelles avec la page.
// Chaque rendu exécute la page et ses sous-composants ; les gestionnaires sont ceux du dernier rendu
// (appelés même sur un bouton inactif, pour prouver la garde de l'action elle-même) ; l'état local est
// conservé par position. Le VRAI pipeline navigateur prépare les fichiers fictifs (analyse, empreintes,
// statuts demandés). Sont remplacés au chargement de la page (hook de résolution Node) : les services
// réseau (appels enregistrés, réponses fictives), les lectures/mutations TanStack (mini-cache piloté par
// le test), la session, la cible d'exécution, les dialogues Lot 1 (props enregistrées) et les primitives
// d'interface (éléments HTML simples). Données fictives uniquement.

type Props = Record<string, unknown>;
interface HostNode { type: string; props: Props; children: Array<HostNode | string> }
interface Instance { slots: Array<{ value: unknown; deps?: unknown[] }> }
interface CacheEntry {
  status: 'pending' | 'success' | 'error'; data?: unknown; error?: unknown; fetching: boolean;
  /** Relecture en attente du réseau (TanStack « paused » : isFetching faux, données et statut inchangés). */
  paused?: boolean;
  queryFn: () => Promise<unknown>; promise: Promise<void>;
}

const ui = {
  instances: new Map<string, Instance>(),
  current: null as Instance | null,
  index: 0,
  effects: [] as Array<() => void>,
  cache: new Map<string, CacheEntry>(),
  pending: new Set<Promise<unknown>>(),
  calls: [] as Array<{ name: string; args: unknown[] }>,
  toasts: [] as Array<{ kind: string; message: string }>,
  dropzone: null as null | { onDrop: (files: unknown[]) => void },
  roles: ['admin'] as string[],
  accounts: [] as DailyV2AccountRegistryRow[],
  staging: (_input: Record<string, unknown>) => ({ rows: [] as DailyV2StagingUnitRow[], count: 0 }),
  /** Échec de la lecture du registre de la revue (toutes banques), pour l'état « registre indisponible ». */
  reviewRegistryFails: false,
  /** Barrière optionnelle de la lecture du registre de la revue : la relecture reste en cours tant qu'elle n'est pas levée. */
  reviewRegistryGate: null as Promise<void> | null,
  /** Unité canonical active renvoyée au supersede (fictive). */
  activeCanonical: null as null | { id: string },
  /** Barrière optionnelle du dépôt RPC : le dépôt reste en cours tant qu'elle n'est pas levée. */
  depositGate: null as Promise<void> | null,
  /** Barrière optionnelle des RPC de décision (promotion, supersede) : la décision reste en cours tant qu'elle n'est pas levée. */
  decisionGate: null as Promise<void> | null,
  /** Nombre de prochaines RPC de décision qui échouent (erreur fictive), pour éprouver la reprise après échec. */
  decisionFailures: 0,
  async decide(name: string, result: unknown): Promise<unknown> {
    if (ui.decisionGate) await ui.decisionGate;
    if (ui.decisionFailures > 0) {
      ui.decisionFailures--;
      throw new Error(`échec fictif de ${name}`);
    }
    return result;
  },
  versionsUnit: undefined as unknown,
  batchAttemptId: undefined as unknown,
  slot(init: unknown) {
    const instance = ui.current;
    if (!instance) throw new Error('hook hors rendu');
    const position = ui.index++;
    if (!instance.slots[position]) instance.slots[position] = { value: typeof init === 'function' ? (init as () => unknown)() : init };
    return instance.slots[position];
  },
  dirty: false,
  useState(init: unknown) {
    const slot = ui.slot(init);
    return [slot.value, (next: unknown) => {
      const value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(slot.value) : next;
      if (!Object.is(value, slot.value)) ui.dirty = true;
      slot.value = value;
    }];
  },
  useRef(init: unknown) {
    const slot = ui.slot(() => ({ current: init }));
    return slot.value;
  },
  // Effet sans tableau de dépendances : exécuté après chaque rendu, comme React.
  useEffect(effect: () => void, deps?: unknown[]) {
    const slot = ui.slot(undefined);
    const changed = deps === undefined || !slot.deps || slot.deps.length !== deps.length
      || slot.deps.some((value, index) => !Object.is(value, deps[index]));
    if (changed) {
      if (deps !== undefined) slot.deps = deps;
      ui.effects.push(effect);
    }
  },
  track<T>(promise: Promise<T>): Promise<T> {
    ui.pending.add(promise);
    void promise.finally(() => ui.pending.delete(promise)).catch(() => {});
    return promise;
  },
  // Mini-cache TanStack v5 : une lecture par clé ; une invalidation relance la lecture en CONSERVANT les données
  // précédentes (isFetching vrai pendant la relecture), comme TanStack.
  fetchEntry(entry: CacheEntry) {
    entry.fetching = true;
    entry.promise = ui.track(Promise.resolve().then(() => entry.queryFn()).then(
      (data) => { entry.status = 'success'; entry.data = data; entry.error = undefined; entry.fetching = false; },
      (error) => { entry.status = 'error'; entry.error = error; entry.fetching = false; },
    ));
  },
  useQuery(options: { queryKey: unknown[]; queryFn: () => Promise<unknown>; enabled?: boolean }) {
    const idle = { data: undefined, error: null, isError: false, isLoading: false, isPending: false, isFetching: false, isPaused: false, refetch: () => {} };
    if (options.enabled === false) return idle;
    const key = JSON.stringify(options.queryKey);
    let entry = ui.cache.get(key);
    if (!entry) {
      entry = { status: 'pending', fetching: false, queryFn: options.queryFn, promise: Promise.resolve() };
      ui.cache.set(key, entry);
      ui.fetchEntry(entry);
    }
    entry.queryFn = options.queryFn;
    const current = entry;
    return {
      data: current.data, error: current.error ?? null, isError: current.status === 'error',
      isLoading: current.status === 'pending', isPending: current.status === 'pending', isFetching: current.fetching,
      isPaused: current.paused === true,
      refetch: () => { if (!current.fetching) ui.fetchEntry(current); },
    };
  },
  invalidate(prefix: unknown[]) {
    for (const [key, entry] of ui.cache) {
      const parsed = JSON.parse(key) as unknown[];
      if (prefix.every((part, index) => JSON.stringify(parsed[index]) === JSON.stringify(part)) && !entry.fetching) ui.fetchEntry(entry);
    }
  },
  // Mini-mutation TanStack v5 (5.59.16, Mutation.execute et MutationObserver) : `isPending` est une valeur de rendu,
  // figée dans les gestionnaires jusqu'au rendu suivant ; deux `mutate` lancent deux exécutions ; onSuccess puis
  // onSettled du hook (ou, si l'un échoue, onError puis onSettled) sont attendus AVANT la fin de l'état « pending » ;
  // les rappels passés à l'appel (`mutate(variables, rappels)`) sont ceux de l'observateur, appelés à cette fin, page
  // montée, sans le filtre de portée de session appliqué aux rappels du hook.
  useMutation(options: {
    mutationFn: (variables: unknown) => Promise<unknown>;
    onSuccess?: (data: unknown, variables: unknown) => unknown;
    onError?: (error: unknown, variables: unknown) => unknown;
    onSettled?: (data: unknown, error: unknown, variables: unknown) => unknown;
  }) {
    const slot = ui.slot(false);
    return {
      isPending: slot.value === true,
      mutate: (variables: unknown, call?: {
        onSuccess?: (data: unknown, variables: unknown) => unknown;
        onError?: (error: unknown, variables: unknown) => unknown;
        onSettled?: (data: unknown, error: unknown, variables: unknown) => unknown;
      }) => {
        slot.value = true;
        ui.track((async () => {
          let data: unknown;
          let failure: { error: unknown } | null = null;
          try {
            await Promise.resolve();
            data = await options.mutationFn(variables);
            await options.onSuccess?.(data, variables);
            await options.onSettled?.(data, null, variables);
          } catch (error) {
            failure = { error };
            await options.onError?.(error, variables);
            await options.onSettled?.(undefined, error, variables);
          } finally {
            slot.value = false;
          }
          if (failure) { call?.onError?.(failure.error, variables); call?.onSettled?.(undefined, failure.error, variables); }
          else { call?.onSuccess?.(data, variables); call?.onSettled?.(data, null, variables); }
        })());
      },
    };
  },
  /** Portée de session réelle (`dailyV2SessionScope.ts` exécuté tel quel) : durée de vie réelle, activée au montage. */
  scope: null as null | { lifetime: ReturnType<typeof createDailyV2SessionLifetime> },
};
const testGlobal = globalThis as unknown as Record<string, unknown>;
testGlobal.__dv2Page = ui;
testGlobal.React = React;

const stub = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const recordingService = (name: string, result: string) =>
  `export async function ${name}(...args) { globalThis.__dv2Page.calls.push({ name: '${name}', args }); return ${result}; }`;
const serviceStub = [
  `export class DailyV2ServiceError extends Error { constructor(message, safeCode) { super(message); this.safeCode = safeCode; } }`,
  `export function getDailyV2AccountOpaqueIdentity(account) { return account.account_fingerprint; }`,
  recordingService('getDailyV2MutationsEnabled', 'true'),
  `export async function listDailyV2Accounts(...args) {
    globalThis.__dv2Page.calls.push({ name: 'listDailyV2Accounts', args });
    if (globalThis.__dv2Page.reviewRegistryGate && !args[0].bank) await globalThis.__dv2Page.reviewRegistryGate;
    if (globalThis.__dv2Page.reviewRegistryFails && !args[0].bank) throw new Error('lecture du registre en échec (fictif)');
    return globalThis.__dv2Page.accounts.filter((a) => (!args[0].bank || a.bank === args[0].bank)
      && (!args[0].currency || a.currency === args[0].currency) && (args[0].includeInactive || a.status === 'active'));
  }`,
  recordingService('listDailyV2StagingUnits', '({ ...globalThis.__dv2Page.staging(args[0]), page: args[0].page, pageSize: args[0].pageSize })'),
  recordingService('listDailyV2CanonicalUnits', '({ rows: [], count: 0, page: 0, pageSize: 20 })'),
  recordingService('listDailyV2AuditEvents', '({ rows: [], count: 0, page: 0, pageSize: 20 })'),
  recordingService('listDailyV2AccountEvents', '({ rows: [], count: 0, page: 0, pageSize: 20 })'),
  recordingService('listDailyV2BackfillGrants', '[]'),
  recordingService('listDailyV2StagingLines', '[]'),
  recordingService('listDailyV2CanonicalLines', '[]'),
  recordingService('getActiveDailyV2CanonicalUnit', 'globalThis.__dv2Page.activeCanonical'),
  `export async function preIngestDailyV2WithIncrementalDelta(...args) {
    globalThis.__dv2Page.calls.push({ name: 'preIngestDailyV2WithIncrementalDelta', args });
    if (globalThis.__dv2Page.depositGate) await globalThis.__dv2Page.depositGate;
    return { outcome: 'deposited', response: { attempt_id: '40000000-0000-4000-8000-000000000001', requested_mode: 'daily', units: [] }, incrementalDelta: null };
  }`,
  `export async function promoteDailyV2Unit(...args) {
    globalThis.__dv2Page.calls.push({ name: 'promoteDailyV2Unit', args });
    return globalThis.__dv2Page.decide('promoteDailyV2Unit', { outcome: 'promoted' });
  }`,
  `export async function supersedeDailyV2Unit(...args) {
    globalThis.__dv2Page.calls.push({ name: 'supersedeDailyV2Unit', args });
    return globalThis.__dv2Page.decide('supersedeDailyV2Unit', { outcome: 'superseded' });
  }`,
  `export async function provisionDailyV2Account(...args) {
    globalThis.__dv2Page.calls.push({ name: 'provisionDailyV2Account', args });
    const account = { ...globalThis.__dv2Page.accounts[0], id: '20000000-0000-4000-8000-0000000000c1',
      safe_alias: args[0].safeAlias, account_number_masked: null, account_fingerprint: '9'.repeat(64) };
    globalThis.__dv2Page.accounts.push(account);
    return account;
  }`,
  ...['deactivateDailyV2Account', 'issueDailyV2BackfillGrant', 'revokeDailyV2BackfillGrant']
    .map((name) => recordingService(name, 'null')),
].join('\n');

const pageReplacements: Record<string, string> = {
  react: stub(`export function useState(init) { return globalThis.__dv2Page.useState(init); }
    export function useRef(init) { return globalThis.__dv2Page.useRef(init); }
    export function useEffect(effect, deps) { return globalThis.__dv2Page.useEffect(effect, deps); }
    export function useLayoutEffect(effect, deps) { return globalThis.__dv2Page.useEffect(effect, deps); }
    export function useCallback(fn) { return fn; }`),
  'react-dropzone': stub(`export function useDropzone(options) { globalThis.__dv2Page.dropzone = options;
    return { getRootProps: () => ({}), getInputProps: () => ({}) }; }`),
  '@tanstack/react-query': stub(`export function useQuery(options) { return globalThis.__dv2Page.useQuery(options); }
    export function useQueryClient() { return { invalidateQueries: async ({ queryKey }) => { globalThis.__dv2Page.invalidate(queryKey); } }; }`),
  'lucide-react': stub(`export const Loader2 = 'i', ShieldCheck = 'i', Upload = 'i';`),
  '@/contexts/AuthContext': stub(`export function useAuth() { return { user: { id: '50000000-0000-4000-8000-000000000001' }, loading: false }; }`),
  '@/components/ui/sonner': stub(`export const toast = {
    success: (message) => { globalThis.__dv2Page.toasts.push({ kind: 'success', message }); },
    error: (message) => { globalThis.__dv2Page.toasts.push({ kind: 'error', message }); } };`),
  '@/features/daily-v2/dailyV2SupabaseService': stub(serviceStub),
  '@/features/daily-v2/DailyV2DecisionDialogs': stub(
    `export function DailyV2DayDecisionsDialog(props) { globalThis.__dv2Page.versionsUnit = props.unit; return null; }`),
  '@/features/daily-v2/DailyV2BatchApprovalDialog': stub(
    `export function DailyV2BatchApprovalDialog(props) { globalThis.__dv2Page.batchAttemptId = props.attemptId; return null; }`),
  '@/features/daily-v2/DailyV2Reporting': stub('export default function DailyV2Reporting() { return null; }'),
  '@/features/daily-v2/DailyV2AdminControlsGate': stub(
    'export function DailyV2AdminControlsGate(props) { return props.allowed ? props.renderControls() : null; }'),
  '@/features/daily-v2/dailyV2Access': stub(`export function useDailyV2Access() {
    return { roles: globalThis.__dv2Page.roles, accessState: { status: 'allowed' } }; }`),
  '@/features/daily-v2/session/DailyV2SessionBoundary': stub('export function DailyV2SessionBoundary(props) { return props.children; }'),
  '@/features/daily-v2/session/dailyV2SessionPresentation': stub(`export function dailyV2BuildVersionLabel() { return 'build'; }
    export function dailyV2SessionLabel() { return 'session'; }
    export function dailyV2RuntimeLockPresentation() { return { title: 'verrou', label: 'ouvert' }; }`),
  '@/config/buildProvenance': stub('export function currentBuildProvenance() { return {}; }'),
  '@/features/daily-v2/session/DailyV2AccessFeedback': stub('export function DailyV2AccessFeedback() { return null; }'),
  '@/features/daily-v2/dailyV2RuntimeTarget': stub(`const all = { read: true, deposit: true, promote: true, admin: true };
    export function currentDailyV2Capabilities() { return all; }
    export function currentDailyV2RuntimeTargetVerdict() { return { allowed: true, projectRef: 'synthetic-staging' }; }
    export function isDailyV2ProductionPilotProject() { return false; }
    export function applyDailyV2RuntimeMutationLock(capabilities, enabled) {
      return enabled === true ? capabilities : { ...capabilities, deposit: false, promote: false, admin: false }; }
    export function resolveDailyV2ImportPermissions(canDeposit, target, effective) {
      return { canPrepareLocally: canDeposit && target.deposit, canPersist: canDeposit && effective.deposit }; }`),
};
const uiPrimitives = stub(`export const Alert = 'div', AlertDescription = 'div', AlertTitle = 'strong', Badge = 'span',
  Button = 'button', Card = 'div', CardContent = 'div', CardDescription = 'p', CardHeader = 'div', CardTitle = 'h3',
  DialogContent = 'div', DialogDescription = 'p', DialogFooter = 'footer', DialogHeader = 'header', DialogTitle = 'h2',
  Input = 'input', Label = 'label', Select = 'select', SelectContent = 'div', SelectItem = 'option', SelectTrigger = 'button',
  SelectValue = 'span', Tabs = 'div', TabsContent = 'section', TabsList = 'nav', TabsTrigger = 'span', Textarea = 'textarea',
  Table = 'table', TableBody = 'tbody', TableCell = 'td', TableHead = 'th', TableHeader = 'thead', TableRow = 'tr';
  export function Dialog(props) { return props.open ? props.children : null; }`);
register(stub(`
  const replacements = ${JSON.stringify(pageReplacements)};
  const ui = ${JSON.stringify(uiPrimitives)};
  const lucide = ${JSON.stringify(stub(`export const AlertCircle = 'i', Eye = 'i', Loader2 = 'i';`))};
  const scopeReact = ${JSON.stringify(stub(`export function createContext(value) { return { value }; }
    export function useContext() { return globalThis.__dv2Page.scope; }`))};
  const scopeQuery = ${JSON.stringify(stub(`export class QueryClient { constructor(options) { this.options = options; } }
    export function useMutation(options) { return globalThis.__dv2Page.useMutation(options); }`))};
  export function resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    if (parent.includes('/src/pages/DailyStatementV2.tsx')) {
      if (Object.prototype.hasOwnProperty.call(replacements, specifier)) return { shortCircuit: true, url: replacements[specifier] };
      if (specifier.startsWith('@/components/ui/')) return { shortCircuit: true, url: ui };
    }
    // Portée de session réelle : seuls son contexte React et la mutation TanStack sont fournis par le harnais.
    if (parent.includes('/src/features/daily-v2/session/dailyV2SessionScope.ts')) {
      if (specifier === 'react') return { shortCircuit: true, url: scopeReact };
      if (specifier === '@tanstack/react-query') return { shortCircuit: true, url: scopeQuery };
    }
    if (parent.includes('/src/features/daily-v2/DailyV2Tables.tsx')) {
      if (specifier.startsWith('@/components/ui/')) return { shortCircuit: true, url: ui };
      if (specifier === 'lucide-react') return { shortCircuit: true, url: lucide };
    }
    return nextResolve(specifier, context);
  }`));

const { default: DailyStatementV2 } = await import('./DailyStatementV2');

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
    const previous = [ui.current, ui.index] as const;
    ui.current = instance;
    ui.index = 0;
    const rendered = (element.type as (props: Props) => unknown)(element.props);
    [ui.current, ui.index] = previous;
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
  /** Rendu, puis effets ; nouveau rendu tant qu'un effet a modifié l'état (comme un commit React). */
  render(): this {
    for (let pass = 0; pass < 5; pass++) {
      const seen = new Set<string>();
      ui.dirty = false;
      this.tree = expand(this.root, 'root', seen);
      for (const id of [...ui.instances.keys()]) if (!seen.has(id)) ui.instances.delete(id);
      ui.dirty = false;
      ui.effects.splice(0).forEach((effect) => effect());
      if (!ui.dirty) return this;
    }
    throw new Error('effets instables');
  }
  async settle(): Promise<this> {
    for (let round = 0; round < 20; round++) {
      this.render();
      if (ui.pending.size === 0) return this;
      await Promise.all([...ui.pending]);
    }
    throw new Error('rendu instable');
  }
  text(scope: Array<HostNode | string> = this.tree): string { return scope.map(textOf).join(' ').replace(/\s+/g, ' '); }
  buttons(label: string, scope: Array<HostNode | string> = this.tree): HostNode[] {
    return findAll(scope, (node) => node.type === 'button' && textOf(node).trim() === label);
  }
  button(label: string, scope?: Array<HostNode | string>): HostNode {
    const found = this.buttons(label, scope);
    assert.equal(found.length, 1, `un seul bouton « ${label} » attendu, ${found.length} trouvé(s)`);
    return found[0];
  }
  async click(label: string, scope?: Array<HostNode | string>): Promise<this> {
    (this.button(label, scope).props.onClick as () => void)();
    return this.settle();
  }
  labelled(label: string): HostNode {
    const found = findAll(this.tree, (node) => node.props['aria-label'] === label);
    assert.equal(found.length, 1, `un seul élément « ${label} » attendu`);
    return found[0];
  }
  async choose(triggerLabel: string, value: string): Promise<this> {
    const select = findAll(this.tree, (node) => node.type === 'select'
      && findAll(node.children, (child) => child.props['aria-label'] === triggerLabel).length === 1);
    assert.equal(select.length, 1, `liste « ${triggerLabel} »`);
    (select[0].props.onValueChange as (value: string) => void)(value);
    return this.settle();
  }
  options(triggerLabel: string): string[] {
    const select = findAll(this.tree, (node) => node.type === 'select'
      && findAll(node.children, (child) => child.props['aria-label'] === triggerLabel).length === 1)[0];
    return findAll(select.children, (node) => node.type === 'option').map((option) => textOf(option));
  }
  async type(label: string, value: string): Promise<this> {
    (this.labelled(label).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    return this.settle();
  }
  async drop(name: string, text: string): Promise<this> {
    return this.dropNow(name, text).settle();
  }
  /** Dépôt d'un fichier sans attendre les opérations en cours (course avec un dépôt RPC non terminé). */
  dropNow(name: string, text: string): this {
    const bytes = new TextEncoder().encode(text);
    assert.ok(ui.dropzone, 'zone de dépôt montée');
    ui.dropzone.onDrop([{ name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(0) }]);
    return this.render();
  }
  typeNow(label: string, value: string): this {
    (this.labelled(label).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    return this.render();
  }
  async typeInto(predicate: (node: HostNode) => boolean, value: string): Promise<this> {
    const found = findAll(this.tree, predicate);
    assert.equal(found.length, 1, 'un seul champ attendu');
    (found[0].props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    return this.settle();
  }
  checkbox(): HostNode {
    const found = findAll(this.tree, (node) => node.type === 'input' && node.props.type === 'checkbox');
    assert.equal(found.length, 1, 'une seule case de confirmation');
    return found[0];
  }
  async setChecked(checked: boolean): Promise<this> {
    (this.checkbox().props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked } });
    return this.settle();
  }
  row(unitId: string): Array<HostNode | string> {
    const found = findAll(this.tree, (node) => node.type === 'tr' && node.props['data-staging-unit'] === unitId);
    assert.equal(found.length, 1, `ligne de l’unité ${unitId}`);
    return [found[0]];
  }
  /** Onglet « Staging » seul (les autres onglets ont aussi leurs paginations). */
  stagingTab(): Array<HostNode | string> {
    const found = findAll(this.tree, (node) => node.type === 'section' && node.props.value === 'staging');
    assert.equal(found.length, 1, 'onglet Staging');
    return [found[0]];
  }
  stagingRowIds(): string[] {
    return findAll(this.tree, (node) => node.type === 'tr' && typeof node.props['data-staging-unit'] === 'string')
      .map((node) => String(node.props['data-staging-unit']));
  }
}

function callsOf(name: string): unknown[][] {
  return ui.calls.filter((call) => call.name === name).map((call) => call.args);
}

function reset(): void {
  ui.instances.clear();
  ui.cache.clear();
  ui.pending.clear();
  ui.effects.length = 0;
  ui.calls.length = 0;
  ui.toasts.length = 0;
  ui.dropzone = null;
  ui.versionsUnit = undefined;
  ui.batchAttemptId = undefined;
  ui.roles = ['admin'];
  ui.reviewRegistryFails = false;
  ui.reviewRegistryGate = null;
  ui.activeCanonical = null;
  ui.depositGate = null;
  ui.decisionGate = null;
  ui.decisionFailures = 0;
  ui.scope = { lifetime: activeLifetime() };
}

function activeLifetime(): ReturnType<typeof createDailyV2SessionLifetime> {
  const lifetime = createDailyV2SessionLifetime();
  lifetime.activate();
  return lifetime;
}
ui.scope = { lifetime: activeLifetime() };

// --- Données fictives ---------------------------------------------------------
const ACCOUNT_A = '20000000-0000-4000-8000-00000000000a';
const ACCOUNT_B = '20000000-0000-4000-8000-00000000000b';
/** Empreintes fictives des comptes : internes au pipeline, elles ne doivent jamais apparaître dans l'interface. */
const FINGERPRINTS: Record<string, string> = { [ACCOUNT_A]: '1'.repeat(64), [ACCOUNT_B]: '2'.repeat(64) };

function account(id: string, alias: string, masked: string | null, status: 'active' | 'inactive' = 'active'): DailyV2AccountRegistryRow {
  return {
    id, created_at: '2026-11-01T08:00:00Z', created_by: '50000000-0000-4000-8000-000000000001', bank: 'ORA', currency: 'XOF',
    safe_alias: alias, fingerprint_scheme: 'sha256_hex_v1', account_fingerprint: FINGERPRINTS[id] ?? '0'.repeat(64),
    account_number_masked: masked, status, deactivated_at: null, deactivated_by: null, deactivation_reason: null,
  };
}

function unit(id: string, accountId: string | null, overrides: Partial<DailyV2StagingUnitRow> = {}): DailyV2StagingUnitRow {
  return {
    id, attempt_id: `30000000-0000-4000-8000-${id.slice(-12)}`, day_unit_id: id.slice(-1).repeat(64), bank: 'ORA',
    account_fingerprint: 'f'.repeat(64), account_registry_id: accountId, currency: 'XOF', accounting_date: '2026-10-05',
    day_content_hash: 'c'.repeat(64), line_count: 2, day_total_debits: 10, day_total_credits: 20,
    opening_balance_derived: 100, closing_balance_derived: 110, aggregates_status: 'derived', validation_status: 'valid',
    review_reason_codes: [], status: 'staged', created_at: '2026-11-09T10:00:00Z', created_by: null, ...overrides,
  };
}

function oraCsv(periodEnd = '03/06/2026'): string {
  return [
    'EXTRAIT DE COMPTE;;;;;',
    `Periode du;01/06/2026;au;${periodEnd};;`,
    'Numero de compte;01401-00000000000-00 XOF;;;;',
    ';;Solde initial (XOF) : 1000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC DEBIT;100;;900',
    '02/06/2026;02/06/2026;SYNTHETIC CREDIT;;200;1100',
    '03/06/2026;03/06/2026;SYNTHETIC DEBIT TWO;50;;1050',
    ';;Total;150;200;',
    `;;Solde (XOF) au ${periodEnd} : 1050;;;`,
  ].join('\n');
}

async function importScreen(): Promise<Screen> {
  reset();
  ui.accounts = [account(ACCOUNT_A, 'Exploitation Dakar', null), account(ACCOUNT_B, 'Salaires Dakar', null)];
  ui.staging = () => ({ rows: [], count: 0 });
  const screen = await new Screen(<DailyStatementV2 />).settle();
  await screen.choose('Banque', 'ORA');
  await screen.choose('Compte pré-provisionné', ACCOUNT_A);
  return screen;
}

// --- A : date d'export --------------------------------------------------------

test('a new file never inherits the previous date: it is cleared visibly and the previous preparation is invalidated (A)', async () => {
  const screen = await importScreen();
  await screen.drop('030626 ORA ONLINE.csv', oraCsv());
  assert.match(screen.text(), /Fichier courant : 030626 ORA ONLINE\.csv/);
  assert.match(screen.text(), /Date lue dans le nom du fichier : 03\/06\/2026/);
  assert.match(screen.text(), /Date qui sera transmise : aucune — sans date, la dernière journée ORABANK du fichier sera demandée provisoire\./);
  assert.match(screen.text(), /Banque reconnue d’après le nom du fichier : ORABANK\./);

  await screen.click('Utiliser cette date');
  assert.match(screen.text(), /Date qui sera transmise : 03\/06\/2026/);
  await screen.click('Préparer');
  assert.match(screen.text(), /Payload prêt/);
  assert.match(screen.text(), /Date de référence export\s*03\/06\/2026/);

  // Nouveau fichier : la préparation précédente disparaît, la date n'est pas reprise et l'effacement est signalé.
  await screen.drop('040626 ORA ONLINE.csv', oraCsv('04/06/2026'));
  assert.doesNotMatch(screen.text(), /Payload prêt/);
  assert.equal(screen.buttons('Déposer via RPC').length, 0);
  assert.match(screen.text(), /Date précédente effacée/);
  assert.match(screen.text(), /La date saisie pour le fichier précédent \(03\/06\/2026\) n’est pas reprise\. Saisissez la date d’export de « 040626 ORA ONLINE\.csv »/);
  assert.equal(screen.labelled('Date de référence export').props.value, '');
  assert.match(screen.text(), /Date qui sera transmise : aucune/);
  assert.match(screen.text(), /Date lue dans le nom du fichier : 04\/06\/2026/);

  // Saisir une date fait disparaître l'avis ; la modifier après préparation invalide la préparation.
  await screen.type('Date de référence export', '04/06/2026');
  assert.doesNotMatch(screen.text(), /Date précédente effacée/);
  await screen.click('Préparer');
  assert.match(screen.text(), /Payload prêt/);
  await screen.type('Date de référence export', '05/06/2026');
  assert.doesNotMatch(screen.text(), /Payload prêt/);
  assert.equal(callsOf('preIngestDailyV2WithIncrementalDelta').length, 0);
});

test('the deposit requires an explicit confirmation of the date for this very preparation (A)', async () => {
  const screen = await importScreen();
  await screen.drop('030626 ORA ONLINE.csv', oraCsv());
  await screen.type('Date de référence export', '03/06/2026');
  await screen.click('Préparer');
  assert.match(screen.text(), /Journées demandées provisoires : 03\/06\/2026 · journées non provisoires : 2 · dernière journée du fichier : 03\/06\/2026/);
  // C2 : le décompte reste celui du payload ; aucune clôture ni disponibilité n'est affirmée par l'interface.
  assert.match(screen.text(), /Statuts demandés par cette préparation : ils ne démontrent ni la clôture bancaire d’une journée ni sa disponibilité en Trésorerie, vérifiées côté serveur\./);
  assert.doesNotMatch(screen.text(), /journées? (sont |seront )?closes?|serait close/i);
  assert.match(screen.text(), /Compte du dépôt\s*Exploitation Dakar/);
  assert.match(screen.text(), /Je confirme que la date d’export 03\/06\/2026 correspond au fichier « 030626 ORA ONLINE\.csv », pour le compte « Exploitation Dakar »\./);
  assert.equal(screen.checkbox().props.checked, false);
  assert.equal(screen.button('Déposer via RPC').props.disabled, true);

  // Le gestionnaire du bouton inactif est appelé quand même : la garde de l'action refuse sans RPC.
  await screen.click('Déposer via RPC');
  assert.equal(callsOf('preIngestDailyV2WithIncrementalDelta').length, 0);
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && /Confirmez la date d’export/.test(toast.message)));

  await screen.setChecked(true);
  assert.equal(screen.button('Déposer via RPC').props.disabled, false);
  // Une nouvelle préparation, même identique, exige une nouvelle confirmation.
  await screen.click('Préparer');
  assert.equal(screen.checkbox().props.checked, false);
  assert.equal(screen.button('Déposer via RPC').props.disabled, true);
  await screen.setChecked(true);
  await screen.click('Déposer via RPC');
  const deposits = callsOf('preIngestDailyV2WithIncrementalDelta');
  assert.equal(deposits.length, 1);
  const payload = deposits[0][0] as { p_attempt: { export_reference_date: string | null; account_registry_id: string } };
  assert.equal(payload.p_attempt.export_reference_date, '03/06/2026');
  assert.equal(payload.p_attempt.account_registry_id, ACCOUNT_A);
});

test('a date earlier than the file itself blocks the deposit, even when the guard is bypassed in the UI (A)', async () => {
  const screen = await importScreen();
  await screen.drop('030626 ORA ONLINE.csv', oraCsv());
  await screen.type('Date de référence export', '02/06/2026');
  await screen.click('Préparer');
  assert.match(screen.text(), /Date incohérente : dépôt bloqué/);
  assert.match(screen.text(), /Date incohérente : 02\/06\/2026 est antérieure à la dernière journée du fichier \(03\/06\/2026\)/);
  assert.match(screen.text(), /Journées demandées provisoires : 02\/06\/2026, 03\/06\/2026/);
  assert.equal(screen.checkbox().props.disabled, true);
  assert.equal(screen.button('Déposer via RPC').props.disabled, true);
  await screen.setChecked(true);
  await screen.click('Déposer via RPC');
  assert.equal(callsOf('preIngestDailyV2WithIncrementalDelta').length, 0);
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && /incohérente avec le fichier : dépôt refusé/.test(toast.message)));
});

test('preparing without a date is an explicit, informed choice (A)', async () => {
  const screen = await importScreen();
  await screen.drop('030626 ORAB ONLINE.csv', oraCsv());
  await screen.click('Préparer');
  assert.match(screen.text(), /Date de référence export\s*aucune/);
  assert.match(screen.text(), /ORABANK sans date de référence : la dernière journée du fichier \(03\/06\/2026\) est demandée provisoire\./);
  assert.match(screen.text(), /Le nom du fichier porte la date 03\/06\/2026, mais aucune date de référence n’est transmise\./);
  assert.match(screen.text(), /Je confirme déposer « 030626 ORAB ONLINE\.csv » sans date de référence export, pour le compte « Exploitation Dakar »\./);
  await screen.setChecked(true);
  await screen.click('Déposer via RPC');
  const deposits = callsOf('preIngestDailyV2WithIncrementalDelta');
  assert.equal(deposits.length, 1);
  assert.equal((deposits[0][0] as { p_attempt: { export_reference_date: string | null } }).p_attempt.export_reference_date, null);
});

test('the file name bank rule is shown before preparation, ORAB included, and mismatches are announced (C)', async () => {
  const screen = await importScreen();
  await screen.drop('211026 ORAB ONLINE.csv', oraCsv());
  assert.match(screen.text(), /Banque reconnue d’après le nom du fichier : ORABANK\./);
  await screen.drop('211026 ORAB BDK ONLINE.csv', oraCsv());
  assert.match(screen.text(), /Aucune banque reconnue dans le nom du fichier : la préparation sera refusée\./);
  await screen.choose('Banque', 'BDK');
  await screen.drop('211026 ORAB ONLINE.csv', oraCsv());
  assert.match(screen.text(), /ORABANK — ne correspond pas à la banque choisie \(BDK\) : la préparation sera refusée\./);
});

// --- B : identification du compte, filtre serveur, décisions ciblées ----------

const UNIT_A = '10000000-0000-4000-8000-00000000000a';
const UNIT_B = '10000000-0000-4000-8000-00000000000b';

async function reviewScreen(): Promise<{ screen: Screen; units: Map<string, DailyV2StagingUnitRow> }> {
  reset();
  ui.accounts = [account(ACCOUNT_A, 'Exploitation Dakar', '****1111'), account(ACCOUNT_B, 'Salaires Dakar', '****2222', 'inactive')];
  // Deux comptes de la même banque, même journée : deux unités distinctes du même jour.
  const units = new Map([[UNIT_A, unit(UNIT_A, ACCOUNT_A)], [UNIT_B, unit(UNIT_B, ACCOUNT_B)]]);
  ui.staging = (input) => {
    const rows = [...units.values()].filter((row) => input.account === 'all' || row.account_registry_id === input.account);
    // Effectif serveur du compte A porté à 25 pour éprouver la pagination de l'ensemble filtré.
    return { rows, count: input.account === ACCOUNT_A ? 25 : rows.length };
  };
  const screen = await new Screen(<DailyStatementV2 />).settle();
  return { screen, units };
}

test('two accounts of the same bank on the same day are identified by alias and masked number (B)', async () => {
  const { screen } = await reviewScreen();
  assert.deepEqual(screen.stagingRowIds(), [UNIT_A, UNIT_B]);
  assert.match(screen.text(screen.row(UNIT_A)), /Exploitation Dakar\s*\*\*\*\*1111\s*Tentative 30000000 · unité 10000000/);
  assert.match(screen.text(screen.row(UNIT_B)), /Salaires Dakar \(inactif\)\s*\*\*\*\*2222/);
  assert.deepEqual(screen.options('Filtrer par compte'), [
    'Tous les comptes', 'Exploitation Dakar — ****1111 · ORA/XOF', 'Salaires Dakar — ****2222 · ORA/XOF (inactif)', 'Sans compte du registre',
  ]);
  // Registre de la revue : toutes banques, inactifs inclus pour l'admin (droits existants).
  assert.ok(callsOf('listDailyV2Accounts').some(([input]) => JSON.stringify(input) === JSON.stringify({ includeInactive: true })));
  // L'empreinte du compte n'apparaît ni dans le texte ni dans les attributs, y compris dialogue de décision ouvert.
  await screen.click('Promouvoir', screen.row(UNIT_B));
  assert.equal(screen.buttons('Confirmer').length, 1);
  const rendered = JSON.stringify(screen.tree);
  for (const fingerprint of ['1'.repeat(64), '2'.repeat(64), 'f'.repeat(64)]) {
    assert.equal(rendered.includes(fingerprint), false, 'empreinte jamais rendue');
  }
});

test('a manager reads only active accounts; others stay unidentified rather than guessed (B)', async () => {
  reset();
  ui.roles = ['manager'];
  ui.accounts = [account(ACCOUNT_A, 'Exploitation Dakar', '****1111'), account(ACCOUNT_B, 'Salaires Dakar', '****2222', 'inactive')];
  ui.staging = () => ({ rows: [unit(UNIT_A, ACCOUNT_A), unit(UNIT_B, ACCOUNT_B)], count: 2 });
  const screen = await new Screen(<DailyStatementV2 />).settle();
  assert.ok(callsOf('listDailyV2Accounts').some(([input]) => JSON.stringify(input) === JSON.stringify({ includeInactive: false })));
  assert.match(screen.text(screen.row(UNIT_B)), /Compte non visible avec vos droits/);
  assert.equal(screen.buttons('Promouvoir').length, 0, 'aucune décision pour un manager');
});

test('the account filter is applied by the server before pagination, with its own count (B)', async () => {
  const { screen } = await reviewScreen();
  assert.equal((callsOf('listDailyV2StagingUnits').at(-1)?.[0] as { account: string }).account, 'all');
  await screen.choose('Filtrer par compte', ACCOUNT_A);
  const request = callsOf('listDailyV2StagingUnits').at(-1)?.[0] as Record<string, unknown>;
  assert.deepEqual({ account: request.account, page: request.page, pageSize: request.pageSize },
    { account: ACCOUNT_A, page: 0, pageSize: 20 });
  assert.deepEqual(screen.stagingRowIds(), [UNIT_A]);
  assert.match(screen.text(), /Filtre serveur appliqué avant la pagination : Exploitation Dakar — \*\*\*\*1111 · ORA\/XOF — 25 unité\(s\)\./);
  assert.match(screen.text(screen.stagingTab()), /Page 1\/2 — 25 élément\(s\)/);
  await screen.click('Suivant', screen.stagingTab());
  const next = callsOf('listDailyV2StagingUnits').at(-1)?.[0] as Record<string, unknown>;
  assert.deepEqual({ account: next.account, page: next.page }, { account: ACCOUNT_A, page: 1 });
  // Changer de compte revient à la première page de l'ensemble filtré.
  await screen.choose('Filtrer par compte', 'unregistered');
  const unregistered = callsOf('listDailyV2StagingUnits').at(-1)?.[0] as Record<string, unknown>;
  assert.deepEqual({ account: unregistered.account, page: unregistered.page }, { account: 'unregistered', page: 0 });
});

test('a decision targets the exact unit and attempt, and closes when the account or the page changes (B)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_B));
  assert.match(screen.text(screen.labelled('Unité concernée').children),
    /Compte\s*Salaires Dakar \(inactif\) — \*\*\*\*2222.*Journée\s*2026-10-05 · ORA\/XOF.*Tentative\s*30000000.*Unité\s*10000000/);
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_B, undefined]]);

  // Décision ouverte puis changement de compte : le dialogue se ferme, rien n'est envoyé.
  await screen.click('Promouvoir', screen.row(UNIT_A));
  assert.equal(screen.buttons('Confirmer').length, 1);
  await screen.choose('Filtrer par compte', ACCOUNT_A);
  assert.equal(screen.buttons('Confirmer').length, 0);
  // Versions ouvertes puis changement de page : les dialogues Lot 1 sont aussi refermés.
  await screen.click('Versions', screen.row(UNIT_A));
  assert.equal((ui.versionsUnit as DailyV2StagingUnitRow | null)?.id, UNIT_A);
  await screen.click('Suivant', screen.stagingTab());
  assert.equal(ui.versionsUnit, null);
  assert.equal(callsOf('promoteDailyV2Unit').length, 1);
});

test('a decision whose unit changed or left the view is refused as stale, without any RPC (B)', async () => {
  const { screen, units } = await reviewScreen();
  // Le gestionnaire « Confirmer » d'un dialogue resté ouvert, appelé après une relecture où l'unité a changé.
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const confirmOpenedOnA = screen.button('Confirmer').props.onClick as () => void;
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A, { status: 'promoted' }));
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  confirmOpenedOnA();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && /l’unité a changé depuis l’ouverture/.test(toast.message)));
  assert.equal(screen.buttons('Confirmer').length, 0);

  // Unité retirée de la vue (autre tentative arrivée, pagination décalée) : refus sans RPC.
  await screen.click('Promouvoir', screen.row(UNIT_B));
  units.delete(UNIT_B);
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  await screen.click('Confirmer');
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && /n’apparaît plus dans la revue affichée/.test(toast.message)));
});

// --- Observations de la revue indépendante -------------------------------------

test('provisioning a new account drops the preparation confirmed for the previous account (A, revue P1-1)', async () => {
  const screen = await importScreen();
  await screen.drop('030626 ORA ONLINE.csv', oraCsv());
  await screen.type('Date de référence export', '03/06/2026');
  await screen.click('Préparer');
  await screen.setChecked(true);
  assert.equal(screen.button('Déposer via RPC').props.disabled, false);
  await screen.typeInto((node) => node.type === 'input' && node.props.placeholder === 'Ex. Compte exploitation Dakar', 'Compte fictif nouveau');
  await screen.click('Provisionner pour ORA/XOF');
  assert.equal(callsOf('provisionDailyV2Account').length, 1);
  assert.doesNotMatch(screen.text(), /Payload prêt/);
  assert.equal(screen.buttons('Déposer via RPC').length, 0);
  assert.match(screen.text(), /Compte sélectionné : Compte fictif nouveau/);
  assert.equal(callsOf('preIngestDailyV2WithIncrementalDelta').length, 0);
});

test('a date later than the export date of the file name blocks the deposit (A, revue P2-1)', async () => {
  const screen = await importScreen();
  await screen.drop('030626 ORA ONLINE.csv', oraCsv());
  await screen.type('Date de référence export', '04/06/2026');
  await screen.click('Préparer');
  assert.match(screen.text(), /Date incohérente : dépôt bloqué/);
  assert.match(screen.text(), /Date incohérente : 04\/06\/2026 est postérieure à la date d’export lue dans le nom du fichier \(03\/06\/2026\) ; la journée d’export, peut-être incomplète, ne serait plus demandée provisoire\./);
  assert.match(screen.text(), /Journées demandées provisoires : aucune/);
  assert.equal(screen.checkbox().props.disabled, true);
  assert.equal(screen.button('Déposer via RPC').props.disabled, true);
  await screen.setChecked(true);
  await screen.click('Déposer via RPC');
  assert.equal(callsOf('preIngestDailyV2WithIncrementalDelta').length, 0);
});

test('the cleared-date notice names its real cause (A, revue P3-3)', async () => {
  const screen = await importScreen();
  await screen.type('Date de référence export', '21/10/2026');
  await screen.drop('030626 ORA ONLINE.csv', oraCsv());
  assert.match(screen.text(), /La date saisie avant le choix du fichier \(21\/10\/2026\) n’est pas reprise\./);
  await screen.type('Date de référence export', '03/06/2026');
  await screen.choose('Banque', 'BDK');
  assert.match(screen.text(), /La date saisie \(03\/06\/2026\) a été effacée par le changement de banque\./);
  assert.equal(screen.labelled('Date de référence export').props.value, '');
});

test('a file and date entered while a deposit is pending are kept, and preparing is disabled meanwhile (A, revue P3-2)', async () => {
  const screen = await importScreen();
  await screen.drop('030626 ORA ONLINE.csv', oraCsv());
  await screen.type('Date de référence export', '03/06/2026');
  await screen.click('Préparer');
  await screen.setChecked(true);
  let release: () => void = () => {};
  ui.depositGate = new Promise<void>((resolve) => { release = resolve; });
  (screen.button('Déposer via RPC').props.onClick as () => void)();
  await new Promise((resolve) => setImmediate(resolve));
  screen.render();
  assert.equal(callsOf('preIngestDailyV2WithIncrementalDelta').length, 1, 'dépôt en cours');
  screen.dropNow('040626 ORA ONLINE.csv', oraCsv('04/06/2026')).typeNow('Date de référence export', '04/06/2026');
  assert.equal(screen.button('Préparer').props.disabled, true, 'préparation indisponible pendant le dépôt');
  release();
  await screen.settle();
  assert.match(screen.text(), /Fichier courant : 040626 ORA ONLINE\.csv/);
  assert.equal(screen.labelled('Date de référence export').props.value, '04/06/2026');
  assert.equal(screen.button('Préparer').props.disabled, false);
  assert.ok(ui.toasts.some((toast) => toast.kind === 'success' && toast.message === 'Dépôt Daily v2 terminé'));
});

test('a refresh suspends the confirmation without closing the dialog or losing the reason (B, revue P3-1)', async () => {
  const { screen, units } = await reviewScreen();
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A, { review_reason_codes: ['ACCOUNT_IDENTITY_NOT_CORROBORATED'], validation_status: 'needs_review' }));
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  await screen.typeInto((node) => node.type === 'textarea', 'Contrôle manuel fictif');
  ui.invalidate(['daily-v2', 'staging']);
  screen.render();
  assert.match(screen.text(), /Revue en cours d’actualisation : la confirmation reprend une fois la liste relue\./);
  assert.equal(screen.button('Confirmer').props.disabled, true);
  (screen.button('Confirmer').props.onClick as () => void)();
  screen.render();
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && /Décision suspendue/.test(toast.message)));
  assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');
  assert.equal(findAll(screen.tree, (node) => node.type === 'textarea')[0].props.value, 'Contrôle manuel fictif');
  await screen.settle();
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, 'Contrôle manuel fictif']]);
});

test('after a failed refresh, old rows never confirm a decision until the review is read again (B, revue P3-B)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const healthy = ui.staging;
  ui.staging = () => { throw new Error('relecture en échec (fictive)'); };
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  // La liste affiche l'échec, mais le dialogue (hors de la liste) reste ouvert sur des lignes que TanStack conserve :
  // la décision est suspendue tant que la revue n'a pas été relue.
  assert.match(screen.text(screen.stagingTab()), /Lecture impossible ou non autorisée\./);
  assert.match(screen.text(), /la relecture de la revue a échoué\. Actualisez la liste avant de confirmer\./);
  assert.equal(screen.button('Confirmer').props.disabled, true);
  (screen.button('Confirmer').props.onClick as () => void)();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');
  ui.staging = healthy;
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined]]);
});

test('a confirm handler captured before a change of account does nothing afterwards (B, revue P3-5)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const captured = screen.button('Confirmer').props.onClick as () => void;
  await screen.choose('Filtrer par compte', ACCOUNT_B);
  captured();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
});

test('while the account registry is unavailable, accounts are shown as such and decisions on them are refused (B, revue P3-4)', async () => {
  reset();
  ui.reviewRegistryFails = true;
  ui.accounts = [account(ACCOUNT_A, 'Exploitation Dakar', '****1111')];
  const historical = '10000000-0000-4000-8000-0000000000c3';
  ui.staging = () => ({ rows: [unit(UNIT_A, ACCOUNT_A), unit(historical, null)], count: 2 });
  const screen = await new Screen(<DailyStatementV2 />).settle();
  assert.match(screen.text(screen.row(UNIT_A)), /Registre des comptes indisponible/);
  assert.match(screen.text(screen.row(historical)), /Sans compte du registre/);
  await screen.click('Promouvoir', screen.row(UNIT_A));
  assert.match(screen.text(), /Compte non identifiable/);
  assert.equal(screen.button('Confirmer').props.disabled, true);
  (screen.button('Confirmer').props.onClick as () => void)();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  // Depuis C1, le refus nomme sa cause première : la lecture du registre a échoué (aucun compte en cache ici).
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && /dernière lecture du registre des comptes a échoué/.test(toast.message)));
  assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');
  // Une unité historique sans compte du registre reste décidable comme avant.
  await screen.click('Annuler');
  await screen.click('Promouvoir', screen.row(historical));
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[historical, undefined]]);
});

// --- C1 : décisions dépendant du registre des comptes (contre-revue CTO de 607c0bb) ---

const CANONICAL_A = '60000000-0000-4000-8000-00000000000a';
const HISTORICAL = '10000000-0000-4000-8000-0000000000c3';

test('CTO reproduction: a failed registry re-read with cached accounts no longer lets a promotion through (C1)', async () => {
  const { screen } = await reviewScreen();
  // 1. registre lu ; 2. promotion ouverte ; 3. relecture du registre en échec, anciennes données conservées.
  await screen.click('Promouvoir', screen.row(UNIT_A));
  ui.reviewRegistryFails = true;
  ui.invalidate(['daily-v2', 'accounts', 'review']);
  await screen.settle();
  assert.match(screen.text(screen.row(UNIT_A)), /Exploitation Dakar/, 'données du registre conservées en cache');
  // 4. la confirmation n'est plus active et son gestionnaire, appelé quand même, ne promeut rien.
  assert.equal(screen.button('Confirmer').props.disabled, true);
  (screen.button('Confirmer').props.onClick as () => void)();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
});

test('a failed registry re-read suspends a promotion, keeps the dialog, and resumes only after a healthy read (C1)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const capturedBeforeFailure = screen.button('Confirmer').props.onClick as () => void;
  ui.reviewRegistryFails = true;
  ui.invalidate(['daily-v2', 'accounts', 'review']);
  await screen.settle();
  // Cache affiché mais signalé ; décision suspendue avec son motif, dialogue conservé.
  assert.match(screen.text(screen.stagingTab()), /Dernière lecture du registre des comptes en échec/);
  assert.match(screen.text(), /Décision suspendue : la dernière lecture du registre des comptes a échoué/);
  assert.equal(screen.button('Confirmer').props.disabled, true);
  capturedBeforeFailure();
  (screen.button('Confirmer').props.onClick as () => void)();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  assert.equal(ui.toasts.filter((toast) => toast.kind === 'error' && /dernière lecture du registre des comptes a échoué/.test(toast.message)).length, 2);
  assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');
  // Une relecture encore en échec ne débloque rien.
  await screen.click('Relire la revue et le registre');
  assert.equal(screen.button('Confirmer').props.disabled, true);
  (screen.button('Confirmer').props.onClick as () => void)();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  // Lecture saine : reprise après les contrôles de contexte existants.
  ui.reviewRegistryFails = false;
  await screen.click('Relire la revue et le registre');
  assert.doesNotMatch(screen.text(), /Dernière lecture du registre des comptes en échec/);
  assert.equal(screen.button('Confirmer').props.disabled, false);
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined]]);
});

test('a registry re-read in progress suspends a supersede without losing its reason; a failed one refuses it (C1)', async () => {
  const { screen, units } = await reviewScreen();
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A, { status: 'conflict' }));
  ui.activeCanonical = { id: CANONICAL_A };
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  await screen.click('Supersede', screen.row(UNIT_A));
  await screen.typeInto((node) => node.type === 'textarea', 'Remplacement fictif');
  // Relecture du registre en cours : suspension, dialogue et motif conservés, aucun appel.
  let release: () => void = () => {};
  ui.reviewRegistryGate = new Promise<void>((resolve) => { release = resolve; });
  ui.invalidate(['daily-v2', 'accounts', 'review']);
  screen.render();
  assert.match(screen.text(), /Décision suspendue : le registre des comptes est en cours de lecture/);
  assert.equal(screen.button('Confirmer').props.disabled, true);
  (screen.button('Confirmer').props.onClick as () => void)();
  screen.render();
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && /registre des comptes est en cours de lecture/.test(toast.message)));
  assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');
  assert.equal(findAll(screen.tree, (node) => node.type === 'textarea')[0].props.value, 'Remplacement fictif');
  // La relecture se termine en échec : refus, toujours sans appel.
  ui.reviewRegistryFails = true;
  release();
  await screen.settle();
  assert.match(screen.text(), /Décision suspendue : la dernière lecture du registre des comptes a échoué/);
  assert.equal(screen.button('Confirmer').props.disabled, true);
  (screen.button('Confirmer').props.onClick as () => void)();
  await screen.settle();
  assert.equal(callsOf('getActiveDailyV2CanonicalUnit').length, 0);
  assert.equal(callsOf('supersedeDailyV2Unit').length, 0);
  assert.equal(findAll(screen.tree, (node) => node.type === 'textarea')[0].props.value, 'Remplacement fictif');
  // Lecture saine : le supersede reprend avec l'unité et le motif exacts.
  ui.reviewRegistryGate = null;
  ui.reviewRegistryFails = false;
  await screen.click('Relire la revue et le registre');
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('supersedeDailyV2Unit'), [[{ oldCanonicalUnitId: CANONICAL_A, newStagingUnitId: UNIT_A, reason: 'Remplacement fictif' }]]);
});

test('historical units without a registry account stay decidable while the registry is re-read or failed (C1)', async () => {
  const { screen, units } = await reviewScreen();
  units.set(HISTORICAL, unit(HISTORICAL, null));
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  ui.reviewRegistryFails = true;
  ui.invalidate(['daily-v2', 'accounts', 'review']);
  await screen.settle();
  await screen.click('Promouvoir', screen.row(HISTORICAL));
  assert.doesNotMatch(screen.text(), /Décision suspendue/);
  assert.equal(screen.button('Confirmer').props.disabled, false);
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[HISTORICAL, undefined]]);
  // Pendant une relecture du registre : l'unité rattachée est suspendue, l'unité historique reste décidable.
  let release: () => void = () => {};
  ui.reviewRegistryFails = false;
  ui.reviewRegistryGate = new Promise<void>((resolve) => { release = resolve; });
  ui.invalidate(['daily-v2', 'accounts', 'review']);
  screen.render();
  (screen.button('Promouvoir', screen.row(UNIT_A)).props.onClick as () => void)();
  screen.render();
  assert.equal(screen.button('Confirmer').props.disabled, true);
  // Promotion de l'unité rattachée, gestionnaire appelé directement pendant la relecture : suspendue, sans appel.
  const toastsBefore = ui.toasts.length;
  (screen.button('Confirmer').props.onClick as () => void)();
  screen.render();
  assert.equal(callsOf('promoteDailyV2Unit').length, 1, 'aucune promotion de l’unité rattachée');
  assert.ok(ui.toasts.slice(toastsBefore).some((toast) => toast.kind === 'error' && /registre des comptes est en cours de lecture/.test(toast.message)));
  assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');
  assert.match(screen.text(screen.labelled('Unité concernée').children), /Exploitation Dakar/);
  (screen.button('Annuler').props.onClick as () => void)();
  screen.render();
  (screen.button('Promouvoir', screen.row(HISTORICAL)).props.onClick as () => void)();
  screen.render();
  assert.equal(screen.button('Confirmer').props.disabled, false);
  (screen.button('Confirmer').props.onClick as () => void)();
  release();
  await screen.settle();
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[HISTORICAL, undefined], [HISTORICAL, undefined]]);
});

test('a re-read waiting for the network (paused) suspends a decision like a re-read in progress (C1, contre-revue)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const registry = ui.cache.get(JSON.stringify(['daily-v2', 'accounts', 'review', true]));
  const staging = [...ui.cache.entries()].find(([key]) => key.startsWith('["daily-v2","staging",'))?.[1];
  assert.ok(registry && staging, 'lectures de la revue et du registre en cache');
  const refusedWhile = (pattern: RegExp) => {
    assert.equal(screen.button('Confirmer').props.disabled, true);
    const before = ui.toasts.length;
    (screen.button('Confirmer').props.onClick as () => void)();
    screen.render();
    assert.ok(ui.toasts.slice(before).some((toast) => toast.kind === 'error' && pattern.test(toast.message)));
    assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');
  };
  // TanStack « paused » : isFetching faux, données et statut inchangés, lecture non confirmée.
  registry.paused = true;
  screen.render();
  assert.match(screen.text(), /Décision suspendue : le registre des comptes est en cours de lecture/);
  refusedWhile(/registre des comptes est en cours de lecture/);
  registry.paused = false;
  staging.paused = true;
  screen.render();
  assert.match(screen.text(), /Revue en cours d’actualisation/);
  refusedWhile(/revue est en cours d’actualisation/);
  staging.paused = false;
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined]]);
});

test('the no-date BDK hint and a date after the last day never claim any closing (C2, contre-revue)', async () => {
  const screen = await importScreen();
  // Export du 04/06 dont la dernière opération date du 03/06 : date postérieure au contenu, égale au nom (non bloquant).
  await screen.drop('040626 ORA ONLINE.csv', oraCsv());
  await screen.type('Date de référence export', '04/06/2026');
  await screen.click('Préparer');
  assert.match(screen.text(), /04\/06\/2026 est postérieure à la dernière journée du fichier \(03\/06\/2026\) : aucune journée du fichier n’est demandée provisoire\./);
  assert.match(screen.text(), /Journées demandées provisoires : aucune · journées non provisoires : 3/);
  assert.doesNotMatch(screen.text(), /seront closes|sont closes|serait close|journées closes/i);
  // BDK sans date : aucune journée demandée provisoire, sans affirmation de clôture.
  await screen.choose('Banque', 'BDK');
  await screen.drop('030626 BDK ONLINE.csv', oraCsv());
  assert.match(screen.text(), /Date qui sera transmise : aucune — sans date, aucune journée du fichier ne sera demandée provisoire\./);
  assert.doesNotMatch(screen.text(), /seront closes|sont closes|serait close|journées closes/i);
});

test('a deposit followed by a redeposit of the same file keeps the same payload and needs a fresh confirmation each time (non-regression)', async () => {
  const screen = await importScreen();
  for (let round = 0; round < 2; round++) {
    await screen.drop('030626 ORA ONLINE.csv', oraCsv());
    await screen.type('Date de référence export', '03/06/2026');
    await screen.click('Préparer');
    assert.equal(screen.button('Déposer via RPC').props.disabled, true);
    await screen.setChecked(true);
    await screen.click('Déposer via RPC');
    // Après dépôt, le formulaire est vidé : aucune date ni préparation ne survit pour le fichier suivant.
    assert.doesNotMatch(screen.text(), /Payload prêt/);
    assert.match(screen.text(), /Déposez un CSV, XLS ou XLSX/);
  }
  const deposits = callsOf('preIngestDailyV2WithIncrementalDelta').map(([payload]) => JSON.stringify(payload));
  assert.equal(deposits.length, 2);
  assert.equal(deposits[0], deposits[1], 'redépôt identique : même payload, l’arbitrage reste serveur');
});

// --- Gestionnaire de confirmation (pack DAILY-V2-BDK-ORABANK-DAILY-USE-READINESS) ---
// Reproductions écrites sur la base 88ef056, où elles échouent : motif revérifié sur l'unité relue, motif vide refusé,
// une seule décision à la fois même avant le rendu suivant. Le test de reprise après échec passe aussi sur la base : il
// garde la levée du verrou (non-régression). Les tests « contre-revue » ferment les constats F1 à F4 et F8 de la revue
// indépendante du correctif.

const textareas = (screen: Screen) => findAll(screen.tree, (node) => node.type === 'textarea');
const errorToastsMatching = (pattern: RegExp, from = 0) =>
  ui.toasts.slice(from).filter((toast) => toast.kind === 'error' && pattern.test(toast.message)).length;
const REASON_REFUSED = /motif non vide est obligatoire/;
const DECISION_IN_FLIGHT = /Une décision est déjà en cours d’envoi/;

async function supersedeScreen(unitId = UNIT_A): Promise<{ screen: Screen; units: Map<string, DailyV2StagingUnitRow> }> {
  const { screen, units } = await reviewScreen();
  units.set(unitId, unit(unitId, unitId === UNIT_A ? ACCOUNT_A : ACCOUNT_B, { status: 'conflict' }));
  ui.activeCanonical = { id: CANONICAL_A };
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  await screen.click('Supersede', screen.row(unitId));
  return { screen, units };
}

test('two confirmations before a new render send a single promotion (daily use, concurrence)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const confirm = screen.button('Confirmer').props.onClick as () => void;
  // Double clic : deux appels du même gestionnaire avant que React n'ait rendu l'état « pending ».
  confirm();
  confirm();
  await screen.settle();
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined]]);
  assert.equal(errorToastsMatching(DECISION_IN_FLIGHT), 1);
  assert.equal(screen.buttons('Confirmer').length, 0, 'dialogue fermé après la promotion');
});

test('two confirmations before a new render send a single supersede (daily use, concurrence)', async () => {
  const { screen } = await supersedeScreen();
  await screen.typeInto((node) => node.type === 'textarea', 'Remplacement fictif');
  const confirm = screen.button('Confirmer').props.onClick as () => void;
  confirm();
  confirm();
  await screen.settle();
  assert.equal(callsOf('getActiveDailyV2CanonicalUnit').length, 1);
  assert.deepEqual(callsOf('supersedeDailyV2Unit'), [[{ oldCanonicalUnitId: CANONICAL_A, newStagingUnitId: UNIT_A, reason: 'Remplacement fictif' }]]);
});

test('while a decision is pending, captured, current and other-unit handlers send nothing more (daily use, concurrence)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const captured = screen.button('Confirmer').props.onClick as () => void;
  let release: () => void = () => {};
  ui.decisionGate = new Promise<void>((resolve) => { release = resolve; });
  captured();
  await new Promise((resolve) => setImmediate(resolve));
  screen.render();
  assert.equal(callsOf('promoteDailyV2Unit').length, 1, 'promotion en cours');
  assert.equal(screen.button('Confirmer').props.disabled, true, 'état « pending » visible au rendu suivant');
  const toastsBefore = ui.toasts.length;
  // Gestionnaire capturé avant l'envoi, puis gestionnaire du rendu courant, appelés malgré le bouton inactif.
  captured();
  (screen.button('Confirmer').props.onClick as () => void)();
  screen.render();
  // Dialogue fermé puis décision ouverte sur une autre unité pendant l'envoi : refusée tant que la première court.
  (screen.button('Annuler').props.onClick as () => void)();
  screen.render();
  (screen.button('Promouvoir', screen.row(UNIT_B)).props.onClick as () => void)();
  screen.render();
  (screen.button('Confirmer').props.onClick as () => void)();
  await new Promise((resolve) => setImmediate(resolve));
  screen.render();
  assert.equal(callsOf('promoteDailyV2Unit').length, 1, 'aucune décision concurrente');
  assert.equal(errorToastsMatching(DECISION_IN_FLIGHT, toastsBefore), 3);
  release();
  await screen.settle();
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined]]);
  // Après la fin de la première décision, une nouvelle décision est de nouveau possible.
  await screen.click('Promouvoir', screen.row(UNIT_B));
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined], [UNIT_B, undefined]]);
});

test('after a failed decision the lock is released and an explicit retry is possible (daily use, reprise)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  ui.decisionFailures = 1;
  const reviewReadsBefore = callsOf('listDailyV2StagingUnits').length;
  await screen.click('Confirmer');
  assert.equal(callsOf('promoteDailyV2Unit').length, 1);
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && toast.message === 'Promotion impossible.'));
  // F8 : un échec, peut-être ambigu, relit la revue avant toute nouvelle tentative.
  assert.ok(callsOf('listDailyV2StagingUnits').length > reviewReadsBefore, 'revue relue après l’échec');
  assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé après l’échec');
  assert.equal(screen.button('Confirmer').props.disabled, false, 'nouvelle tentative proposée');
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined], [UNIT_A, undefined]]);
  assert.equal(screen.buttons('Confirmer').length, 0, 'dialogue fermé après le succès');
  assert.equal(errorToastsMatching(DECISION_IN_FLIGHT), 0);

  // Supersede : échec levé par la page (aucune unité canonical active), puis échec de la RPC, puis succès.
  const { screen: second } = await supersedeScreen();
  await second.typeInto((node) => node.type === 'textarea', 'Remplacement fictif');
  ui.activeCanonical = null;
  await second.click('Confirmer');
  assert.equal(callsOf('supersedeDailyV2Unit').length, 0);
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && toast.message === 'Aucune unité canonical active correspondante.'));
  ui.activeCanonical = { id: CANONICAL_A };
  ui.decisionFailures = 1;
  await second.click('Confirmer');
  assert.equal(callsOf('supersedeDailyV2Unit').length, 1);
  assert.ok(ui.toasts.some((toast) => toast.kind === 'error' && toast.message === 'Supersede impossible.'));
  assert.equal(textareas(second)[0].props.value, 'Remplacement fictif', 'motif conservé pour la nouvelle tentative');
  await second.click('Confirmer');
  assert.equal(callsOf('supersedeDailyV2Unit').length, 2);
  assert.equal(second.buttons('Confirmer').length, 0);
  assert.equal(errorToastsMatching(DECISION_IN_FLIGHT), 0);
});

test('the required reason is checked against the unit actually re-read, not the one captured at opening (daily use, motif)', async () => {
  for (const change of [
    { review_reason_codes: ['ACCOUNT_IDENTITY_NOT_CORROBORATED' as const] },
    { validation_status: 'needs_review' as const },
    { aggregates_status: 'unavailable' as const },
  ]) {
    const { screen, units } = await reviewScreen();
    await screen.click('Promouvoir', screen.row(UNIT_A));
    assert.equal(textareas(screen).length, 0, 'motif non requis à l’ouverture');
    const captured = screen.button('Confirmer').props.onClick as () => void;
    // Même unité, même tentative, même contenu et même statut, relue avec un motif désormais obligatoire.
    units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A, change));
    ui.invalidate(['daily-v2', 'staging']);
    await screen.settle();
    captured();
    (screen.button('Confirmer').props.onClick as () => void)();
    await screen.settle();
    assert.equal(callsOf('promoteDailyV2Unit').length, 0, JSON.stringify(change));
    assert.equal(errorToastsMatching(REASON_REFUSED), 2);
    assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');
    assert.equal(textareas(screen).length, 1, 'champ du motif affiché');
    assert.equal(screen.button('Confirmer').props.disabled, true);
    await screen.typeInto((node) => node.type === 'textarea', '  Contrôle manuel fictif  ');
    await screen.click('Confirmer');
    assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, 'Contrôle manuel fictif']], JSON.stringify(change));
  }
});

test('an empty or blank reason is refused before any decision, for a promotion and a supersede (daily use, motif)', async () => {
  const { screen, units } = await reviewScreen();
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A, { validation_status: 'needs_review' }));
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  for (const blank of ['', '   ', ' \t\n ']) {
    await screen.typeInto((node) => node.type === 'textarea', blank);
    assert.equal(screen.button('Confirmer').props.disabled, true);
    (screen.button('Confirmer').props.onClick as () => void)();
    await screen.settle();
  }
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  assert.equal(errorToastsMatching(REASON_REFUSED), 3);
  assert.equal(screen.buttons('Confirmer').length, 1, 'dialogue conservé');

  const { screen: second } = await supersedeScreen();
  for (const blank of ['', '   ', ' \t\n ']) {
    await second.typeInto((node) => node.type === 'textarea', blank);
    (second.button('Confirmer').props.onClick as () => void)();
    await second.settle();
  }
  assert.equal(callsOf('getActiveDailyV2CanonicalUnit').length, 0, 'aucune lecture ni décision avec un motif vide');
  assert.equal(callsOf('supersedeDailyV2Unit').length, 0);
  assert.equal(errorToastsMatching(REASON_REFUSED), 3);
  // Le motif transmis est le motif saisi, sans les espaces de bord.
  await second.typeInto((node) => node.type === 'textarea', '  Remplacement fictif  ');
  await second.click('Confirmer');
  assert.deepEqual(callsOf('supersedeDailyV2Unit'), [[{ oldCanonicalUnitId: CANONICAL_A, newStagingUnitId: UNIT_A, reason: 'Remplacement fictif' }]]);
});

test('a confirm handler captured before the reason changed decides with the reason now displayed (daily use, motif)', async () => {
  const { screen } = await supersedeScreen();
  await screen.typeInto((node) => node.type === 'textarea', 'Motif initial');
  const captured = screen.button('Confirmer').props.onClick as () => void;
  // Motif effacé après la capture : le gestionnaire capturé ne décide pas avec l'ancien motif.
  await screen.typeInto((node) => node.type === 'textarea', '');
  captured();
  await screen.settle();
  assert.equal(callsOf('supersedeDailyV2Unit').length, 0);
  assert.equal(errorToastsMatching(REASON_REFUSED), 1);
  // Motif corrigé : le gestionnaire capturé transmet le motif affiché, pas celui de sa capture.
  await screen.typeInto((node) => node.type === 'textarea', 'Motif corrigé');
  captured();
  await screen.settle();
  assert.deepEqual(callsOf('supersedeDailyV2Unit'), [[{ oldCanonicalUnitId: CANONICAL_A, newStagingUnitId: UNIT_A, reason: 'Motif corrigé' }]]);

  // Même règle pour une promotion à motif obligatoire.
  const { screen: second, units } = await reviewScreen();
  units.set(UNIT_B, unit(UNIT_B, ACCOUNT_B, { review_reason_codes: ['RUNNING_BALANCE_MISSING'] }));
  ui.invalidate(['daily-v2', 'staging']);
  await second.settle();
  await second.click('Promouvoir', second.row(UNIT_B));
  await second.typeInto((node) => node.type === 'textarea', 'Motif initial');
  const capturedPromotion = second.button('Confirmer').props.onClick as () => void;
  await second.typeInto((node) => node.type === 'textarea', 'Motif corrigé');
  capturedPromotion();
  await second.settle();
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_B, 'Motif corrigé']]);
});

test('a handler called after the decision ended but before the next render sends nothing more (daily use, contre-revue F1)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const captured = screen.button('Confirmer').props.onClick as () => void;
  captured();
  // La décision se termine (verrou levé) sans qu'aucun rendu n'ait eu lieu.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callsOf('promoteDailyV2Unit').length, 1);
  captured();
  await screen.settle();
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined]]);
  assert.equal(ui.toasts.filter((toast) => toast.kind === 'success' && toast.message === 'Promotion : promoted').length, 1);
  assert.equal(screen.buttons('Confirmer').length, 0);
});

test('the decision lock is released even when the session scope filters the hook callbacks (daily use, contre-revue F2, R2)', async () => {
  const { screen, units } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  let release: () => void = () => {};
  ui.decisionGate = new Promise<void>((resolve) => { release = resolve; });
  (screen.button('Confirmer').props.onClick as () => void)();
  await new Promise((resolve) => setImmediate(resolve));
  screen.render();
  // La durée de vie de la session change pendant la RPC, page restée montée (rechargement à chaud en développement) :
  // la portée réelle rejette le résultat et ne rappelle ni onSuccess, ni onError, ni onSettled du hook.
  ui.scope!.lifetime.dispose();
  ui.scope!.lifetime.activate();
  // Le serveur a pourtant enregistré la promotion : l'issue est inconnue de l'interface.
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A, { status: 'promoted' }));
  const reviewReadsBefore = callsOf('listDailyV2StagingUnits').length;
  release();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 1);
  assert.equal(ui.toasts.some((toast) => toast.message === 'Promotion : promoted' || toast.message === 'Promotion impossible.'), false, 'rappels du hook filtrés');
  // R2 : la revue est relue, comme après un échec.
  assert.ok(callsOf('listDailyV2StagingUnits').length > reviewReadsBefore, 'revue relue après un résultat rejeté');
  // Le verrou n'est pas resté posé : la confirmation suivante n'est pas refusée comme déjà en cours, mais la vue relue
  // la déclare périmée, sans seconde RPC.
  ui.decisionGate = null;
  await screen.click('Confirmer');
  assert.equal(errorToastsMatching(DECISION_IN_FLIGHT), 0);
  assert.equal(errorToastsMatching(/l’unité a changé depuis l’ouverture/), 1);
  assert.equal(callsOf('promoteDailyV2Unit').length, 1);
  assert.equal(screen.buttons('Confirmer').length, 0);
});

test('after a failure, a captured handler called before the next render waits for the re-read (daily use, contre-revue R1)', async () => {
  const { screen } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  const captured = screen.button('Confirmer').props.onClick as () => void;
  ui.decisionFailures = 1;
  captured();
  // L'échec se termine (verrou levé) sans qu'aucun rendu n'ait eu lieu.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callsOf('promoteDailyV2Unit').length, 1);
  captured();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callsOf('promoteDailyV2Unit').length, 1, 'aucune reprise avant la relecture');
  assert.equal(errorToastsMatching(/revue est en cours d’actualisation/), 1);
  // Après la relecture, la nouvelle tentative explicite est possible.
  await screen.settle();
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, undefined], [UNIT_A, undefined]]);
});

test('the handler requires a reason whenever the button does, even if the re-read unit no longer asks for it (daily use, contre-revue F3)', async () => {
  const { screen, units } = await reviewScreen();
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A, { validation_status: 'needs_review', review_reason_codes: ['RUNNING_BALANCE_MISSING'] }));
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  // Même unité relue sans motif de revue (codes recalculés, même contenu, même statut).
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A));
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  assert.equal(screen.button('Confirmer').props.disabled, true, 'le bouton exige toujours un motif');
  (screen.button('Confirmer').props.onClick as () => void)();
  await screen.settle();
  assert.equal(callsOf('promoteDailyV2Unit').length, 0);
  assert.equal(errorToastsMatching(REASON_REFUSED), 1);
});

test('the dialog shows the re-read review codes and never hides a typed reason that would be sent (daily use, contre-revue F4)', async () => {
  const { screen, units } = await reviewScreen();
  await screen.click('Promouvoir', screen.row(UNIT_A));
  assert.doesNotMatch(screen.text(), /Motifs à examiner avant décision/);
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A, { review_reason_codes: ['RUNNING_BALANCE_MISSING'] }));
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  // (a) Les codes qui rendent le motif obligatoire sont ceux de l'unité relue, affichés dans le dialogue.
  assert.match(screen.text(), /Motifs à examiner avant décision\s*RUNNING_BALANCE_MISSING/);
  assert.match(screen.text(), /Raison obligatoire/);
  await screen.typeInto((node) => node.type === 'textarea', 'Motif fictif');
  // (b) Une nouvelle relecture lève l'obligation : le motif saisi reste affiché, et c'est lui qui est transmis.
  units.set(UNIT_A, unit(UNIT_A, ACCOUNT_A));
  ui.invalidate(['daily-v2', 'staging']);
  await screen.settle();
  assert.equal(textareas(screen).length, 1, 'motif saisi toujours visible');
  assert.match(screen.text(), /Raison saisie \(sera transmise\)/);
  await screen.click('Confirmer');
  assert.deepEqual(callsOf('promoteDailyV2Unit'), [[UNIT_A, 'Motif fictif']]);
});
