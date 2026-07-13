import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStructuredBankStatementDayContentHash as buildDayContentHashInNode,
  buildStructuredBankStatementRawTextHash,
  STRUCTURED_BANK_STATEMENT_DAY_CONTENT_HASH_DOMAIN_V2 as NODE_DAY_CONTENT_HASH_DOMAIN_V2
} from './structuredBankStatementCsvIdempotencyKeys';
import {
  buildStructuredBankStatementDayContentHash as buildDayContentHashInBrowser,
  STRUCTURED_BANK_STATEMENT_DAY_CONTENT_HASH_DOMAIN_V2 as BROWSER_DAY_CONTENT_HASH_DOMAIN_V2
} from './structuredBankStatementCsvBrowserIdempotencyKeys';
import { deriveStructuredBankStatementDailyAggregates } from './structuredBankStatementDailyAggregates';
import {
  buildDailyStatementUnitsFromStructuredDocument,
  type StructuredBankStatementDailyUnit
} from './structuredBankStatementDailyIdentity';
import { parseStructuredBankStatementCsv } from './structuredBankStatementCsvParser';
import { MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS } from './structuredBankStatementCsvPreIngestion';
import {
  buildPreIngestDailyStatementUnitsRpcPayload,
  findForbiddenDailyStatementPayloadKeys,
  findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors,
  DAILY_STATEMENT_FORBIDDEN_PAYLOAD_KEYS,
  DAILY_STATEMENT_RPC_ATTEMPT_ALLOWED_KEYS,
  DAILY_STATEMENT_RPC_GUARD_ALLOWED_KEYS,
  DAILY_STATEMENT_RPC_LINE_ALLOWED_KEYS,
  DAILY_STATEMENT_RPC_UNIT_ALLOWED_KEYS,
  PRE_INGEST_DAILY_STATEMENT_UNITS_RPC_NAME,
  type BuildPreIngestDailyStatementUnitsRpcPayloadInput,
  type DailyStatementRpcAttemptInput,
  type DailyStatementRpcGuardContextInput,
  type PreIngestDailyStatementUnitsRpcPayload
} from './structuredBankStatementDailyRpcPayload';

// All fixtures below are fully synthetic. No real bank statement data, no real
// account number, no real bank client and no SODATRA data is ever used.

const HEX_SHA256 = /^[0-9a-f]{64}$/;

const SYNTHETIC_FINGERPRINT = 'SYNTHETIC-FINGERPRINT-0001';
const SYNTHETIC_RAW_ACCOUNT_DIGITS = '01234567890';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const DAY_UNIT_ID_1 = 'd'.repeat(64);
const DAY_UNIT_ID_2 = 'e'.repeat(64);

// ---------------------------------------------------------------------------
// Parser-based fixtures: two overlapping sliding exports of the same account
// (same shape as the 0E identity suite). Export J covers 29/06 -> 01/07;
// export J+1 covers 30/06 -> 02/07; days 30/06 and 01/07 are identical.
// ---------------------------------------------------------------------------

function exportJCsv(): string {
  return [
    'Releve de compte synthetique;;;;;',
    `Numero de compte;SN08 SN000 ${SYNTHETIC_RAW_ACCOUNT_DIGITS}-46 XOF;;;;`,
    'Periode;29/06/2026;01/07/2026;;;',
    'Solde initial au 28/06/2026 : 1000000;;;;;',
    'Date;Valeur;Libelle;Debit;Credit;Solde',
    '29/06/2026;29/06/2026;PRELEVEMENT SYNTHETIQUE J29;50000;;950000',
    '30/06/2026;30/06/2026;VIREMENT RECU SYNTHETIQUE COMMUN;;200000;1150000',
    '01/07/2026;01/07/2026;PRELEVEMENT SYNTHETIQUE COMMUN;100000;;1050000',
    ';;Total;150000;200000;',
    'Solde au 01/07/2026 : 1050000;;;;;'
  ].join('\n');
}

function exportJPlus1Csv(): string {
  return [
    'Releve de compte synthetique;;;;;',
    `Numero de compte;SN08 SN000 ${SYNTHETIC_RAW_ACCOUNT_DIGITS}-46 XOF;;;;`,
    'Periode;30/06/2026;02/07/2026;;;',
    'Solde initial au 29/06/2026 : 950000;;;;;',
    'Date;Valeur;Libelle;Debit;Credit;Solde',
    '30/06/2026;30/06/2026;VIREMENT RECU SYNTHETIQUE COMMUN;;200000;1150000',
    '01/07/2026;01/07/2026;PRELEVEMENT SYNTHETIQUE COMMUN;100000;;1050000',
    '02/07/2026;02/07/2026;VIREMENT RECU SYNTHETIQUE J02;;300000;1350000',
    ';;Total;100000;500000;',
    'Solde au 02/07/2026 : 1350000;;;;;'
  ].join('\n');
}

