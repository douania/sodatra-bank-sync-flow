import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Rendu réel du panneau d'administration. Doubles injectés au chargement des
// modules (hook de résolution Node), jamais par une option de production : le
// client Supabase et la cible d'exécution sont remplacés avant le premier
// import ; aucune requête ne part, les listes sont fournies au cache.
const supabaseStub = 'data:text/javascript,' + encodeURIComponent(`
  export const supabase = {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    rpc: () => Promise.resolve({ data: null, error: { message: 'PAYABLES_TEST_NO_NETWORK' } }),
  };`);
const targetStub = 'data:text/javascript,' + encodeURIComponent(`
  export function currentPayablesRuntimeVerdict() { return { allowed: true, environment: 'local' }; }
  export function isRuntimeRefused(v) { return v.allowed === false; }`);
register('data:text/javascript,' + encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === '@/integrations/supabase/client') return { shortCircuit: true, url: ${JSON.stringify(supabaseStub)} };
    if (specifier === './payablesRuntimeTarget' && context.parentURL && context.parentURL.includes('payablesChequesService')) {
      return { shortCircuit: true, url: ${JSON.stringify(targetStub)} };
    }
    return nextResolve(specifier, context);
  }`));

// Le lanceur de tests compile le JSX en React.createElement (transformation
// classique) ; le build Vite utilise la transformation automatique.
(globalThis as unknown as { React: typeof React }).React = React;
const { ParametersPanel } = await import('./ParametersPanel');
const { PAYABLES_QUERY_ROOT } = await import('./payablesUi');
type Access = Parameters<typeof ParametersPanel>[0]['access'];

const baseAccess: Access = {
  user_id: '10000000-0000-4000-8000-000000000051', capabilities: [], person_id: null, business_writes_enabled: false,
  export_enabled: false, governance_model: 'SINGLE_ADMIN', admin_configured: true, is_admin: false,
};

function render(access: Access, seed: { grants?: unknown[]; persons?: unknown[] } = {}): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData([PAYABLES_QUERY_ROOT, 'persons'], seed.persons ?? []);
  client.setQueryData([PAYABLES_QUERY_ROOT, 'person-links'], []);
  client.setQueryData([PAYABLES_QUERY_ROOT, 'grants'], seed.grants ?? []);
  client.setQueryData([PAYABLES_QUERY_ROOT, 'parameters'], []);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}><ParametersPanel access={access} /></QueryClientProvider>,
  );
}

const ADMIN_CONTROLS = ['Créer la personne', 'Rattacher', 'Attribuer', 'Retirer', 'Enregistrer la version'];

test('administrateur désigné : formulaires disponibles pendant que les écritures métier restent fermées', () => {
  const html = render({ ...baseAccess, is_admin: true, business_writes_enabled: false });
  for (const label of ADMIN_CONTROLS) assert.match(html, new RegExp(`>${label}<`), label);
  assert.match(html, /Écritures métier fermées : l’administration reste possible, aucune opération financière ne l’est\./);
  assert.doesNotMatch(html, /Proposer|Valider/, 'no proposal or second validation flow');
  // Liste des capacités attribuables : aucune capacité de gouvernance retirée.
  assert.doesNotMatch(html, /value="PARAM_PROPOSE"|value="PARAM_VALIDATE"/);
  assert.match(html, /value="CHEQUE_CONFIRM_ISSUE"/);
});

test('comptable, même ancien détenteur des capacités de gouvernance et module ouvert : consultation seule', () => {
  const html = render({ ...baseAccess, user_id: 'u-acc', capabilities: ['READ', 'PARAM_PROPOSE', 'PARAM_VALIDATE'],
    business_writes_enabled: true });
  assert.match(html, /Consultation seule : l’administration est réservée à l’administrateur du module\./);
  for (const label of ADMIN_CONTROLS) assert.doesNotMatch(html, new RegExp(`>${label}<`), label);
});

test('aucun administrateur désigné : administration fermée, aucun formulaire', () => {
  const html = render({ ...baseAccess, admin_configured: false, is_admin: false });
  assert.match(html, /Aucun administrateur n’est désigné : l’administration du module est fermée\./);
  for (const label of ADMIN_CONTROLS) assert.doesNotMatch(html, new RegExp(`>${label}<`), label);
});

test('droits en vigueur et propositions héritées : affichés ; seul l’administrateur peut clore celles des autres', () => {
  const grants = [
    { id: 'g1', user_id: 'aaaaaaaa-0000-4000-8000-000000000001', capability: 'READ', action: 'GRANT', status: 'VALIDATED',
      origin: 'ADMIN', decision_seq: 2, proposed_by: baseAccess.user_id },
    { id: 'g2', user_id: 'aaaaaaaa-0000-4000-8000-000000000001', capability: 'AUDIT', action: 'GRANT', status: 'PROPOSED',
      origin: 'PROPOSAL', decision_seq: null, proposed_by: 'bbbbbbbb-0000-4000-8000-000000000002' },
    { id: 'g3', user_id: 'aaaaaaaa-0000-4000-8000-000000000003', capability: 'BANK_READ', action: 'GRANT', status: 'PROPOSED',
      origin: 'PROPOSAL', decision_seq: null, proposed_by: baseAccess.user_id },
  ];
  const admin = render({ ...baseAccess, is_admin: true }, { grants });
  assert.match(admin, /aaaaaaaa/);
  assert.match(admin, /Propositions héritées en attente/);
  assert.equal((admin.match(/>Clore</g) ?? []).length, 1, 'own legacy proposal cannot be closed by the administrator');
  const reader = render({ ...baseAccess, user_id: 'u-acc', capabilities: ['READ'] }, { grants });
  assert.match(reader, /Propositions héritées en attente/);
  assert.doesNotMatch(reader, />Clore</);
});

test('le panneau n’appelle que l’API d’administration et ne lit l’autorité que du serveur', () => {
  const panel = readFileSync(new URL('./ParametersPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /propose(Capability|Person|PersonLink|Parameter)|decide(Capability|Person|PersonLink|Parameter)/);
  assert.doesNotMatch(panel, /PARAM_PROPOSE|PARAM_VALIDATE|hasCapability\(/, 'no legacy capability gates the administration');
  assert.match(panel, /adminState\(access\)/);
  const service = readFileSync(new URL('./payablesChequesService.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /payables_(propose|decide)_(capability|person|person_link|parameter)_v1/);
});

test('la garde de cible d’exécution est inchangée : la production reste refusée', () => {
  const target = readFileSync(new URL('./payablesRuntimeTarget.ts', import.meta.url), 'utf8');
  assert.match(target, /if \(hostname === PRODUCTION_HOST \|\| input\.projectId === PAYABLES_PRODUCTION_PROJECT_REF\) \{\s+return \{ allowed: false, reason: 'Le module chèques reste interdit en production\.' \};/);
});
