import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStructuredBankStatementDayUnitId as buildDayUnitIdInNode,
  buildStructuredBankStatementDailyLineHash as buildDailyLineHashInNode,
  buildStructuredBankStatementRawTextHash,
  STRUCTURED_BANK_STATEMENT_DAY_UNIT_ID_DOMAIN_V2 as NODE_DAY_UNIT_ID_DOMAIN_V2,
  STRUCTURED_BANK_STATEMENT_DAILY_LINE_HASH_DOMAIN_V2 as NODE_DAILY_LINE_HASH_DOMAIN_V2,
  type BuildStructuredBankStatementDayUnitIdInput,
  type BuildStructuredBankStatementDailyLineHashInput
} from './structuredBankStatementCsvIdempotencyKeys';
import {
  buildStructuredBankStatementDayUnitId as buildDayUnitIdInBrowser,
  buildStructuredBankStatementDailyLineHash as buildDailyLineHashInBrowser,
  STRUCTURED_BANK_STATEMENT_DAY_UNIT_ID_DOMAIN_V2 as BROWSER_DAY_UNIT_ID_DOMAIN_V2,
  STRUCTURED_BANK_STATEMENT_DAILY_LINE_HASH_DOMAIN_V2 as BROWSER_DAILY_LINE_HASH_DOMAIN_V2
} from './structuredBankStatementCsvBrowserIdempotencyKeys';
import {
  assignDailyOccurrenceOrdinals,
  buildDailyStatementUnitsFromStructuredDocument,
  groupStructuredBankStatementLinesByAccountingDate,
  type StructuredBankStatementDailyUnit
} from './structuredBankStatementDailyIdentity';
import {
  parseStructuredBankStatementCsv,
  type StructuredBankStatementDocument,
  type StructuredBankStatementLine
} from './structuredBankStatementCsvParser';
import {
  prepareStructuredBankStatementCsvIngestion,
  MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS
} from './structuredBankStatementCsvPreIngestion';

// All fixtures below are fully synthetic. No real bank statement data, no real
// account number, no real bank client and no SODATRA data is ever used.

const HEX_SHA256 = /^[0-9a-f]{64}$/;

const SYNTHETIC_FINGERPRINT = 'SYNTHETIC-FINGERPRINT-0001';
const SYNTHETIC_RAW_ACCOUNT_DIGITS = '01234567890';

// ---------------------------------------------------------------------------
// Direct fixture builders (no parser involved)
// ---------------------------------------------------------------------------

function dayUnitIdInput(
  overrides: Partial<BuildStructuredBankStatementDayUnitIdInput> = {}
): BuildStructuredBankStatementDayUnitIdInput {
  return {
    bank: 'ORA',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    currency: 'XOF',
    accountingDate: '30/06/2026',
    ...overrides
  };
}

function dailyLineHashInput(
  overrides: Partial<BuildStructuredBankStatementDailyLineHashInput> = {}
): BuildStructuredBankStatementDailyLineHashInput {
  return {
    dayUnitId: buildDayUnitIdInNode(dayUnitIdInput()),
    valueDate: '30/06/2026',
    direction: 'credit',
    signedAmount: 200_000,
    currency: 'XOF',
    descriptionSanitized: 'VIREMENT RECU SYNTHETIQUE COMMUN',
    dailyOccurrenceOrdinal: 1,
    ...overrides
  };
}

function syntheticLine(
  overrides: Partial<StructuredBankStatementLine> = {}
): StructuredBankStatementLine {
  return {
    sourceRowIndex: 10,
    operationDate: '30/06/2026',
    valueDate: '30/06/2026',
    descriptionSanitized: 'VIREMENT RECU SYNTHETIQUE COMMUN',
    credit: 200_000,
    signedAmount: 200_000,
    direction: 'credit',
    ...overrides
  };
}

