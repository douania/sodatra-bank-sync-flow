import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { prepareDailyV2BrowserDeposit } from './dailyV2BrowserPipeline';

const encoder = new TextEncoder();

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
    backfillGrantReference: 'GO-BACKFILL-SYNTHETIC-0Q',
  });
  assert.equal(backfill.success, true);
  if (!backfill.success) return;
  assert.equal(backfill.payload.p_attempt.requested_mode, 'backfill');
  assert.equal(
    backfill.payload.p_guard_context.backfill_grant_reference,
    'GO-BACKFILL-SYNTHETIC-0Q',
  );
  assert.equal(backfill.payload.p_units.length, 2);
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
