import assert from 'node:assert/strict';
import test from 'node:test';
import { canDeclarePrintOutcome, INITIAL_PRINT_FLOW, parseTakeoverLines, printFlowReducer, type PrintFlowState } from './printFlow';
import type { PrintIntentResult } from './payablesChequesTypes';

const intent: PrintIntentResult = {
  print_event_id: 'e', kind: 'INITIAL', form_version: 2, fields: {}, layout: {}, profile_version_id: 'p',
};

test('afterprint n’enregistre jamais un résultat : il ouvre seulement la confirmation', () => {
  let state: PrintFlowState = INITIAL_PRINT_FLOW;
  state = printFlowReducer(state, { type: 'INTENT_RECORDED', intent });
  state = printFlowReducer(state, { type: 'PRINT_STARTED' });
  assert.equal(canDeclarePrintOutcome(state), false);
  state = printFlowReducer(state, { type: 'AFTERPRINT' });
  assert.equal(state.step, 'awaiting_confirmation');
  assert.equal(canDeclarePrintOutcome(state), true);
  state = printFlowReducer(state, { type: 'OUTCOME_RECORDED', outcome: 'UNCERTAIN' });
  assert.deepEqual(state, { step: 'confirmed', outcome: 'UNCERTAIN' });
});

test('aucun résultat sans intention enregistrée ni avant la fin de l’impression', () => {
  assert.deepEqual(printFlowReducer(INITIAL_PRINT_FLOW, { type: 'OUTCOME_RECORDED', outcome: 'PRINTED' }), INITIAL_PRINT_FLOW);
  assert.deepEqual(printFlowReducer(INITIAL_PRINT_FLOW, { type: 'PRINT_STARTED' }), INITIAL_PRINT_FLOW);
  assert.deepEqual(printFlowReducer(INITIAL_PRINT_FLOW, { type: 'AFTERPRINT' }), INITIAL_PRINT_FLOW);
  const recorded = printFlowReducer(INITIAL_PRINT_FLOW, { type: 'INTENT_RECORDED', intent });
  assert.equal(printFlowReducer(recorded, { type: 'OUTCOME_RECORDED', outcome: 'PRINTED' }).step, 'intent_recorded');
  const printing = printFlowReducer(recorded, { type: 'PRINT_STARTED' });
  assert.equal(printFlowReducer(printing, { type: 'OUTCOME_RECORDED', outcome: 'PRINTED' }).step, 'printing');
});

test('lot de reprise : zéros conservés, aucune correction silencieuse', () => {
  const ok = parseTakeoverLines('0012345;Bénéficiaire fictif;150000;2026-09-30\n\n0012346 ; Autre fictif ; 75000 ; 2026-09-29');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.items.map((i) => i.cheque_number), ['0012345', '0012346']);
  assert.equal(typeof ok.items[0].cheque_number, 'string');
  const bad = parseTakeoverLines('12A;X;10.5;30/09/2026\n123;Bénéficiaire;0;2026-09-30\nseul champ');
  // Ligne 1 : numéro, bénéficiaire, montant et date invalides ; ligne 2 : montant nul ; ligne 3 : forme.
  assert.equal(bad.errors.length, 6);
});
