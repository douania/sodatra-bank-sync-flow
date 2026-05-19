import assert from 'node:assert/strict';
import test from 'node:test';
import { InternalBookExcelParser } from './internalBookExcelParser';
import { characterizationFixtures } from './internalBookExcelParser.characterization.fixtures';

const parser = new InternalBookExcelParser();

test('aggregates post-0D characterization outcomes by fixture and issue code', () => {
  const report = characterizationFixtures.map((fixture) => {
    const result = parser.parseWorkbook(fixture.workbook, fixture.sourceFile, {
      parsedAt: '2026-05-18T00:00:00.000Z',
    });
    const [book] = result.books;

    assert.ok(book, `Missing parsed book for ${fixture.sourceFile}`);

    return {
      bank: result.bank,
      sourceFile: fixture.sourceFile,
      sheetName: book.sheetName,
      status: book.validation.status,
      issueCodes: [...new Set(book.validation.issues.map((issue) => issue.code))].sort(),
      deposits: book.depositsNotYetCleared.length,
      checks: book.checksNotYetCleared.length,
      facilities: book.bankFacilities.length,
      impayes: book.impayes.length,
    };
  });

  assert.equal(report.length, characterizationFixtures.length);

  for (const fixture of characterizationFixtures) {
    const entry = report.find((candidate) => candidate.sourceFile === fixture.sourceFile);
    assert.ok(entry, `Missing validation report entry for ${fixture.sourceFile}`);

    assert.deepEqual(
      entry,
      {
        bank: fixture.bank,
        sourceFile: fixture.sourceFile,
        sheetName: '050526',
        status: fixture.expected.status,
        issueCodes: [...fixture.expected.issueCodes].sort(),
        deposits: fixture.expected.deposits,
        checks: fixture.expected.checks,
        facilities: fixture.expected.facilities,
        impayes: fixture.expected.impayes,
      },
    );
  }

  assert.equal(report.some((entry) => entry.bank === 'BICIS' && entry.status === 'needs_review'), true);
  assert.equal(report.some((entry) => entry.issueCodes.includes('IMPAYES_TOTAL_MISMATCH')), true);
  assert.equal(report.some((entry) => entry.issueCodes.includes('AMBIGUOUS_AMOUNT_COLUMN')), true);
  assert.deepEqual(
    report.find((entry) => entry.sourceFile === '05-BDK 2026 real-shape amount1 zero totals.xlsx')?.issueCodes,
    [],
  );
});
