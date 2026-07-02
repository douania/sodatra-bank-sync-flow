import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import {
  runStructuredBankStatementCsvDiagnostic,
  type StructuredBankStatementCsvFileLike
} from './structuredBankStatementCsvRuntimeDiagnosticService';

// All fixtures below are fully synthetic. No real bank statement data is used.

function toArrayBuffer(text: string): ArrayBuffer {
  // Encode as latin1 so ASCII fixtures round-trip through the Windows-1252
  // decoding performed by the service under test.
  const bytes = Buffer.from(text, 'latin1');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

interface RecordingCsvFile extends StructuredBankStatementCsvFileLike {
  arrayBufferCalls: number;
}

function csvFile(name: string, rows: string[]): RecordingCsvFile {
  const text = rows.join('\n');
  return {
    name,
    type: 'text/csv',
    arrayBufferCalls: 0,
    async arrayBuffer(): Promise<ArrayBuffer> {
      this.arrayBufferCalls++;
      return toArrayBuffer(text);
    }
  };
}

function nonReadableFile(name: string): {
  file: StructuredBankStatementCsvFileLike;
  wasRead: () => boolean;
} {
  let read = false;
  return {
    file: {
      name,
      type: 'application/pdf',
      async arrayBuffer(): Promise<ArrayBuffer> {
        read = true;
        throw new Error('arrayBuffer must not be called for a non-csv file');
      }
    },
    wasRead: () => read
  };
}

function collectKeys(value: unknown, keys: Set<string> = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

const FORBIDDEN_KEYS = ['rawCsv', 'rawText', 'lines', 'descriptionSanitized'];

function validOraLikeRows(): string[] {
  return [
    'EXTRAIT DE COMPTE;;;;;',
    'Periode du;01/06/2026;au;30/06/2026;;',
    'Numero de compte;01401-00000000000-00 XOF;;;;',
    'Code IBAN;SN00SN0000000000000000000000;;;;',
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;SYNTHETIC OUTFLOW ORABANK;200000;;800000',
    '02/06/2026;02/06/2026;SYNTHETIC INFLOW;;500000;1300000',
    '03/06/2026;03/06/2026;SYNTHETIC OUTFLOW TWO;300000;;1000000',
    ';;Total;500000;500000;',
    ';;Solde (XOF) au 30/06/2026 : 1000000;;;'
  ];
}

test('valid ORA-like CSV produces a safe diagnostic summary without ingestion', async () => {
  const file = csvFile('010726 ORA ONLINE.csv', validOraLikeRows());
  const diagnostic = await runStructuredBankStatementCsvDiagnostic(file);

  assert.equal(diagnostic.detectedFormat, 'structured_bank_statement_csv');
  assert.equal(diagnostic.status, 'valid');
  assert.equal(diagnostic.success, true);
  assert.equal(diagnostic.diagnosticCompleted, true);
  assert.equal(diagnostic.ingestionAllowed, false);
  assert.equal(diagnostic.rawContentHidden, true);

  assert.equal(diagnostic.lineCount, 3);
  assert.equal(diagnostic.debitLineCount, 2);
  assert.equal(diagnostic.creditLineCount, 1);
  assert.equal(diagnostic.unknownLineCount, 0);

  assert.equal(diagnostic.bankHint, 'ORA');
  assert.equal(diagnostic.currency, 'XOF');
  assert.equal(diagnostic.periodStart, '01/06/2026');
  assert.equal(diagnostic.periodEnd, '30/06/2026');

  // No forbidden field must appear anywhere in the result.
  const keys = collectKeys(diagnostic);
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.equal(keys.has(forbidden), false, `result must not expose "${forbidden}"`);
  }

  // No raw content must leak: neither a transaction label nor the raw account.
  const serialized = JSON.stringify(diagnostic);
  assert.equal(serialized.includes('SYNTHETIC OUTFLOW'), false);
  assert.equal(serialized.includes('ORABANK'), false);
  assert.equal(serialized.includes('01401'), false);
});

test('unterminated quoted field fails closed as invalid with no lines', async () => {
  const file = csvFile('020726 ORA ONLINE.csv', [
    ';;Solde initial (XOF) : 1000000;;;',
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    '01/06/2026;01/06/2026;"CHEQUE DE BANQUE;200000;;800000'
  ]);

  const diagnostic = await runStructuredBankStatementCsvDiagnostic(file);

  assert.equal(diagnostic.success, false);
  assert.equal(diagnostic.status, 'invalid');
  assert.equal(diagnostic.ingestionAllowed, false);
  assert.equal(diagnostic.lineCount, 0);
  assert.match(diagnostic.errors.join(' '), /unterminated quoted field/i);
});

test('non-bank CSV without a recognizable header is unsupported and leaks nothing', async () => {
  const file = csvFile('random-export.csv', [
    'FOO;BAR;BAZ',
    'ALPHA;BETA;GAMMA',
    '1;2;3'
  ]);

  const diagnostic = await runStructuredBankStatementCsvDiagnostic(file);

  assert.equal(diagnostic.success, false);
  assert.ok(
    diagnostic.status === 'unsupported' || diagnostic.status === 'invalid',
    `expected unsupported/invalid, got ${diagnostic.status}`
  );
  assert.equal(diagnostic.ingestionAllowed, false);
  assert.equal(diagnostic.lineCount, 0);

  const serialized = JSON.stringify(diagnostic);
  assert.equal(serialized.includes('GAMMA'), false);
  assert.equal(serialized.includes('ALPHA'), false);
});

test('non-csv file is rejected fail-closed without reading its bytes', async () => {
  const { file, wasRead } = nonReadableFile('statement.pdf');

  const diagnostic = await runStructuredBankStatementCsvDiagnostic(file);

  assert.equal(diagnostic.success, false);
  assert.equal(diagnostic.diagnosticCompleted, false);
  assert.equal(diagnostic.ingestionAllowed, false);
  assert.equal(diagnostic.rawContentHidden, true);
  assert.equal(wasRead(), false, 'arrayBuffer() must not be called for a non-csv file');
  assert.match(diagnostic.errors.join(' '), /only \.csv files are supported/i);
});
