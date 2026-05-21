import * as XLSX from 'xlsx';
import type {
  InternalBook,
  InternalBookBank,
  InternalBookFacilityLine,
  InternalBookFacilityTotals,
  InternalBookIgnoredSheet,
  InternalBookLine,
  InternalBookMoneyCell,
  InternalBookParseResult,
  InternalBookSection,
  InternalBookStatus,
  InternalBookValidationIssue,
} from '@/types/internalBook';

const PARSER_VERSION = 'POC-INTERNAL-BOOK-0A';
const DEFAULT_TOLERANCE = 1;
const STALE_CHECK_AGE_YEARS = 3;
const HIGH_RISK_STALE_CHECK_LABEL = /\b(?:DOUANE|DOUANES|TRESOR|TRESOR PUBLIC|DGD|ADMINISTRATION)\b/;

interface InternalBookParserOptions {
  tolerance?: number;
  parsedAt?: string;
}

interface SectionDefinition {
  key: InternalBookSection;
  aliases: string[];
  required: boolean;
}

interface NormalizedCell {
  raw: unknown;
  normalizedText: string;
  rowIndex: number;
  columnIndex: number;
  address: string;
  headerNormalizedText?: string;
  money?: InternalBookMoneyCell;
}

interface NormalizedRow {
  rowIndex: number;
  cells: NormalizedCell[];
  normalizedText: string;
  rawRow: unknown[];
}

interface SectionAnchor {
  key: InternalBookSection;
  rowIndex: number;
  rowPosition: number;
}

interface MoneySelection {
  money?: InternalBookMoneyCell;
  issue?: InternalBookValidationIssue;
}

const EXCEL_SERIAL_DATE_MIN = 20000;
const EXCEL_SERIAL_DATE_MAX = 60000;
const EXCEL_SERIAL_DATE_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const NON_AMOUNT_COLUMN_HEADERS = new Set(['DATE', 'CH NO', 'CH NO BD', 'TR NO', 'FACT NO', 'REF', 'REFERENCE']);
const AMOUNT_COLUMN_HEADERS = new Set(['AMOUNT', 'MONTANT', 'AMOUNT 1', 'MONTANT 1']);
const PRIMARY_AMOUNT_COLUMN_HEADERS = new Set(['AMOUNT', 'MONTANT']);
const SECONDARY_AMOUNT_COLUMN_HEADERS = new Set(['AMOUNT 1', 'MONTANT 1']);
const SUFFIXED_SECONDARY_AMOUNT_COLUMN_HEADERS = new Set(['AMOUNT 2', 'MONTANT 2']);
const FACILITY_LIMIT_COLUMN_HEADERS = new Set(['LIMIT', 'LIMITE']);
const FACILITY_USED_COLUMN_HEADERS = new Set(['USED', 'UTILISE']);
const FACILITY_BALANCE_COLUMN_HEADERS = new Set(['BALANCE', 'DISPONIBLE']);

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    key: 'openingBalance',
    aliases: ['OPENING BALANCE', 'SOLDE D OUVERTURE', 'SOLDE OUVERTURE'],
    required: true,
  },
  {
    key: 'depositsNotYetCleared',
    aliases: [
      'DEPOSIT NOT YET CLEARED',
      'DEPOSITS NOT YET CLEARED',
      'DEPOT NON ENCORE ENCAISSE',
      'DEPOTS NON ENCORE ENCAISSES',
      'DEPOTS PAS ENCORE ENCAISSES',
      'DEPOTS PAS ENCORE ENCAISSE',
      'DEPOTS NON CREDITES',
    ],
    required: false,
  },
  {
    key: 'totalDeposits',
    aliases: ['TOTAL DEPOSIT', 'TOTAL DEPOSITS', 'TOTAL DEPOT', 'TOTAL DEPOTS'],
    required: true,
  },
  {
    key: 'totalBalanceA',
    aliases: ['TOTAL BALANCE A', 'TOTAL BALANCE (A)', 'SOLDE TOTAL A', 'TOTAL SOLDE A', 'TOTAL A', 'TOTAL (A)'],
    required: true,
  },
  {
    key: 'checksNotYetCleared',
    aliases: [
      'CHECK NOT YET CLEARED',
      'CHECKS NOT YET CLEARED',
      'CHEQUE NON ENCORE DEBITE',
      'CHEQUES NON ENCORE DEBITES',
      'CHEQUES NON DEBITES',
      'CHEQUES EN CIRCULATION',
      'LESS CHEQUES EMIS NON ENCAISSES',
      'CHEQUES EMIS NON ENCAISSES',
    ],
    required: false,
  },
  {
    key: 'totalB',
    aliases: ['TOTAL B', 'TOTAL (B)'],
    required: true,
  },
  {
    key: 'closingBalanceC',
    aliases: [
      'CLOSING BALANCE',
      'CLOSING BALANCE C',
      'CLOSING BALANCE C A B',
      'CLOSING BALANCE C = A - B',
      'SOLDE DE CLOTURE',
      'SOLDE CLOTURE',
      'SOLDE DE CLOTURE C',
    ],
    required: true,
  },
  {
    key: 'bankFacilities',
    aliases: ['BANK FACILITY', 'BANK FACILITIES', 'FACILITE BANCAIRE', 'FACILITES BANCAIRES'],
    required: false,
  },
  {
    key: 'impayes',
    aliases: ['IMPAYE', 'IMPAYES', 'UNPAID', 'UNPAID ITEMS'],
    required: false,
  },
];

const SUPPORTED_BANKS: InternalBookBank[] = ['BIS', 'BICIS', 'BDK', 'ORABANK', 'BRIDGE', 'ATLANTIK'];

class InternalBookExcelParser {
  async parseFile(file: File, options: InternalBookParserOptions = {}): Promise<InternalBookParseResult> {
    const buffer = await file.arrayBuffer();
    return this.parseArrayBuffer(buffer, file.name, options);
  }

  parseArrayBuffer(
    buffer: ArrayBuffer,
    sourceFile = 'internal-book.xlsx',
    options: InternalBookParserOptions = {},
  ): InternalBookParseResult {
    const workbook = XLSX.read(buffer, { type: 'array', raw: true, cellDates: false });
    return this.parseWorkbook(workbook, sourceFile, options);
  }

