import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  assessDailyV2ExportReferenceDate,
  prepareDailyV2BrowserDeposit as prepareDailyV2BrowserDepositImpl,
  readDailyV2FileNameExportDate,
  type DailyV2SupportedBank,
  type PrepareDailyV2BrowserInput,
} from './dailyV2BrowserPipeline';

const encoder = new TextEncoder();
const ACCOUNT_REGISTRY_ID = '00000000-0000-4000-8000-000000000001';
const BACKFILL_GRANT_ID = '00000000-0000-4000-8000-000000000002';

function prepareDailyV2BrowserDeposit(
  input: Omit<PrepareDailyV2BrowserInput, 'accountRegistryId'>,
) {
  return prepareDailyV2BrowserDepositImpl({
    ...input,
    accountRegistryId: ACCOUNT_REGISTRY_ID,
  });
}

function file(name: string, text: string) {
  const bytes = encoder.encode(text);
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function binaryFile(name: string, bytes: ArrayBuffer) {
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.slice(0);
    },
  };
}

function workbookBytes(
  rows: unknown[][],
  bookType: 'xls' | 'xlsx',
  compression = false,
): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'SYNTHETIC');
  const written = XLSX.write(workbook, { type: 'array', bookType, compression }) as ArrayBuffer | Uint8Array;
  if (written instanceof ArrayBuffer) return written;
  return written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
}

function atbExcel(): ArrayBuffer {
  return workbookBytes([
    ['SYNTHETIC ONLINE EXPORT'],
    [], [], [], [], [],
    ['Référence', "Date de l'opération", 'Date Valeur', 'Montant', 'Solde', 'Devise', 'Libellé'],
    ['SYN-002', 46212, 46212, '200', '1,100', 'XOF', 'SYNTHETIC CREDIT'],
    ['SYN-001', 46212, 46212, '-100', '900', 'XOF', 'SYNTHETIC DEBIT'],
  ], 'xls');
}

function bisBackfillExcel(): ArrayBuffer {
  const header = new Array(15).fill('');
  header[1] = "Date de l'opération commerciale";
  header[3] = 'Date de valeur';
  header[5] = 'Description';
  header[10] = 'Débit(XOF)';
  header[12] = 'Crédit(XOF)';
  header[14] = 'Solde';
  const latest = new Array(15).fill('');
  latest[1] = '20/02/2026';
  latest[3] = '20/02/2026';
  latest[5] = 'SYNTHETIC CREDIT';
  latest[10] = 0;
  latest[12] = 200;
  latest[14] = '1,100 Créditeur';
  const earliest = new Array(15).fill('');
  earliest[1] = '01/01/2026';
  earliest[3] = '01/01/2026';
  earliest[5] = 'SYNTHETIC DEBIT';
  earliest[10] = 100;
  earliest[12] = 0;
  earliest[14] = '900 Créditeur';
  return workbookBytes([
    ['SYNTHETIC ONLINE EXPORT'],
    [], [], [], [], [], [], [], [], [],
    header,
    latest,
    earliest,
  ], 'xls');
}

function bridgeExcel(): ArrayBuffer {
  return workbookBytes([
    ['Date Operation', 'Description', 'Reference', 'Date Valeur', 'Debit', 'Credit', ''],
    ['09 Jul 2026', 'SYNTHETIC DEBIT', 'SYN-001', '09 Jul 2026', '100', '', '900'],
    ['09 Jul 2026', 'SYNTHETIC CREDIT', 'SYN-002', '09 Jul 2026', '', '200', '1,100'],
  ], 'xlsx');
}

function compressedBridgeExcel(): ArrayBuffer {
  return workbookBytes([
    ['Date Operation', 'Description', 'Reference', 'Date Valeur', 'Debit', 'Credit', ''],
    ['09 Jul 2026', 'SYNTHETIC DEBIT', 'SYN-001', '09 Jul 2026', '100', '', '900'],
  ], 'xlsx', true);
}

