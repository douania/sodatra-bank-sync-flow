import assert from 'node:assert/strict';
import test from 'node:test';
import type { PositionedBankStatementRow } from '@/types/bankStatementPositioning';
import type { TextItem } from './positionalExtractionService';
import { parseBDKAccountStatement } from './bdkAccountStatementParser';
import { analyzeBDKAccountStatementPositioned } from './bdkAccountStatementPositionedAnalyzer';
import { extractBDKAccountStatementPositionedBalances } from './bdkAccountStatementPositionedBalanceExtractor';
import {
  BDK_ACCOUNT_STATEMENT_POSITIONAL_PROFILE,
  reconstructBDKAccountStatementRows
} from './bdkAccountStatementPositionalRows';
import { validateBDKAccountStatementPositionedRows } from './bdkAccountStatementPositionedRowsValidator';

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

function observedHeaderVariant(): TextItem[] {
  return [
    textItem('Date', COLUMN_X.transactionDate, 20),
    textItem('Valeur', COLUMN_X.valueDate, 20),
    textItem("Libellé de l'Opération", COLUMN_X.description, 20),
    textItem('Débit (XOF)', COLUMN_X.debit, 20),
    textItem('Crédit (XOF)', COLUMN_X.credit, 20),
    textItem('Solde (XOF)', COLUMN_X.balance, 20)
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

function balanceLine(text: string, y: number): TextItem[] {
  return text
    .split('|')
    .map((part, index) => textItem(part, 40 + index * 140, y));
}

function closingBalanceFooterLine(amount: string, y: number): TextItem[] {
  return [
    textItem('Solde (XOF) au 05/05/2026 :', COLUMN_X.balance, y),
    textItem(amount, COLUMN_X.balance + 180, y)
  ];
}

function syntheticPositionedStatementItems(): TextItem[] {
  return [
    ...balanceLine('Solde initial (XOF) :|1 000 000', 8),
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    }),
    ...transactionItems({
      transactionDate: '02/05/2026',
      valueDate: '02/05/2026',
      description: 'ENCAISSEMENT SYNTHETIC CLIENT',
      credit: '200 000',
      balance: '1 000 000',
      y: 104
    }),
    ...transactionItems({
      transactionDate: '05/05/2026',
      valueDate: '05/05/2026',
      description: 'FRAIS SYNTHETIC',
      debit: '100 000',
      balance: '900 000',
      y: 128
    }),
    ...closingBalanceFooterLine('900 000', 160)
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

function positionedRow(
  overrides: Partial<PositionedBankStatementRow>
): PositionedBankStatementRow {
  return {
    sourceRowIndex: 0,
    transactionDate: '30/04/2026',
    valueDate: '30/04/2026',
    description: 'SYNTHETIC POSITIONED ROW',
    debit: '',
    credit: '',
    balance: '',
    direction: 'unknown',
    ...overrides
  };
}

test('BDK positioned balance extractor reads opening and closing balances', () => {
  const balances = extractBDKAccountStatementPositionedBalances([
    ...balanceLine('Solde initial (XOF) :|1 000 000', 8),
    ...headers(),
    ...balanceLine('Solde (XOF) au 05/05/2026 :|900 000', 160)
  ]);

  assert.equal(balances.openingBalanceFound, true);
  assert.equal(balances.closingBalanceFound, true);
  assert.equal(balances.openingBalance, 1_000_000);
  assert.equal(balances.closingBalance, 900_000);
  assert.equal(balances.closingDate, '05/05/2026');
  assert.deepEqual(balances.errors, []);
  assert.deepEqual(balances.warnings, []);
});

test('BDK positioned balance extractor accepts NBSP and narrow NBSP amount separators', () => {
  const balances = extractBDKAccountStatementPositionedBalances([
    ...balanceLine('Solde initial (XOF) :|1\u00a0000\u202f000', 20),
    ...balanceLine('Solde (XOF) au 05/05/2026 :|900\u00a0000', 160)
  ]);

  assert.equal(balances.openingBalance, 1_000_000);
  assert.equal(balances.closingBalance, 900_000);
  assert.deepEqual(balances.errors, []);
});

test('BDK positioned balance extractor accepts accented and variable-case opening label', () => {
  const balances = extractBDKAccountStatementPositionedBalances([
    ...balanceLine('SOLDE INITIÁL (XOF) :|1 000 000', 20),
    ...balanceLine('Solde (XOF) au 05/05/2026 :|900 000', 160)
  ]);

  assert.equal(balances.openingBalanceFound, true);
  assert.equal(balances.openingBalance, 1_000_000);
  assert.equal(balances.closingBalance, 900_000);
  assert.deepEqual(balances.errors, []);
});

test('BDK positioned balance extractor rejects missing opening balance', () => {
  const balances = extractBDKAccountStatementPositionedBalances([
    ...headers(),
    ...balanceLine('Solde (XOF) au 05/05/2026 :|900 000', 160)
  ]);

  assert.equal(balances.openingBalanceFound, false);
  assert.equal(balances.openingBalance, undefined);
  assert.equal(balances.closingBalanceFound, true);
  assert.equal(balances.closingBalance, 900_000);
  assert.match(balances.errors.join(' '), /opening balance/i);
});

test('BDK positioned balance extractor rejects missing closing balance', () => {
  const balances = extractBDKAccountStatementPositionedBalances([
    ...balanceLine('Solde initial (XOF) :|1 000 000', 8),
    ...headers()
  ]);

  assert.equal(balances.openingBalanceFound, true);
  assert.equal(balances.openingBalance, 1_000_000);
  assert.equal(balances.closingBalanceFound, false);
  assert.equal(balances.closingBalance, undefined);
  assert.match(balances.errors.join(' '), /closing balance/i);
});

test('BDK positioned balance extractor does not depend on declared debit credit totals', () => {
  const balances = extractBDKAccountStatementPositionedBalances([
    ...balanceLine('Solde initial (XOF) :|1 000 000', 20),
    ...balanceLine('Total|300 000|200 000', 140),
    ...balanceLine('Solde (XOF) au 05/05/2026 :|900 000', 160)
  ]);

  assert.equal(balances.openingBalance, 1_000_000);
  assert.equal(balances.closingBalance, 900_000);
  assert.deepEqual(balances.errors, []);
});

test('BDK positioned analyzer composes balances rows and validator successfully', () => {
  const analysis = analyzeBDKAccountStatementPositioned(syntheticPositionedStatementItems());

  assert.equal(analysis.success, true);
  assert.equal(analysis.balances.openingBalance, 1_000_000);
  assert.equal(analysis.balances.closingBalance, 900_000);
  assert.equal(analysis.rows.success, true);
  assert.ok(analysis.validation);
  assert.equal(analysis.validation.success, true);
  assert.equal(analysis.validation.calculatedClosing, 900_000);
  assert.deepEqual(analysis.rows.positionedRows.map((row) => row.amountColumn), ['debit', 'credit', 'debit']);
  assert.deepEqual(analysis.rows.positionedRows.map((row) => row.direction), ['debit', 'credit', 'debit']);
  assert.deepEqual(analysis.errors, []);
});

test('BDK positioned analyzer fails closed when opening balance is missing', () => {
  const analysis = analyzeBDKAccountStatementPositioned([
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    }),
    ...balanceLine('Solde (XOF) au 05/05/2026 :|800 000', 160)
  ]);

  assert.equal(analysis.success, false);
  assert.equal(analysis.balances.openingBalanceFound, false);
  assert.equal(analysis.validation, undefined);
  assert.match(analysis.errors.join(' '), /opening balance/i);
});

