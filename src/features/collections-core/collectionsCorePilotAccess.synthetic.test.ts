import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  assertExactCollectionsCorePilotEntry,
  assertExactCollectionsCorePilotValidation,
  collectionsCorePilotActor,
  collectionsCorePilotBootstrapCommandKey,
  collectionsCorePilotBootstrapReason,
  collectionsCorePilotCapabilitySpecs,
  evaluateCollectionsCorePilotGate,
  isCollectionsCorePilotActionAllowed,
} from './collectionsCorePilotAccess';
import type { CollectionsCoreRuntimeVerdict } from './collectionsCoreRuntimeTarget';

const G = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN = `PILOT-0Z1B-20260805-G${G.replace(/-/g, '')}-Naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

function stagingVerdict(overrides: Record<string, string | undefined> = {}): CollectionsCoreRuntimeVerdict {
  const dataset = {
    entry: {
      clientName: `${CAMPAIGN}:CLIENT`, method: 'CHECK', amount: 1000, currency: 'XOF',
      clientBank: `${CAMPAIGN}:CLIENT_BANK`, depositAccountId: '44444444-4444-4444-8444-444444444444',
      depositDate: '2026-08-05', declaredCreditDate: '',
      instrumentReference: `${CAMPAIGN}:CHECK:1`, maturityDate: '',
      invoiceReference: `${CAMPAIGN}:INVOICE:1`, slipReference: `${CAMPAIGN}:SLIP:1`,
      businessNature: 'STANDARD', note: `${CAMPAIGN}:SYNTHETIC`,
    },
    entryCommandKey: `${CAMPAIGN}:ENTRY`,
    validationReason: `${CAMPAIGN}:VALIDATION`,
    validationCommandKey: `${CAMPAIGN}:VALIDATE`,
  };
  const bytes = Buffer.from(JSON.stringify(dataset), 'utf8');
  return {
    allowed: true,
    environment: 'staging',
    pilotRaw: {
      campaignId: CAMPAIGN,
      grantorUserId: G,
      operatorUserId: A,
      controllerUserId: B,
      datasetBase64: bytes.toString('base64'),
      datasetSha256: createHash('sha256').update(bytes).digest('hex'),
      ...overrides,
    },
  };
}

function phaseBVerdict(): CollectionsCoreRuntimeVerdict {
  const base = stagingVerdict();
  if ('reason' in base || base.environment !== 'staging') throw new Error('staging verdict expected');
  const dataset = JSON.parse(Buffer.from(base.pilotRaw.datasetBase64, 'base64').toString('utf8'));
  dataset.phaseB = {
    remittanceItemId: '44444444-4444-4444-8444-444444444441',
    dailyLineId: '44444444-4444-4444-8444-444444444442',
    canonicalUnitId: '44444444-4444-4444-8444-444444444443',
    dailyLineHash: 'a'.repeat(64), accountRegistryId: '44444444-4444-4444-8444-444444444444',
    accountingDate: '2026-08-05', creditAmount: 1000, currency: 'XOF',
    sourceAttemptId: '44444444-4444-4444-8444-444444444445', sourceRawTextHash: 'b'.repeat(64),
    dateFrom: '2026-08-05', dateTo: '2026-09-04', evidenceBasis: 'EXACT_CREDIT', settledGrossAmount: 1000,
    proposalReason: `${CAMPAIGN}:PROPOSAL_REASON`, proposalCommandKey: `${CAMPAIGN}:PROPOSE_MATCH`,
    confirmationReason: `${CAMPAIGN}:CONFIRMATION_REASON`, confirmationCommandKey: `${CAMPAIGN}:CONFIRM_MATCH`,
    expiresAt: '2099-08-05T23:59:59Z',
  };
  const bytes = Buffer.from(JSON.stringify(dataset), 'utf8');
  return { ...base, pilotRaw: { ...base.pilotRaw, datasetBase64: bytes.toString('base64'), datasetSha256: createHash('sha256').update(bytes).digest('hex') } };
}

test('valide le manifeste, son hash brut et le dataset fermé', async () => {
  const gate = await evaluateCollectionsCorePilotGate(stagingVerdict());
  assert.equal(gate.status, 'allowed');
  assert.equal(gate.status === 'allowed' && gate.environment, 'staging');
  if (gate.status !== 'allowed' || gate.environment !== 'staging') return;
  assert.equal(collectionsCorePilotActor(gate.pilotManifest, G), 'G');
  assert.equal(collectionsCorePilotActor(gate.pilotManifest, A), 'A');
  assert.equal(collectionsCorePilotActor(gate.pilotManifest, B), 'B');
  assert.deepEqual(collectionsCorePilotCapabilitySpecs(gate.pilotManifest).map((row) => row.capability), [
    'ENTRY', 'VALIDATE_REMITTANCE', 'AUDIT',
  ]);
  assert.equal(collectionsCorePilotBootstrapReason(gate.pilotManifest), `${CAMPAIGN}:BOOTSTRAP_MANAGE_ACCESS`);
  assert.equal(collectionsCorePilotBootstrapCommandKey(gate.pilotManifest), `${CAMPAIGN}:GRANT:G:MANAGE_ACCESS`);
});

test('refuse hash, Base64, identités ou campagne altérés', async () => {
  for (const overrides of [
    { datasetSha256: '0'.repeat(64) },
    { datasetBase64: '!!!!' },
    { operatorUserId: G },
    { campaignId: `${CAMPAIGN.slice(0, -1)}b` },
  ]) {
    assert.equal((await evaluateCollectionsCorePilotGate(stagingVerdict(overrides))).status, 'blocked');
  }
});

test('lie strictement chaque action à G, A ou B et bloque toujours la phase B', async () => {
  const gate = await evaluateCollectionsCorePilotGate(stagingVerdict());
  if (gate.status !== 'allowed' || gate.environment !== 'staging') assert.fail('manifest expected');
  const manifest = gate.pilotManifest;
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, G, 'administration'), true);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, G, 'entry'), false);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, A, 'entry'), true);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, A, 'validation'), false);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, B, 'validation'), true);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, B, 'audit'), true);
  for (const userId of [G, A, B]) {
    assert.equal(isCollectionsCorePilotActionAllowed(manifest, userId, 'phase_b_propose'), false);
    assert.equal(isCollectionsCorePilotActionAllowed(manifest, userId, 'phase_b_review'), false);
  }
});

test('ouvre seulement la tranche Phase B scellée et produit les scopes serveur exacts', async () => {
  const gate = await evaluateCollectionsCorePilotGate(phaseBVerdict());
  if (gate.status !== 'allowed' || gate.environment !== 'staging') assert.fail('phase B manifest expected');
  const manifest = gate.pilotManifest;
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, A, 'phase_b_propose'), true);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, A, 'phase_b_review'), false);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, B, 'phase_b_review'), true);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, B, 'phase_b_propose'), false);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, G, 'phase_b_propose'), false);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, G, 'phase_b_review'), false);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, A, 'entry'), false);
  assert.equal(isCollectionsCorePilotActionAllowed(manifest, B, 'validation'), false);
  const specs = collectionsCorePilotCapabilitySpecs(manifest);
  assert.deepEqual(specs.map((row) => row.capability), ['PROPOSE_MATCH', 'CONFIRM_MATCH', 'AUDIT']);
  assert.deepEqual(specs[0].scope, specs[1].scope);
  assert.deepEqual(specs[0].scope?.daily_line_ids, [manifest.dataset.phaseB?.dailyLineId]);
  assert.deepEqual(specs[0].scope?.daily_line_hashes, [manifest.dataset.phaseB?.dailyLineHash]);
});

test('exige l’égalité exacte des commandes métier du pilote', async () => {
  const gate = await evaluateCollectionsCorePilotGate(stagingVerdict());
  if (gate.status !== 'allowed' || gate.environment !== 'staging') assert.fail('manifest expected');
  const manifest = gate.pilotManifest;
  assert.doesNotThrow(() => assertExactCollectionsCorePilotEntry(
    manifest, manifest.dataset.entry, manifest.dataset.entryCommandKey,
  ));
  assert.throws(() => assertExactCollectionsCorePilotEntry(
    manifest, { ...manifest.dataset.entry, amount: 999 }, manifest.dataset.entryCommandKey,
  ));
  assert.doesNotThrow(() => assertExactCollectionsCorePilotValidation(
    manifest, manifest.dataset.validationReason, manifest.dataset.validationCommandKey,
  ));
  assert.throws(() => assertExactCollectionsCorePilotValidation(
    manifest, `${CAMPAIGN}:OTHER`, manifest.dataset.validationCommandKey,
  ));
});