function corruptFirstXlsxLocalSize(source: ArrayBuffer): ArrayBuffer {
  const bytes = source.slice(0);
  const view = new DataView(bytes);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  assert.notEqual(eocd, -1);
  const centralOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  const localOffset = view.getUint32(centralOffset + 42, true);
  assert.equal(view.getUint32(localOffset, true), 0x04034b50);
  view.setUint32(localOffset + 22, view.getUint32(localOffset + 22, true) + 1, true);
  return bytes;
}

function understateFirstDeflatedXlsxEntry(source: ArrayBuffer): ArrayBuffer {
  const bytes = source.slice(0);
  const view = new DataView(bytes);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  assert.notEqual(eocd, -1);
  const centralOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint16(centralOffset + 10, true), 8);
  const localOffset = view.getUint32(centralOffset + 42, true);
  assert.equal(view.getUint16(localOffset + 8, true), 8);
  view.setUint32(centralOffset + 24, 1, true);
  view.setUint32(localOffset + 22, 1, true);
  return bytes;
}

function csv(rows: string[]): string {
  return rows.join('\n');
}

function validCsv(periodEnd = '03/06/2026'): string {
  return csv([
    'EXTRAIT DE COMPTE;;;;;',
    `Periode du;01/06/2026;au;${periodEnd};;`,
    'Numero de compte;01401-00000000000-00 XOF;;;;',
    'Code IBAN;SN00SN0000000000000000000000;;;;',
    ';;Solde initial (XOF) : 1000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC DEBIT;100;;900',
    '02/06/2026;02/06/2026;SYNTHETIC CREDIT;;200;1100',
    '03/06/2026;03/06/2026;SYNTHETIC DEBIT TWO;50;;1050',
    ';;Total;150;200;',
    `;;Solde (XOF) au ${periodEnd} : 1050;;;`,
  ]);
}

function currencyFreeCsv(periodEnd = '03/06/2026'): string {
  return csv([
    'EXTRAIT DE COMPTE;;;;;',
    `Periode du;01/06/2026;au;${periodEnd};;`,
    'Numero de compte;01401-00000000000-00;;;;',
    'Code IBAN;SN00SN0000000000000000000000;;;;',
    ';;Solde initial : 1000;;;',
    "Date;Valeur;Libelle de l'operation;Debit;Credit;Solde",
    '01/06/2026;01/06/2026;SYNTHETIC DEBIT;100;;900',
    '02/06/2026;02/06/2026;SYNTHETIC CREDIT;;200;1100',
    '03/06/2026;03/06/2026;SYNTHETIC DEBIT TWO;50;;1050',
    ';;Total;150;200;',
    `;;Solde au ${periodEnd} : 1050;;;`,
  ]);
}

test('refuses a BDK CSV without a verifiable parsed currency (fail closed)', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', currencyFreeCsv()),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bdk-no-currency',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.errors.join(' '), /no verifiable currency; deposit refused/i);
  }
});

test('refuses an ORA CSV without a verifiable parsed currency (fail closed)', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC ORA ONLINE.csv', currencyFreeCsv()),
    bank: 'ORA',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-ora-no-currency',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.errors.join(' '), /no verifiable currency; deposit refused/i);
  }
});

test('still refuses a CSV whose parsed currency differs from the trusted currency', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', validCsv()),
    bank: 'BDK',
    currency: 'EUR',
    accountFingerprint: 'fp-synthetic-bdk-currency-mismatch',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.errors.join(' '), /does not match the parsed currency/i);
  }
});

test('builds a safe BDK Daily v2 payload without raw CSV, full account, IBAN or file name', async () => {
  const source = validCsv();
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', source),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bdk-v2',
    exportReferenceDate: '04/06/2026',
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.payload.p_units.length, 3);
  assert.equal(result.payload.p_lines.length, 3);
  assert.deepEqual(result.payload.p_units.map((unit) => unit.requested_unit_status), [
    'staged',
    'staged',
    'staged',
  ]);
  assert.equal(result.payload.p_attempt.source_file_name_redacted, null);
  assert.match(result.payload.p_attempt.account_number_masked ?? '', /^\*+[0-9]{0,4}$/);

  const serialized = JSON.stringify(result.payload);
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes('01401-00000000000-00'), false);
  assert.equal(serialized.includes('SN00SN0000000000000000000000'), false);
  assert.equal(serialized.includes('SYNTHETIC BDK ONLINE.csv'), false);
  assert.equal(serialized.includes('raw_csv'), false);
  assert.equal(serialized.includes('decoded_text'), false);
});