test('BDK positioned analyzer validates with opening only but fails global success when closing is missing', () => {
  const analysis = analyzeBDKAccountStatementPositioned([
    ...balanceLine('Solde initial (XOF) :|1 000 000', 8),
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    })
  ]);

  assert.equal(analysis.success, false);
  assert.equal(analysis.balances.openingBalance, 1_000_000);
  assert.equal(analysis.balances.closingBalanceFound, false);
  assert.ok(analysis.validation);
  assert.equal(analysis.validation.success, true);
  assert.equal(analysis.validation.calculatedClosing, 800_000);
  assert.match(analysis.errors.join(' '), /closing balance/i);
});

test('BDK positioned analyzer returns validation failure for debit with increasing balance', () => {
  const analysis = analyzeBDKAccountStatementPositioned([
    ...balanceLine('Solde initial (XOF) :|1 000 000', 8),
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '1 200 000',
      y: 80
    }),
    ...closingBalanceFooterLine('1 200 000', 160)
  ]);

  assert.equal(analysis.success, false);
  assert.equal(analysis.rows.success, true);
  assert.ok(analysis.validation);
  assert.equal(analysis.validation.success, false);
  assert.equal(analysis.rows.positionedRows[0].amountColumn, 'debit');
  assert.equal(analysis.rows.positionedRows[0].direction, 'debit');
  assert.match(analysis.errors.join(' '), /debit arithmetic/i);
});

