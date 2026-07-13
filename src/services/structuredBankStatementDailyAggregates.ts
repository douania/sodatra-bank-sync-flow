/**
 * Pure daily aggregates derivation for structured bank statement daily units
 * (DAILY-RPC-V2-PAYLOAD-0G).
 *
 * Doctrine CTO (0F acted):
 *  - the day totals (line count, total debits, total credits) are ALWAYS
 *    derivable from the lines themselves (direction + signedAmount);
 *  - opening/closing balances are DERIVED from the running balances only when
 *    every line carries one and the chain is positively coherent
 *    (runningBalance[i] = runningBalance[i-1] + signedAmount[i], with
 *    opening = first.runningBalance - first.signedAmount and
 *    closing = last.runningBalance);
 *  - when a running balance is missing or the chain does not reconcile:
 *    aggregatesStatus = 'unavailable' and validationStatus = 'needs_review'.
 *    NO balance is ever fabricated, defaulted or silently corrected.
 *
 * Hard boundaries (deliberately not crossed here):
 *  - PURE and BROWSER-SAFE: no import of any kind, no I/O, no DB, no Supabase,
 *    no hashing, no clock, no randomness. Same input, same output.
 *  - Controlled result, never a throw: invalid business input (unmappable
 *    direction, non-strict amount, direction/sign mismatch) comes back as
 *    `errors` with aggregatesStatus 'unavailable' — a bad line never crashes
 *    the composition and never produces partial aggregates.
 *  - Money arithmetic runs on bigint cents with a strict exact-output cap, so
 *    neither per-line conversion nor daily summation can silently lose cents.
 */

/** Minimal structural view of one daily line, decoupled from the 0E module. */
export interface StructuredBankStatementDailyAggregatesLineInput {
  direction: 'debit' | 'credit' | string;
  signedAmount: number;
  /** Optional: some sources legitimately omit the per-line running balance. */
  runningBalance?: number;
}

export interface StructuredBankStatementDailyAggregates {
  lineCount: number;
  dayTotalDebits: number;
  dayTotalCredits: number;
  /** Present ONLY when aggregatesStatus is 'derived'; never fabricated. */
  openingBalanceDerived?: number;
  /** Present ONLY when aggregatesStatus is 'derived'; never fabricated. */
  closingBalanceDerived?: number;
  aggregatesStatus: 'derived' | 'unavailable';
  validationStatus: 'valid' | 'needs_review';
  /** Invalid business input (bug-grade): totals are zeroed, nothing derived. */
  errors: string[];
  /** Legitimate underivability (missing balance, incoherent chain). */
  warnings: string[];
}

const STRICT_AMOUNT_PATTERN = /^-?\d{1,13}(\.\d{1,2})?$/;
const MAX_ABSOLUTE_AMOUNT_CENTS = 100_000_000_000_000n;

/**
 * Derive the day-level aggregates of ONE accounting day from its lines.
 *
 * All-or-nothing on validity: any invalid line yields `errors`, zeroed totals
 * and no derived balance. Missing/incoherent running balances are NOT errors:
 * they yield 'unavailable' + 'needs_review' with the totals still computed.
 */