test('corroborates a parsed masked account only against the provisioned registry mask', async () => {
  const uncorroborated = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', validCsv()),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bdk-v2',
  });
  assert.equal(uncorroborated.success, true);
  if (!uncorroborated.success) return;
  const parsedMask = uncorroborated.diagnostic.accountNumberMasked;
  assert.ok(parsedMask);
  assert.equal(uncorroborated.payload.p_units[0].validation_status, 'needs_review');
  assert.ok(uncorroborated.payload.p_units[0].review_reason_codes.includes('ACCOUNT_IDENTITY_NOT_CORROBORATED'));

  const corroborated = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', validCsv()),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bdk-v2',
    registeredAccountNumberMasked: parsedMask,
  });
  assert.equal(corroborated.success, true);
  if (!corroborated.success) return;
  assert.equal(corroborated.payload.p_units[0].validation_status, 'valid');
  assert.equal(corroborated.payload.p_units[0].review_reason_codes.includes('ACCOUNT_IDENTITY_NOT_CORROBORATED'), false);
});

test('builds a safe ATB XLS payload through the same Daily v2 identity contract', async () => {
  const source = atbExcel();
  const result = await prepareDailyV2BrowserDeposit({
    file: binaryFile('SYNTHETIC ATB ONLINE.xls', source),
    bank: 'ATB',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-atb-v2',
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.payload.p_attempt.source_format, 'structured_bank_statement_xls');
  assert.equal(result.payload.p_attempt.requested_mode, 'daily');
  assert.match(result.payload.p_attempt.parser_version ?? '', /atb-online-xls-v1/);
  assert.deepEqual(result.payload.p_lines.map((line) => line.signed_amount), [-100, 200]);
  assert.equal(result.payload.p_units[0].validation_status, 'needs_review');
  assert.deepEqual(result.payload.p_units[0].review_reason_codes, ['ACCOUNT_IDENTITY_NOT_CORROBORATED']);
  assert.deepEqual(result.payload.p_attempt.review_reason_codes, ['ACCOUNT_IDENTITY_NOT_CORROBORATED']);
  assert.equal(result.payload.p_attempt.source_file_name_redacted, null);
  assert.equal(JSON.stringify(result.payload).includes('SYNTHETIC ATB ONLINE.xls'), false);
});

test('holds BRIDGE XLSX units for review when currency exists only in trusted context', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: binaryFile('SYNTHETIC BRIDGE ONLINE.xlsx', bridgeExcel()),
    bank: 'BRIDGE',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bridge-v2',
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.payload.p_attempt.parser_validation_status, 'needs_review');
  assert.equal(result.payload.p_units[0].aggregates_status, 'derived');
  assert.equal(result.payload.p_units[0].validation_status, 'needs_review');
  assert.deepEqual(new Set(result.payload.p_attempt.review_reason_codes), new Set([
    'TRUSTED_CURRENCY_UNCORROBORATED',
    'ACCOUNT_IDENTITY_NOT_CORROBORATED',
  ]));
});

test('refuses a non-canonical trusted currency even when the workbook omits currency', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: binaryFile('SYNTHETIC BRIDGE ONLINE.xlsx', bridgeExcel()),
    bank: 'BRIDGE',
    currency: 'xof',
    accountFingerprint: 'fp-synthetic-bridge-v2',
  });

  assert.equal(result.success, false);
  if (!result.success) assert.match(result.errors.join(' '), /uppercase ISO-like/i);
});

