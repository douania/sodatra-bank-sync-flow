/**
 * Bigint minor-units money contract for Daily v2 reporting
 * (DAILY-V2-CANONICAL-REPORTING-EXPORT-0O).
 *
 * Every financial total of the reporting feature flows through this module:
 * amounts received from PostgREST as JS numbers are converted fail-closed to
 * minor units (integer cents) as bigint, all additions/subtractions stay in
 * bigint, and rendering back to decimal text is pure string arithmetic.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - PURE and browser-safe: no I/O, no Supabase, no Node-only import;
 *  - no silent rounding, no fallback to zero, no float-parsing helper, no
 *    string accepted as an amount, no bigint→number conversion for any
 *    computation or export;
 *  - a value that cannot be represented exactly in minor units rejects the
 *    whole computation with a controlled, non-sensitive error code.
 */

export type DailyV2MinorUnits = bigint;

export const DAILY_V2_MONEY_ERROR_CODES = Object.freeze({
  runtimeType: 'AMOUNT_RUNTIME_TYPE_UNSAFE',
  outOfSafeRange: 'AMOUNT_MINOR_UNITS_OUT_OF_SAFE_RANGE',
  precisionLoss: 'AMOUNT_PRECISION_LOSS',
  bigintExpected: 'AMOUNT_BIGINT_EXPECTED',
} as const);

/**
 * Exclusive magnitude ceiling for exact conversion: below 2^42 major units, a
 * two-decimal amount scaled by 100 stays far inside the Number safe-integer
 * range, so every accepted value has an exact minor-units representation.
 */
export const DAILY_V2_MAX_EXACT_MAJOR_UNITS_EXCLUSIVE = 2 ** 42;

/**
 * Lexical gate on String(value): plain decimal notation only — an integer
 * part without spurious leading zeros, at most two decimals, no scientific
 * notation. Anything else is a precision loss, never rounded away.
 */
const DAILY_V2_DECIMAL_NUMBER_PATTERN =
  /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

/** Fixed maximum distance tolerated between value*100 and its rounded integer. */
const DAILY_V2_MAX_SCALED_ROUNDING_DISTANCE = 0.05;

/**
 * Convert a runtime amount (JS number carrying at most 2 decimals) to exact
 * minor units. Fail-closed, in this order: runtime type, finiteness, exclusive
 * 2^42 magnitude ceiling, lexical decimal gate, safe-integer minor units and
 * fixed rounding distance. A rejected value is never rounded away, defaulted
 * or clamped.
 */
export function toDailyV2MinorUnits(value: unknown): DailyV2MinorUnits {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(DAILY_V2_MONEY_ERROR_CODES.runtimeType);
  }

  if (Math.abs(value) >= DAILY_V2_MAX_EXACT_MAJOR_UNITS_EXCLUSIVE) {
    throw new Error(DAILY_V2_MONEY_ERROR_CODES.outOfSafeRange);
  }

  if (!DAILY_V2_DECIMAL_NUMBER_PATTERN.test(String(value))) {
    throw new Error(DAILY_V2_MONEY_ERROR_CODES.precisionLoss);
  }

  const scaled = value * 100;
  const rounded = Math.round(scaled);

  if (!Number.isSafeInteger(rounded)) {
    throw new Error(DAILY_V2_MONEY_ERROR_CODES.outOfSafeRange);
  }

  if (Math.abs(scaled - rounded) > DAILY_V2_MAX_SCALED_ROUNDING_DISTANCE) {
    throw new Error(DAILY_V2_MONEY_ERROR_CODES.precisionLoss);
  }

  return BigInt(rounded);
}

/** Exact bigint sum; the accumulator is never a JS number. */
export function addDailyV2MinorUnits(
  values: readonly DailyV2MinorUnits[],
): DailyV2MinorUnits {
  let total = 0n;
  for (const value of values) {
    assertMinorUnits(value);
    total += value;
  }
  return total;
}

/** Exact bigint subtraction (left - right). */
export function subtractDailyV2MinorUnits(
  left: DailyV2MinorUnits,
  right: DailyV2MinorUnits,
): DailyV2MinorUnits {
  assertMinorUnits(left);
  assertMinorUnits(right);
  return left - right;
}

/**
 * Render minor units as an exact decimal text with exactly two decimals,
 * using bigint and string operations only. 0n renders as "0.00" and a
 * negative zero can never appear.
 */
export function dailyV2MinorUnitsToDecimalText(value: DailyV2MinorUnits): string {
  assertMinorUnits(value);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const units = absolute / 100n;
  const cents = absolute % 100n;
  const text = `${units.toString()}.${cents.toString().padStart(2, '0')}`;
  return negative && absolute !== 0n ? `-${text}` : text;
}

/**
 * Human-oriented rendering: exact decimal text with thousands separators
 * (plain spaces) and the trusted currency label appended. Pure
 * string/bigint operations — the amount never transits through number.
 */
export function formatDailyV2MinorUnits(
  value: DailyV2MinorUnits,
  currency: string,
): string {
  const decimalText = dailyV2MinorUnitsToDecimalText(value);
  const negative = decimalText.startsWith('-');
  const unsigned = negative ? decimalText.slice(1) : decimalText;
  const [unitsPart, centsPart] = unsigned.split('.');

  let grouped = '';
  for (let index = 0; index < unitsPart.length; index++) {
    const positionFromEnd = unitsPart.length - index;
    grouped += unitsPart[index];
    if (positionFromEnd > 1 && (positionFromEnd - 1) % 3 === 0) {
      grouped += ' ';
    }
  }

  const label = currency.trim();
  const core = `${grouped}.${centsPart}`;
  const signed = negative ? `-${core}` : core;
  return label === '' ? signed : `${signed} ${label}`;
}

function assertMinorUnits(value: unknown): asserts value is bigint {
  if (typeof value !== 'bigint') {
    throw new Error(DAILY_V2_MONEY_ERROR_CODES.bigintExpected);
  }
}