export function deriveStructuredBankStatementDailyAggregates(
  lines: StructuredBankStatementDailyAggregatesLineInput[]
): StructuredBankStatementDailyAggregates {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      lineCount: 0,
      dayTotalDebits: 0,
      dayTotalCredits: 0,
      aggregatesStatus: 'unavailable',
      validationStatus: 'needs_review',
      errors: ['at least one line is required to derive daily aggregates (fail-closed).'],
      warnings
    };
  }

  lines.forEach((line, index) => {
    if (line.direction !== 'debit' && line.direction !== 'credit') {
      errors.push(
        `lines[${index}]: direction "${String(line.direction)}" is not mappable to debit/credit (fail-closed).`
      );
      return;
    }
    if (!isStrictAmount(line.signedAmount)) {
      errors.push(
        `lines[${index}]: signedAmount must be finite, exact to cents and within the monetary safety cap.`
      );
      return;
    }
    // Direction/sign coherence (mirror of the v1 one_amount gate): a zero or
    // wrongly signed amount is bug-grade input, never aggregated.
    if (line.direction === 'debit' && !(line.signedAmount < 0)) {
      errors.push(`lines[${index}]: a debit line requires signedAmount < 0 (zero is refused).`);
    }
    if (line.direction === 'credit' && !(line.signedAmount > 0)) {
      errors.push(`lines[${index}]: a credit line requires signedAmount > 0 (zero is refused).`);
    }
    if (line.runningBalance !== undefined && !isStrictAmount(line.runningBalance)) {
      errors.push(
        `lines[${index}]: runningBalance, when present, must be finite, exact to cents and within the monetary safety cap.`
      );
    }
  });

  if (errors.length > 0) {
    return {
      lineCount: lines.length,
      dayTotalDebits: 0,
      dayTotalCredits: 0,
      aggregatesStatus: 'unavailable',
      validationStatus: 'needs_review',
      errors,
      warnings
    };
  }

  // Totals: always derivable from direction + signedAmount, in integer cents.
  let debitCents = 0n;
  let creditCents = 0n;
  for (const line of lines) {
    const cents = toCents(line.signedAmount);
    if (line.direction === 'debit') {
      debitCents += -cents;
    } else {
      creditCents += cents;
    }
  }
  if (!isCentsWithinOutputCap(debitCents) || !isCentsWithinOutputCap(creditCents)) {
    return {
      lineCount: lines.length,
      dayTotalDebits: 0,
      dayTotalCredits: 0,
      aggregatesStatus: 'unavailable',
      validationStatus: 'needs_review',
      errors: ['daily debit or credit total exceeds the exact monetary output cap (fail-closed).'],
      warnings
    };
  }

  // Opening/closing: derived only from a COMPLETE and COHERENT balance chain.
  let openingBalanceDerived: number | undefined;
  let closingBalanceDerived: number | undefined;
  let aggregatesStatus: 'derived' | 'unavailable' = 'unavailable';

  const missingIndex = lines.findIndex((line) => line.runningBalance === undefined);
  if (missingIndex >= 0) {
    warnings.push(
      `lines[${missingIndex}]: runningBalance is missing; opening/closing balances are not derivable ` +
        'and are never fabricated (aggregates unavailable).'
    );
  } else {
    let coherent = true;
    let previousBalanceCents = 0n;
    for (let index = 0; index < lines.length; index++) {
      const balanceCents = toCents(lines[index].runningBalance as number);
      const signedCents = toCents(lines[index].signedAmount);
      if (index > 0 && balanceCents !== previousBalanceCents + signedCents) {
        warnings.push(
          `lines[${index}]: running balance chain is incoherent ` +
            '(balance does not equal previous balance plus signed amount); ' +
            'opening/closing balances are not derivable and are never fabricated (aggregates unavailable).'
        );
        coherent = false;
        break;
      }
      previousBalanceCents = balanceCents;
    }
    if (coherent) {
      const firstBalanceCents = toCents(lines[0].runningBalance as number);
      const firstSignedCents = toCents(lines[0].signedAmount);
      const openingCents = firstBalanceCents - firstSignedCents;
      if (!isCentsWithinOutputCap(openingCents)) {
        return {
          lineCount: lines.length,
          dayTotalDebits: 0,
          dayTotalCredits: 0,
          aggregatesStatus: 'unavailable',
          validationStatus: 'needs_review',
          errors: ['derived opening balance exceeds the exact monetary output cap (fail-closed).'],
          warnings
        };
      }
      openingBalanceDerived = fromCents(openingCents);
      closingBalanceDerived = fromCents(toCents(lines[lines.length - 1].runningBalance as number));
      aggregatesStatus = 'derived';
    }
  }

  return {
    lineCount: lines.length,
    dayTotalDebits: fromCents(debitCents),
    dayTotalCredits: fromCents(creditCents),
    ...(openingBalanceDerived !== undefined ? { openingBalanceDerived } : {}),
    ...(closingBalanceDerived !== undefined ? { closingBalanceDerived } : {}),
    aggregatesStatus,
    validationStatus: aggregatesStatus === 'derived' ? 'valid' : 'needs_review',
    errors,
    warnings
  };
}

function isStrictAmount(value: number): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || !STRICT_AMOUNT_PATTERN.test(String(value))) {
    return false;
  }
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) &&
    Math.abs(value * 100 - cents) <= 1e-7 &&
    Math.abs(cents) <= Number(MAX_ABSOLUTE_AMOUNT_CENTS);
}

function toCents(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

function fromCents(cents: bigint): number {
  return Number(cents) / 100;
}

function isCentsWithinOutputCap(cents: bigint): boolean {
  return cents >= -MAX_ABSOLUTE_AMOUNT_CENTS && cents <= MAX_ABSOLUTE_AMOUNT_CENTS;
}
