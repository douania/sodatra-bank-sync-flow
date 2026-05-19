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
const NON_AMOUNT_COLUMN_HEADERS = new Set(['DATE', 'CH NO', 'CH NO BD', 'TR NO', 'FACT NO', 'REF', 'REFERENCE']);
const AMOUNT_COLUMN_HEADERS = new Set(['AMOUNT', 'MONTANT', 'AMOUNT 1', 'MONTANT 1']);
const PRIMARY_AMOUNT_COLUMN_HEADERS = new Set(['AMOUNT', 'MONTANT']);
const SECONDARY_AMOUNT_COLUMN_HEADERS = new Set(['AMOUNT 1', 'MONTANT 1']);

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
    const totalB = this.extractSingleAmount(context.rows, context.anchors, 'totalB', context.sheetName, issues);
    const closingBalanceC = this.extractSingleAmount(context.rows, context.anchors, 'closingBalanceC', context.sheetName, issues);

    const depositsNotYetCleared = this.extractAmountLines(
      sectionRows.depositsNotYetCleared ?? [],
      context.sheetName,
      'depositsNotYetCleared',
      issues,
    );
    const checksNotYetCleared = this.extractAmountLines(
      sectionRows.checksNotYetCleared ?? [],
      context.sheetName,
      'checksNotYetCleared',
      issues,
    );
    const impayesResult = this.extractImpayes(sectionRows.impayes ?? [], context.sheetName, issues);
    const facilitiesResult = this.extractFacilities(sectionRows.bankFacilities ?? [], context.sheetName, issues);

    this.validateBookAmounts({
      openingBalance,
      totalDeposits,
      totalBalanceA,
      totalB,
      closingBalanceC,
      depositsNotYetCleared,
      checksNotYetCleared,
      impayes: impayesResult.lines,
      declaredTotalImpayes: impayesResult.declaredTotal,
      bankFacilities: facilitiesResult.lines,
      declaredFacilitiesTotals: facilitiesResult.declaredTotals,
      issues,
      tolerance: context.tolerance,
      sheetName: context.sheetName,
    });

    const calculatedTotalDeposits = this.sumLines(depositsNotYetCleared);
    const calculatedTotalChecks = this.sumLines(checksNotYetCleared);
    const calculatedTotalImpayes = this.sumLines(impayesResult.lines);
    const calculatedFacilitiesTotals = this.sumFacilities(facilitiesResult.lines);
    const calculatedTotalBalanceA = openingBalance ? openingBalance.value + calculatedTotalDeposits : undefined;
    const declaredOrCalculatedA = totalBalanceA?.value ?? calculatedTotalBalanceA;
    const calculatedClosingBalanceC = declaredOrCalculatedA !== undefined ? declaredOrCalculatedA - calculatedTotalChecks : undefined;
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

  private extractAmountLines(
    rows: NormalizedRow[],
    sheetName: string,
    section: InternalBookSection,
    issues: InternalBookValidationIssue[],
  ): InternalBookLine[] {
    const lines: InternalBookLine[] = [];

    for (const row of rows) {
      if (this.isTotalRow(row) || this.isHeaderLikeRow(row)) {
        continue;
      }

      const selection = this.selectRightMostMoney(row, sheetName, section, true);
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

  private extractImpayes(
    rows: NormalizedRow[],
    sheetName: string,
    issues: InternalBookValidationIssue[],
  ): { lines: InternalBookLine[]; declaredTotal?: InternalBookMoneyCell } {
    const lines: InternalBookLine[] = [];
    let declaredTotal: InternalBookMoneyCell | undefined;

    for (const row of rows) {
      const selection = this.selectRightMostMoney(row, sheetName, 'impayes', !this.isTotalRow(row));
      if (selection.issue) {
        issues.push(selection.issue);
      }

      if (this.isTotalRow(row)) {
        declaredTotal = selection.money ?? declaredTotal;
        continue;
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
      const lastThree = moneyCells.slice(-3);

      if (lastThree.length >= 1) {
        facilityLine.limit = lastThree[0];
      }
      if (lastThree.length >= 2) {
        facilityLine.used = lastThree[1];
      }
      if (lastThree.length >= 3) {
        facilityLine.balance = lastThree[2];
      }

      if (moneyCells.length > 3) {
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
    impayes: InternalBookLine[];
    declaredTotalImpayes?: InternalBookMoneyCell;
    bankFacilities: InternalBookFacilityLine[];
    declaredFacilitiesTotals?: InternalBookFacilityLine;
    issues: InternalBookValidationIssue[];
    tolerance: number;
    sheetName: string;
  }): void {
    const calculatedTotalDeposits = this.sumLines(context.depositsNotYetCleared);
    const calculatedTotalChecks = this.sumLines(context.checksNotYetCleared);
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

    this.compareOptionalTotals({
      code: 'A_MINUS_B_MISMATCH',
      section: 'totalB',
      declared: context.totalB?.value,
      calculated: calculatedTotalChecks,
      message: 'TOTAL (B) déclaré ne correspond pas à la somme des chèques non débités.',
      issues: context.issues,
      sheetName: context.sheetName,
      tolerance: context.tolerance,
    });

    if (context.totalBalanceA && context.closingBalanceC) {
      this.compareOptionalTotals({
        code: 'A_MINUS_B_MISMATCH',
        section: 'closingBalanceC',
        declared: context.closingBalanceC.value,
        calculated: context.totalBalanceA.value - calculatedTotalChecks,
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
    const structuredMoney = this.selectStructuredSingleTotalMoney(row, section);
    if (structuredMoney) {
      return { money: structuredMoney };
    }

    return this.selectRightMostMoney(row, sheetName, section, false);
  }

  private selectStructuredSingleTotalMoney(row: NormalizedRow, section: InternalBookSection): InternalBookMoneyCell | undefined {
    const primaryAmountCells = row.cells.filter(
      (cell) => cell.money && PRIMARY_AMOUNT_COLUMN_HEADERS.has(cell.headerNormalizedText ?? ''),
    );
    const secondaryAmountCells = row.cells.filter(
      (cell) => cell.money && SECONDARY_AMOUNT_COLUMN_HEADERS.has(cell.headerNormalizedText ?? ''),
    );

    if (primaryAmountCells.length === 0 || secondaryAmountCells.length === 0) {
      return undefined;
    }

    let preferredCells: NormalizedCell[] = [];
    if (section === 'totalB') {
      preferredCells = secondaryAmountCells;
    } else if (section === 'totalDeposits' || section === 'totalBalanceA' || section === 'closingBalanceC') {
      preferredCells = primaryAmountCells;
    }

    return preferredCells.length === 1 ? preferredCells[0].money : undefined;
  }

  private filterAmountCandidateCells(cells: NormalizedCell[]): NormalizedCell[] {
    const nonAmountFiltered = cells.filter((cell) => !this.isHeaderedNonAmountCell(cell));
    const amountHeaderCandidates = nonAmountFiltered.filter((cell) => AMOUNT_COLUMN_HEADERS.has(cell.headerNormalizedText ?? ''));
    return amountHeaderCandidates.length > 0 ? amountHeaderCandidates : nonAmountFiltered;
  }

  private isHeaderedNonAmountCell(cell: NormalizedCell): boolean {
    return NON_AMOUNT_COLUMN_HEADERS.has(cell.headerNormalizedText ?? '');
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

    return undefined;
  }

  private looksLikeDate(value: string): boolean {
    return /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value.trim());
  }
}

export const internalBookExcelParser = new InternalBookExcelParser();
export { InternalBookExcelParser };