test('requires explicit backfill mode and grant for a BIS export above 45 days', async () => {
  const source = bisBackfillExcel();
  const daily = await prepareDailyV2BrowserDeposit({
    file: binaryFile('SYNTHETIC BIS ONLINE.xls', source),
    bank: 'BIS',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bis-v2',
  });
  assert.equal(daily.success, false);
  if (!daily.success) assert.match(daily.errors.join(' '), /above the 45-day/i);

  const backfill = await prepareDailyV2BrowserDeposit({
    file: binaryFile('SYNTHETIC BIS ONLINE.xls', source),
    bank: 'BIS',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bis-v2',
    requestedMode: 'backfill',
    backfillGrantId: BACKFILL_GRANT_ID,
  });
  assert.equal(backfill.success, true);
  if (!backfill.success) return;
  assert.equal(backfill.payload.p_attempt.requested_mode, 'backfill');
  assert.equal(
    backfill.payload.p_guard_context.backfill_grant_id,
    BACKFILL_GRANT_ID,
  );
  assert.equal(backfill.payload.p_units.length, 2);
  assert.equal(backfill.payload.p_units.every((unit) => unit.validation_status === 'needs_review'), true);
  assert.equal(
    backfill.payload.p_units.every((unit) => unit.review_reason_codes.includes('BACKFILL_REVIEW_REQUIRED')),
    true,
  );
});

test('rejects a missing provisioned account registry id before parsing', async () => {
  const result = await prepareDailyV2BrowserDepositImpl({
    file: file('SYNTHETIC BDK ONLINE.csv', validCsv()),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bdk-v2',
    accountRegistryId: '',
  });

  assert.equal(result.success, false);
  if (!result.success) assert.match(result.errors.join(' '), /provisioned account/i);
});

test('rejects an Excel extension/signature mismatch before workbook parsing', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BRIDGE ONLINE.xlsx', 'not an xlsx container'),
    bank: 'BRIDGE',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bridge-v2',
  });

  assert.equal(result.success, false);
  if (!result.success) assert.match(result.errors.join(' '), /does not match the file signature/i);
});

test('rejects a PK-prefixed XLSX payload without a valid ZIP central directory', async () => {
  const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).buffer;
  const result = await prepareDailyV2BrowserDeposit({
    file: binaryFile('SYNTHETIC BRIDGE ONLINE.xlsx', fakeZip),
    bank: 'BRIDGE',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bridge-v2',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.errors.join(' '), /no valid end-of-central-directory/i);
  }
});

test('rejects conflicting local and central XLSX sizes before decompression', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: binaryFile('SYNTHETIC BRIDGE ONLINE.xlsx', corruptFirstXlsxLocalSize(bridgeExcel())),
    bank: 'BRIDGE',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bridge-v2',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.errors.join(' '), /local and central directory metadata do not match/i);
  }
});

test('rejects a deflated XLSX entry whose actual expansion exceeds matching headers', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: binaryFile(
      'SYNTHETIC BRIDGE ONLINE.xlsx',
      understateFirstDeflatedXlsxEntry(compressedBridgeExcel()),
    ),
    bank: 'BRIDGE',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bridge-v2',
  });

  assert.equal(result.success, false);
  if (!result.success) assert.match(result.errors.join(' '), /expands beyond its declared safety bound/i);
});

test('enforces the byte cap even when a File-like caller omits the declared size', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: {
      name: 'SYNTHETIC BDK ONLINE.csv',
      async arrayBuffer() {
        return new ArrayBuffer(10 * 1024 * 1024 + 1);
      },
    },
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-byte-cap-v2',
  });

  assert.equal(result.success, false);
  if (!result.success) assert.match(result.errors.join(' '), /exceeds the 10 MB safety limit/i);
});

test('holds the latest ORA accounting day as provisional when exportReferenceDate is absent', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC ORA ONLINE.csv', validCsv()),
    bank: 'ORA',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-ora-v2',
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.payload.p_units.map((unit) => unit.requested_unit_status), [
    'staged',
    'staged',
    'provisional',
  ]);
  assert.equal(result.diagnostic.provisionalUnitsCount, 1);
});

test('never derives accountFingerprint from the masked account label', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', validCsv()),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: '',
  });

  assert.equal(result.success, false);
  assert.ok('errors' in result);
  if ('errors' in result) assert.match(result.errors.join(' '), /accountFingerprint is required/i);
});

test('rejects a masked label supplied as accountFingerprint', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', validCsv()),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: '****0000',
  });

  assert.equal(result.success, false);
  assert.ok('errors' in result);
  if ('errors' in result) assert.match(result.errors.join(' '), /opaque pre-provisioned/i);
});