test('BDK positioned analyzer fails when headers are missing even if balances are present', () => {
  const analysis = analyzeBDKAccountStatementPositioned([
    ...balanceLine('Solde initial (XOF) :|1 000 000', 8),
    ...headers().filter((item) => item.text !== 'Libelle'),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    }),
    ...closingBalanceFooterLine('800 000', 160)
  ]);

  assert.equal(analysis.success, false);
  assert.equal(analysis.balances.openingBalance, 1_000_000);
  assert.equal(analysis.balances.closingBalance, 800_000);
  assert.equal(analysis.rows.success, false);
  assert.ok(analysis.validation);
  assert.equal(analysis.validation.success, false);
  assert.match(analysis.errors.join(' '), /missing bdk account statement column headers: description/i);
});

test('BDK positioned analyzer accepts synthetic positional page items', () => {
  const page = {
    items: syntheticPositionedStatementItems(),
    tables: [],
    pageWidth: 800,
    pageHeight: 1000
  };
  const analysis = analyzeBDKAccountStatementPositioned(page.items);

  assert.equal(analysis.success, true);
  assert.equal(analysis.balances.openingBalance, 1_000_000);
  assert.equal(analysis.balances.closingBalance, 900_000);
  assert.equal(analysis.rows.positionedRows.length, 3);
  assert.deepEqual(analysis.rows.positionedRows.map((row) => row.amountColumn), ['debit', 'credit', 'debit']);
  assert.deepEqual(analysis.rows.positionedRows.map((row) => row.direction), ['debit', 'credit', 'debit']);
  assert.ok(analysis.validation);
  assert.equal(analysis.validation.success, true);
});

test('BDK positioned analyzer does not depend on synthetic page tables or dimensions', () => {
  const pageWithMetadata = {
    items: syntheticPositionedStatementItems(),
    tables: [{ synthetic: true }],
    pageWidth: 1,
    pageHeight: 1
  };
  const pageWithoutUsefulMetadata = {
    items: syntheticPositionedStatementItems(),
    tables: [],
    pageWidth: 0,
    pageHeight: 0
  };

  assert.equal(analyzeBDKAccountStatementPositioned(pageWithMetadata.items).success, true);
  assert.equal(analyzeBDKAccountStatementPositioned(pageWithoutUsefulMetadata.items).success, true);
});

test('BDK positioned analyzer fails closed for incomplete synthetic positional page items', () => {
  const page = {
    items: [
      ...balanceLine('Solde initial (XOF) :|1 000 000', 8),
      ...headers().filter((item) => item.text !== 'Libelle'),
      ...transactionItems({
        description: 'VIREMENT SYNTHETIC FOURNISSEUR',
        debit: '200 000',
        balance: '800 000',
        y: 80
      })
    ],
    tables: [],
    pageWidth: 800,
    pageHeight: 1000
  };
  const analysis = analyzeBDKAccountStatementPositioned(page.items);

  assert.equal(analysis.success, false);
  assert.equal(analysis.balances.openingBalance, 1_000_000);
  assert.equal(analysis.balances.closingBalanceFound, false);
  assert.equal(analysis.rows.success, false);
  assert.match(analysis.errors.join(' '), /closing balance/i);
  assert.match(analysis.errors.join(' '), /missing bdk account statement column headers: description/i);
});