// 0E long-export fixture: two accounting days inside a 90-day window.
function longExportCsv(): string {
  return [
    'Releve de compte synthetique;;;;;',
    `Numero de compte;SN08 SN000 ${SYNTHETIC_RAW_ACCOUNT_DIGITS}-46 XOF;;;;`,
    'Periode;01/01/2026;31/03/2026;;;',
    'Solde initial au 31/12/2025 : 1000000;;;;;',
    'Date;Valeur;Libelle;Debit;Credit;Solde',
    '05/01/2026;05/01/2026;PRELEVEMENT SYNTHETIQUE JANVIER;100000;;900000',
    '20/02/2026;20/02/2026;VIREMENT RECU SYNTHETIQUE FEVRIER;;300000;1200000',
    ';;Total;100000;300000;',
    'Solde au 31/03/2026 : 1200000;;;;;'
  ].join('\n');
}

function buildUnitsFromCsv(decodedText: string, bank: string = 'ORA'): StructuredBankStatementDailyUnit[] {
  const document = parseStructuredBankStatementCsv(decodedText, {
    sourceFileName: 'releve synthetique.csv'
  });
  assert.ok(document.lines.length > 0, 'fixture must parse into transaction lines');
  const result = buildDailyStatementUnitsFromStructuredDocument({
    document,
    bank,
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    currency: 'XOF',
    rawTextHash: buildStructuredBankStatementRawTextHash({ decodedText })
  });
  assert.ok(result.success, `composition must succeed: ${JSON.stringify(result)}`);
  return result.units;
}

function syntheticAttempt(
  overrides: Partial<DailyStatementRpcAttemptInput> = {}
): DailyStatementRpcAttemptInput {
  return {
    requestedMode: 'daily',
    sourceFormat: 'structured_bank_statement_csv',
    bank: 'ORA',
    currency: 'XOF',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    accountNumberMasked: '****7890',
    sourceFileNameRedacted: 'releve synthetique.csv',
    rawTextHash: buildStructuredBankStatementRawTextHash({ decodedText: exportJCsv() }),
    exportPeriodStart: '29/06/2026',
    exportPeriodEnd: '01/07/2026',
    statementDate: '01/07/2026',
    exportReferenceDate: '02/07/2026',
    parserValidationStatus: 'valid',
    errorsCount: 0,
    warningsCount: 0,
    runtimeVersion: 'synthetic-runtime',
    parserVersion: 'synthetic-parser',
    ...overrides
  };
}

function syntheticGuard(
  overrides: Partial<DailyStatementRpcGuardContextInput> = {}
): DailyStatementRpcGuardContextInput {
  return {
    ingestionReady: true,
    periodDays: 3,
    bridgeGuardPassed: true,
    ...overrides
  };
}

function exportJInput(
  attemptOverrides: Partial<DailyStatementRpcAttemptInput> = {},
  guardOverrides: Partial<DailyStatementRpcGuardContextInput> = {}
): BuildPreIngestDailyStatementUnitsRpcPayloadInput {
  return {
    attempt: syntheticAttempt(attemptOverrides),
    units: buildUnitsFromCsv(exportJCsv()),
    guardContext: syntheticGuard(guardOverrides)
  };
}

function buildExportJPayload(
  attemptOverrides: Partial<DailyStatementRpcAttemptInput> = {},
  guardOverrides: Partial<DailyStatementRpcGuardContextInput> = {}
): PreIngestDailyStatementUnitsRpcPayload {
  const result = buildPreIngestDailyStatementUnitsRpcPayload(exportJInput(attemptOverrides, guardOverrides));
  assert.ok(result.success, `payload build must succeed: ${JSON.stringify(result)}`);
  return result.payload;
}

function expectFailure(
  input: BuildPreIngestDailyStatementUnitsRpcPayloadInput,
  pattern: RegExp
): string[] {
  const result = buildPreIngestDailyStatementUnitsRpcPayload(input);
  if (result.success) {
    assert.fail(`payload build must fail (expected ${pattern})`);
  }
  assert.match(result.errors.join('\n'), pattern);
  return result.errors;
}