test('rejects a bank mismatch between trusted context and source-file hint', async () => {
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC ORA ONLINE.csv', validCsv()),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-mismatch-v2',
  });

  assert.equal(result.success, false);
  assert.ok('errors' in result);
  if ('errors' in result) assert.match(result.errors.join(' '), /does not match the parser bank hint/i);
});

test('rejects BRIDGE-named files before reading bytes', async () => {
  let reads = 0;
  const result = await prepareDailyV2BrowserDeposit({
    file: {
      name: 'SYNTHETIC BRIDGE BANK.csv',
      size: 100,
      async arrayBuffer() {
        reads++;
        return new ArrayBuffer(0);
      },
    },
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-bridge-v2',
  });

  assert.equal(result.success, false);
  assert.equal(reads, 0);
});

test('assigns distinct daily hashes to duplicate logical lines through per-day ordinals', async () => {
  const duplicateCsv = csv([
    'Periode du;01/06/2026;au;01/06/2026;;',
    'Numero de compte;01401-00000000000-00 XOF;;;;',
    ';;Solde initial (XOF) : 0;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC DUPLICATE;;100;100',
    '01/06/2026;01/06/2026;SYNTHETIC DUPLICATE;;100;200',
    ';;Total;0;200;',
    ';;Solde (XOF) au 01/06/2026 : 200;;;',
  ]);
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', duplicateCsv),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-duplicates-v2',
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.payload.p_lines.map((line) => line.daily_occurrence_ordinal), [1, 2]);
  assert.equal(new Set(result.payload.p_lines.map((line) => line.daily_line_hash)).size, 2);
});

test('rejects daily windows above 45 days', async () => {
  const longPeriodCsv = csv([
    'Periode du;01/01/2026;au;20/02/2026;;',
    'Numero de compte;01401-00000000000-00 XOF;;;;',
    ';;Solde initial (XOF) : 0;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/01/2026;01/01/2026;SYNTHETIC CREDIT;;100;100',
    ';;Total;0;100;',
    ';;Solde (XOF) au 20/02/2026 : 100;;;',
  ]);
  const result = await prepareDailyV2BrowserDeposit({
    file: file('SYNTHETIC BDK ONLINE.csv', longPeriodCsv),
    bank: 'BDK',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-long-v2',
  });

  assert.equal(result.success, false);
  assert.ok('errors' in result);
  if ('errors' in result) assert.match(result.errors.join(' '), /above the 45-day/i);
});

// --- Pack DAILY-V2-BDK-ORABANK-OPERATIONAL-READINESS ------------------------
// C : reconnaissance ORAB par le pipeline réellement utilisé (cas `ora_211026_orab`, données fictives).

test('accepts ORAB-named ORABANK CSVs through the real pipeline, identical to the ORA name, parser version unchanged (C)', async () => {
  const reference = await prepareDailyV2BrowserDeposit({
    file: file('030626 ORA ONLINE.csv', validCsv()),
    bank: 'ORA',
    currency: 'XOF',
    accountFingerprint: 'fp-synthetic-orab-v2',
  });
  assert.equal(reference.success, true);
  if (!reference.success) return;
  for (const name of ['030626 ORAB ONLINE.csv', '030626_ORAB_ONLINE.csv', '030626-ORAB-ONLINE.csv', 'ORABANK 030626.csv']) {
    const result = await prepareDailyV2BrowserDeposit({
      file: file(name, validCsv()),
      bank: 'ORA',
      currency: 'XOF',
      accountFingerprint: 'fp-synthetic-orab-v2',
    });
    assert.equal(result.success, true, name);
    if (!result.success) return;
    assert.equal(result.payload.p_attempt.parser_version, 'structured-csv-0b', name);
    assert.equal(result.payload.p_attempt.runtime_version, 'daily-v2-browser-0q', name);
    assert.equal(result.payload.p_attempt.raw_text_hash, reference.payload.p_attempt.raw_text_hash, name);
    assert.deepEqual(result.payload.p_units, reference.payload.p_units, name);
    assert.deepEqual(result.payload.p_lines, reference.payload.p_lines, name);
    assert.equal(JSON.stringify(result.payload).includes(name), false, `${name} : nom jamais transmis`);
  }
});

