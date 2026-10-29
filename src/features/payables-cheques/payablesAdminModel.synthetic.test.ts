import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminState,
  currentLinks,
  editParameterDraft,
  effectiveGrants,
  expectedParameterVersion,
  legacyPendingProposals,
  parameterDraftConflict,
  parameterDraftExpectedVersion,
  readState,
  rebaseParameterDraft,
  reloadParameterDraft,
  savedParameterDraft,
  type ParameterDraft,
} from './payablesAdminModel';
import {
  PAYABLES_ASSIGNABLE_CAPABILITIES,
  type CapabilityGrantRow,
  type ParameterVersionRow,
  type PayablesAccess,
  type PersonLinkRow,
} from './payablesChequesTypes';

const access = (overrides: Partial<PayablesAccess>): PayablesAccess => ({
  user_id: 'u-dg', capabilities: [], person_id: null, business_writes_enabled: false, export_enabled: false,
  governance_model: 'SINGLE_ADMIN', admin_configured: true, is_admin: false, ...overrides,
});

const grant = (id: string, user: string, capability: CapabilityGrantRow['capability'], action: 'GRANT' | 'REVOKE', seq: number | null,
  status: CapabilityGrantRow['status'] = 'VALIDATED'): CapabilityGrantRow => ({
  id, user_id: user, capability, action, status, origin: 'ADMIN', decision_seq: seq, proposed_by: 'u-dg',
});

test('autorité : uniquement celle que renvoie le serveur, jamais une capacité héritée', () => {
  assert.equal(adminState(access({ admin_configured: false })), 'NOT_CONFIGURED');
  assert.equal(adminState(access({ is_admin: true })), 'ADMIN');
  // Ancien détenteur des capacités de gouvernance, interrupteur ouvert : aucune autorité.
  assert.equal(adminState(access({ capabilities: ['PARAM_PROPOSE', 'PARAM_VALIDATE'], business_writes_enabled: true })), 'NOT_ADMIN');
});

test('capacités attribuables : les capacités de gouvernance retirées n’en font pas partie', () => {
  assert.ok(!PAYABLES_ASSIGNABLE_CAPABILITIES.includes('PARAM_PROPOSE'));
  assert.ok(!PAYABLES_ASSIGNABLE_CAPABILITIES.includes('PARAM_VALIDATE'));
  assert.equal(PAYABLES_ASSIGNABLE_CAPABILITIES.length, 13);
});

test('droits en vigueur : dernière décision validée, révocation comprise, capacités retirées ignorées', () => {
  const rights = effectiveGrants([
    grant('g1', 'u-a', 'READ', 'GRANT', 1),
    grant('g2', 'u-a', 'SUPPLIER_MANAGE', 'GRANT', 2),
    grant('g3', 'u-a', 'SUPPLIER_MANAGE', 'REVOKE', 5),
    grant('g4', 'u-a', 'CHEQUE_PREPARE_PRINT', 'GRANT', 3),
    grant('g5', 'u-a', 'BANK_READ', 'GRANT', null, 'PROPOSED'),
    { ...grant('g6', 'u-b', 'PARAM_VALIDATE', 'GRANT', 4), origin: 'BOOTSTRAP' },
    grant('g7', 'u-b', 'READ', 'REVOKE', 7),
    grant('g8', 'u-b', 'READ', 'GRANT', 6),
  ]);
  assert.deepEqual(rights.get('u-a'), ['CHEQUE_PREPARE_PRINT', 'READ']);
  assert.equal(rights.has('u-b'), false, 'the later revocation wins and retired grants confer nothing');
});

test('rattachements : dernier lien validé ; un retrait détache', () => {
  const link = (id: string, user: string, person: string, action: 'LINK' | 'UNLINK', seq: number): PersonLinkRow => ({
    id, person_id: person, user_id: user, action, status: 'VALIDATED', origin: 'ADMIN', decision_seq: seq, proposed_by: 'u-dg',
  });
  const links = currentLinks([link('l1', 'u-a', 'p-a', 'LINK', 1), link('l2', 'u-b', 'p-b', 'LINK', 2), link('l3', 'u-b', 'p-b', 'UNLINK', 3)]);
  assert.equal(links.get('u-a'), 'p-a');
  assert.equal(links.has('u-b'), false);
});

test('version attendue d’un paramètre : dernier numéro connu, 0 sinon', () => {
  const version = (no: number, status: ParameterVersionRow['status']): ParameterVersionRow => ({
    id: `v${no}`, kind: 'CATEGORY', subject_key: 'ALL_PAYMENTS', version_no: no, valid_from: '2026-01-01', payload: {},
    status, origin: 'ADMIN', proposed_by: 'u-dg',
  });
  assert.equal(expectedParameterVersion([version(1, 'VALIDATED'), version(2, 'REJECTED'), version(3, 'PROPOSED')],
    'CATEGORY', 'ALL_PAYMENTS'), 3);
  assert.equal(expectedParameterVersion([version(1, 'VALIDATED')], 'CATEGORY', 'OTHER'), 0);
});

