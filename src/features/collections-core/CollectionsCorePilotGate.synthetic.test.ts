import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gate = readFileSync(new URL('./CollectionsCorePilotGate.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../components/Layout.tsx', import.meta.url), 'utf8');

test('le provider partage les trois états et refuse les comptes hors manifeste', () => {
  assert.match(gate, /status: 'checking'/);
  assert.match(gate, /status: 'blocked'/);
  assert.match(gate, /resolved\.status !== 'allowed'/);
  assert.match(gate, /collectionsCorePilotActor/);
  assert.match(gate, /Ce compte ne fait pas partie des trois acteurs du pilote/);
});

test('App et Layout consomment la même garde asynchrone', () => {
  assert.match(app, /CollectionsCorePilotGateProvider/);
  assert.match(app, /useCollectionsCorePilotGate/);
  assert.match(layout, /useCollectionsCorePilotGate/);
  assert.doesNotMatch(layout, /currentCollectionsCoreRuntimeVerdict/);
});