test('BDK positioned account statement profile uses column sign mode', () => {
  assert.equal(BDK_ACCOUNT_STATEMENT_POSITIONAL_PROFILE.bank, 'BDK');
  assert.equal(BDK_ACCOUNT_STATEMENT_POSITIONAL_PROFILE.signMode, 'column');
  assert.deepEqual(BDK_ACCOUNT_STATEMENT_POSITIONAL_PROFILE.expectedColumns, [
    'transactionDate',
    'valueDate',
    'description',
    'debit',
    'credit',
    'balance'
  ]);
});

test('BDK positioned account statement rows keep a typed debit source before parser compat', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    })
  ]);

  assert.equal(positioned.success, true);
  assert.deepEqual(positioned.positionedRows, [{
    sourceRowIndex: 0,
    transactionDate: '30/04/2026',
    valueDate: '30/04/2026',
    description: 'VIREMENT SYNTHETIC FOURNISSEUR',
    debit: '200 000',
    credit: '',
    balance: '800 000',
    amountColumn: 'debit',
    direction: 'debit'
  }]);
  assert.equal(positioned.rows.length, 1);

  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '200 000 0', '800 000'));

  assert.equal(parsed.success, true);
  assert.ok(parsed.statement);
  assert.equal(parsed.statement.lines[0].direction, 'debit');
  assert.equal(parsed.statement.lines[0].debitAmount, 200_000);
});

test('BDK positioned account statement rows keep a typed credit source before parser compat', () => {
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

  assert.equal(positioned.success, true);
  assert.deepEqual(positioned.positionedRows, [{
    sourceRowIndex: 0,
    transactionDate: '02/05/2026',
    valueDate: '02/05/2026',
    description: 'ENCAISSEMENT SYNTHETIC CLIENT',
    debit: '',
    credit: '200 000',
    balance: '1 200 000',
    amountColumn: 'credit',
    direction: 'credit'
  }]);

  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '0 200 000', '1 200 000'));

  assert.equal(parsed.success, true);
  assert.ok(parsed.statement);
  assert.equal(parsed.statement.lines[0].direction, 'credit');
  assert.equal(parsed.statement.lines[0].creditAmount, 200_000);
});

test('BDK positioned account statement rows reconstruct with characterized header variants', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...observedHeaderVariant(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    })
  ]);

  assert.equal(positioned.success, true);
  assert.equal(positioned.positionedRows[0].amountColumn, 'debit');
  assert.equal(positioned.positionedRows[0].direction, 'debit');
  assert.equal(positioned.rows.length, 1);

  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '200 000 0', '800 000'));

  assert.equal(parsed.success, true);
  assert.ok(parsed.statement);
  assert.equal(parsed.statement.lines[0].direction, 'debit');
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

  assert.equal(positioned.success, true);
  assert.equal(positioned.positionedRows[0].description, 'VIREMENT SYNTHETIC FOURNISSEUR LONG LABEL');
  assert.equal(positioned.rows.length, 1);

  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '200 000 0', '800 000'));

  assert.ok(parsed.statement);
  assert.equal(parsed.statement.lines[0].descriptionSanitized, 'VIREMENT SYNTHETIC FOURNISSEUR LONG LABEL');
});

test('BDK positioned account statement rows do not promote an orphan continuation to a transaction', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    textItem('ORPHAN MULTILINE LABEL', COLUMN_X.description, 80)
  ]);

  assert.equal(positioned.success, false);
  assert.deepEqual(positioned.positionedRows, []);
  assert.deepEqual(positioned.rows, []);
  assert.match(positioned.errors.join(' '), /orphan description continuation/i);
});

test('BDK positioned account statement rows reject ambiguous header-like text', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers().filter((item) => item.text !== 'Libelle'),
    textItem('Libellé Fournisseur', COLUMN_X.description, 20),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    })
  ]);

  assert.equal(positioned.success, false);
  assert.deepEqual(positioned.rows, []);
  assert.match(positioned.errors.join(' '), /missing bdk account statement column headers: description/i);
});

