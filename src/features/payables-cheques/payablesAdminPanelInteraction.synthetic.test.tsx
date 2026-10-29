import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Interactions réelles avec le panneau d'administration : rendu client React
// (react-dom/client) dans un DOM minimal écrit ici, sans dépendance ajoutée.
// Le client Supabase et la cible d'exécution sont remplacés au chargement des
// modules (hook de résolution Node), jamais par une option de production ;
// chaque appel serveur passe par un double qui l'enregistre.

type RpcResult = { data: unknown; error: { message: string } | null };
type RpcHandler = (name: string, args: Record<string, unknown>) => RpcResult;
const testGlobal = globalThis as unknown as Record<string, unknown>;
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcHandler: RpcHandler = () => ({ data: null, error: { message: 'PAYABLES_TEST_NO_NETWORK' } });
testGlobal.__payablesTestRpc = (name: string, args: Record<string, unknown>) => {
  rpcCalls.push({ name, args });
  return Promise.resolve(rpcHandler(name, args));
};

const supabaseStub = 'data:text/javascript,' + encodeURIComponent(`
  export const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'synthetic' } } }, error: null }) },
    rpc: (name, args) => globalThis.__payablesTestRpc(name, args),
  };`);
const targetStub = 'data:text/javascript,' + encodeURIComponent(`
  export function currentPayablesRuntimeVerdict() {
    return globalThis.__payablesTestVerdict ?? { allowed: true, environment: 'local', mode: 'full' };
  }
  export function isRuntimeRefused(v) { return v.allowed === false; }`);
// Session vue par la garde réelle : utilisateur authentifié synthétique.
const authStub = 'data:text/javascript,' + encodeURIComponent(`
  const auth = { user: { id: 'synthetic' }, loading: false };
  export function useAuth() { return auth; }`);
// Garde lue par la page : état fourni par le test ; la décision d'ouverture est testée à part.
const gateStub = 'data:text/javascript,' + encodeURIComponent(`
  export function usePayablesChequesGate() { return { gate: globalThis.__payablesTestGate, refresh() {} }; }`);