  parseWorkbook(
    workbook: XLSX.WorkBook,
    sourceFile = 'internal-book.xlsx',
    options: InternalBookParserOptions = {},
  ): InternalBookParseResult {
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const parsedAt = options.parsedAt ?? new Date().toISOString();
    const bank = this.detectBank(sourceFile);
    const books: InternalBook[] = [];
    const ignoredSheets: InternalBookIgnoredSheet[] = [];
    const errors: InternalBookValidationIssue[] = [];
    const warnings: InternalBookValidationIssue[] = [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const normalizedRows = this.normalizeWorksheet(worksheet, sheetName);

      if (normalizedRows.length === 0) {
        ignoredSheets.push({
          sheetName,
          reason: 'Onglet vide ignoré.',
          issue: this.createIssue('EMPTY_SHEET', 'warning', 'Onglet vide ignoré.', sheetName),
        });
        continue;
      }

      const reportDate = this.parseSheetDate(sheetName);
      if (!reportDate) {
        const issue = this.createIssue(
          'INVALID_SHEET_DATE',
          'warning',
          `Nom d'onglet non journalier ignoré: ${sheetName}.`,
          sheetName,
        );
        ignoredSheets.push({ sheetName, reason: issue.message, issue });
        warnings.push(issue);
        continue;
      }

      const anchors = this.findSectionAnchors(normalizedRows);
      if (!this.hasMinimumInternalBookShape(anchors)) {
        const issue = this.createIssue(
          'UNSUPPORTED_SHEET',
          'warning',
          `Onglet ${sheetName} ignoré: sections Internal Book insuffisantes.`,
          sheetName,
        );
        ignoredSheets.push({ sheetName, reason: issue.message, issue });
        warnings.push(issue);
        continue;
      }

      const book = this.parseSheet({
        bank,
        sourceFile,
        sheetName,
        reportDate,
        rows: normalizedRows,
        anchors,
        workbookSheetCount: workbook.SheetNames.length,
        ignoredSheetNames: ignoredSheets.map((sheet) => sheet.sheetName),
        tolerance,
        parsedAt,
      });

      books.push(book);
      for (const issue of book.validation.issues) {
        if (issue.severity === 'error') {
          errors.push(issue);
        } else {
          warnings.push(issue);
        }
      }
    }

    return {
      success: books.length > 0 && errors.length === 0,
      bank,
      sourceFile,
      books,
      ignoredSheets,
      errors,
      warnings,
    };
  }

  private parseSheet(context: {
    bank: InternalBookBank;
    sourceFile: string;
    sheetName: string;
    reportDate: string;
    rows: NormalizedRow[];
    anchors: SectionAnchor[];
    workbookSheetCount: number;
    ignoredSheetNames: string[];
    tolerance: number;
    parsedAt: string;
  }): InternalBook {
    const issues: InternalBookValidationIssue[] = [];
    const sectionRows = this.buildSectionRows(context.rows, context.anchors);

    for (const definition of SECTION_DEFINITIONS.filter((section) => section.required)) {
      if (!context.anchors.some((anchor) => anchor.key === definition.key)) {
        issues.push(
          this.createIssue(
            'MISSING_REQUIRED_SECTION',
            'error',
            `Section requise absente: ${definition.key}.`,
            context.sheetName,
            definition.key,
          ),
        );
      }
    }

    if (!SUPPORTED_BANKS.includes(context.bank)) {
      issues.push(
        this.createIssue(
          'UNSUPPORTED_BANK',
          'error',
          `Banque non supportée pour Internal Book: ${context.bank}.`,
          context.sheetName,
        ),
      );
    }

    const openingBalance = this.extractSingleAmount(context.rows, context.anchors, 'openingBalance', context.sheetName, issues);
    const totalDeposits = this.extractSingleAmount(context.rows, context.anchors, 'totalDeposits', context.sheetName, issues);
    const totalBalanceA = this.extractSingleAmount(context.rows, context.anchors, 'totalBalanceA', context.sheetName, issues);
    const closingBalanceC = this.extractSingleAmount(context.rows, context.anchors, 'closingBalanceC', context.sheetName, issues);
    const totalB = this.extractTotalBAmount(
      context.rows,
      context.anchors,
      context.sheetName,
      issues,
      totalBalanceA,
      closingBalanceC,
      context.tolerance,
    );

    const depositsNotYetCleared = this.extractAmountLines(
      sectionRows.depositsNotYetCleared ?? [],
      context.sheetName,
      'depositsNotYetCleared',
      issues,
    );
    const extractedChecksNotYetCleared = this.extractAmountLines(
      sectionRows.checksNotYetCleared ?? [],
      context.sheetName,
      'checksNotYetCleared',
      issues,
      this.resolveTotalBAlignmentHeader(context.rows, totalB),
    );
    const classifiedChecks = this.classifyOutstandingChecks(
      extractedChecksNotYetCleared,
      context.reportDate,
      context.sheetName,
      issues,
    );
    const checksNotYetCleared = classifiedChecks.operational;
    const staleOutstandingChecks = classifiedChecks.stale;
    const impayesResult = this.extractImpayes(sectionRows.impayes ?? [], context.sheetName, issues, context.tolerance);
    const facilitiesResult = this.extractFacilities(sectionRows.bankFacilities ?? [], context.sheetName, issues);

    this.validateBookAmounts({
      openingBalance,
      totalDeposits,
      totalBalanceA,
      totalB,
      closingBalanceC,
      depositsNotYetCleared,
      checksNotYetCleared,
      staleOutstandingChecks,
      impayes: impayesResult.lines,
      declaredTotalImpayes: impayesResult.declaredTotal,
      bankFacilities: facilitiesResult.lines,
      declaredFacilitiesTotals: facilitiesResult.declaredTotals,
      issues,
      tolerance: context.tolerance,
      sheetName: context.sheetName,
    });

    const calculatedTotalDeposits = this.sumLines(depositsNotYetCleared);
    const calculatedTotalChecksOperational = this.sumLines(checksNotYetCleared);
    const calculatedStaleOutstandingChecksRiskTotal = this.sumLines(staleOutstandingChecks);
    const calculatedTotalChecksPrudent =
      calculatedTotalChecksOperational + calculatedStaleOutstandingChecksRiskTotal;
    const calculatedTotalChecks = calculatedTotalChecksOperational;
    const calculatedTotalImpayes = this.sumLines(impayesResult.lines);
    const calculatedFacilitiesTotals = this.sumFacilities(facilitiesResult.lines);
    const calculatedTotalBalanceA = openingBalance ? openingBalance.value + calculatedTotalDeposits : undefined;
    const declaredOrCalculatedA = totalBalanceA?.value ?? calculatedTotalBalanceA;
    const closingBalanceChecksTotal = totalB?.value ?? calculatedTotalChecks;
    const calculatedClosingBalanceC =
      declaredOrCalculatedA !== undefined ? declaredOrCalculatedA - closingBalanceChecksTotal : undefined;
    const status = this.resolveStatus(context.bank, issues);

    return {
      bank: context.bank,
      sourceFile: context.sourceFile,
      sheetName: context.sheetName,
      reportDate: context.reportDate,
      openingBalance,
      depositsNotYetCleared,
      totalDeposits,
      totalBalanceA,
      checksNotYetCleared,
      staleOutstandingChecks,
      totalB,
      closingBalanceC,
      bankFacilities: facilitiesResult.lines,
      impayes: impayesResult.lines,
      validation: {
        status,
        needsReview: status === 'needs_review',
        tolerance: context.tolerance,
        issues,
        declaredTotalDeposits: totalDeposits?.value,
        calculatedTotalDeposits,
        declaredTotalBalanceA: totalBalanceA?.value,
        calculatedTotalBalanceA,
        declaredTotalChecks: totalB?.value,
        calculatedTotalChecks,
        calculatedTotalChecksOperational,
        calculatedTotalChecksPrudent,
        calculatedStaleOutstandingChecksRiskTotal,
        highRiskStaleOutstandingChecksTotal: classifiedChecks.highRiskTotal || undefined,
        declaredClosingBalanceC: closingBalanceC?.value,
        calculatedClosingBalanceC,
        declaredTotalImpayes: impayesResult.declaredTotal?.value,
        calculatedTotalImpayes,
        declaredFacilitiesTotals: this.toDeclaredFacilityTotals(facilitiesResult.declaredTotals),
        calculatedFacilitiesTotals,
      },
      metadata: {
        parserVersion: PARSER_VERSION,
        parsedAt: context.parsedAt,
        workbookSheetCount: context.workbookSheetCount,
        ignoredSheets: context.ignoredSheetNames,
        labelProfile: context.bank,
      },
    };
  }

