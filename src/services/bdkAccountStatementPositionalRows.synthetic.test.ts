import assert from 'node:assert/strict';
import test from 'node:test';
import type { TextItem } from './positionalExtractionService';
import { parseBDKAccountStatement } from './bdkAccountStatementParser';
import { reconstructBDKAccountStatementRows } from './bdkAccountStatementPositionalRows';

const COLUMN_X = {
  transactionDate: 40,
  valueDate: 140,
  description: 250,
  debit: 520,
  credit: 620,
  balance: 730
};

function textItem(text: string, x: number, y: number): TextItem {
  return {
    text,
    x,
    y,
    width: text.length * 6,
    height: 12,
    fontSize: 12,
    fontName: 'synthetic'
  };
}

function headers(): TextItem[] {
  return [
    textItem('Date', COLUMN_X.transactionDate, 20),
    textItem('Valeur', COLUMN_X.valueDate, 20),
    textItem('Libelle', COLUMN_X.description, 20),
    textItem('Debit', COLUMN_X.debit, 20),
    textItem('Credit', COLUMN_X.credit, 20),
    textItem('Solde', COLUMN_X.balance, 20)
  ];
}

function transactionItems({
  transactionDate = '30/04/2026',
  valueDate = '30/04/2026',
  description,
  debit,
  credit,
  balance,
  y
}: {
  transactionDate?: string;
  valueDate?: string;
  description: string;
  debit?: string;
  credit?: string;
  balance?: string;
  y: number;
}): TextItem[] {
  return [
    textItem(transactionDate, COLUMN_X.transactionDate, y),
    textItem(valueDate, COLUMN_X.valueDate, y),
    textItem(description, COLUMN_X.description, y),
    ...(debit ? [textItem(debit, COLUMN_X.debit, y)] : []),
    ...(credit ? [textItem(credit, COLUMN_X.credit, y)] : []),
    ...(balance ? [textItem(balance, COLUMN_X.balance, y)] : [])
  ];
}

function statementText(rows: string, totals: string, closingBalance: string): string {
  return `
BDK
EXTRAIT DE COMPTE
Solde initial (XOF) : 1 000 000
Date Valeur Libelle Debit Credit Solde
${rows}
Total ${totals}
Solde (XOF) au 05/05/2026 : ${closingBalance}
`;
}

test('BDK positioned account statement rows reconstruct a debit row for the pure parser', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    })
  ]);
  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '200 000 0', '800 000'));

  assert.equal(positioned.success, true);
  assert.equal(positioned.rows.length, 1);
  assert.equal(parsed.success, true);
  assert.ok(parsed.statement);
  assert.equal(parsed.statement.lines[0].direction, 'debit');
  assert.equal(parsed.statement.lines[0].debitAmount, 200_000);
});

test('BDK positioned account statement rows reconstruct a credit row for the pure parser', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      transactionDate: '02/05/2026',
      valueDate: '02/05/2026',
      description: 'ENCAISSEMENT SYNTHETIC CLIENT',
      credit: '200 000',
      balance: '1 200 000',
      y: 80
    })
  ]);
  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '0 200 000', '1 200 000'));

  assert.equal(positioned.success, true);
  assert.equal(parsed.success, true);
  assert.ok(parsed.statement);
  assert.equal(parsed.statement.lines[0].direction, 'credit');
  assert.equal(parsed.statement.lines[0].creditAmount, 200_000);
});

test('BDK positioned account statement rows attach a multiline description to its transaction', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC',
      debit: '200 000',
      balance: '800 000',
      y: 80
    }),
    textItem('FOURNISSEUR LONG LABEL', COLUMN_X.description, 96)
  ]);
  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '200 000 0', '800 000'));

  assert.equal(positioned.success, true);
  assert.equal(positioned.rows.length, 1);
  assert.ok(parsed.statement);
  assert.equal(parsed.statement.lines[0].descriptionSanitized, 'VIREMENT SYNTHETIC FOURNISSEUR LONG LABEL');
});

test('BDK positioned account statement rows do not promote an orphan continuation to a transaction', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    textItem('ORPHAN MULTILINE LABEL', COLUMN_X.description, 80)
  ]);

  assert.equal(positioned.success, false);
  assert.deepEqual(positioned.rows, []);
  assert.match(positioned.errors.join(' '), /orphan description continuation/i);
});

test('BDK positioned account statement rows leave a missing running balance fail-closed in the parser', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'FRAIS SYNTHETIC',
      debit: '100 000',
      y: 80
    })
  ]);
  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '100 000 0', '900 000'));

  assert.equal(positioned.success, false);
  assert.match(positioned.errors.join(' '), /no running balance/i);
  assert.equal(parsed.success, false);
  assert.match(parsed.errors.join(' '), /unknown direction/i);
});

test('BDK positioned account statement rows keep parser validation for balances and declared totals', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '850 000',
      y: 80
    })
  ]);
  const ambiguousBalance = parseBDKAccountStatement(
    statementText(positioned.rowOrientedText, '200 000 0', '850 000')
  );
  const mismatchedTotals = parseBDKAccountStatement(
    statementText(
      reconstructBDKAccountStatementRows([
        ...headers(),
        ...transactionItems({
          description: 'VIREMENT SYNTHETIC FOURNISSEUR',
          debit: '200 000',
          balance: '800 000',
          y: 80
        })
      ]).rowOrientedText,
      '100 000 0',
      '800 000'
    )
  );

  assert.equal(positioned.success, true);
  assert.equal(ambiguousBalance.success, false);
  assert.match(ambiguousBalance.errors.join(' '), /unknown direction/i);
  assert.equal(mismatchedTotals.success, false);
  assert.match(mismatchedTotals.errors.join(' '), /line totals do not match declared statement totals/i);
});