function syntheticDocument(
  lines: StructuredBankStatementLine[],
  overrides: Partial<StructuredBankStatementDocument> = {}
): StructuredBankStatementDocument {
  return {
    bankHint: 'ORA',
    detectedDelimiter: ';',
    sourceFileName: 'releve ora synthetique.csv',
    periodStart: '29/06/2026',
    periodEnd: '01/07/2026',
    lines,
    validation: {
      status: 'valid',
      openingBalanceFound: true,
      closingBalanceFound: true,
      declaredTotalsFound: true,
      errors: [],
      warnings: []
    },
    errors: [],
    warnings: [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Parser-based fixtures: two overlapping sliding exports of the same account.
// Export J covers 29/06 -> 01/07 ; export J+1 covers 30/06 -> 02/07. The lines
// of 30/06 and 01/07 are strictly identical in both exports.
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

function exportJPlus1Csv(commonCreditLabel = 'VIREMENT RECU SYNTHETIQUE COMMUN'): string {
  return [
    'Releve de compte synthetique;;;;;',
    `Numero de compte;SN08 SN000 ${SYNTHETIC_RAW_ACCOUNT_DIGITS}-46 XOF;;;;`,
    'Periode;30/06/2026;02/07/2026;;;',
    'Solde initial au 29/06/2026 : 950000;;;;;',
    'Date;Valeur;Libelle;Debit;Credit;Solde',
    `30/06/2026;30/06/2026;${commonCreditLabel};;200000;1150000`,
    '01/07/2026;01/07/2026;PRELEVEMENT SYNTHETIQUE COMMUN;100000;;1050000',
    '02/07/2026;02/07/2026;VIREMENT RECU SYNTHETIQUE J02;;300000;1350000',
    ';;Total;100000;500000;',
    'Solde au 02/07/2026 : 1350000;;;;;'
  ].join('\n');
}

function buildUnitsFromCsv(decodedText: string): StructuredBankStatementDailyUnit[] {
  const document = parseStructuredBankStatementCsv(decodedText, {
    sourceFileName: 'releve ora synthetique.csv'
  });
  assert.ok(document.lines.length > 0, 'fixture must parse into transaction lines');
  const result = buildDailyStatementUnitsFromStructuredDocument({
    document,
    bank: 'ORA',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    currency: 'XOF',
    rawTextHash: buildStructuredBankStatementRawTextHash({ decodedText })
  });
  assert.ok(result.success, `composition must succeed: ${JSON.stringify(result)}`);
  return result.units;
}

function unitByDate(
  units: StructuredBankStatementDailyUnit[],
  accountingDate: string
): StructuredBankStatementDailyUnit {
  const unit = units.find((candidate) => candidate.accountingDate === accountingDate);
  assert.ok(unit !== undefined, `expected a unit for ${accountingDate}`);
  return unit;
}

// Identity-only view of a unit: everything EXCEPT the traceability metadata,
// which legitimately differs between two exports carrying the same day.
function identityView(unit: StructuredBankStatementDailyUnit): unknown {
  const { source: _source, ...identity } = unit;
  return identity;
}

// ---------------------------------------------------------------------------
// 1. dayUnitId identity
// ---------------------------------------------------------------------------

test('dayUnitId: deterministic over (bank, accountFingerprint, currency, accountingDate)', () => {
  const first = buildDayUnitIdInNode(dayUnitIdInput());
  const second = buildDayUnitIdInNode(dayUnitIdInput());
  assert.equal(second, first);
  assert.match(first, HEX_SHA256);
});

test('dayUnitId: each canonical component discriminates', () => {
  const reference = buildDayUnitIdInNode(dayUnitIdInput());
  assert.notEqual(buildDayUnitIdInNode(dayUnitIdInput({ currency: 'EUR' })), reference);
  assert.notEqual(
    buildDayUnitIdInNode(dayUnitIdInput({ accountFingerprint: 'SYNTHETIC-FINGERPRINT-0002' })),
    reference
  );
  assert.notEqual(buildDayUnitIdInNode(dayUnitIdInput({ bank: 'BDK' })), reference);
  assert.notEqual(buildDayUnitIdInNode(dayUnitIdInput({ accountingDate: '01/07/2026' })), reference);
});

test('dayUnitId: structurally independent of the export period (no period input exists)', () => {
  // The input type carries no periodStart/periodEnd at all; the composition
  // test below proves two different export windows yield the same dayUnitId.
  const input = dayUnitIdInput();
  assert.deepEqual(Object.keys(input).sort(), ['accountFingerprint', 'accountingDate', 'bank', 'currency']);
});

test('dayUnitId: fail-closed validation (empty fingerprint, malformed or rolled-over dates)', () => {
  assert.throws(
    () => buildDayUnitIdInNode(dayUnitIdInput({ accountFingerprint: '   ' })),
    /accountFingerprint is mandatory/
  );
  assert.throws(
    () => buildDayUnitIdInNode(dayUnitIdInput({ accountingDate: '2026-06-30' })),
    /strict DD\/MM\/YYYY/
  );
  assert.throws(
    () => buildDayUnitIdInNode(dayUnitIdInput({ accountingDate: '31/02/2026' })),
    /real calendar date/
  );
});

// ---------------------------------------------------------------------------
// 2. dailyLineHash identity
// ---------------------------------------------------------------------------

test('dailyLineHash: deterministic, and amount/label changes discriminate', () => {
  const reference = buildDailyLineHashInNode(dailyLineHashInput());
  assert.equal(buildDailyLineHashInNode(dailyLineHashInput()), reference);
  assert.match(reference, HEX_SHA256);
  assert.notEqual(
    buildDailyLineHashInNode(dailyLineHashInput({ signedAmount: 200_001 })),
    reference
  );
  assert.notEqual(
    buildDailyLineHashInNode(
      dailyLineHashInput({ descriptionSanitized: 'VIREMENT RECU SYNTHETIQUE CORRIGE' })
    ),
    reference
  );
});

test('dailyLineHash: valueDate stays a component but never a split key', () => {
  const reference = buildDailyLineHashInNode(dailyLineHashInput());
  const shiftedValueDate = buildDailyLineHashInNode(dailyLineHashInput({ valueDate: '01/07/2026' }));
  // Different valueDate => different line identity...
  assert.notEqual(shiftedValueDate, reference);
  // ...but both lines share the same dayUnitId (same operationDate).
  assert.equal(dailyLineHashInput().dayUnitId, dailyLineHashInput({ valueDate: '01/07/2026' }).dayUnitId);
});

test('dailyLineHash: ordinal discriminates two otherwise identical business lines', () => {
  const first = buildDailyLineHashInNode(dailyLineHashInput({ dailyOccurrenceOrdinal: 1 }));
  const second = buildDailyLineHashInNode(dailyLineHashInput({ dailyOccurrenceOrdinal: 2 }));
  assert.notEqual(second, first);
});

// ---------------------------------------------------------------------------
// 3. Node/browser parity of the v2 builders
// ---------------------------------------------------------------------------

test('parity v2: domain tags are byte-identical between Node and browser twins', () => {
  assert.equal(BROWSER_DAY_UNIT_ID_DOMAIN_V2, NODE_DAY_UNIT_ID_DOMAIN_V2);
  assert.equal(BROWSER_DAILY_LINE_HASH_DOMAIN_V2, NODE_DAILY_LINE_HASH_DOMAIN_V2);
});

test('parity v2: dayUnitId and dailyLineHash are identical between Node and browser', async () => {
  const dayInputs = [
    dayUnitIdInput(),
    dayUnitIdInput({ bank: '  BDK  ', currency: ' XOF ' }),
    dayUnitIdInput({ accountingDate: ' 01/07/2026 ' })
  ];
  for (const input of dayInputs) {
    assert.equal(await buildDayUnitIdInBrowser(input), buildDayUnitIdInNode(input));
  }

  const lineInputs = [
    dailyLineHashInput(),
    dailyLineHashInput({ valueDate: undefined }),
    dailyLineHashInput({ signedAmount: -0, direction: 'credit' }),
    dailyLineHashInput({ descriptionSanitized: '  VIREMENT RECU   synthetique  ' })
  ];
  for (const input of lineInputs) {
    assert.equal(await buildDailyLineHashInBrowser(input), buildDailyLineHashInNode(input));
  }
});

test('parity v2: validation errors carry the same messages in both twins', async () => {
  const badDate = dayUnitIdInput({ accountingDate: '31/02/2026' });
  let nodeMessage = '';
  try {
    buildDayUnitIdInNode(badDate);
  } catch (error) {
    nodeMessage = error instanceof Error ? error.message : String(error);
  }
  assert.ok(nodeMessage !== '');
  await assert.rejects(buildDayUnitIdInBrowser(badDate), (error: unknown) => {
    assert.equal(error instanceof Error ? error.message : String(error), nodeMessage);
    return true;
  });
});

// ---------------------------------------------------------------------------
// 4. Grouping by accounting date
// ---------------------------------------------------------------------------

test('grouping: chronological groups keyed by operationDate, document order kept inside a day', () => {
  const lines = [
    syntheticLine({ sourceRowIndex: 12, operationDate: '01/07/2026' }),
    syntheticLine({ sourceRowIndex: 13, operationDate: '30/06/2026', descriptionSanitized: 'PREMIERE DU 30' }),
    syntheticLine({ sourceRowIndex: 14, operationDate: '30/06/2026', descriptionSanitized: 'SECONDE DU 30' })
  ];
  const result = groupStructuredBankStatementLinesByAccountingDate(lines);
  assert.ok(result.success);
  assert.deepEqual(
    result.groups.map((group) => group.accountingDate),
    ['30/06/2026', '01/07/2026']
  );
  assert.deepEqual(
    result.groups[0].lines.map((line) => line.descriptionSanitized),
    ['PREMIERE DU 30', 'SECONDE DU 30']
  );
});

test('grouping: fail-closed on missing or malformed operationDate, never borrowed from valueDate', () => {
  const missing = groupStructuredBankStatementLinesByAccountingDate([
    syntheticLine({ operationDate: undefined, valueDate: '30/06/2026' })
  ]);
  assert.ok(!missing.success);
  assert.match(missing.errors[0], /operationDate is missing or empty/);

  const malformed = groupStructuredBankStatementLinesByAccountingDate([
    syntheticLine({ operationDate: '31/02/2026' })
  ]);
  assert.ok(!malformed.success);
  assert.match(malformed.errors[0], /not a strict DD\/MM\/YYYY calendar date/);
});

// ---------------------------------------------------------------------------
// 5. Daily occurrence ordinals
// ---------------------------------------------------------------------------

test('ordinals: two strictly identical business lines in one day get 1 then 2', () => {
  const lines = [
    syntheticLine({ sourceRowIndex: 10 }),
    syntheticLine({ sourceRowIndex: 25 })
  ];
  assert.deepEqual(assignDailyOccurrenceOrdinals(lines, 'XOF'), [1, 2]);
});

test('ordinals: a different valueDate opens a separate sequence (both ordinal 1)', () => {
  const lines = [
    syntheticLine(),
    syntheticLine({ valueDate: '01/07/2026' })
  ];
  assert.deepEqual(assignDailyOccurrenceOrdinals(lines, 'XOF'), [1, 1]);
});

test('ordinals: sequences never leak across accounting days (defensive per-day key)', () => {
  const lines = [
    syntheticLine({ operationDate: '30/06/2026' }),
    syntheticLine({ operationDate: '01/07/2026', valueDate: '01/07/2026' })
  ];
  assert.deepEqual(assignDailyOccurrenceOrdinals(lines, 'XOF'), [1, 1]);
});

// ---------------------------------------------------------------------------
// 6. Composition: export -> daily units
// ---------------------------------------------------------------------------

test('composition: export J splits into one unit per accounting day with full traceability', () => {
  const decodedText = exportJCsv();
  const units = buildUnitsFromCsv(decodedText);

  assert.deepEqual(
    units.map((unit) => unit.accountingDate),
    ['29/06/2026', '30/06/2026', '01/07/2026']
  );
  for (const unit of units) {
    assert.equal(unit.bank, 'ORA');
    assert.equal(unit.accountFingerprint, SYNTHETIC_FINGERPRINT);
    assert.equal(unit.currency, 'XOF');
    assert.match(unit.dayUnitId, HEX_SHA256);
    assert.equal(unit.source.exportPeriodStart, '29/06/2026');
    assert.equal(unit.source.exportPeriodEnd, '01/07/2026');
    assert.equal(unit.source.sourceFileName, 'releve ora synthetique.csv');
    assert.equal(unit.source.rawTextHash, buildStructuredBankStatementRawTextHash({ decodedText }));
    // Identity layer only: a daily unit never carries an ingestion signal.
    assert.ok(!('ingestionReady' in unit));
    for (const line of unit.lines) {
      assert.equal(line.accountingDate, unit.accountingDate);
      assert.match(line.dailyLineHash, HEX_SHA256);
    }
  }
});

test('composition (0G): daily lines carry the parser amounts and running balance, without feeding any hash', () => {
  const units = buildUnitsFromCsv(exportJCsv());

  const debitLine = unitByDate(units, '29/06/2026').lines[0];
  assert.equal(debitLine.debitAmount, 50_000);
  assert.equal(debitLine.creditAmount, undefined);
  assert.equal(debitLine.runningBalance, 950_000);

  const creditLine = unitByDate(units, '30/06/2026').lines[0];
  assert.equal(creditLine.debitAmount, undefined);
  assert.equal(creditLine.creditAmount, 200_000);
  assert.equal(creditLine.runningBalance, 1_150_000);

  // Identity invariance: the enrichment is payload/aggregate material only —
  // a line stripped of its running balance keeps the exact same identities.
  const document = parseStructuredBankStatementCsv(exportJCsv(), {
    sourceFileName: 'releve ora synthetique.csv'
  });
  const strippedDocument = {
    ...document,
    lines: document.lines.map((line) => ({ ...line, debit: undefined, credit: undefined, balance: undefined }))
  };
  const stripped = buildDailyStatementUnitsFromStructuredDocument({
    document: strippedDocument,
    bank: 'ORA',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    currency: 'XOF'
  });
  assert.ok(stripped.success);
  assert.deepEqual(
    stripped.units.map((unit) => unit.lines.map((line) => line.dailyLineHash)),
    units.map((unit) => unit.lines.map((line) => line.dailyLineHash))
  );
});

test('composition: exact re-deposit of the same export yields identical units and hashes', () => {
  const first = buildUnitsFromCsv(exportJCsv());
  const second = buildUnitsFromCsv(exportJCsv());
  assert.deepEqual(second, first);
});

test('composition: overlapping exports J and J+1 share dayUnitId and dailyLineHash for common days', () => {
  const unitsJ = buildUnitsFromCsv(exportJCsv());
  const unitsJPlus1 = buildUnitsFromCsv(exportJPlus1Csv());

  // The two exports have different windows and different raw text fingerprints.
  assert.notEqual(
    unitByDate(unitsJ, '30/06/2026').source.rawTextHash,
    unitByDate(unitsJPlus1, '30/06/2026').source.rawTextHash
  );
  assert.notEqual(
    unitByDate(unitsJ, '30/06/2026').source.exportPeriodStart,
    unitByDate(unitsJPlus1, '30/06/2026').source.exportPeriodStart
  );

  // Common days 30/06 and 01/07: SAME canonical identity, line by line.
  for (const accountingDate of ['30/06/2026', '01/07/2026']) {
    const fromJ = unitByDate(unitsJ, accountingDate);
    const fromJPlus1 = unitByDate(unitsJPlus1, accountingDate);
    assert.equal(fromJPlus1.dayUnitId, fromJ.dayUnitId);
    assert.deepEqual(
      fromJPlus1.lines.map((line) => line.dailyLineHash),
      fromJ.lines.map((line) => line.dailyLineHash)
    );
    // Full identity view matches even though sourceRowIndex may differ; only
    // the traceability metadata (source) differs between the two exports.
    assert.deepEqual(
      { ...identityView(fromJPlus1), lines: fromJPlus1.lines.map(({ sourceRowIndex: _s, ...rest }) => rest) },
      { ...identityView(fromJ), lines: fromJ.lines.map(({ sourceRowIndex: _s, ...rest }) => rest) }
    );
  }

  // Day 29/06 exists only in J; day 02/07 is a NEW unit brought by J+1.
  assert.equal(unitsJPlus1.some((unit) => unit.accountingDate === '29/06/2026'), false);
  assert.equal(unitsJ.some((unit) => unit.accountingDate === '02/07/2026'), false);
  const newDay = unitByDate(unitsJPlus1, '02/07/2026');
  assert.equal(
    unitsJ.some((unit) => unit.dayUnitId === newDay.dayUnitId),
    false
  );
});

test('composition: same day with a corrected label yields the same dayUnitId but a different dailyLineHash', () => {
  const unitsJ = buildUnitsFromCsv(exportJCsv());
  const unitsCorrected = buildUnitsFromCsv(exportJPlus1Csv('VIREMENT RECU SYNTHETIQUE CORRIGE'));

  const fromJ = unitByDate(unitsJ, '30/06/2026');
  const corrected = unitByDate(unitsCorrected, '30/06/2026');
  assert.equal(corrected.dayUnitId, fromJ.dayUnitId);
  assert.notEqual(corrected.lines[0].dailyLineHash, fromJ.lines[0].dailyLineHash);
});

test('composition: physical noise (shifted sourceRowIndex) never changes a daily identity', () => {
  const reference = buildDailyStatementUnitsFromStructuredDocument({
    document: syntheticDocument([syntheticLine({ sourceRowIndex: 10 })]),
    bank: 'ORA',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    currency: 'XOF'
  });
  const shifted = buildDailyStatementUnitsFromStructuredDocument({
    document: syntheticDocument([syntheticLine({ sourceRowIndex: 42 })]),
    bank: 'ORA',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    currency: 'XOF'
  });
  assert.ok(reference.success && shifted.success);
  assert.equal(shifted.units[0].dayUnitId, reference.units[0].dayUnitId);
  assert.equal(shifted.units[0].lines[0].dailyLineHash, reference.units[0].lines[0].dailyLineHash);
  assert.notEqual(shifted.units[0].lines[0].sourceRowIndex, reference.units[0].lines[0].sourceRowIndex);
});

test('composition: two identical business lines in one day get ordinals 1 and 2 and distinct hashes', () => {
  const result = buildDailyStatementUnitsFromStructuredDocument({
    document: syntheticDocument([
      syntheticLine({ sourceRowIndex: 10 }),
      syntheticLine({ sourceRowIndex: 11 })
    ]),
    bank: 'ORA',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    currency: 'XOF'
  });
  assert.ok(result.success);
  const lines = result.units[0].lines;
  assert.deepEqual(lines.map((line) => line.dailyOccurrenceOrdinal), [1, 2]);
  assert.notEqual(lines[1].dailyLineHash, lines[0].dailyLineHash);
});

test('composition: fail-closed and all-or-nothing on unmappable direction or missing dates', () => {
  const badDirection = buildDailyStatementUnitsFromStructuredDocument({
    document: syntheticDocument([
      syntheticLine(),
      syntheticLine({ direction: 'unknown', sourceRowIndex: 11 })
    ]),
    bank: 'ORA',
    accountFingerprint: SYNTHETIC_FINGERPRINT,
    currency: 'XOF'
  });
  assert.ok(!badDirection.success);
  assert.match(badDirection.errors.join('\n'), /direction "unknown" is not mappable/);

  const missingContext = buildDailyStatementUnitsFromStructuredDocument({
    document: syntheticDocument([syntheticLine()]),
    bank: 'ORA',
    accountFingerprint: '   ',
    currency: 'XOF'
  });
  assert.ok(!missingContext.success);
  assert.match(missingContext.errors.join('\n'), /accountFingerprint is required/);
});

// ---------------------------------------------------------------------------
// 7. The v2 split never bypasses the 0C period guard
// ---------------------------------------------------------------------------

test('long export: v2 splitting works but the 0C ingestion guard still refuses ingestionReady', () => {
  const decodedText = [
    'Releve de compte synthetique;;;;;',
    `Numero de compte;SN08 SN000 ${SYNTHETIC_RAW_ACCOUNT_DIGITS}-46 XOF;;;;`,
    'Periode;01/01/2026;28/02/2026;;;',
    'Solde initial au 31/12/2025 : 1000000;;;;;',
    'Date;Valeur;Libelle;Debit;Credit;Solde',
    '05/01/2026;05/01/2026;PRELEVEMENT SYNTHETIQUE JANVIER;100000;;900000',
    '20/02/2026;20/02/2026;VIREMENT RECU SYNTHETIQUE FEVRIER;;300000;1200000',
    ';;Total;100000;300000;',
    'Solde au 28/02/2026 : 1200000;;;;;'
  ].join('\n');

  // The identity layer can split the long export into daily units...
  const units = buildUnitsFromCsv(decodedText);
  assert.deepEqual(
    units.map((unit) => unit.accountingDate),
    ['05/01/2026', '20/02/2026']
  );

  // ...but the pre-ingestion 0C guard is untouched: the export stays not
  // ingestion-ready because its period exceeds the cap.
  const preIngestion = prepareStructuredBankStatementCsvIngestion({
    decodedText,
    bank: 'ORA',
    sourceFileName: 'releve ora synthetique long.csv',
    accountFingerprint: SYNTHETIC_FINGERPRINT
  });
  assert.equal(preIngestion.ingestionReady, false);
  assert.match(
    preIngestion.errors.join('\n'),
    new RegExp(`above the ${MAX_STRUCTURED_BANK_STATEMENT_PERIOD_DAYS}-day ingestion limit`)
  );
});
