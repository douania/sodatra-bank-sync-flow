import assert from 'node:assert/strict';
import test from 'node:test';
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
