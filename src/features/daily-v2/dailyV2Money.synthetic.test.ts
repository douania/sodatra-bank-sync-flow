import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAILY_V2_MAX_EXACT_MAJOR_UNITS_EXCLUSIVE,
  addDailyV2MinorUnits,
  dailyV2MinorUnitsToDecimalText,
  formatDailyV2MinorUnits,
  subtractDailyV2MinorUnits,
  toDailyV2MinorUnits,
} from './dailyV2Money';

test('converts zero and one/two-decimal synthetic amounts exactly', () => {
  assert.equal(toDailyV2MinorUnits(0), 0n);
  assert.equal(toDailyV2MinorUnits(0.01), 1n);
  assert.equal(toDailyV2MinorUnits(0.1), 10n);
  assert.equal(toDailyV2MinorUnits(1.23), 123n);
  assert.equal(toDailyV2MinorUnits(123.45), 12345n);
  assert.equal(toDailyV2MinorUnits(1000000), 100000000n);
  assert.equal(toDailyV2MinorUnits(-0.01), -1n);
  assert.equal(toDailyV2MinorUnits(-0.1), -10n);
  assert.equal(toDailyV2MinorUnits(-1.23), -123n);
  assert.equal(toDailyV2MinorUnits(-123.45), -12345n);
});

test('accepts large synthetic values under the exclusive 2^42 limit', () => {
  assert.equal(toDailyV2MinorUnits(999999999.99), 99999999999n);
  assert.equal(toDailyV2MinorUnits(-999999999.99), -99999999999n);
  // Largest representable two-decimal amount below the limit.
  assert.equal(toDailyV2MinorUnits(2 ** 42 - 0.01), 439804651110399n);
  assert.equal(toDailyV2MinorUnits(-(2 ** 42 - 0.01)), -439804651110399n);
});

test('adjacent two-decimal values near the limit stay distinct and exact', () => {
  const lower = toDailyV2MinorUnits(4398046511103.98);
  const upper = toDailyV2MinorUnits(4398046511103.99);
  assert.equal(lower, 439804651110398n);
  assert.equal(upper, 439804651110399n);
  assert.notEqual(lower, upper);
  assert.equal(upper - lower, 1n);
});

test('rejects the 2^42 limit itself and anything beyond, out-of-range', () => {
  assert.equal(DAILY_V2_MAX_EXACT_MAJOR_UNITS_EXCLUSIVE, 2 ** 42);
  for (const bad of [
    2 ** 42,
    -(2 ** 42),
    2 ** 42 + 0.01,
    9999999999999.99,
    -9999999999999.99,
  ]) {
    assert.throws(() => toDailyV2MinorUnits(bad), /AMOUNT_MINOR_UNITS_OUT_OF_SAFE_RANGE/);
  }
});

test('rejects three-decimal amounts inside the range as precision loss', () => {
  assert.throws(() => toDailyV2MinorUnits(3000000000000.994), /AMOUNT_PRECISION_LOSS/);
  assert.throws(() => toDailyV2MinorUnits(0.001), /AMOUNT_PRECISION_LOSS/);
});

test('rejects scientific-notation magnitudes as precision loss', () => {
  for (const bad of [1e-9, 2e-7, -3.5e-8]) {
    assert.throws(() => toDailyV2MinorUnits(bad), /AMOUNT_PRECISION_LOSS/);
  }
});

test('rejects strings, null, undefined and other non-number inputs fail-closed', () => {
  for (const bad of ['1.23', '', null, undefined, true, 123n, { amount: 1 }, [1.23]]) {
    assert.throws(() => toDailyV2MinorUnits(bad), /AMOUNT_RUNTIME_TYPE_UNSAFE/);
  }
});

test('rejects NaN and Infinity fail-closed', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => toDailyV2MinorUnits(bad), /AMOUNT_RUNTIME_TYPE_UNSAFE/);
  }
});

test('rejects three-decimal amounts instead of silently rounding', () => {
  assert.throws(() => toDailyV2MinorUnits(1.234), /AMOUNT_PRECISION_LOSS/);
  assert.throws(() => toDailyV2MinorUnits(-0.005), /AMOUNT_PRECISION_LOSS/);
});

test('rejects amounts whose minor units leave the Number safe range', () => {
  assert.throws(() => toDailyV2MinorUnits(Number.MAX_SAFE_INTEGER), /AMOUNT_MINOR_UNITS_OUT_OF_SAFE_RANGE/);
  assert.throws(() => toDailyV2MinorUnits(-Number.MAX_SAFE_INTEGER), /AMOUNT_MINOR_UNITS_OUT_OF_SAFE_RANGE/);
});

test('adds exactly in bigint, beyond float precision', () => {
  assert.equal(addDailyV2MinorUnits([]), 0n);
  assert.equal(addDailyV2MinorUnits([1n, 2n, 3n]), 6n);
  // 90071992547409.91 * 100 sits near 2^53: float addition would drift.
  const nearLimit = 9007199254740991n;
  assert.equal(addDailyV2MinorUnits([nearLimit, 1n, 1n]), 9007199254740993n);
  assert.equal(addDailyV2MinorUnits([nearLimit, -nearLimit]), 0n);
});

test('rejects non-bigint members in additions and subtractions', () => {
  assert.throws(
    () => addDailyV2MinorUnits([1n, 2 as unknown as bigint]),
    /AMOUNT_BIGINT_EXPECTED/,
  );
  assert.throws(
    () => subtractDailyV2MinorUnits(1n, 2 as unknown as bigint),
    /AMOUNT_BIGINT_EXPECTED/,
  );
});

test('subtracts exactly in bigint', () => {
  assert.equal(subtractDailyV2MinorUnits(500n, 125n), 375n);
  assert.equal(subtractDailyV2MinorUnits(125n, 500n), -375n);
  assert.equal(subtractDailyV2MinorUnits(0n, 0n), 0n);
});

test('renders exact decimal text with two decimals and no -0.00', () => {
  assert.equal(dailyV2MinorUnitsToDecimalText(0n), '0.00');
  assert.equal(dailyV2MinorUnitsToDecimalText(1n), '0.01');
  assert.equal(dailyV2MinorUnitsToDecimalText(10n), '0.10');
  assert.equal(dailyV2MinorUnitsToDecimalText(123n), '1.23');
  assert.equal(dailyV2MinorUnitsToDecimalText(-123n), '-1.23');
  assert.equal(dailyV2MinorUnitsToDecimalText(100000000n), '1000000.00');
  assert.equal(dailyV2MinorUnitsToDecimalText(9007199254740993n), '90071992547409.93');
  assert.equal(dailyV2MinorUnitsToDecimalText(-1n), '-0.01');
  assert.doesNotMatch(dailyV2MinorUnitsToDecimalText(0n), /^-/);
});

test('formats with grouping and currency using string operations only', () => {
  assert.equal(formatDailyV2MinorUnits(0n, 'XOF'), '0.00 XOF');
  assert.equal(formatDailyV2MinorUnits(123n, 'XOF'), '1.23 XOF');
  assert.equal(formatDailyV2MinorUnits(100000000n, 'XOF'), '1 000 000.00 XOF');
  assert.equal(formatDailyV2MinorUnits(-100000001n, 'XOF'), '-1 000 000.01 XOF');
  assert.equal(formatDailyV2MinorUnits(4200n, ''), '42.00');
});
