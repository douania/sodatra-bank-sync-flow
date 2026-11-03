import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareOperationalPayloads } from './dailyV2OperationalFixtures.synthetic';

// All fixtures are fully synthetic and go through the real Daily v2 pipeline
// (real idempotency key builders, real aggregates derivation).

function unitOf(payloads: Awaited<ReturnType<typeof prepareOperationalPayloads>>, key: string, index = 0) {
  const result = payloads.get(key);
  assert.ok(result, `missing scenario ${key}`);
  return { attempt: result.payload.p_attempt, unit: result.payload.p_units[index], lines: result.payload.p_lines };
}

test('same movements, different balances: same hashes, different financial version (R6, C4 bis)', async () => {
  const payloads = await prepareOperationalPayloads();
  const wrong = unitOf(payloads, 'wrong');
  const right = unitOf(payloads, 'right');
  assert.equal(wrong.unit.day_unit_id, right.unit.day_unit_id);
  assert.equal(wrong.unit.day_content_hash, right.unit.day_content_hash);
  assert.deepEqual(wrong.lines.map((l) => l.daily_line_hash), right.lines.map((l) => l.daily_line_hash));
  assert.equal(wrong.unit.aggregates_status, 'derived');
  assert.equal(right.unit.aggregates_status, 'derived');
  assert.equal(wrong.unit.opening_balance_derived, 90);
  assert.equal(wrong.unit.closing_balance_derived, 100);
  assert.equal(right.unit.opening_balance_derived, 100);
  assert.equal(right.unit.closing_balance_derived, 110);
  assert.equal(wrong.unit.day_total_credits, right.unit.day_total_credits);
  assert.equal(wrong.unit.day_total_debits, right.unit.day_total_debits);
  // The running balance is carried per line, outside the hash.
  assert.notEqual(wrong.lines[0].running_balance, right.lines[0].running_balance);
});

test('another file of the same version is another raw source (R6, P1)', async () => {
  const payloads = await prepareOperationalPayloads();
  const wrong = unitOf(payloads, 'wrong');
  const f2 = unitOf(payloads, 'wrong_f2');
  assert.notEqual(wrong.attempt.raw_text_hash, f2.attempt.raw_text_hash);
  assert.equal(wrong.unit.day_content_hash, f2.unit.day_content_hash);
  assert.equal(wrong.unit.opening_balance_derived, f2.unit.opening_balance_derived);
  assert.equal(wrong.unit.closing_balance_derived, f2.unit.closing_balance_derived);
});

test('breakdown and unavailable variants (R6, three outcomes)', async () => {
  const payloads = await prepareOperationalPayloads();
  const right = unitOf(payloads, 'right');
  const breakdown = unitOf(payloads, 'breakdown');
  const unavailable = unitOf(payloads, 'unavailable');
  // Breakdown: other movements, same net and balances, different totals.
  assert.notEqual(breakdown.unit.day_content_hash, right.unit.day_content_hash);
  assert.equal(breakdown.unit.opening_balance_derived, right.unit.opening_balance_derived);
  assert.equal(breakdown.unit.closing_balance_derived, right.unit.closing_balance_derived);
  assert.equal(
    breakdown.unit.day_total_credits - breakdown.unit.day_total_debits,
    right.unit.day_total_credits - right.unit.day_total_debits,
  );
  assert.notEqual(breakdown.unit.day_total_debits, right.unit.day_total_debits);
  // Unavailable: same movements, balances absent (never zero).
  assert.equal(unavailable.unit.day_content_hash, right.unit.day_content_hash);
  assert.equal(unavailable.unit.aggregates_status, 'unavailable');
  assert.equal(unavailable.unit.opening_balance_derived, null);
  assert.equal(unavailable.unit.closing_balance_derived, null);
});

test('the later corrective file carries the corrected version and a later delivered day', async () => {
  const payloads = await prepareOperationalPayloads();
  const right = unitOf(payloads, 'right');
  const later = payloads.get('right_later');
  assert.ok(later);
  const units = later.payload.p_units;
  assert.equal(units.length, 2);
  const same = units.find((u) => u.day_unit_id === right.unit.day_unit_id);
  assert.ok(same);
  assert.equal(same.day_content_hash, right.unit.day_content_hash);
  assert.equal(same.opening_balance_derived, 100);
  assert.ok(units.some((u) => u.accounting_date > same.accounting_date));
});