test('refuses ORAB names declared under another bank, and ambiguous or partial bank names (C)', async () => {
  const cases: Array<[string, DailyV2SupportedBank]> = [
    ['030626 ORAB ONLINE.csv', 'BDK'],
    ['030626 ORAB BDK ONLINE.csv', 'ORA'],
    ['030626 ORAB BDK ONLINE.csv', 'BDK'],
    ['030626 ORABANK BDK.csv', 'ORA'],
    ['030626 BORAB ONLINE.csv', 'ORA'],
    ['030626 ORABX ONLINE.csv', 'ORA'],
  ];
  for (const [name, bank] of cases) {
    const result = await prepareDailyV2BrowserDeposit({
      file: file(name, validCsv()),
      bank,
      currency: 'XOF',
      accountFingerprint: 'fp-synthetic-orab-refusal-v2',
    });
    assert.equal(result.success, false, `${name} / ${bank}`);
    assert.ok('errors' in result);
    if ('errors' in result) assert.match(result.errors.join(' '), /does not match the parser bank hint/i, name);
  }
});

// A : date d'export — lecture du nom de fichier et effet de la date sur une préparation réelle.

test('reads an export date only from a leading DDMMYY token of the file name (A)', () => {
  assert.equal(readDailyV2FileNameExportDate('211026 ORAB ONLINE.csv'), '21/10/2026');
  assert.equal(readDailyV2FileNameExportDate('  090726_BDK_ONLINE.csv'), '09/07/2026');
  assert.equal(readDailyV2FileNameExportDate('031126-BDK-ONLINE.csv'), '03/11/2026');
  for (const name of ['BDK OCTOBRE-26.csv', 'ORABANK OCT-26.csv', '2110261 ORA ONLINE.csv',
    '311126 BDK ONLINE.csv', 'releve 211026 ORA ONLINE.csv', 'SYNTHETIC ORA ONLINE.csv']) {
    assert.equal(readDailyV2FileNameExportDate(name), null, name);
  }
});