test('BDK positioned account statement rows reject an incomplete transaction date pair', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      valueDate: '',
      description: 'FRAIS SYNTHETIC',
      debit: '100 000',
      balance: '900 000',
      y: 80
    })
  ]);

  assert.equal(positioned.success, false);
  assert.deepEqual(positioned.positionedRows, []);
  assert.match(positioned.errors.join(' '), /incomplete transaction date pair/i);
});

test('BDK positioned account statement rows reject a missing running balance before parser compat', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'FRAIS SYNTHETIC',
      debit: '100 000',
      y: 80
    })
  ]);

  assert.equal(positioned.success, false);
  assert.equal(positioned.positionedRows[0].direction, 'debit');
  assert.equal(positioned.positionedRows[0].balance, '');
  assert.match(positioned.errors.join(' '), /no running balance/i);

  const parsed = parseBDKAccountStatement(statementText(positioned.rowOrientedText, '100 000 0', '900 000'));

  assert.equal(parsed.success, false);
  assert.match(parsed.errors.join(' '), /unknown direction/i);
});

test('BDK positioned account statement rows reject both amount columns on one row', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'AMBIGUOUS SYNTHETIC',
      debit: '100 000',
      credit: '100 000',
      balance: '1 000 000',
      y: 80
    })
  ]);

  assert.equal(positioned.success, false);
  assert.equal(positioned.positionedRows[0].direction, 'unknown');
  assert.equal(positioned.positionedRows[0].amountColumn, undefined);
  assert.match(positioned.errors.join(' '), /both debit and credit amounts/i);
});

test('BDK positioned account statement rows reject a row without debit or credit amount', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'NO AMOUNT SYNTHETIC',
      balance: '1 000 000',
      y: 80
    })
  ]);

  assert.equal(positioned.success, false);
  assert.equal(positioned.positionedRows[0].direction, 'unknown');
  assert.equal(positioned.positionedRows[0].amountColumn, undefined);
  assert.match(positioned.errors.join(' '), /no debit or credit amount/i);
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

test('BDK positioned account statement rows validate reconstructed debit credit debit balances', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '800 000',
      y: 80
    }),
    ...transactionItems({
      transactionDate: '02/05/2026',
      valueDate: '02/05/2026',
      description: 'ENCAISSEMENT SYNTHETIC CLIENT',
      credit: '200 000',
      balance: '1 000 000',
      y: 104
    }),
    ...transactionItems({
      transactionDate: '05/05/2026',
      valueDate: '05/05/2026',
      description: 'FRAIS SYNTHETIC',
      debit: '100 000',
      balance: '900 000',
      y: 128
    })
  ]);
  const validation = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    closingBalance: 900_000,
    positionedRows: positioned.positionedRows
  });

  assert.equal(positioned.success, true);
  assert.deepEqual(positioned.positionedRows.map((row) => row.amountColumn), ['debit', 'credit', 'debit']);
  assert.deepEqual(positioned.positionedRows.map((row) => row.direction), ['debit', 'credit', 'debit']);
  assert.equal(validation.success, true);
  assert.equal(validation.calculatedClosing, 900_000);
  assert.deepEqual(validation.errors, []);
});

test('BDK positioned account statement validation rejects reconstructed debit with increasing balance', () => {
  const positioned = reconstructBDKAccountStatementRows([
    ...headers(),
    ...transactionItems({
      description: 'VIREMENT SYNTHETIC FOURNISSEUR',
      debit: '200 000',
      balance: '1 200 000',
      y: 80
    })
  ]);
  const validation = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: positioned.positionedRows
  });

  assert.equal(positioned.success, true);
  assert.equal(positioned.positionedRows[0].amountColumn, 'debit');
  assert.equal(positioned.positionedRows[0].direction, 'debit');
  assert.equal(validation.success, false);
  assert.match(validation.errors.join(' '), /debit arithmetic/i);
});

