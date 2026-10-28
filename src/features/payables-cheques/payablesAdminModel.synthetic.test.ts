import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminState,
  currentLinks,
  effectiveGrants,
  expectedParameterVersion,
  legacyPendingProposals,
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