  private normalizeWorksheet(worksheet: XLSX.WorkSheet | undefined, sheetName: string): NormalizedRow[] {
    if (!worksheet) {
      return [];
    }

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null });

    const normalizedRows = rawRows
      .map((rawRow, rowOffset) => {
        const rowIndex = rowOffset + 1;
        const cells = rawRow.map((raw, columnOffset) => {
          const columnIndex = columnOffset + 1;
          const address = XLSX.utils.encode_cell({ r: rowOffset, c: columnOffset });
          const normalizedText = this.normalizeText(raw);
          const money = this.parseMoneyCell(raw, sheetName, rowIndex, columnIndex, address);
          return { raw, normalizedText, rowIndex, columnIndex, address, money };
        });

        return {
          rowIndex,
          cells,
          normalizedText: cells.map((cell) => cell.normalizedText).filter(Boolean).join(' '),
          rawRow,
        };
      })
      .filter((row) => row.cells.some((cell) => cell.raw !== null && cell.raw !== undefined && `${cell.raw}`.trim() !== ''));

    let currentHeaders: string[] = [];
    for (const row of normalizedRows) {
      if (this.isHeaderLikeRow(row)) {
        currentHeaders = row.cells.map((cell) => cell.normalizedText);
        continue;
      }

      row.cells.forEach((cell, index) => {
        cell.headerNormalizedText = currentHeaders[index] ?? '';
      });
    }

    return normalizedRows;
  }

  private findSectionAnchors(rows: NormalizedRow[]): SectionAnchor[] {
    const anchors: SectionAnchor[] = [];

    rows.forEach((row, rowPosition) => {
      const matched = SECTION_DEFINITIONS.find((definition) =>
        definition.aliases.some((alias) => row.normalizedText.includes(this.normalizeText(alias))),
      );

      if (matched && !anchors.some((anchor) => anchor.key === matched.key)) {
        anchors.push({ key: matched.key, rowIndex: row.rowIndex, rowPosition });
      }
    });

    return anchors.sort((left, right) => left.rowPosition - right.rowPosition);
  }

  private buildSectionRows(rows: NormalizedRow[], anchors: SectionAnchor[]): Partial<Record<InternalBookSection, NormalizedRow[]>> {
    const sections: Partial<Record<InternalBookSection, NormalizedRow[]>> = {};

    anchors.forEach((anchor, index) => {
      const nextAnchor = anchors[index + 1];
      const start = anchor.rowPosition + 1;
      const end = nextAnchor ? nextAnchor.rowPosition : rows.length;
      sections[anchor.key] = rows.slice(start, end);
    });

    return sections;
  }

  private extractSingleAmount(
    rows: NormalizedRow[],
    anchors: SectionAnchor[],
    section: InternalBookSection,
    sheetName: string,
    issues: InternalBookValidationIssue[],
  ): InternalBookMoneyCell | undefined {
    const anchor = anchors.find((candidate) => candidate.key === section);
    if (!anchor) {
      return undefined;
    }

    const row = rows[anchor.rowPosition];
    const selection = this.selectSingleTotalMoney(row, sheetName, section);
    if (selection.issue) {
      issues.push(selection.issue);
    }

    if (!selection.money) {
      issues.push(
        this.createIssue(
          'MISSING_REQUIRED_AMOUNT',
          'error',
          `Montant requis absent pour la section ${section}.`,
          sheetName,
          section,
          row.rowIndex,
        ),
      );
    }

    return selection.money;
  }

  private extractTotalBAmount(
    rows: NormalizedRow[],
    anchors: SectionAnchor[],
    sheetName: string,
    issues: InternalBookValidationIssue[],
    totalBalanceA: InternalBookMoneyCell | undefined,
    closingBalanceC: InternalBookMoneyCell | undefined,
    tolerance: number,
  ): InternalBookMoneyCell | undefined {
    const anchor = anchors.find((candidate) => candidate.key === 'totalB');
    if (!anchor) {
      return undefined;
    }

    const row = rows[anchor.rowPosition];
    const selection = this.selectTotalBMoney(row, sheetName, totalBalanceA, closingBalanceC, tolerance);
    if (selection.issue) {
      issues.push(selection.issue);
    }

    if (!selection.money && !selection.issue) {
      issues.push(
        this.createIssue(
          'MISSING_REQUIRED_AMOUNT',
          'error',
          'Montant requis absent pour la section totalB.',
          sheetName,
          'totalB',
          row.rowIndex,
        ),
      );
    }

    return selection.money;
  }

  private extractAmountLines(
    rows: NormalizedRow[],
    sheetName: string,
    section: InternalBookSection,
    issues: InternalBookValidationIssue[],
    alignedAmountHeader?: string,
  ): InternalBookLine[] {
    const lines: InternalBookLine[] = [];

    for (const row of rows) {
      if (this.isTotalRow(row) || this.isHeaderLikeRow(row)) {
        continue;
      }

      const selection = this.selectLineMoney(row, sheetName, section, alignedAmountHeader);
      if (selection.issue) {
        issues.push(selection.issue);
      }

      if (selection.money) {
        lines.push({
          label: this.extractLabel(row),
          date: this.extractDateFromRow(row),
          reference: this.extractReference(row),
          description: this.extractDescription(row),
          amount: selection.money,
          rawRow: row.rawRow,
        });
      }
    }

    return lines;
  }

  private resolveTotalBAlignmentHeader(rows: NormalizedRow[], money: InternalBookMoneyCell | undefined): string | undefined {
    if (!money) {
      return undefined;
    }

    const row = rows.find((candidate) => candidate.rowIndex === money.rowIndex);
    const cell = row?.cells.find((candidate) => candidate.columnIndex === money.columnIndex);
    const totalBHasPrimaryAndSecondary =
      row?.cells.some((candidate) => candidate.money && this.hasPrimaryAmountHeader(candidate)) === true &&
      row.cells.some((candidate) => candidate.money && this.hasSecondaryAmountHeader(candidate));
    const header = cell?.headerNormalizedText;
    return totalBHasPrimaryAndSecondary && header && AMOUNT_COLUMN_HEADERS.has(header) ? header : undefined;
  }

  private extractImpayes(
    rows: NormalizedRow[],
    sheetName: string,
    issues: InternalBookValidationIssue[],
    tolerance: number,
  ): { lines: InternalBookLine[]; declaredTotal?: InternalBookMoneyCell } {
    const lines: InternalBookLine[] = [];
    let declaredTotal: InternalBookMoneyCell | undefined;

    for (const row of rows) {
      const selection = this.isTotalRow(row)
        ? this.selectSingleTotalMoney(row, sheetName, 'impayes')
        : this.selectLineMoney(row, sheetName, 'impayes');
      if (selection.issue) {
        issues.push(selection.issue);
      }

      if (this.isTotalRow(row)) {
        declaredTotal = selection.money ?? declaredTotal;
        continue;
      }

      const unlabeledSingleMoney = this.extractUnlabeledSingleMoney(row);
      if (unlabeledSingleMoney && lines.length > 0 && !this.isHeaderLikeRow(row)) {
        const currentTotal = this.sumLines(lines);
        if (Math.abs(unlabeledSingleMoney.value - currentTotal) <= tolerance) {
          declaredTotal = unlabeledSingleMoney;
          continue;
        }

        issues.push({
          code: 'IMPAYES_TOTAL_MISMATCH',
          severity: 'error',
          message: 'Ligne montant isolee sous IMPAYE incoherente avec la somme des lignes impayees precedentes.',
          section: 'impayes',
          sheetName,
          rowIndex: unlabeledSingleMoney.rowIndex,
          columnIndex: unlabeledSingleMoney.columnIndex,
          expected: currentTotal,
          actual: unlabeledSingleMoney.value,
          discrepancy: unlabeledSingleMoney.value - currentTotal,
          tolerance,
        });
      }

      if (selection.money && !this.isHeaderLikeRow(row)) {
        lines.push({
          label: this.extractLabel(row),
          date: this.extractDateFromRow(row),
          reference: this.extractReference(row),
          description: this.extractDescription(row),
          amount: selection.money,
          rawRow: row.rawRow,
        });
      }
    }

    return { lines, declaredTotal };
  }

  private extractFacilities(
    rows: NormalizedRow[],
    sheetName: string,
    issues: InternalBookValidationIssue[],
  ): { lines: InternalBookFacilityLine[]; declaredTotals?: InternalBookFacilityLine } {
    const lines: InternalBookFacilityLine[] = [];
    let declaredTotals: InternalBookFacilityLine | undefined;

    for (const row of rows) {
      if (this.isHeaderLikeRow(row)) {
        continue;
      }

      const moneyCells = row.cells.filter((cell) => cell.money).map((cell) => cell.money as InternalBookMoneyCell);
      if (moneyCells.length === 0) {
        continue;
      }

      const facilityLine: InternalBookFacilityLine = {
        label: this.extractLabel(row) || 'BANK FACILITY',
        rawRow: row.rawRow,
      };
      const structuredFacilityLine = this.selectStructuredFacilityMoney(row);

      if (structuredFacilityLine.limit || structuredFacilityLine.used || structuredFacilityLine.balance) {
        facilityLine.limit = structuredFacilityLine.limit;
        facilityLine.used = structuredFacilityLine.used;
        facilityLine.balance = structuredFacilityLine.balance;
      } else {
        const lastThree = this.filterAmountCandidateCells(row.cells.filter((cell) => cell.money)).map(
          (cell) => cell.money as InternalBookMoneyCell,
        ).slice(-3);

        if (lastThree.length >= 1) {
          facilityLine.limit = lastThree[0];
        }
        if (lastThree.length >= 2) {
          facilityLine.used = lastThree[1];
        }
        if (lastThree.length >= 3) {
          facilityLine.balance = lastThree[2];
        }
      }

      const unexpectedIssue = this.createUnexpectedMoneyIssue(row, sheetName, 'bankFacilities', [
        facilityLine.limit,
        facilityLine.used,
        facilityLine.balance,
      ]);
      if (unexpectedIssue) {
        issues.push(unexpectedIssue);
      }

      if (!structuredFacilityLine.limit && !structuredFacilityLine.used && !structuredFacilityLine.balance && moneyCells.length > 3) {
        issues.push(
          this.createIssue(
            'AMBIGUOUS_AMOUNT_COLUMN',
            'error',
            'Plus de trois montants détectés sur une ligne de facilités bancaires.',
            sheetName,
            'bankFacilities',
            row.rowIndex,
          ),
        );
      }

      if (this.isTotalRow(row)) {
        declaredTotals = facilityLine;
      } else {
        lines.push(facilityLine);
      }
    }

    return { lines, declaredTotals };
  }

  private validateBookAmounts(context: {
    openingBalance?: InternalBookMoneyCell;
    totalDeposits?: InternalBookMoneyCell;
    totalBalanceA?: InternalBookMoneyCell;
    totalB?: InternalBookMoneyCell;
    closingBalanceC?: InternalBookMoneyCell;
    depositsNotYetCleared: InternalBookLine[];
    checksNotYetCleared: InternalBookLine[];
    staleOutstandingChecks: InternalBookLine[];
    impayes: InternalBookLine[];
    declaredTotalImpayes?: InternalBookMoneyCell;
    bankFacilities: InternalBookFacilityLine[];
    declaredFacilitiesTotals?: InternalBookFacilityLine;
    issues: InternalBookValidationIssue[];
    tolerance: number;
    sheetName: string;
  }): void {
    const calculatedTotalDeposits = this.sumLines(context.depositsNotYetCleared);
    const calculatedTotalChecksOperational = this.sumLines(context.checksNotYetCleared);
    const calculatedStaleOutstandingChecksRiskTotal = this.sumLines(context.staleOutstandingChecks);
    const calculatedTotalChecksPrudent =
      calculatedTotalChecksOperational + calculatedStaleOutstandingChecksRiskTotal;
    const calculatedTotalImpayes = this.sumLines(context.impayes);
    const calculatedFacilitiesTotals = this.sumFacilities(context.bankFacilities);

    this.compareOptionalTotals({
      code: 'OPENING_PLUS_DEPOSITS_MISMATCH',
      section: 'totalDeposits',
      declared: context.totalDeposits?.value,
      calculated: calculatedTotalDeposits,
      message: 'Le total des dépôts déclaré ne correspond pas à la somme des lignes de dépôts.',
      issues: context.issues,
      sheetName: context.sheetName,
      tolerance: context.tolerance,
    });

    if (context.openingBalance && context.totalBalanceA) {
      this.compareOptionalTotals({
        code: 'OPENING_PLUS_DEPOSITS_MISMATCH',
        section: 'totalBalanceA',
        declared: context.totalBalanceA.value,
        calculated: context.openingBalance.value + calculatedTotalDeposits,
        message: 'OPENING BALANCE + total dépôts ne correspond pas à TOTAL BALANCE (A).',
        issues: context.issues,
        sheetName: context.sheetName,
        tolerance: context.tolerance,
      });
    }

    const validatedTotalChecks = this.resolveValidatedTotalChecks({
      operational: calculatedTotalChecksOperational,
      prudent: calculatedTotalChecksPrudent,
      declared: context.totalB,
      issues: context.issues,
      sheetName: context.sheetName,
      tolerance: context.tolerance,
    });

    this.compareOptionalTotals({
      code: 'A_MINUS_B_MISMATCH',
      section: 'totalB',
      declared: context.totalB?.value,
      calculated: validatedTotalChecks,
      message: 'TOTAL (B) déclaré ne correspond pas à la somme des chèques non débités.',
      issues: context.issues,
      sheetName: context.sheetName,
      tolerance: context.tolerance,
    });

    if (context.totalBalanceA && context.closingBalanceC) {
      const closingBalanceChecksTotal = context.totalB?.value ?? calculatedTotalChecksOperational;
      this.compareOptionalTotals({
        code: 'A_MINUS_B_MISMATCH',
        section: 'closingBalanceC',
        declared: context.closingBalanceC.value,
        calculated: context.totalBalanceA.value - closingBalanceChecksTotal,
        message: 'TOTAL BALANCE (A) - TOTAL (B) ne correspond pas au CLOSING BALANCE C.',
        issues: context.issues,
        sheetName: context.sheetName,
        tolerance: context.tolerance,
      });
    }

    this.compareOptionalTotals({
      code: 'IMPAYES_TOTAL_MISMATCH',
      section: 'impayes',
      declared: context.declaredTotalImpayes?.value,
      calculated: calculatedTotalImpayes,
      message: 'Le total impayés déclaré ne correspond pas à la somme des lignes impayés.',
      issues: context.issues,
      sheetName: context.sheetName,
      tolerance: context.tolerance,
    });

    const declaredFacilityTotals = context.declaredFacilitiesTotals;
    if (declaredFacilityTotals?.limit) {
      this.compareOptionalTotals({
        code: 'FACILITIES_TOTAL_MISMATCH',
        section: 'bankFacilities',
        declared: declaredFacilityTotals.limit.value,
        calculated: calculatedFacilitiesTotals.limit,
        message: 'Le total limite des facilités ne correspond pas à la somme des lignes.',
        issues: context.issues,
        sheetName: context.sheetName,
        tolerance: context.tolerance,
      });
    }
    if (declaredFacilityTotals?.used) {
      this.compareOptionalTotals({
        code: 'FACILITIES_TOTAL_MISMATCH',
        section: 'bankFacilities',
        declared: declaredFacilityTotals.used.value,
        calculated: calculatedFacilitiesTotals.used,
        message: 'Le total utilisé des facilités ne correspond pas à la somme des lignes.',
        issues: context.issues,
        sheetName: context.sheetName,
        tolerance: context.tolerance,
      });
    }
    if (declaredFacilityTotals?.balance) {
      this.compareOptionalTotals({
        code: 'FACILITIES_TOTAL_MISMATCH',
        section: 'bankFacilities',
        declared: declaredFacilityTotals.balance.value,
        calculated: calculatedFacilitiesTotals.balance,
        message: 'Le total disponible des facilités ne correspond pas à la somme des lignes.',
        issues: context.issues,
        sheetName: context.sheetName,
        tolerance: context.tolerance,
      });
    }
  }

  private compareOptionalTotals(context: {
    code: InternalBookValidationIssue['code'];
    section: InternalBookSection;
    declared?: number;
    calculated: number;
    message: string;
    issues: InternalBookValidationIssue[];
    sheetName: string;
    tolerance: number;
  }): void {
    if (context.declared === undefined) {
      return;
    }

    const discrepancy = context.calculated - context.declared;
    if (Math.abs(discrepancy) > context.tolerance) {
      context.issues.push({
        code: context.code,
        severity: 'error',
        message: context.message,
        section: context.section,
        sheetName: context.sheetName,
        expected: context.calculated,
        actual: context.declared,
        discrepancy,
        tolerance: context.tolerance,
      });
    }
  }

  private selectRightMostMoney(
    row: NormalizedRow,
    sheetName: string,
    section: InternalBookSection,
    flagAmbiguity: boolean,
  ): MoneySelection {
    const moneyCells = row.cells.filter((cell) => cell.money);
    const candidateCells = flagAmbiguity ? this.filterAmountCandidateCells(moneyCells) : moneyCells;
    const candidates = candidateCells.map((cell) => cell.money as InternalBookMoneyCell);
    const money = candidates[candidates.length - 1];

    if (flagAmbiguity && candidates.length > 1 && !this.hasClearRightMostAmount(row, candidates)) {
      return {
        money,
        issue: this.createIssue(
          'AMBIGUOUS_AMOUNT_COLUMN',
          'error',
          `Plusieurs montants candidats détectés; montant le plus à droite retenu pour ${section}.`,
          sheetName,
          section,
          row.rowIndex,
          money?.columnIndex,
        ),
      };
    }

    return { money };
  }

  private selectSingleTotalMoney(row: NormalizedRow, sheetName: string, section: InternalBookSection): MoneySelection {
    const structuredSelection = this.selectStructuredSingleTotalMoney(row, section);
    if (structuredSelection) {
      return {
        money: structuredSelection.money,
        issue:
          structuredSelection.issue ??
          this.createUnexpectedMoneyIssue(row, sheetName, section, [structuredSelection.money]),
      };
    }

    return this.selectRightMostMoney(row, sheetName, section, false);
  }

  private selectStructuredSingleTotalMoney(
    row: NormalizedRow,
    section: InternalBookSection,
  ): { money: InternalBookMoneyCell; issue?: InternalBookValidationIssue } | undefined {
    return this.selectExpectedAmountCell(row, section);
  }

  private selectTotalBMoney(
    row: NormalizedRow,
    sheetName: string,
    totalBalanceA: InternalBookMoneyCell | undefined,
    closingBalanceC: InternalBookMoneyCell | undefined,
    tolerance: number,
  ): MoneySelection {
    const consistencySelection = this.selectTotalBByClosingBalance(row, sheetName, totalBalanceA, closingBalanceC, tolerance);
    return consistencySelection ?? this.selectSingleTotalMoney(row, sheetName, 'totalB');
  }

  private selectTotalBByClosingBalance(
    row: NormalizedRow,
    sheetName: string,
    totalBalanceA: InternalBookMoneyCell | undefined,
    closingBalanceC: InternalBookMoneyCell | undefined,
    tolerance: number,
  ): MoneySelection | undefined {
    if (!totalBalanceA || !closingBalanceC) {
      return undefined;
    }

    const amountCells = row.cells.filter(
      (cell) => cell.money && (this.hasPrimaryAmountHeader(cell) || this.hasSecondaryAmountHeader(cell)),
    );
    const hasPrimaryAmountCell = amountCells.some((cell) => this.hasPrimaryAmountHeader(cell));
    const hasSecondaryAmountCell = amountCells.some((cell) => this.hasSecondaryAmountHeader(cell));
    if (amountCells.length <= 1 || !hasPrimaryAmountCell || !hasSecondaryAmountCell) {
      return undefined;
    }

    const candidates = amountCells.map((cell) => cell.money as InternalBookMoneyCell);
    const matchingCandidates = candidates.filter(
      (candidate) => Math.abs(totalBalanceA.value - candidate.value - closingBalanceC.value) <= tolerance,
    );

    if (matchingCandidates.length === 1) {
      const money = matchingCandidates[0];
      return {
        money,
        issue: this.createUnexpectedMoneyIssue(row, sheetName, 'totalB', [money]),
      };
    }

    const selected = candidates[candidates.length - 1];
    return {
      issue: this.createIssue(
        'AMBIGUOUS_AMOUNT_COLUMN',
        'error',
        matchingCandidates.length === 0
          ? 'Plusieurs colonnes montant metier detectees pour totalB; aucune ne respecte TOTAL BALANCE (A) - TOTAL (B) = CLOSING BALANCE.'
          : 'Plusieurs colonnes montant metier detectees pour totalB; plusieurs respectent TOTAL BALANCE (A) - TOTAL (B) = CLOSING BALANCE.',
        sheetName,
        'totalB',
        selected.rowIndex,
        selected.columnIndex,
      ),
    };
  }

  private selectLineMoney(
    row: NormalizedRow,
    sheetName: string,
    section: InternalBookSection,
    alignedAmountHeader?: string,
  ): MoneySelection {
    if (alignedAmountHeader) {
      return this.selectLineMoneyByAlignedHeader(row, sheetName, section, alignedAmountHeader);
    }

    const structuredMoney = this.selectExpectedAmountCell(row, section);
    if (structuredMoney) {
      return {
        money: structuredMoney.money,
        issue: structuredMoney.issue ?? this.createUnexpectedMoneyIssue(row, sheetName, section, [structuredMoney.money]),
      };
    }

    return this.selectRightMostMoney(row, sheetName, section, true);
  }

  private selectLineMoneyByAlignedHeader(
    row: NormalizedRow,
    sheetName: string,
    section: InternalBookSection,
    alignedAmountHeader: string,
  ): MoneySelection {
    const businessAmountCells = row.cells.filter((cell) => cell.money && this.hasAmountHeader(cell));
    const unalignedBusinessAmountCells = businessAmountCells.filter((cell) => cell.headerNormalizedText !== alignedAmountHeader);
    const alignedCell = row.cells.find((cell) => cell.money && cell.headerNormalizedText === alignedAmountHeader);
    if (alignedCell?.money) {
      return {
        money: alignedCell.money,
        issue:
          unalignedBusinessAmountCells.length > 0
            ? this.createUnalignedCheckAmountIssue(unalignedBusinessAmountCells[0], sheetName, section)
            : this.createUnexpectedMoneyIssue(row, sheetName, section, [alignedCell.money]),
      };
    }

    if (businessAmountCells.length > 0) {
      return {
        issue: this.createUnalignedCheckAmountIssue(businessAmountCells[0], sheetName, section),
      };
    }

    return this.selectLineMoney(row, sheetName, section);
  }

  private createUnalignedCheckAmountIssue(
    cell: NormalizedCell,
    sheetName: string,
    section: InternalBookSection,
  ): InternalBookValidationIssue {
    return this.createIssue(
      'AMBIGUOUS_AMOUNT_COLUMN',
      'warning',
      'Montant de cheque hors colonne alignee avec TOTAL(B) ignore; revue conseillee.',
      sheetName,
      section,
      cell.rowIndex,
      cell.columnIndex,
    );
  }

  private selectExpectedAmountCell(
    row: NormalizedRow,
    section: InternalBookSection,
  ): { money: InternalBookMoneyCell; issue?: InternalBookValidationIssue } | undefined {
    const primaryAmountCells = row.cells.filter((cell) => cell.money && this.hasPrimaryAmountHeader(cell));
    const secondaryAmountCells = row.cells.filter((cell) => cell.money && this.hasSecondaryAmountHeader(cell));
    const suffixedSecondaryAmountCells = row.cells.filter((cell) => cell.money && this.hasSuffixedSecondaryAmountHeader(cell));
    const amountCells = [...primaryAmountCells, ...secondaryAmountCells];

    if (section === 'totalB' && secondaryAmountCells.length === 1) {
      return { money: secondaryAmountCells[0].money as InternalBookMoneyCell };
    }

    if (primaryAmountCells.length === 1) {
      return { money: primaryAmountCells[0].money as InternalBookMoneyCell };
    }

    if (primaryAmountCells.length === 0 && secondaryAmountCells.length === 1) {
      return { money: secondaryAmountCells[0].money as InternalBookMoneyCell };
    }

    if (primaryAmountCells.length === 0 && suffixedSecondaryAmountCells.length > 0) {
      return undefined;
    }

    if (amountCells.length > 1) {
      const selected = amountCells[amountCells.length - 1].money as InternalBookMoneyCell;
      return {
        money: selected,
        issue: this.createIssue(
          'AMBIGUOUS_AMOUNT_COLUMN',
          'error',
          `Plusieurs colonnes montant métier détectées; revue requise pour ${section}.`,
          selected.sheetName,
          section,
          selected.rowIndex,
          selected.columnIndex,
        ),
      };
    }

    return undefined;
  }

  private filterAmountCandidateCells(cells: NormalizedCell[]): NormalizedCell[] {
    const nonAmountFiltered = cells.filter((cell) => !this.isNonAmountCell(cell));
    const amountHeaderCandidates = nonAmountFiltered.filter((cell) => this.hasAmountHeader(cell));
    return amountHeaderCandidates.length > 0 ? amountHeaderCandidates : nonAmountFiltered;
  }

  private isHeaderedNonAmountCell(cell: NormalizedCell): boolean {
    return this.hasNonAmountHeader(cell);
  }

  private isNonAmountCell(cell: NormalizedCell): boolean {
    return this.hasNonAmountHeader(cell) || this.isExcelSerialDateCell(cell);
  }

  private hasAmountHeader(cell: NormalizedCell): boolean {
    const header = cell.headerNormalizedText ?? '';
    return (
      AMOUNT_COLUMN_HEADERS.has(header) ||
      PRIMARY_AMOUNT_COLUMN_HEADERS.has(header) ||
      SECONDARY_AMOUNT_COLUMN_HEADERS.has(header) ||
      SUFFIXED_SECONDARY_AMOUNT_COLUMN_HEADERS.has(header)
    );
  }

  private hasPrimaryAmountHeader(cell: NormalizedCell): boolean {
    return PRIMARY_AMOUNT_COLUMN_HEADERS.has(cell.headerNormalizedText ?? '');
  }

  private hasSecondaryAmountHeader(cell: NormalizedCell): boolean {
    return SECONDARY_AMOUNT_COLUMN_HEADERS.has(cell.headerNormalizedText ?? '');
  }

  private hasSuffixedSecondaryAmountHeader(cell: NormalizedCell): boolean {
    return SUFFIXED_SECONDARY_AMOUNT_COLUMN_HEADERS.has(cell.headerNormalizedText ?? '');
  }

  private hasNonAmountHeader(cell: NormalizedCell): boolean {
    const header = cell.headerNormalizedText ?? '';
    return (
      NON_AMOUNT_COLUMN_HEADERS.has(header) ||
      /\bDATE\b/.test(header) ||
      /\bCH NO\b/.test(header) ||
      /\bTR NO\b/.test(header) ||
      /\bFACT NO\b/.test(header) ||
      /\bREF\b/.test(header) ||
      /\bREFERENCE\b/.test(header)
    );
  }

  private isExcelSerialDateCell(cell: NormalizedCell): boolean {
    return typeof cell.raw === 'number' && this.looksLikeExcelSerialDate(cell.raw);
  }

  private selectStructuredFacilityMoney(row: NormalizedRow): Pick<InternalBookFacilityLine, 'limit' | 'used' | 'balance'> {
    return {
      limit: this.findFacilityMoneyByHeader(row, FACILITY_LIMIT_COLUMN_HEADERS),
      used: this.findFacilityMoneyByHeader(row, FACILITY_USED_COLUMN_HEADERS),
      balance: this.findFacilityMoneyByHeader(row, FACILITY_BALANCE_COLUMN_HEADERS),
    };
  }

  private findFacilityMoneyByHeader(row: NormalizedRow, headers: Set<string>): InternalBookMoneyCell | undefined {
    const cell = row.cells.find((candidate) => candidate.money && headers.has(candidate.headerNormalizedText ?? ''));
    return cell?.money;
  }

  private createUnexpectedMoneyIssue(
    row: NormalizedRow,
    sheetName: string,
    section: InternalBookSection,
    selectedMoneyCells: Array<InternalBookMoneyCell | undefined>,
  ): InternalBookValidationIssue | undefined {
    const selected = new Set(
      selectedMoneyCells
        .filter((money): money is InternalBookMoneyCell => money !== undefined)
        .map((money) => `${money.rowIndex}:${money.columnIndex}`),
    );
    const unexpected = row.cells.find(
      (cell) =>
        cell.money &&
        !selected.has(`${cell.rowIndex}:${cell.columnIndex}`) &&
        !this.isNonAmountCell(cell) &&
        !this.isIgnorableSecondaryAmountCell(cell),
    );

    if (!unexpected?.money) {
      return undefined;
    }

    return this.createIssue(
      'AMBIGUOUS_AMOUNT_COLUMN',
      'warning',
      `Cellule numérique hors colonne métier ignorée pour ${section}; revue conseillée.`,
      sheetName,
      section,
      unexpected.rowIndex,
      unexpected.columnIndex,
    );
  }

  private isIgnorableSecondaryAmountCell(cell: NormalizedCell): boolean {
    return (
      this.hasSuffixedSecondaryAmountHeader(cell) ||
      ((this.hasSecondaryAmountHeader(cell) || this.hasSuffixedSecondaryAmountHeader(cell)) && cell.money?.value === 0)
    );
  }


  private hasClearRightMostAmount(row: NormalizedRow, candidates: InternalBookMoneyCell[]): boolean {
    if (candidates.length <= 1) {
      return true;
    }

    const rightMostCandidate = candidates[candidates.length - 1];
    const latestTextColumn = Math.max(
      0,
      ...row.cells
        .filter((cell) => !cell.money && cell.normalizedText && !this.looksLikeDate(`${cell.raw ?? ''}`))
        .map((cell) => cell.columnIndex),
    );
    const candidatesAfterLatestText = candidates.filter((candidate) => candidate.columnIndex > latestTextColumn);

    if (latestTextColumn > 0 && candidatesAfterLatestText.length === 1 && candidatesAfterLatestText[0] === rightMostCandidate) {
      return true;
    }

    return this.rowStartsWithDate(row) && candidates.length === 2;
  }

  private rowStartsWithDate(row: NormalizedRow): boolean {
    const firstCell = row.cells[0];
    if (!firstCell) {
      return false;
    }

    if (this.looksLikeDate(`${firstCell.raw ?? ''}`)) {
      return true;
    }

    return typeof firstCell.raw === 'number' && this.looksLikeExcelSerialDate(firstCell.raw);
  }

  private looksLikeZeroDash(value: string): boolean {
    return /^[-–—]$/.test(value.trim());
  }

  private looksLikeExcelSerialDate(value: number): boolean {
    return Number.isInteger(value) && value >= EXCEL_SERIAL_DATE_MIN && value <= EXCEL_SERIAL_DATE_MAX;
  }

  private parseMoneyCell(
    raw: unknown,
    sheetName: string,
    rowIndex: number,
    columnIndex: number,
    address: string,
  ): InternalBookMoneyCell | undefined {
    if (raw === null || raw === undefined || raw === '') {
      return undefined;
    }

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (columnIndex === 1 && this.looksLikeExcelSerialDate(raw)) {
        return undefined;
      }

      return { value: raw, raw, sheetName, rowIndex, columnIndex, address };
    }

    if (typeof raw !== 'string') {
      return undefined;
    }

    const value = raw.trim();
    if (!value || this.looksLikeDate(value)) {
      return undefined;
    }

    if (this.looksLikeZeroDash(value)) {
      return { value: 0, raw, sheetName, rowIndex, columnIndex, address };
    }

    const numericLike = value.match(/^\(?-?\s*[\d\s.,]+\)?$/);
    if (!numericLike) {
      return undefined;
    }

    const isParenthesizedNegative = value.startsWith('(') && value.endsWith(')');
    const hasExplicitNegative = value.includes('-');
    const withoutDecorations = value.replace(/[()\s]/g, '').replace(/-/g, '');
    const decimalNormalized = this.normalizeDecimalSeparators(withoutDecorations);
    const parsed = Number(decimalNormalized);

    if (!Number.isFinite(parsed)) {
      return undefined;
    }

    const sign = isParenthesizedNegative || hasExplicitNegative ? -1 : 1;
    return { value: sign * parsed, raw, sheetName, rowIndex, columnIndex, address };
  }

  private normalizeDecimalSeparators(value: string): string {
    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');

    if (lastComma > -1 && lastDot > -1) {
      const decimalSeparator = lastComma > lastDot ? ',' : '.';
      const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
      return value.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
    }

    if (lastComma > -1) {
      const decimals = value.length - lastComma - 1;
      return decimals > 0 && decimals <= 2 ? value.replace(',', '.') : value.replace(/,/g, '');
    }

    if (lastDot > -1) {
      const decimals = value.length - lastDot - 1;
      return decimals > 0 && decimals <= 2 ? value : value.replace(/\./g, '');
    }

    return value;
  }

  private parseSheetDate(sheetName: string): string | undefined {
    const trimmed = sheetName.trim();
    const match = /^(\d{2})(\d{2})(\d{2})$/.exec(trimmed);
    if (!match) {
      return undefined;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = 2000 + Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return undefined;
    }

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private normalizeText(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    return `${value}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’'`]/g, ' ')
      .replace(/[=()\-_/\\:;,.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private detectBank(sourceFile: string): InternalBookBank {
    const normalized = this.normalizeText(sourceFile);

    if (normalized.includes('ORABANK') || normalized.includes('ORA BANK')) return 'ORABANK';
    if (normalized.includes('ATLANTIK') || normalized.includes('ATLANTIQUE')) return 'ATLANTIK';
    if (normalized.includes('BRIDGE')) return 'BRIDGE';
    if (normalized.includes('BICIS')) return 'BICIS';
    if (normalized.includes('BDK') || normalized.includes('BANQUE DE DAKAR')) return 'BDK';
    if (normalized.includes('BIS') || normalized.includes('BANQUE ISLAMIQUE')) return 'BIS';

    return 'UNKNOWN';
  }

  private hasMinimumInternalBookShape(anchors: SectionAnchor[]): boolean {
    const foundSections = new Set(anchors.map((anchor) => anchor.key));
    return foundSections.has('openingBalance') || foundSections.has('totalBalanceA') || foundSections.has('closingBalanceC');
  }

  private resolveStatus(bank: InternalBookBank, issues: InternalBookValidationIssue[]): InternalBookStatus {
    if (!SUPPORTED_BANKS.includes(bank)) {
      return 'unsupported';
    }

    return issues.some((issue) => issue.severity === 'error') ? 'needs_review' : 'valid';
  }

  private createIssue(
    code: InternalBookValidationIssue['code'],
    severity: InternalBookValidationIssue['severity'],
    message: string,
    sheetName?: string,
    section?: InternalBookSection,
    rowIndex?: number,
    columnIndex?: number,
  ): InternalBookValidationIssue {
    return { code, severity, message, sheetName, section, rowIndex, columnIndex };
  }

  private sumLines(lines: InternalBookLine[]): number {
    return lines.reduce((sum, line) => sum + line.amount.value, 0);
  }

  private resolveValidatedTotalChecks(context: {
    operational: number;
    prudent: number;
    declared?: InternalBookMoneyCell;
    issues: InternalBookValidationIssue[];
    sheetName: string;
    tolerance: number;
  }): number {
    if (!context.declared) {
      return context.operational;
    }

    const matchesOperational = Math.abs(context.operational - context.declared.value) <= context.tolerance;
    const matchesPrudent = Math.abs(context.prudent - context.declared.value) <= context.tolerance;

    if (!matchesOperational && matchesPrudent) {
      context.issues.push(
        this.createIssue(
          'TOTAL_B_INCLUDES_STALE_CHECKS',
          'warning',
          'TOTAL(B) inclut des cheques anciens; risque prudent deja integre.',
          context.sheetName,
          'totalB',
          context.declared.rowIndex,
          context.declared.columnIndex,
        ),
      );
      return context.prudent;
    }

    return context.operational;
  }

  private classifyOutstandingChecks(
    lines: InternalBookLine[],
    reportDate: string,
    sheetName: string,
    issues: InternalBookValidationIssue[],
  ): { operational: InternalBookLine[]; stale: InternalBookLine[]; highRiskTotal: number } {
    const operational: InternalBookLine[] = [];
    const stale: InternalBookLine[] = [];
    let highRiskTotal = 0;

    for (const line of lines) {
      if (!this.isStaleOutstandingCheck(line, reportDate)) {
        operational.push(line);
        continue;
      }

      stale.push(line);
      issues.push(
        this.createIssue(
          'STALE_OUTSTANDING_CHECK',
          'warning',
          'Cheque ancien a regulariser detecte; inclus dans le risque prudent.',
          sheetName,
          'checksNotYetCleared',
          line.amount.rowIndex,
          line.amount.columnIndex,
        ),
      );

      if (this.isHighRiskStaleOutstandingCheck(line)) {
        highRiskTotal += line.amount.value;
        issues.push(
          this.createIssue(
            'HIGH_RISK_STALE_OUTSTANDING_CHECK',
            'warning',
            'Cheque ancien a risque eleve: beneficiaire administration/douane/tresor.',
            sheetName,
            'checksNotYetCleared',
            line.amount.rowIndex,
            line.amount.columnIndex,
          ),
        );
      }
    }

    return { operational, stale, highRiskTotal };
  }

  private isStaleOutstandingCheck(line: InternalBookLine, reportDate: string): boolean {
    if (!line.date) {
      return false;
    }

    const checkDate = this.parseIsoDate(line.date);
    const reportDay = this.parseIsoDate(reportDate);
    if (!checkDate || !reportDay) {
      return false;
    }

    const staleCutoff = new Date(reportDay);
    staleCutoff.setUTCFullYear(staleCutoff.getUTCFullYear() - STALE_CHECK_AGE_YEARS);
    return checkDate <= staleCutoff;
  }

  private isHighRiskStaleOutstandingCheck(line: InternalBookLine): boolean {
    const label = this.normalizeText([line.label, line.description].filter(Boolean).join(' '));
    return HIGH_RISK_STALE_CHECK_LABEL.test(label);
  }

  private parseIsoDate(value: string): Date | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return undefined;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? date
      : undefined;
  }

  private extractUnlabeledSingleMoney(row: NormalizedRow): InternalBookMoneyCell | undefined {
    const moneyCells = row.cells.filter((cell) => cell.money);
    if (moneyCells.length !== 1) {
      return undefined;
    }

    const hasBusinessText = row.cells.some((cell) => {
      if (cell.money) {
        return false;
      }

      return cell.raw !== null && cell.raw !== undefined && `${cell.raw}`.trim() !== '';
    });

    return hasBusinessText ? undefined : moneyCells[0].money;
  }

  private sumFacilities(lines: InternalBookFacilityLine[]): Required<InternalBookFacilityTotals> {
    return lines.reduce(
      (totals, line) => ({
        limit: totals.limit + (line.limit?.value ?? 0),
        used: totals.used + (line.used?.value ?? 0),
        balance: totals.balance + (line.balance?.value ?? 0),
      }),
      { limit: 0, used: 0, balance: 0 },
    );
  }

  private toDeclaredFacilityTotals(line?: InternalBookFacilityLine): InternalBookFacilityTotals | undefined {
    if (!line) {
      return undefined;
    }

    return {
      limit: line.limit?.value,
      used: line.used?.value,
      balance: line.balance?.value,
    };
  }

  private isTotalRow(row: NormalizedRow): boolean {
    return /\bTOTAL\b|\bTOTAUX\b|\bSOUS TOTAL\b/.test(row.normalizedText);
  }

  private isHeaderLikeRow(row: NormalizedRow): boolean {
    const text = row.normalizedText;
    const hasHeaderWords = /\bDATE\b|\bREFERENCE\b|\bREF\b|\bCLIENT\b|\bMONTANT\b|\bAMOUNT\b|\bLIMIT\b|\bLIMITE\b|\bUSED\b|\bUTILISE\b|\bBALANCE\b|\bDISPONIBLE\b/.test(text);
    const hasMoney = row.cells.some((cell) => cell.money);
    return hasHeaderWords && !hasMoney;
  }

  private extractLabel(row: NormalizedRow): string | undefined {
    return row.cells
      .filter((cell) => (!cell.money || this.isHeaderedNonAmountCell(cell)) && cell.normalizedText)
      .map((cell) => `${cell.raw}`.trim())
      .join(' ')
      .trim() || undefined;
  }

  private extractDescription(row: NormalizedRow): string | undefined {
    return this.extractLabel(row);
  }

  private extractReference(row: NormalizedRow): string | undefined {
    const candidate = row.cells.find(
      (cell) =>
        (!cell.money || this.isHeaderedNonAmountCell(cell)) &&
        cell.headerNormalizedText !== 'DATE' &&
        /\d/.test(cell.normalizedText) &&
        !this.looksLikeDate(`${cell.raw}`),
    );
    return candidate ? `${candidate.raw}`.trim() : undefined;
  }

  private extractDateFromRow(row: NormalizedRow): string | undefined {
    for (const cell of row.cells) {
      const value = `${cell.raw ?? ''}`.trim();
      const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
      if (!match) {
        continue;
      }

      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    const dateColumnCells = row.cells.filter((cell) => this.isDateColumnCell(cell));
    for (const cell of dateColumnCells) {
      const dateColumnSerial = this.parseExcelSerialDate(cell.raw);
      if (dateColumnSerial) {
        return dateColumnSerial;
      }
    }

    const firstCell = row.cells[0];
    if (dateColumnCells.length === 0 && firstCell && this.canUseFirstCellExcelSerialDateFallback(firstCell)) {
      return this.parseExcelSerialDate(firstCell.raw);
    }

    return undefined;
  }

  private isDateColumnCell(cell: NormalizedCell): boolean {
    return /\bDATE\b/.test(cell.headerNormalizedText ?? '');
  }

  private canUseFirstCellExcelSerialDateFallback(cell: NormalizedCell): boolean {
    const header = cell.headerNormalizedText ?? '';
    return header === '' || this.isDateColumnCell(cell);
  }

  private parseExcelSerialDate(value: unknown): string | undefined {
    if (typeof value !== 'number' || !this.looksLikeExcelSerialDate(value)) {
      return undefined;
    }

    const date = new Date(EXCEL_SERIAL_DATE_EPOCH_UTC + value * MILLISECONDS_PER_DAY);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  private looksLikeDate(value: string): boolean {
    return /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value.trim());
  }
}

export const internalBookExcelParser = new InternalBookExcelParser();
export { InternalBookExcelParser };