register('data:text/javascript,' + encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === '@/integrations/supabase/client') return { shortCircuit: true, url: ${JSON.stringify(supabaseStub)} };
    if (specifier === './payablesRuntimeTarget' && context.parentURL
      && (context.parentURL.includes('payablesChequesService') || context.parentURL.includes('PayablesChequesGate'))) {
      return { shortCircuit: true, url: ${JSON.stringify(targetStub)} };
    }
    if (specifier === '@/contexts/AuthContext' && context.parentURL && context.parentURL.includes('PayablesChequesGate')) {
      return { shortCircuit: true, url: ${JSON.stringify(authStub)} };
    }
    if (specifier === '@/features/payables-cheques/PayablesChequesGate' && context.parentURL
      && context.parentURL.includes('pages/PayablesCheques')) {
      return { shortCircuit: true, url: ${JSON.stringify(gateStub)} };
    }
    return nextResolve(specifier, context);
  }`));

// --- DOM minimal : ce que react-dom/client utilise pour monter, mettre à jour
// et déléguer les événements à la racine. -------------------------------------
interface FakeEvent {
  type: string;
  target: FakeNode | null;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented: boolean;
  timeStamp: number;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
type Listener = { fn: (event: FakeEvent) => void; capture: boolean };

class FakeNode {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly nodeType: number, readonly nodeName: string, public ownerDocument: FakeDocument | null) {}
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child: FakeNode): FakeNode {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child: FakeNode, before: FakeNode | null): FakeNode {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  contains(node: FakeNode | null): boolean {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(value: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (value) this.appendChild(new FakeText(String(value), this.ownerDocument));
  }
  addEventListener(type: string, fn: (event: FakeEvent) => void, options?: boolean | { capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn, capture }]);
  }
  removeEventListener(type: string, fn: (event: FakeEvent) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l.fn !== fn));
  }
  dispatchEvent(event: FakeEvent): boolean {
    event.target = this;
    const path: FakeNode[] = [this];
    for (let n = this.parentNode; n; n = n.parentNode) path.push(n);
    for (const node of [...path].reverse()) {
      for (const l of node.listeners.get(event.type) ?? []) if (l.capture && !event.stopped) l.fn(event);
    }
    path.forEach((node, index) => {
      if (index > 0 && !event.bubbles) return;
      for (const l of node.listeners.get(event.type) ?? []) if (!l.capture && !event.stopped) l.fn(event);
    });
    return !event.defaultPrevented;
  }
}

class FakeText extends FakeNode {
  constructor(public nodeValue: string, ownerDocument: FakeDocument | null) { super(3, '#text', ownerDocument); }
  get textContent(): string { return this.nodeValue; }
  set textContent(value: string) { this.nodeValue = value; }
  get data(): string { return this.nodeValue; }
}

class FakeElement extends FakeNode {
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> & { setProperty(name: string, value: string): void } =
    Object.assign(Object.create(null) as Record<string, string>, { setProperty(this: Record<string, string>, n: string, v: string) { this[n] = v; } });
  // Propriétés de formulaire : simples champs (react-dom n'installe alors pas de suivi de valeur).
  value = '';
  defaultValue = '';
  name = '';
  checked = false;
  defaultChecked = false;
  selected = false;
  defaultSelected = false;
  multiple = false;
  onclick: unknown = undefined;
  constructor(readonly tagName: string, ownerDocument: FakeDocument) { super(1, tagName, ownerDocument); }
  setAttribute(name: string, value: unknown): void { this.attributes.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  get type(): string { return this.getAttribute('type') ?? 'text'; }
  set type(value: string) { this.setAttribute('type', value); }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  get id(): string { return this.getAttribute('id') ?? ''; }
  get options(): FakeElement[] { return descendants(this).filter((n) => n.tagName === 'OPTION'); }
  focus(): void {}
  blur(): void {}
}

class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement | null = null;
  oninput: unknown = null;
  constructor() {
    super(9, '#document', null);
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  getElementsByTagName(tag: string): FakeElement[] { return descendants(this).filter((n) => n.tagName === tag.toUpperCase()); }
  createElement(tag: string): FakeElement { return new FakeElement(tag.toUpperCase(), this); }
  createElementNS(_ns: string, tag: string): FakeElement { return this.createElement(tag); }
  createTextNode(text: string): FakeText { return new FakeText(text, this); }
}

function descendants(node: FakeNode): FakeElement[] {
  const out: FakeElement[] = [];
  for (const child of node.childNodes) {
    if (child instanceof FakeElement) out.push(child, ...descendants(child));
  }
  return out;
}

function makeEvent(type: string): FakeEvent {
  return {
    type, target: null, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

const fakeDocument = new FakeDocument();
testGlobal.window = globalThis;
testGlobal.document = fakeDocument;
testGlobal.HTMLIFrameElement = class FakeIFrame {};
// Node 20 (CI) n'a pas de navigator global ; react-dom le lit dès qu'un DOM est présent.
if (typeof testGlobal.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
}
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
// Le lanceur de tests compile le JSX en React.createElement (transformation classique).
testGlobal.React = React;

const { act } = React;
const { createRoot } = await import('react-dom/client');
const { ParametersPanel } = await import('./ParametersPanel');
const { PAYABLES_QUERY_ROOT } = await import('./payablesUi');
type Access = Parameters<typeof ParametersPanel>[0]['access'];
type DomRoot = Parameters<typeof createRoot>[0];

const adminAccess: Access = {
  user_id: '10000000-0000-4000-8000-000000000051', capabilities: [], person_id: '20000000-0000-4000-8000-000000000051',
  business_writes_enabled: false, export_enabled: false, governance_model: 'SINGLE_ADMIN', admin_configured: true, is_admin: true,
};
const categoryVersion = (versionNo: number, label: string) => ({
  id: `v${versionNo}`, kind: 'CATEGORY', subject_key: 'ALL_PAYMENTS', version_no: versionNo, valid_from: `2026-0${versionNo}-01`,
  payload: { code: 'ALL_PAYMENTS', label, state: 'ACTIVE' }, status: 'VALIDATED', origin: 'ADMIN', proposed_by: adminAccess.user_id,
});

async function mount(seed: Partial<Record<'persons' | 'person-links' | 'grants' | 'parameters', unknown[]>>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const [key, rows] of Object.entries(seed)) client.setQueryData([PAYABLES_QUERY_ROOT, key], rows);
  const container = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(container);
  const root = createRoot(container as unknown as DomRoot);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><ParametersPanel access={adminAccess} /></QueryClientProvider>);
  });
  await settle();
  return { client, container, unmount: () => act(() => root.unmount()) };
}

// React Query notifie ses abonnés au tick suivant : attendre quelques ticks dans act().
async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** Rafraîchissement du cache des paramètres, comme après la relecture d'un autre onglet. */
async function refreshCache(client: QueryClient, rows: unknown[]) {
  await act(async () => { client.setQueryData([PAYABLES_QUERY_ROOT, 'parameters'], rows); });
  await settle();
}

const find = (container: FakeElement, predicate: (el: FakeElement) => boolean, what: string): FakeElement => {
  const el = descendants(container).find(predicate);
  assert.ok(el, `element not found: ${what}`);
  return el;
};
const button = (container: FakeElement, label: string) =>
  find(container, (el) => el.tagName === 'BUTTON' && el.textContent.trim() === label, `button ${label}`);
const field = (container: FakeElement, label: string) =>
  find(container, (el) => el.getAttribute('aria-label') === label || el.id === label, `field ${label}`);
const text = (container: FakeElement) => container.textContent;

async function type(el: FakeElement, value: string) {
  await act(async () => { el.value = value; el.dispatchEvent(makeEvent('input')); });
}
async function click(el: FakeElement) {
  await act(async () => { el.dispatchEvent(makeEvent('click')); });
  await settle();
}
const parameterCalls = () => rpcCalls.filter((c) => c.name === 'payables_admin_set_parameter_v1');

test('saisie commencée sur v1, cache passé à v2 : conflit signalé, aucun envoi, jeton v1 jamais renouvelé en silence', async () => {
  rpcCalls.length = 0;
  // Versions connues du serveur : le rafraîchissement d'après décision les relit.
  let serverVersions = [categoryVersion(1, 'Version 1')];
  rpcHandler = (name, args) => {
    if (name === 'payables_admin_set_parameter_v1') {
      serverVersions = [...serverVersions, categoryVersion(3, 'Ma saisie')];
      return { data: { version_id: 'v3', version_no: 3 }, error: null };
    }
    return { data: args.p_list === 'parameters' ? serverVersions : [], error: null };
  };
  const ui = await mount({ persons: [], 'person-links': [], grants: [], parameters: serverVersions });
  await type(field(ui.container, 'admin-reason'), 'Motif synthétique');
  const myDraft = JSON.stringify({ code: 'ALL_PAYMENTS', label: 'Ma saisie', state: 'ACTIVE' });
  await type(field(ui.container, 'Contenu (JSON)'), myDraft);
  assert.match(text(ui.container), /Nouvelle version sur la version 1 relue/);

  // Un autre onglet de l'administrateur publie v2 ; le cache se rafraîchit.
  serverVersions = [categoryVersion(1, 'Version 1'), categoryVersion(2, 'Version 2')];
  await refreshCache(ui.client, serverVersions);
  assert.match(text(ui.container), /La version 2 de ce paramètre a été enregistrée depuis le début de votre saisie, fondée sur la version 1/);
  assert.match(text(ui.container), /Version 2/, 'the concurrent version is shown for review');
  assert.match(text(ui.container), /Nouvelle version sur la version 1 relue/, 'reference version stays v1');
  const save = button(ui.container, 'Enregistrer la version');
  assert.ok(save.disabled, 'save blocked while the conflict stands');
  await click(save);
  assert.equal(parameterCalls().length, 0, 'no submission, hence no silent renewal of the v1 token');
  assert.equal(field(ui.container, 'Contenu (JSON)').value, myDraft, 'the draft is kept');

  // Confirmation explicite : la même saisie, fondée cette fois sur v2.
  await click(button(ui.container, 'Conserver ma saisie sur la version 2'));
  assert.doesNotMatch(text(ui.container), /a été enregistrée depuis le début de votre saisie/);
  assert.match(text(ui.container), /Nouvelle version sur la version 2 relue/);
  await click(button(ui.container, 'Enregistrer la version'));
  assert.equal(parameterCalls().length, 1);
  assert.equal(parameterCalls()[0].args.p_expected_version_no, 2);
  assert.deepEqual(parameterCalls()[0].args.p_payload, JSON.parse(myDraft));
  // Sa propre décision devient la référence : aucun faux conflit une fois le cache relu en v3.
  assert.equal(ui.client.getQueryData<unknown[]>([PAYABLES_QUERY_ROOT, 'parameters'])?.length, 3, 'cache refreshed after the decision');
  assert.doesNotMatch(text(ui.container), /a été enregistrée depuis le début de votre saisie/);
  assert.match(text(ui.container), /Nouvelle version sur la version 3 relue/);
  await ui.unmount();
});

test('conflit levé par rechargement : contenu de la version concurrente, justificatif à refournir', async () => {
  rpcCalls.length = 0;
  rpcHandler = () => ({ data: [], error: null });
  const ui = await mount({ persons: [], 'person-links': [], grants: [], parameters: [categoryVersion(1, 'Version 1')] });
  await type(field(ui.container, 'Pièce justificative'), 'Pièce synthétique');
  await type(field(ui.container, 'Contenu (JSON)'), '{"label":"Ma saisie"}');
  await refreshCache(ui.client, [categoryVersion(1, 'Version 1'), categoryVersion(2, 'Version 2')]);
  await click(button(ui.container, 'Recharger la saisie depuis la version 2'));
  assert.deepEqual(JSON.parse(field(ui.container, 'Contenu (JSON)').value), categoryVersion(2, 'Version 2').payload);
  assert.equal(field(ui.container, 'Pièce justificative').value, '');
  assert.match(text(ui.container), /Nouvelle version sur la version 2 relue/);
  assert.equal(parameterCalls().length, 0);
  await ui.unmount();
});

test('lecture des habilitations en échec puis reprise : erreur distincte du vide, décisions suspendues, saisie conservée', async () => {
  rpcCalls.length = 0;
  let grantsFail = true;
  const grantRow = { id: 'g1', user_id: 'aaaaaaaa-0000-4000-8000-000000000001', capability: 'READ', action: 'GRANT',
    status: 'VALIDATED', origin: 'ADMIN', decision_seq: 1, proposed_by: adminAccess.user_id };
  rpcHandler = (name, args) => {
    if (name === 'payables_read_v1' && args.p_list === 'capability_grants') {
      return grantsFail ? { data: null, error: { message: 'PAYABLES_READ_INCOMPLETE' } } : { data: [grantRow], error: null };
    }
    return { data: [], error: null };
  };
  const ui = await mount({ persons: [], 'person-links': [], parameters: [] });
  await type(field(ui.container, 'admin-reason'), 'Motif synthétique');
  await type(field(ui.container, 'admin-grant-user'), 'bbbbbbbb-0000-4000-8000-000000000002');
  assert.match(text(ui.container), /Lecture « Habilitations » impossible : Lecture incomplète/);
  assert.match(text(ui.container), /Habilitations indisponibles : la lecture a échoué/);
  assert.doesNotMatch(text(ui.container), /Aucune habilitation attribuée/, 'a failed read is never shown as an empty list');
  assert.ok(button(ui.container, 'Attribuer').disabled, 'decisions depending on the failed read are suspended');
  await click(button(ui.container, 'Attribuer'));
  assert.equal(rpcCalls.filter((c) => c.name === 'payables_admin_set_capability_v1').length, 0);

  grantsFail = false;
  await click(button(ui.container, 'Réessayer'));
  assert.doesNotMatch(text(ui.container), /impossible/);
  assert.match(text(ui.container), /aaaaaaaa/);
  assert.equal(field(ui.container, 'admin-grant-user').value, 'bbbbbbbb-0000-4000-8000-000000000002', 'the draft survived the retry');
  assert.ok(!button(ui.container, 'Attribuer').disabled, 'decisions available again once the read succeeds');
  assert.equal(rpcCalls.filter((c) => c.name === 'payables_read_v1' && c.args.p_list === 'capability_grants').length, 2);
  await ui.unmount();
});

test('retaper la clé du paramètre ne refonde jamais la saisie : le conflit reste, aucun envoi', async () => {
  rpcCalls.length = 0;
  rpcHandler = () => ({ data: [], error: null });
  const ui = await mount({ persons: [], 'person-links': [], grants: [], parameters: [categoryVersion(1, 'Version 1')] });
  await type(field(ui.container, 'admin-reason'), 'Motif synthétique');
  await type(field(ui.container, 'Contenu (JSON)'), '{"label":"Ma saisie"}');
  await refreshCache(ui.client, [categoryVersion(1, 'Version 1'), categoryVersion(2, 'Version 2')]);
  assert.match(text(ui.container), /fondée sur la version 1/);
  await type(field(ui.container, 'Clé du paramètre'), 'ALL_PAYMENTSX');
  await type(field(ui.container, 'Clé du paramètre'), 'ALL_PAYMENTS');
  assert.match(text(ui.container), /La version 2 de ce paramètre a été enregistrée depuis le début de votre saisie, fondée sur la version 1/);
  assert.match(text(ui.container), /Nouvelle version sur la version 1 relue/);
  const save = button(ui.container, 'Enregistrer la version');
  assert.ok(save.disabled);
  await click(save);
  assert.equal(parameterCalls().length, 0);
  await ui.unmount();
});

test('version concurrente vue par le serveur : relecture, conflit affiché, saisie conservée', async () => {
  rpcCalls.length = 0;
  let serverVersions = [categoryVersion(1, 'Version 1')];
  rpcHandler = (name, args) => {
    if (name === 'payables_admin_set_parameter_v1') {
      // Un autre onglet a déjà publié v2, que ce cache n'a pas encore relue.
      serverVersions = [categoryVersion(1, 'Version 1'), categoryVersion(2, 'Version 2')];
      return { data: null, error: { message: 'PAYABLES_STALE_VERSION' } };
    }
    return { data: args.p_list === 'parameters' ? serverVersions : [], error: null };
  };
  const ui = await mount({ persons: [], 'person-links': [], grants: [], parameters: serverVersions });
  await type(field(ui.container, 'admin-reason'), 'Motif synthétique');
  await type(field(ui.container, 'Contenu (JSON)'), '{"label":"Ma saisie"}');
  await click(button(ui.container, 'Enregistrer la version'));
  assert.equal(parameterCalls().length, 1);
  assert.equal(parameterCalls()[0].args.p_expected_version_no, 1);
  assert.ok(rpcCalls.some((c) => c.name === 'payables_read_v1' && c.args.p_list === 'parameters'), 'versions re-read after the refusal');
  assert.match(text(ui.container), /La version 2 de ce paramètre a été enregistrée depuis le début de votre saisie, fondée sur la version 1/);
  assert.ok(button(ui.container, 'Enregistrer la version').disabled);
  assert.equal(field(ui.container, 'Contenu (JSON)').value, '{"label":"Ma saisie"}');
  await ui.unmount();
});

// --- Production : administration seule -------------------------------------
// Verdict de production fourni au service (la liste blanche est donc active) et
// garde de page fournie par le test ; la page réelle et ses panneaux réels sont montés.
const ADMIN_LISTS = ['capability_grants', 'parameters', 'person_links', 'persons'];
const productionVerdict = { allowed: true, environment: 'production', mode: 'admin-only' };

async function mountPage() {
  const { default: PayablesCheques } = await import('../../pages/PayablesCheques');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const container = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(container);
  const root = createRoot(container as unknown as DomRoot);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><PayablesCheques /></QueryClientProvider>);
  });
  await settle();
  return { client, container, unmount: () => act(() => root.unmount()) };
}

test('production, administration seule : seul le panneau d’administration est monté, seules ses quatre listes sont lues', async () => {
  rpcCalls.length = 0;
  testGlobal.__payablesTestVerdict = productionVerdict;
  testGlobal.__payablesTestGate = { status: 'allowed', access: adminAccess, mode: 'admin-only' };
  rpcHandler = (name) => (name === 'payables_read_v1'
    ? { data: [], error: null }
    : { data: null, error: { message: 'PAYABLES_TEST_NO_NETWORK' } });
  const ui = await mountPage();
  try {
    assert.match(text(ui.container), /Administration du module chèques/);
    assert.match(text(ui.container), /Production : administration seule/);
    assert.ok(button(ui.container, 'Créer la personne'), 'the administration panel is mounted');
    assert.equal(descendants(ui.container).filter((el) => el.getAttribute('role') === 'tab').length, 0, 'no other panel tab');
    assert.ok(rpcCalls.length > 0, 'the administration lists are read');
    for (const call of rpcCalls) {
      assert.equal(call.name, 'payables_read_v1', `no other server call (${call.name})`);
      assert.deepEqual(call.args.p_args, {});
    }
    assert.deepEqual([...new Set(rpcCalls.map((c) => String(c.args.p_list)))].sort(), ADMIN_LISTS);
  } finally {
    await ui.unmount();
    delete testGlobal.__payablesTestVerdict;
    delete testGlobal.__payablesTestGate;
  }
});

test('production, administration seule : une décision de l’administrateur part vers sa seule fonction serveur', async () => {
  rpcCalls.length = 0;
  testGlobal.__payablesTestVerdict = productionVerdict;
  testGlobal.__payablesTestGate = { status: 'allowed', access: adminAccess, mode: 'admin-only' };
  rpcHandler = (name) => (name === 'payables_read_v1'
    ? { data: [], error: null }
    : { data: { ok: true }, error: null });
  const ui = await mountPage();
  try {
    await type(field(ui.container, 'admin-reason'), 'Motif synthétique');
    await type(field(ui.container, 'admin-person'), 'Personne fictive');
    await click(button(ui.container, 'Créer la personne'));
    const writes = rpcCalls.filter((c) => c.name !== 'payables_read_v1');
    assert.deepEqual(writes.map((c) => c.name), ['payables_admin_create_person_v1']);
    assert.equal(writes[0].args.p_display_name, 'Personne fictive');
  } finally {
    await ui.unmount();
    delete testGlobal.__payablesTestVerdict;
    delete testGlobal.__payablesTestGate;
  }
});

test('page en administration seule, liste blanche coupée : aucun autre panneau ne lit quoi que ce soit', async () => {
  // Verdict « full » vu par le service : seule la page empêche les autres panneaux de demander leurs listes.
  rpcCalls.length = 0;
  testGlobal.__payablesTestGate = { status: 'allowed', access: { ...adminAccess, capabilities: ['READ', 'AUDIT', 'BANK_READ'] }, mode: 'admin-only' };
  rpcHandler = (name) => (name === 'payables_read_v1'
    ? { data: [], error: null }
    : { data: null, error: { message: 'PAYABLES_TEST_NO_NETWORK' } });
  const ui = await mountPage();
  try {
    assert.deepEqual([...new Set(rpcCalls.map((c) => `${c.name}:${String(c.args.p_list)}`))].sort(),
      ADMIN_LISTS.map((l) => `payables_read_v1:${l}`));
    assert.doesNotMatch(text(ui.container), /Registre des chèques|File de travail|Position bancaire|Suivi bancaire/);
  } finally {
    await ui.unmount();
    delete testGlobal.__payablesTestGate;
  }
});

test('page : mode de garde inattendu traité comme administration seule', async () => {
  rpcCalls.length = 0;
  testGlobal.__payablesTestGate = { status: 'allowed', access: adminAccess };
  rpcHandler = (name) => (name === 'payables_read_v1'
    ? { data: [], error: null }
    : { data: null, error: { message: 'PAYABLES_TEST_NO_NETWORK' } });
  const ui = await mountPage();
  try {
    assert.match(text(ui.container), /Administration du module chèques/);
    assert.equal(descendants(ui.container).filter((el) => el.getAttribute('role') === 'tab').length, 0);
    assert.deepEqual([...new Set(rpcCalls.map((c) => String(c.args.p_list)))].sort(), ADMIN_LISTS);
  } finally {
    await ui.unmount();
    delete testGlobal.__payablesTestGate;
  }
});

test('production, garde fermée (utilisateur non administrateur) : rien n’est monté, aucun appel', async () => {
  rpcCalls.length = 0;
  testGlobal.__payablesTestVerdict = productionVerdict;
  testGlobal.__payablesTestGate = { status: 'blocked', reason: 'Réservé à l’administrateur désigné.' };
  const ui = await mountPage();
  try {
    assert.equal(ui.container.childNodes.length, 0);
    assert.deepEqual(rpcCalls, []);
  } finally {
    await ui.unmount();
    delete testGlobal.__payablesTestVerdict;
    delete testGlobal.__payablesTestGate;
  }
});

// --- Garde réelle : mode de la cible et autorité reconnue par le serveur ---------
async function gateFor(verdict: unknown, access: Access) {
  rpcCalls.length = 0;
  testGlobal.__payablesTestVerdict = verdict;
  rpcHandler = (name) => (name === 'payables_my_access_v1'
    ? { data: access, error: null }
    : { data: null, error: { message: 'PAYABLES_TEST_NO_NETWORK' } });
  const { PayablesChequesGateProvider, usePayablesChequesGate } = await import('./PayablesChequesGate');
  let seen: unknown = null;
  const Probe = () => { seen = usePayablesChequesGate().gate; return null; };
  const container = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(container);
  const root = createRoot(container as unknown as DomRoot);
  await act(async () => { root.render(<PayablesChequesGateProvider><Probe /></PayablesChequesGateProvider>); });
  await settle();
  await act(() => root.unmount());
  delete testGlobal.__payablesTestVerdict;
  return seen as { status: string; mode?: string; reason?: string };
}
const accountant: Access = { ...adminAccess, is_admin: false, capabilities: ['READ', 'AUDIT', 'SUPPLIER_MANAGE', 'CHEQUE_CONFIRM_ISSUE'] };

test('garde réelle, production : l’administrateur reconnu ouvre l’administration seule', async () => {
  const gate = await gateFor(productionVerdict, { ...adminAccess, capabilities: ['READ'] });
  assert.equal(gate.status, 'allowed');
  assert.equal(gate.mode, 'admin-only');
  assert.deepEqual(rpcCalls.map((c) => c.name), ['payables_my_access_v1'], 'the server decides, once');
});

test('garde réelle, production : un comptable, même habilité, reste dehors', async () => {
  const gate = await gateFor(productionVerdict, accountant);
  assert.equal(gate.status, 'blocked');
  assert.match(String(gate.reason), /réservé à l’administrateur désigné/);
});

test('garde réelle, verdict incohérent (production « full ») : traité comme administration seule', async () => {
  const gate = await gateFor({ allowed: true, environment: 'production', mode: 'full' }, accountant);
  assert.equal(gate.status, 'blocked');
  const admin = await gateFor({ allowed: true, environment: 'production', mode: 'full' }, { ...adminAccess, capabilities: ['READ'] });
  assert.equal(admin.mode, 'admin-only');
});

test('garde réelle, non-régression local : module complet sur lecture', async () => {
  const gate = await gateFor({ allowed: true, environment: 'local', mode: 'full' }, accountant);
  assert.equal(gate.status, 'allowed');
  assert.equal(gate.mode, 'full');
  const refused = await gateFor({ allowed: false, reason: 'Le module chèques reste interdit en production.' }, accountant);
  assert.equal(refused.status, 'blocked');
  assert.deepEqual(rpcCalls, [], 'refused target: no server call');
});