test('BDK positioned rows validator accepts debit credit debit arithmetic from amount columns', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    closingBalance: 900_000,
    positionedRows: [
      positionedRow({
        sourceRowIndex: 0,
        debit: '200 000',
        balance: '800 000',
        amountColumn: 'debit',
        direction: 'debit'
      }),
      positionedRow({
        sourceRowIndex: 1,
        credit: '200 000',
        balance: '1 000 000',
        amountColumn: 'credit',
        direction: 'credit'
      }),
      positionedRow({
        sourceRowIndex: 2,
        debit: '100 000',
        balance: '900 000',
        amountColumn: 'debit',
        direction: 'debit'
      })
    ]
  });

  assert.equal(result.success, true);
  assert.equal(result.calculatedClosing, 900_000);
  assert.equal(result.lineCount, 3);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('BDK positioned rows validator rejects debit whose balance increases without reclassification', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: [
      positionedRow({
        debit: '200 000',
        balance: '1 200 000',
        amountColumn: 'debit',
        direction: 'debit'
      })
    ]
  });

  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /debit arithmetic/i);
});

test('BDK positioned rows validator rejects credit whose balance decreases without reclassification', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: [
      positionedRow({
        credit: '200 000',
        balance: '800 000',
        amountColumn: 'credit',
        direction: 'credit'
      })
    ]
  });

  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /credit arithmetic/i);
});

test('BDK positioned rows validator rejects missing amount column and unknown direction', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: [
      positionedRow({
        debit: '200 000',
        balance: '800 000',
        direction: 'unknown'
      })
    ]
  });

  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /unambiguous debit or credit amount column/i);
});

test('BDK positioned rows validator rejects both debit and credit amounts', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: [
      positionedRow({
        debit: '100 000',
        credit: '100 000',
        balance: '1 000 000',
        amountColumn: 'debit',
        direction: 'debit'
      })
    ]
  });

  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /both debit and credit amounts/i);
});

test('BDK positioned rows validator rejects missing amount', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: [
      positionedRow({
        balance: '900 000',
        amountColumn: 'debit',
        direction: 'debit'
      })
    ]
  });

  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /no parsable debit amount/i);
});

test('BDK positioned rows validator rejects direction inconsistent with amount column', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: [
      positionedRow({
        debit: '200 000',
        balance: '800 000',
        amountColumn: 'debit',
        direction: 'credit'
      })
    ]
  });

  assert.equal(result.success, false);
  assert.match(result.errors.join(' '), /direction does not match amount column/i);
});

test('BDK positioned rows validator rejects unparsable amount or balance', () => {
  const invalidAmount = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: [
      positionedRow({
        debit: 'SYNTHETIC',
        balance: '900 000',
        amountColumn: 'debit',
        direction: 'debit'
      })
    ]
  });
  const invalidBalance = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    positionedRows: [
      positionedRow({
        debit: '100 000',
        balance: 'SYNTHETIC',
        amountColumn: 'debit',
        direction: 'debit'
      })
    ]
  });

  assert.equal(invalidAmount.success, false);
  assert.match(invalidAmount.errors.join(' '), /no parsable debit amount/i);
  assert.equal(invalidBalance.success, false);
  assert.match(invalidBalance.errors.join(' '), /no parsable running balance/i);
});

test('BDK positioned rows validator rejects inconsistent final closing balance', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    closingBalance: 901_000,
    positionedRows: [
      positionedRow({
        debit: '100 000',
        balance: '900 000',
        amountColumn: 'debit',
        direction: 'debit'
      })
    ]
  });

  assert.equal(result.success, false);
  assert.equal(result.calculatedClosing, 900_000);
  assert.match(result.errors.join(' '), /closing balance/i);
});

test('BDK positioned rows validator accepts NBSP and narrow NBSP amount separators', () => {
  const result = validateBDKAccountStatementPositionedRows({
    openingBalance: 1_000_000,
    closingBalance: 900_000,
    positionedRows: [
      positionedRow({
        debit: '100\u00a0000',
        balance: '900\u202f000',
        amountColumn: 'debit',
        direction: 'debit'
      })
    ]
  });

  assert.equal(result.success, true);
  assert.equal(result.calculatedClosing, 900_000);
});