test('propositions héritées : seules celles restées en attente, de chaque type', () => {
  const legacy = legacyPendingProposals({
    persons: [{ id: 'p1', display_name: 'Personne en attente', status: 'PROPOSED', origin: 'PROPOSAL', proposed_by: 'u-x' },
      { id: 'p2', display_name: 'Personne active', status: 'ACTIVE', origin: 'ADMIN', proposed_by: 'u-dg' }],
    links: [], parameters: [],
    grants: [{ ...grant('g1', 'u-a', 'AUDIT', 'GRANT', null, 'PROPOSED'), origin: 'PROPOSAL', proposed_by: 'u-y' }],
  });
  assert.deepEqual(legacy.map((l) => [l.kind, l.id, l.proposedBy]), [['PERSON', 'p1', 'u-x'], ['CAPABILITY', 'g1', 'u-y']]);
});

test('rattachement établi par l’opérateur : sans auteur applicatif, il compte comme identité en vigueur', () => {
  const links = currentLinks([{ id: 'l1', person_id: 'p-dg', user_id: 'u-dg', action: 'LINK', status: 'VALIDATED', origin: 'OPERATOR',
    decision_seq: 9, proposed_by: null }]);
  assert.equal(links.get('u-dg'), 'p-dg');
});

test('états de lecture : un échec, même avec des données anciennes, n’est jamais une liste disponible', () => {
  assert.equal(readState({ isPending: true, isError: false }), 'LOADING');
  assert.equal(readState({ isPending: false, isError: true }), 'ERROR');
  assert.equal(readState({ isPending: false, isError: false }), 'READY');
});

test('brouillon de paramètre : référence fixée à la saisie, conflit si une version arrive, jamais d’avance silencieuse', () => {
  const version = (no: number, label: string): ParameterVersionRow => ({
    id: `v${no}`, kind: 'CATEGORY', subject_key: 'ALL_PAYMENTS', version_no: no, valid_from: `2026-0${no}-01`,
    payload: { label }, status: 'VALIDATED', origin: 'ADMIN', proposed_by: 'u-dg',
  });
  const v1 = [version(1, 'v1')];
  const v2 = [version(1, 'v1'), version(2, 'v2')];
  const start: ParameterDraft = { kind: 'CATEGORY', subjectKey: 'ALL_PAYMENTS', validFrom: '2026-10-28', payload: '{}',
    evidenceRef: '', baseVersion: null, knownBases: {} };
  // Rien de saisi : la version connue du moment fait foi.
  assert.equal(parameterDraftExpectedVersion(start, v1), 1);
  const typed = editParameterDraft(start, { payload: '{"label":"ma saisie"}' }, v1);
  assert.equal(typed.baseVersion, 1);
  assert.equal(editParameterDraft(typed, { evidenceRef: 'Pièce' }, v2).baseVersion, 1, 'later edits keep the reference');
  // v2 publiée ailleurs : conflit, aucune version attendue transmissible.
  assert.deepEqual(parameterDraftConflict(typed, v2), { base: 1, current: 2, latest: v2[1] });
  assert.equal(parameterDraftExpectedVersion(typed, v2), null);
  // Levée explicite : confirmation (saisie conservée) ou rechargement (contenu de v2, justificatif à refournir).
  const rebased = rebaseParameterDraft(typed, v2);
  assert.equal(rebased.payload, typed.payload);
  assert.equal(parameterDraftExpectedVersion(rebased, v2), 2);
  const reloaded = reloadParameterDraft({ ...typed, evidenceRef: 'Pièce' }, v2);
  assert.deepEqual(JSON.parse(reloaded.payload), { label: 'v2' });
  assert.equal(reloaded.evidenceRef, '');
  assert.equal(parameterDraftExpectedVersion(reloaded, v2), 2);
  // Changer de paramètre visé fixe la référence de ce nouveau paramètre ; y revenir rend la sienne
  // (revue indépendante P2-2 : retaper la clé ne refonde jamais le brouillon en silence).
  const elsewhere = editParameterDraft(typed, { subjectKey: 'ALL_PAYMENTSX' }, v2);
  assert.equal(elsewhere.baseVersion, 0);
  const back = editParameterDraft(elsewhere, { subjectKey: 'ALL_PAYMENTS' }, v2);
  assert.equal(back.baseVersion, 1);
  assert.deepEqual(parameterDraftConflict(back, v2), { base: 1, current: 2, latest: v2[1] });
  // Sa propre décision fixe la référence du paramètre enregistré.
  assert.equal(savedParameterDraft(back, 'CATEGORY', 'ALL_PAYMENTS', 3).baseVersion, 3);
  assert.equal(savedParameterDraft(elsewhere, 'CATEGORY', 'ALL_PAYMENTS', 3).knownBases['CATEGORY|ALL_PAYMENTS'], 3);
});