// ---------------------------------------------------------------------------
// 1. dayContentHash v2
// ---------------------------------------------------------------------------

test('dayContentHash: order-independent over the same dailyLineHash list', () => {
  const forward = buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [HASH_A, HASH_B] });
  const reversed = buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [HASH_B, HASH_A] });
  assert.match(forward, HEX_SHA256);
  assert.equal(reversed, forward);
});

test('dayContentHash: a different list or a different dayUnitId discriminates', () => {
  const reference = buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [HASH_A, HASH_B] });
  const otherList = buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [HASH_A, HASH_C] });
  const otherUnit = buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_2, dailyLineHashes: [HASH_A, HASH_B] });
  assert.notEqual(otherList, reference);
  assert.notEqual(otherUnit, reference);
});

test('dayContentHash: fail-closed on empty dayUnitId, empty list, non-64-hex entry and duplicate entry', () => {
  assert.throws(
    () => buildDayContentHashInNode({ dayUnitId: '   ', dailyLineHashes: [HASH_A] }),
    /dayUnitId must be non-empty/
  );
  assert.throws(
    () => buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [] }),
    /non-empty array/
  );
  assert.throws(
    () => buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: ['not-a-hash'] }),
    /64-char lowercase hex/
  );
  assert.throws(
    () => buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: ['A'.repeat(64)] }),
    /64-char lowercase hex/
  );
  assert.throws(
    () => buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [HASH_A, HASH_A] }),
    /ordinal bug/
  );
});

test('parity v2: dayContentHash domain tag is byte-identical between Node and browser twins', () => {
  assert.equal(NODE_DAY_CONTENT_HASH_DOMAIN_V2, BROWSER_DAY_CONTENT_HASH_DOMAIN_V2);
  assert.equal(
    NODE_DAY_CONTENT_HASH_DOMAIN_V2,
    'sodatra:structured_bank_statement_csv:day_content_hash:v2'
  );
});

