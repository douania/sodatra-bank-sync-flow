import assert from 'node:assert/strict';
import test from 'node:test';
import { InternalBookExcelParser } from './internalBookExcelParser';
import { characterizationFixtures } from './internalBookExcelParser.characterization.fixtures';

const parser = new InternalBookExcelParser();

for (const fixture of characterizationFixtures) {
  test(`characterizes anonymized ${fixture.bank} internal book fixture from ${fixture.sourceFile}`, () => {
    const result = parser.parseWorkbook(fixture.workbook, fixture.sourceFile, {
      parsedAt: '2026-05-18T00:00:00.000Z',
    });

    assert.equal(result.bank, fixture.bank);
    assert.equal(result.books.length, 1);
    assert.equal(result.ignoredSheets.length, 1);
    assert.equal(result.ignoredSheets[0].sheetName, 'README');

    const [book] = result.books;
    assert.equal(book.sheetName, '050526');
    assert.equal(book.reportDate, '2026-05-05');
    assert.equal(book.openingBalance !== undefined, true);
    assert.equal(book.totalBalanceA !== undefined, true);
    assert.equal(book.totalB !== undefined, true);
    assert.equal(book.closingBalanceC !== undefined, true);
    assert.equal(book.depositsNotYetCleared.length, fixture.expected.deposits);
    assert.equal(book.checksNotYetCleared.length, fixture.expected.checks);
    assert.equal(book.bankFacilities.length, fixture.expected.facilities);
    assert.equal(book.impayes.length, fixture.expected.impayes);
    assert.equal(book.validation.status, fixture.expected.status);

    const issueCodes = [...new Set(book.validation.issues.map((issue) => issue.code))].sort();
    assert.deepEqual(issueCodes, [...fixture.expected.issueCodes].sort());
  });
}