test('assesses the effect of the export reference date on a really prepared payload (A)', async () => {
  const prepareWith = async (name: string, bank: DailyV2SupportedBank, exportReferenceDate?: string) => {
    const result = await prepareDailyV2BrowserDeposit({
      file: file(name, validCsv()),
      bank,
      currency: 'XOF',
      accountFingerprint: 'fp-synthetic-reference-v2',
      exportReferenceDate,
    });
    assert.equal(result.success, true, `${name} / ${exportReferenceDate ?? 'sans date'}`);
    if (!result.success) throw new Error('préparation attendue');
    return assessDailyV2ExportReferenceDate({
      fileName: result.diagnostic.sourceFileName,
      bank,
      exportReferenceDate: result.payload.p_attempt.export_reference_date,
      units: result.payload.p_units,
    });
  };

  // Date du jour d'export = dernière journée = nom du fichier : seule cette journée reste provisoire.
  const exact = await prepareWith('030626 ORA ONLINE.csv', 'ORA', '03/06/2026');
  assert.deepEqual(exact.provisionalDates, ['03/06/2026']);
  assert.equal(exact.closedDatesCount, 2);
  assert.deepEqual(exact.issues, []);
  assert.equal(exact.blocking, false);

  // Ancienne date conservée par erreur (antérieure au fichier) : journées closes rouvertes, dépôt bloqué.
  const stale = await prepareWith('030626 ORA ONLINE.csv', 'ORA', '02/06/2026');
  assert.deepEqual(stale.provisionalDates, ['02/06/2026', '03/06/2026']);
  assert.deepEqual(stale.issues, ['REFERENCE_BEFORE_LATEST_DAY', 'REFERENCE_DIFFERS_FROM_FILE_NAME']);
  assert.equal(stale.provisionalDates.length + stale.closedDatesCount, 3);
  assert.equal(stale.blocking, true);

  // Date d'un fichier plus récent conservée : la journée d'export serait close à tort ; dépôt bloqué.
  const later = await prepareWith('030626 ORA ONLINE.csv', 'ORA', '21/06/2026');
  assert.deepEqual(later.provisionalDates, []);
  assert.equal(later.closedDatesCount, 3);
  assert.deepEqual(later.issues, ['REFERENCE_AFTER_LATEST_DAY', 'REFERENCE_AFTER_FILE_NAME_DATE']);
  assert.equal(later.blocking, true);

  // Export du 04/06 sans opération ce jour-là : date = nom, postérieure à la dernière journée ; signalé, non bloquant.
  const quietExportDay = await prepareWith('040626 ORA ONLINE.csv', 'ORA', '04/06/2026');
  assert.deepEqual(quietExportDay.provisionalDates, []);
  assert.deepEqual(quietExportDay.issues, ['REFERENCE_AFTER_LATEST_DAY']);
  assert.equal(quietExportDay.blocking, false);

  // Date antérieure au nom mais égale à la dernière journée : sens prudent (journée provisoire) ; signalé, non bloquant.
  const earlierThanName = await prepareWith('040626 ORA ONLINE.csv', 'ORA', '03/06/2026');
  assert.deepEqual(earlierThanName.provisionalDates, ['03/06/2026']);
  assert.deepEqual(earlierThanName.issues, ['REFERENCE_DIFFERS_FROM_FILE_NAME']);
  assert.equal(earlierThanName.blocking, false);

  // Sans date lue dans le nom, une date postérieure reste un simple signalement (mensuel déposé après la fin du mois).
  const monthlyLater = await prepareWith('ORABANK JUIN-26.csv', 'ORA', '02/07/2026');
  assert.deepEqual(monthlyLater.issues, ['REFERENCE_AFTER_LATEST_DAY']);
  assert.equal(monthlyLater.blocking, false);

  // Date du nom antérieure au contenu (nom AAMMJJ lu 26/10/2021, ou fichier renommé) : le nom ne juge plus la date
  // saisie ; signalé, et seule la cohérence avec le contenu reste bloquante.
  for (const name of ['020626 BDK ONLINE.csv', '261021 BDK ONLINE.csv']) {
    const onLastDay = await prepareWith(name, 'BDK', '03/06/2026');
    assert.deepEqual(onLastDay.issues, ['FILE_NAME_DATE_BEFORE_CONTENT'], name);
    assert.equal(onLastDay.blocking, false, name);
    const after = await prepareWith(name, 'BDK', '04/06/2026');
    assert.deepEqual(after.issues, ['FILE_NAME_DATE_BEFORE_CONTENT', 'REFERENCE_AFTER_LATEST_DAY'], name);
    assert.equal(after.blocking, false, name);
    const before = await prepareWith(name, 'BDK', '02/06/2026');
    assert.deepEqual(before.issues, ['FILE_NAME_DATE_BEFORE_CONTENT', 'REFERENCE_BEFORE_LATEST_DAY'], name);
    assert.equal(before.blocking, true, name);
    const without = await prepareWith(name, 'BDK');
    assert.deepEqual(without.issues, ['FILE_NAME_DATE_BEFORE_CONTENT'], name);
  }

  // ORABANK sans date : règle existante (dernière journée provisoire) et date du nom non transmise.
  const oraWithout = await prepareWith('030626 ORAB ONLINE.csv', 'ORA');
  assert.equal(oraWithout.referenceDate, null);
  assert.deepEqual(oraWithout.provisionalDates, ['03/06/2026']);
  assert.deepEqual(oraWithout.issues, ['ORA_WITHOUT_REFERENCE_DATE', 'FILE_NAME_DATE_NOT_USED']);

  // BDK sans date : aucune journée provisoire, y compris le jour d'export lu dans le nom.
  const bdkWithout = await prepareWith('030626 BDK ONLINE.csv', 'BDK');
  assert.deepEqual(bdkWithout.provisionalDates, []);
  assert.deepEqual(bdkWithout.issues, ['FILE_NAME_DATE_NOT_USED']);

  // Mensuel sans date dans le nom ni saisie : aucun point signalé.
  const monthly = await prepareWith('BDK JUIN-26.csv', 'BDK');
  assert.deepEqual(monthly.issues, []);
  assert.equal(monthly.fileNameDate, null);
});