test('parity v2: dayContentHash values and error messages are identical between Node and browser', async () => {
  const inNode = buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [HASH_B, HASH_A] });
  const inBrowser = await buildDayContentHashInBrowser({
    dayUnitId: DAY_UNIT_ID_1,
    dailyLineHashes: [HASH_A, HASH_B]
  });
  assert.equal(inBrowser, inNode);

  let nodeMessage = '';
  try {
    buildDayContentHashInNode({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [HASH_A, HASH_A] });
  } catch (error) {
    nodeMessage = error instanceof Error ? error.message : String(error);
  }
  assert.notEqual(nodeMessage, '');
  await assert.rejects(
    buildDayContentHashInBrowser({ dayUnitId: DAY_UNIT_ID_1, dailyLineHashes: [HASH_A, HASH_A] }),
    (error: unknown) => {
      assert.equal(error instanceof Error ? error.message : String(error), nodeMessage);
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 2. Daily aggregates
// ---------------------------------------------------------------------------

test('aggregates: a coherent running balance chain derives opening and closing', () => {
  const aggregates = deriveStructuredBankStatementDailyAggregates([
    { direction: 'debit', signedAmount: -50_000, runningBalance: 950_000 },
    { direction: 'credit', signedAmount: 200_000, runningBalance: 1_150_000 }
  ]);
  assert.equal(aggregates.lineCount, 2);
  assert.equal(aggregates.dayTotalDebits, 50_000);
  assert.equal(aggregates.dayTotalCredits, 200_000);
  assert.equal(aggregates.openingBalanceDerived, 1_000_000);
  assert.equal(aggregates.closingBalanceDerived, 1_150_000);
  assert.equal(aggregates.aggregatesStatus, 'derived');
  assert.equal(aggregates.validationStatus, 'valid');
  assert.deepEqual(aggregates.errors, []);
  assert.deepEqual(aggregates.warnings, []);
});

test('aggregates: a missing running balance yields unavailable + needs_review, totals still derived, no balance fabricated', () => {
  const aggregates = deriveStructuredBankStatementDailyAggregates([
    { direction: 'debit', signedAmount: -50_000, runningBalance: 950_000 },
    { direction: 'credit', signedAmount: 200_000 }
  ]);
  assert.equal(aggregates.dayTotalDebits, 50_000);
  assert.equal(aggregates.dayTotalCredits, 200_000);
  assert.equal(aggregates.openingBalanceDerived, undefined);
  assert.equal(aggregates.closingBalanceDerived, undefined);
  assert.equal(aggregates.aggregatesStatus, 'unavailable');
  assert.equal(aggregates.validationStatus, 'needs_review');
  assert.deepEqual(aggregates.errors, []);
  assert.match(aggregates.warnings.join('\n'), /runningBalance is missing/);
});

test('aggregates: an incoherent running balance chain yields unavailable + needs_review, no silent correction', () => {
  const aggregates = deriveStructuredBankStatementDailyAggregates([
    { direction: 'debit', signedAmount: -50_000, runningBalance: 950_000 },
    { direction: 'credit', signedAmount: 200_000, runningBalance: 1_150_001 }
  ]);
  assert.equal(aggregates.openingBalanceDerived, undefined);
  assert.equal(aggregates.closingBalanceDerived, undefined);
  assert.equal(aggregates.aggregatesStatus, 'unavailable');
  assert.equal(aggregates.validationStatus, 'needs_review');
  assert.match(aggregates.warnings.join('\n'), /chain is incoherent/);
});

test('aggregates: invalid business input is a controlled error, never a throw', () => {
  const wrongSign = deriveStructuredBankStatementDailyAggregates([
    { direction: 'credit', signedAmount: -200_000, runningBalance: 950_000 }
  ]);
  assert.equal(wrongSign.aggregatesStatus, 'unavailable');
  assert.equal(wrongSign.validationStatus, 'needs_review');
  assert.match(wrongSign.errors.join('\n'), /credit line requires signedAmount > 0/);
  assert.equal(wrongSign.dayTotalDebits, 0);
  assert.equal(wrongSign.dayTotalCredits, 0);

  const empty = deriveStructuredBankStatementDailyAggregates([]);
  assert.equal(empty.lineCount, 0);
  assert.match(empty.errors.join('\n'), /at least one line is required/);
});

test('aggregates: refuses a daily total that cannot remain exact in cents', () => {
  const aggregates = deriveStructuredBankStatementDailyAggregates(
    Array.from({ length: 100 }, () => ({
      direction: 'credit' as const,
      signedAmount: 999_999_999_999.99,
    })),
  );

  assert.equal(aggregates.aggregatesStatus, 'unavailable');
  assert.equal(aggregates.dayTotalCredits, 0);
  assert.match(aggregates.errors.join('\n'), /exceeds the exact monetary output cap/i);
});

// ---------------------------------------------------------------------------
// 3. Payload coherence
// ---------------------------------------------------------------------------

test('payload: export J produces one p_unit per accounting day and flat p_lines joined by day_unit_id', () => {
  const payload = buildExportJPayload();

  assert.deepEqual(
    payload.p_units.map((unit) => unit.accounting_date),
    ['29/06/2026', '30/06/2026', '01/07/2026']
  );
  assert.equal(payload.p_lines.length, 3);

  const unitIds = new Set(payload.p_units.map((unit) => unit.day_unit_id));
  for (const line of payload.p_lines) {
    assert.ok(unitIds.has(line.day_unit_id), 'every line joins an existing unit');
  }

  for (const unit of payload.p_units) {
    const unitLines = payload.p_lines.filter((line) => line.day_unit_id === unit.day_unit_id);
    assert.equal(unit.line_count, unitLines.length);
    for (const line of unitLines) {
      assert.equal(line.accounting_date, unit.accounting_date);
      assert.equal(line.currency, payload.p_attempt.currency);
    }
    // The unit's content hash is exactly the hash of its own lines.
    assert.equal(
      unit.day_content_hash,
      buildDayContentHashInNode({
        dayUnitId: unit.day_unit_id,
        dailyLineHashes: unitLines.map((line) => line.daily_line_hash)
      })
    );
    assert.equal(unit.requested_unit_status, 'staged');
  }

  // Derived aggregates of the first day (debit 50000 against opening 1000000).
  const firstDay = payload.p_units[0];
  assert.equal(firstDay.day_total_debits, 50_000);
  assert.equal(firstDay.day_total_credits, 0);
  assert.equal(firstDay.opening_balance_derived, 1_000_000);
  assert.equal(firstDay.closing_balance_derived, 950_000);
  assert.equal(firstDay.aggregates_status, 'derived');
  assert.equal(firstDay.validation_status, 'valid');

  // Attempt/guard echo and self-coherence of the assembled payload.
  assert.equal(payload.p_attempt.requested_mode, 'daily');
  assert.match(payload.p_attempt.raw_text_hash, HEX_SHA256);
  assert.equal(payload.p_guard_context.backfill_grant_reference, null);
  assert.deepEqual(findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors(payload), []);

  const result = buildPreIngestDailyStatementUnitsRpcPayload(exportJInput());
  assert.ok(result.success);
  assert.equal(result.rpcName, PRE_INGEST_DAILY_STATEMENT_UNITS_RPC_NAME);
});

test('payload: overlapping exports J and J+1 share day_unit_id AND day_content_hash for common days', () => {
  const payloadJ = buildExportJPayload();
  const resultJPlus1 = buildPreIngestDailyStatementUnitsRpcPayload({
    attempt: syntheticAttempt({
      rawTextHash: buildStructuredBankStatementRawTextHash({ decodedText: exportJPlus1Csv() }),
      exportPeriodStart: '30/06/2026',
      exportPeriodEnd: '02/07/2026',
      statementDate: '02/07/2026',
      exportReferenceDate: '03/07/2026'
    }),
    units: buildUnitsFromCsv(exportJPlus1Csv()),
    guardContext: syntheticGuard({ periodDays: 3 })
  });
  assert.ok(resultJPlus1.success, `J+1 payload must build: ${JSON.stringify(resultJPlus1)}`);
  const payloadJPlus1 = resultJPlus1.payload;

  // Different exports, different traceability fingerprints...
  assert.notEqual(payloadJPlus1.p_attempt.raw_text_hash, payloadJ.p_attempt.raw_text_hash);

  // ...but the common days carry the SAME identity and the SAME content
  // fingerprint: this is the future day-level R1 comparator.
  for (const accountingDate of ['30/06/2026', '01/07/2026']) {
    const fromJ = payloadJ.p_units.find((unit) => unit.accounting_date === accountingDate);
    const fromJPlus1 = payloadJPlus1.p_units.find((unit) => unit.accounting_date === accountingDate);
    assert.ok(fromJ !== undefined && fromJPlus1 !== undefined);
    assert.equal(fromJPlus1.day_unit_id, fromJ.day_unit_id);
    assert.equal(fromJPlus1.day_content_hash, fromJ.day_content_hash);
  }
});

test('payload validator: orphan line, missing lines and content-hash mismatch are refused', () => {
  const payload = buildExportJPayload();

  const withOrphan = structuredClone(payload);
  withOrphan.p_lines.push({ ...withOrphan.p_lines[0], day_unit_id: 'f'.repeat(64) });
  assert.match(
    findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors(withOrphan).join('\n'),
    /orphan line/
  );

  const withMissingLines = structuredClone(payload);
  const strippedUnitId = withMissingLines.p_units[0].day_unit_id;
  withMissingLines.p_lines = withMissingLines.p_lines.filter((line) => line.day_unit_id !== strippedUnitId);
  assert.match(
    findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors(withMissingLines).join('\n'),
    /received no p_lines/
  );

  const withWrongContentHash = structuredClone(payload);
  withWrongContentHash.p_units[0].day_content_hash = 'f'.repeat(64);
  assert.match(
    findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors(withWrongContentHash).join('\n'),
    /does not match its own lines/
  );

  const withEmptyUnits = structuredClone(payload);
  withEmptyUnits.p_units = [];
  assert.match(
    findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors(withEmptyUnits).join('\n'),
    /p_units must be a non-empty array/
  );

  const withSmuggledKey = structuredClone(payload) as PreIngestDailyStatementUnitsRpcPayload & {
    p_units: Array<Record<string, unknown>>;
  };
  withSmuggledKey.p_units[0].unexpected_key = 'x';
  assert.match(
    findPreIngestDailyStatementUnitsRpcPayloadCoherenceErrors(
      withSmuggledKey as PreIngestDailyStatementUnitsRpcPayload
    ).join('\n'),
    /outside its whitelist: "unexpected_key"/
  );
});

test('payload: an empty units input is a controlled refusal', () => {
  expectFailure(
    { attempt: syntheticAttempt(), units: [], guardContext: syntheticGuard() },
    /units must be a non-empty array/
  );
});

test('payload: a periodDays that contradicts the export window is refused', () => {
  expectFailure(exportJInput({}, { periodDays: 5 }), /does not match the inclusive day count/);
});

// ---------------------------------------------------------------------------
// 4. Anti-smuggling / sensitive data
// ---------------------------------------------------------------------------

test('payload: deep forbidden keys anywhere in the input are refused', () => {
  const smuggledAttempt = exportJInput();
  (smuggledAttempt.attempt as unknown as Record<string, unknown>).raw_csv = 'synthetic;csv;content';
  const attemptErrors = expectFailure(smuggledAttempt, /forbidden key in input at \$\.attempt\.raw_csv/);
  assert.ok(attemptErrors.length >= 1);

  const smuggledNested = exportJInput();
  (smuggledNested.guardContext as unknown as Record<string, unknown>).details = {
    account_number: 'synthetic-value',
    iban: 'synthetic-value'
  };
  const nestedErrors = expectFailure(smuggledNested, /\$\.guardContext\.details\.account_number/);
  assert.match(nestedErrors.join('\n'), /\$\.guardContext\.details\.iban/);

  const smuggledDecodedText = exportJInput();
  (smuggledDecodedText.attempt as unknown as Record<string, unknown>).decoded_text = 'synthetic';
  expectFailure(smuggledDecodedText, /\$\.attempt\.decoded_text/);

  // The blocklist itself covers every key required by the doctrine.
  for (const key of ['raw_csv', 'raw_text', 'raw_bytes', 'raw_content', 'file_content', 'account_number', 'iban', 'decoded_text', 'full_iban', 'raw_account', 'account_number_raw']) {
    assert.ok(
      (DAILY_STATEMENT_FORBIDDEN_PAYLOAD_KEYS as readonly string[]).includes(key),
      `blocklist must include ${key}`
    );
  }
  // The authorized traceability keys are NOT false positives of the scan.
  assert.deepEqual(
    findForbiddenDailyStatementPayloadKeys({ raw_text_hash: HASH_A, account_number_masked: '****1234' }),
    []
  );
});

test('payload: accountNumberMasked is only accepted under the strict mask', () => {
  const ok = buildPreIngestDailyStatementUnitsRpcPayload(exportJInput({ accountNumberMasked: '***1234' }));
  assert.ok(ok.success);

  expectFailure(exportJInput({ accountNumberMasked: '12345678' }), /strict masked pattern/);
  expectFailure(exportJInput({ accountNumberMasked: '***12345' }), /strict masked pattern/);
});

test('payload: sourceFileNameRedacted refuses paths, IBAN-like values and long digit runs', () => {
  expectFailure(exportJInput({ sourceFileNameRedacted: 'exports/releve.csv' }), /path separators/);
  expectFailure(
    exportJInput({ sourceFileNameRedacted: `releve ${SYNTHETIC_RAW_ACCOUNT_DIGITS}.csv` }),
    /looks sensitive/
  );
  expectFailure(
    exportJInput({ sourceFileNameRedacted: 'SN08SN00001234567890.csv' }),
    /looks sensitive/
  );
});

// ---------------------------------------------------------------------------
// 5. ORA / non-closed day
// ---------------------------------------------------------------------------

test('ORA: units strictly before exportReferenceDate stay staged; units at/after become provisional', () => {
  const result = buildPreIngestDailyStatementUnitsRpcPayload(
    exportJInput({ exportReferenceDate: '01/07/2026' })
  );
  assert.ok(result.success);
  assert.deepEqual(
    result.payload.p_units.map((unit) => [unit.accounting_date, unit.requested_unit_status]),
    [
      ['29/06/2026', 'staged'],
      ['30/06/2026', 'staged'],
      ['01/07/2026', 'provisional']
    ]
  );
  assert.match(result.warnings.join('\n'), /provisional/);
});

test('ORA: without exportReferenceDate the last accounting day is held provisional (fail-closed), never silently promotable', () => {
  const result = buildPreIngestDailyStatementUnitsRpcPayload(
    exportJInput({ exportReferenceDate: undefined })
  );
  assert.ok(result.success);
  assert.deepEqual(
    result.payload.p_units.map((unit) => [unit.accounting_date, unit.requested_unit_status]),
    [
      ['29/06/2026', 'staged'],
      ['30/06/2026', 'staged'],
      ['01/07/2026', 'provisional']
    ]
  );
  assert.match(result.warnings.join('\n'), /fail-closed/);
});

test('BDK: without exportReferenceDate no unit is held provisional (the ORA rule is not inherited)', () => {
  const result = buildPreIngestDailyStatementUnitsRpcPayload({
    attempt: syntheticAttempt({ bank: 'BDK', exportReferenceDate: undefined }),
    units: buildUnitsFromCsv(exportJCsv(), 'BDK'),
    guardContext: syntheticGuard()
  });
  assert.ok(result.success, `BDK payload must build: ${JSON.stringify(result)}`);
  assert.deepEqual(
    result.payload.p_units.map((unit) => unit.requested_unit_status),
    ['staged', 'staged', 'staged']
  );
  assert.equal(result.warnings.some((warning) => warning.includes('provisional')), false);
});

// ---------------------------------------------------------------------------
// 6. Backfill (BIS)
// ---------------------------------------------------------------------------

function longExportInput(
  attemptOverrides: Partial<DailyStatementRpcAttemptInput> = {},
  guardOverrides: Partial<DailyStatementRpcGuardContextInput> = {}
): BuildPreIngestDailyStatementUnitsRpcPayloadInput {
  return {
    attempt: syntheticAttempt({
      rawTextHash: buildStructuredBankStatementRawTextHash({ decodedText: longExportCsv() }),
      exportPeriodStart: '01/01/2026',
      exportPeriodEnd: '31/03/2026',
      statementDate: '31/03/2026',
      exportReferenceDate: '01/04/2026',
      ...attemptOverrides
    }),
    units: buildUnitsFromCsv(longExportCsv()),
    guardContext: syntheticGuard({
      // 0C fired upstream on the long window: the export is not ingestion-ready.
      ingestionReady: false,
      periodDays: 90,
      ...guardOverrides
    })
  };
}

test('backfill: a 90-day daily deposit is refused (0C cap mirrored in the builder)', () => {
  const errors = expectFailure(
    longExportInput({ requestedMode: 'daily' }, { ingestionReady: true }),
    new RegExp(`above the ${MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS}-day ingestion limit`)
  );
  assert.match(errors.join('\n'), /backfill mode/);
});

test('backfill: a 90-day backfill deposit without a grant is refused', () => {
  expectFailure(
    longExportInput({ requestedMode: 'backfill' }),
    /backfillGrantReference is mandatory/
  );
});

test('backfill: a 90-day backfill deposit with a grant builds a payload explicitly marked backfill', () => {
  const result = buildPreIngestDailyStatementUnitsRpcPayload(
    longExportInput(
      { requestedMode: 'backfill' },
      { backfillGrantReference: 'CTO-BACKFILL-GRANT-0001' }
    )
  );
  assert.ok(result.success, `backfill payload must build: ${JSON.stringify(result)}`);
  assert.equal(result.payload.p_attempt.requested_mode, 'backfill');
  assert.equal(result.payload.p_guard_context.backfill_grant_reference, 'CTO-BACKFILL-GRANT-0001');
  assert.equal(result.payload.p_guard_context.period_days, 90);
  assert.equal(result.payload.p_units.length, 2);
});

test('backfill: a grant reference must never ride a daily deposit', () => {
  expectFailure(
    exportJInput({}, { backfillGrantReference: 'CTO-BACKFILL-GRANT-0001' }),
    /must not be carried by a daily deposit/
  );
});

test('daily: a not-ingestion-ready export never becomes a daily deposit payload', () => {
  expectFailure(exportJInput({}, { ingestionReady: false }), /requires an ingestion-ready export/);
});

// ---------------------------------------------------------------------------
// 7. Whitelist constants are frozen and exhaustive
// ---------------------------------------------------------------------------

test('whitelists: the built payload carries exactly the whitelisted keys', () => {
  const payload = buildExportJPayload();
  assert.deepEqual(Object.keys(payload.p_attempt).sort(), [...DAILY_STATEMENT_RPC_ATTEMPT_ALLOWED_KEYS].sort());
  assert.deepEqual(Object.keys(payload.p_guard_context).sort(), [...DAILY_STATEMENT_RPC_GUARD_ALLOWED_KEYS].sort());
  for (const unit of payload.p_units) {
    assert.deepEqual(Object.keys(unit).sort(), [...DAILY_STATEMENT_RPC_UNIT_ALLOWED_KEYS].sort());
  }
  for (const line of payload.p_lines) {
    assert.deepEqual(Object.keys(line).sort(), [...DAILY_STATEMENT_RPC_LINE_ALLOWED_KEYS].sort());
  }
});
