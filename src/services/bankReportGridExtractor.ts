import type { BankFacility, BankReport, CheckNotCleared, DepositNotCleared, Impaye } from '@/types/banking';

import { banksMentionedInHeader, detectBankFromHeader, normalizeBankIdentityText, type OperationalBankCode } from './bankIdentity';
import { parseDocumentDate } from './bankReportExtractionContract';
import {
  isBlankRow,
  isFormattedAmountCell,
  type ExcelGridCell,
  type ExcelSheetGrid,
} from './excelSheetGrid';

/**
 * Extraction tabulaire d'un rapport bancaire quotidien (Pack 2).
 *
 * Contrat fail-closed sur la grille d'UNE feuille (voir `excelSheetGrid`) :
 * - l'émetteur est lu dans l'en-tête (lignes avant le solde d'ouverture) et
 *   doit être unique et égal à la banque attendue ; le corps peut citer
 *   d'autres banques ;
 * - la ligne « OPENING BALANCE JJ/MM/AA » (ou « SOLDE D'OUVERTURE ») porte la
 *   date du rapport et le solde d'ouverture ; si le nom de la feuille est une
 *   date `JJMMAA`, elle doit coïncider ;
 * - « CLOSING BALANCE as per Book » (ou « SOLDE DE CLÔTURE … ») porte le solde
 *   de clôture ;
 * - les sections sont délimitées par des libellés strictement listés ; une
 *   ligne datée non exploitable, une section déclarée vide ou une cellule
 *   d'erreur Excel refusent le document ;
 * - un montant est la dernière cellule numérique formatée de la ligne (format
 *   comptable), à défaut la dernière cellule numérique ; il doit être un
 *   entier sûr.
 */

export interface BankReportGridEvidence {
  depositCount: number;
  checkCount: number;
  facilityCount: number;
  unpaidCount: number;
  ignoredPostTotalRowCount: number;
}

export interface BankReportGridExtractionResult {
  success: boolean;
  data?: BankReport;
  errors?: string[];
  warnings?: string[];
  evidence?: BankReportGridEvidence;
}

interface BankReportLabelSet {
  opening: RegExp;
  closing: RegExp;
  depositsHeading: readonly string[];
  checksHeading: readonly string[];
  facilitiesHeading: RegExp;
  impayesHeading: readonly string[];
  impayeMarker: readonly string[];
}

const DATE_IN_LABEL = '(\\d{2}[/-]\\d{2}[/-](?:\\d{4}|\\d{2}))';

const ENGLISH_LABELS: BankReportLabelSet = {
  opening: new RegExp(`^OPENING BALANCE\\s+${DATE_IN_LABEL}$`),
  closing: /^CLOSING BALANCE AS PER BOOK\b/,
  depositsHeading: ['DEPOSIT NOT YET CLEARED', 'DEPOSITS NOT YET CLEARED'],
  checksHeading: ['CHECK NOT YET CLEARED', 'CHECKS NOT YET CLEARED'],
  facilitiesHeading: /^BANK FACILITY\b/,
  impayesHeading: ['IMPAYE', 'IMPAYES'],
  impayeMarker: ['IMPAYE', 'IMPAYES', 'UNPAID'],
};

/** ORA : libellés français saisis dans les rapports réels, strictement listés. */
const ORA_LABELS: BankReportLabelSet = {
  opening: new RegExp(`^SOLDE D'OUVERTURE\\s+${DATE_IN_LABEL}$`),
  closing: /^SOLDE DE CLOTURE\b/,
  depositsHeading: ['DEPOTS PAS ENCORE ENCAISSE', 'DEPOTS PAS ENCORE ENCAISSES'],
  checksHeading: ['CHEQUES EMIS NON ENCAISSES'],
  facilitiesHeading: /^BANK FACILITY\b/,
  impayesHeading: ['IMPAYES', 'IMPAYE'],
  impayeMarker: ['IMPAYE', 'IMPAYES'],
};

const LABELS_BY_BANK: Record<OperationalBankCode, BankReportLabelSet> = {
  BDK: ENGLISH_LABELS,
  ATB: ENGLISH_LABELS,
  BICIS: ENGLISH_LABELS,
  ORA: ORA_LABELS,
  SGBS: ENGLISH_LABELS,
  BIS: ENGLISH_LABELS,
};

const FACILITY_COLUMN_HEADERS = new Set(['LIMIT', 'LIMITE', 'USED', 'UTILISE', 'BALANCE', 'SOLDE', 'DISPONIBLE']);
const TOTAL_PREFIX = /^(?:TOTAL|SOUS TOTAL)\b/;
const ADD_LESS_PREFIX = /^(?:ADD|LESS|PLUS|MOINS)\s*:?\s*/;

type Section = 'none' | 'deposits' | 'checks' | 'facilities' | 'impayes';

function normalizeLabel(value: string): string {
  return normalizeBankIdentityText(value)
    .replace(/[’`´]/g, "'")
    .replace(/\s*:\s*$/, '')
    .trim();
}

function textCells(row: readonly ExcelGridCell[]): string[] {
  return row.filter(cell => cell.kind === 'text').map(cell => cell.text);
}

function rowLabels(row: readonly ExcelGridCell[]): string[] {
  return textCells(row).map(text => normalizeLabel(text).replace(ADD_LESS_PREFIX, '').trim());
}

function rowHasLabel(row: readonly ExcelGridCell[], labels: readonly string[]): boolean {
  const normalizedLabels = rowLabels(row);
  return normalizedLabels.some(label => labels.includes(label));
}

function rowMatches(row: readonly ExcelGridCell[], pattern: RegExp): RegExpMatchArray | null {
  for (const text of textCells(row)) {
    const match = normalizeLabel(text).match(pattern);
    if (match) return match;
  }
  return null;
}

function isTotalRow(row: readonly ExcelGridCell[]): boolean {
  const labels = rowLabels(row);
  return labels.length > 0 && labels.every(label => TOTAL_PREFIX.test(label) || label === '');
}

function isFacilityColumnHeaderRow(row: readonly ExcelGridCell[]): boolean {
  const labels = rowLabels(row).filter(Boolean);
  return labels.length > 0 && labels.every(label => FACILITY_COLUMN_HEADERS.has(label));
}

function cellDate(cell: ExcelGridCell): string | null {
  if (cell.kind === 'date') return cell.isoDate ?? null;
  if (cell.kind === 'text') return parseDocumentDate(cell.text);
  return null;
}

/**
 * Montant d'une ligne : dernière cellule formatée en montant (format comptable)
 * dont la valeur est non nulle ; si toutes les cellules formatées valent zéro
 * (colonne « - »), le montant est zéro. Une cellule numérique sans format
 * (référence, compteur) n'est jamais un montant. Toute cellule d'erreur Excel
 * sur la ligne refuse le montant.
 */
function amountOfRow(row: readonly ExcelGridCell[]): { amount: number | null; error?: string } {
  if (row.some(cell => cell.kind === 'error')) return { amount: null, error: 'cellule d’erreur Excel' };
  const formatted = row.filter(isFormattedAmountCell);
  if (formatted.length === 0) return { amount: null, error: 'montant absent' };
  const nonZero = formatted.filter(cell => cell.number !== 0);
  const chosen = nonZero.length > 0 ? nonZero[nonZero.length - 1] : formatted[formatted.length - 1];
  const value = chosen.number;
  if (value === undefined || !Number.isSafeInteger(value)) return { amount: null, error: 'montant non entier' };
  return { amount: value };
}

function cellReference(cell: ExcelGridCell | undefined): string {
  if (!cell || cell.kind === 'empty') return '';
  if (cell.kind === 'number') return Number.isSafeInteger(cell.number ?? NaN) ? String(cell.number) : cell.text;
  return cell.text;
}

function sheetNameDate(sheetName: string): string | null {
  const match = sheetName.trim().match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  return parseDocumentDate(`${match[1]}/${match[2]}/${match[3]}`);
}

function headerText(grid: ExcelSheetGrid, openingRowIndex: number): string {
  return grid.rows
    .slice(0, openingRowIndex)
    .map(row => row.map(cell => cell.text).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');
}

export async function extractBankReportFromGrid(
  grid: ExcelSheetGrid,
  bank: OperationalBankCode,
): Promise<BankReportGridExtractionResult> {
  const labels = LABELS_BY_BANK[bank];
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = grid.rows;

  const openingRowIndex = rows.findIndex(row => rowMatches(row, labels.opening));
  if (openingRowIndex === -1) {
    return { success: false, errors: ['Solde d’ouverture daté absent.'] };
  }

  const header = headerText(grid, openingRowIndex);
  const headerBank = detectBankFromHeader(header);
  if (headerBank !== bank) {
    const mentioned = banksMentionedInHeader(header);
    return {
      success: false,
      errors: [mentioned.length > 1
        ? `Identité bancaire ambiguë dans l’en-tête (${mentioned.join(', ')}) pour ${bank}.`
        : `Identité bancaire non corroborée pour ${bank} dans l’en-tête.`],
    };
  }

  // Date du rapport : le nom de feuille `JJMMAA` fait foi (un classeur annuel
  // porte une feuille par jour) ; le solde d'ouverture est daté du jour ou d'un
  // jour antérieur (clôture de la veille), jamais d'un jour postérieur. Sans
  // nom de feuille daté, la date du solde d'ouverture est la date du rapport.
  const openingMatch = rowMatches(rows[openingRowIndex], labels.opening)!;
  const openingDate = parseDocumentDate(openingMatch[1]);
  if (!openingDate) errors.push('Date du solde d’ouverture invalide.');
  const sheetDate = sheetNameDate(grid.sheetName);
  const reportDate = sheetDate ?? openingDate;
  if (openingDate && sheetDate && openingDate > sheetDate) {
    errors.push('Date du solde d’ouverture postérieure à la date de la feuille.');
  }
  const opening = amountOfRow(rows[openingRowIndex]);
  if (opening.amount === null) errors.push(`Solde d’ouverture invalide (${opening.error}).`);

  let closingRowIndex = -1;
  for (let index = openingRowIndex + 1; index < rows.length; index += 1) {
    if (rowMatches(rows[index], labels.closing)) {
      closingRowIndex = index;
      break;
    }
  }
  if (closingRowIndex === -1) errors.push('Solde de clôture absent.');
  const closing = closingRowIndex === -1 ? { amount: null } : amountOfRow(rows[closingRowIndex]);
  if (closingRowIndex !== -1 && closing.amount === null) {
    errors.push(`Solde de clôture invalide (${(closing as { error?: string }).error}).`);
  }

  const deposits: DepositNotCleared[] = [];
  const checks: CheckNotCleared[] = [];
  const facilities: BankFacility[] = [];
  const impayes: Impaye[] = [];
  const declared = { deposits: false, checks: false, facilities: false, impayes: false };
  let ignoredPostTotalRowCount = 0;

  // Après le solde d'ouverture, les dépôts non crédités peuvent apparaître sans
  // titre (rapports BIS) : la section implicite est « dépôts » jusqu'au premier
  // titre ou total.
  let section: Section = 'deposits';
  let facilitiesClosed = false;
  let facilitiesHeadingLabel = '';

  for (let index = openingRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (isBlankRow(row)) continue;
    if (index === closingRowIndex) {
      section = 'none';
      continue;
    }

    if (rowHasLabel(row, labels.depositsHeading)) {
      section = 'deposits';
      declared.deposits = true;
      continue;
    }
    if (rowHasLabel(row, labels.checksHeading)) {
      section = 'checks';
      declared.checks = true;
      continue;
    }
    if (rowMatches(row, labels.facilitiesHeading)) {
      section = 'facilities';
      declared.facilities = true;
      facilitiesClosed = false;
      facilitiesHeadingLabel = textCells(row).find(text => labels.facilitiesHeading.test(normalizeLabel(text)))?.trim() ?? '';
      continue;
    }
    if (rowHasLabel(row, labels.impayesHeading) && !cellDate(row[0])) {
      section = 'impayes';
      declared.impayes = true;
      continue;
    }

    if (isTotalRow(row)) {
      if (section === 'facilities') facilitiesClosed = true;
      else section = 'none';
      continue;
    }

    if (section === 'none') {
      if (rowLabels(row).some(label => label && !TOTAL_PREFIX.test(label))) {
        errors.push(`Ligne ${index + 1} hors section non exploitable.`);
      }
      continue;
    }

    if (section === 'facilities') {
      if (isFacilityColumnHeaderRow(row)) continue;
      const explicitName = textCells(row).map(text => text.trim()).filter(Boolean)[0];
      const numbers = row.filter(isFormattedAmountCell);
      if (row.some(cell => cell.kind === 'error')) {
        errors.push(`Ligne ${index + 1} de facilités bancaires : cellule d’erreur Excel.`);
        continue;
      }
      const hasDate = row.some(cell => cellDate(cell) !== null);
      if (!explicitName && !hasDate) {
        // Ligne de total (chiffres seuls, sans date) : fin des facilités.
        facilitiesClosed = true;
        continue;
      }
      // Une ligne datée sans libellé (facilité unique) prend le titre de la section.
      const name = explicitName ?? facilitiesHeadingLabel;
      if (!name) {
        errors.push(`Ligne ${index + 1} de facilités bancaires sans libellé.`);
        continue;
      }
      if (facilitiesClosed) {
        ignoredPostTotalRowCount += 1;
        continue;
      }
      if (numbers.length !== 3 || numbers.some(cell => !Number.isSafeInteger(cell.number ?? NaN))) {
        errors.push(`Ligne ${index + 1} de facilités bancaires non exploitable.`);
        continue;
      }
      facilities.push({
        facilityType: name,
        limitAmount: numbers[0].number!,
        usedAmount: numbers[1].number!,
        availableAmount: numbers[2].number!,
      });
      continue;
    }

    const lineDate = cellDate(row[0]);
    if (!lineDate) {
      const labelsInRow = rowLabels(row).filter(Boolean);
      if (labelsInRow.length === 0 && row.some(isFormattedAmountCell)) {
        // Total chiffré sans libellé : fin de section.
        section = 'none';
        continue;
      }
      errors.push(`Ligne ${index + 1} de ${sectionLabel(section)} non exploitable.`);
      continue;
    }

    const { amount, error } = amountOfRow(row);
    if (amount === null) {
      errors.push(`Ligne ${index + 1} de ${sectionLabel(section)} : ${error}.`);
      continue;
    }

    if (section === 'deposits') {
      const valueDate = row[1] ? cellDate(row[1]) : null;
      deposits.push({
        dateDepot: lineDate,
        dateValeur: valueDate ?? undefined,
        typeReglement: row[2]?.kind === 'text' ? row[2].text : 'DEPOT',
        reference: cellReference(row[5]) || (valueDate ? '' : cellReference(row[1])),
        clientCode: cellReference(row[4]) || cellReference(row[3]),
        montant: amount,
      });
    } else if (section === 'checks') {
      checks.push({
        dateEmission: lineDate,
        numeroCheque: cellReference(row[1]),
        beneficiaire: cellReference(row[3]) || cellReference(row[4]) || undefined,
        montant: amount,
      });
    } else if (section === 'impayes') {
      const secondDate = row[1] ? cellDate(row[1]) : null;
      const marker = row[2]?.kind === 'text' ? normalizeLabel(row[2].text) : '';
      if (!labels.impayeMarker.includes(marker)) {
        errors.push(`Ligne ${index + 1} d’impayés sans marqueur IMPAYE.`);
        continue;
      }
      const clientCode = cellReference(row[3]);
      if (!clientCode) {
        errors.push(`Ligne ${index + 1} d’impayés sans code client.`);
        continue;
      }
      const description = [cellReference(row[4]), cellReference(row[5])].filter(Boolean).join(' ');
      impayes.push({
        dateRetour: secondDate ? lineDate : undefined,
        dateEcheance: secondDate ?? lineDate,
        clientCode,
        description: description || 'IMPAYE',
        montant: amount,
      });
    }
  }

  // Une section titrée mais vide est un état normal des rapports réels (titre
  // imprimé chaque jour, aucune ligne ce jour-là) : elle n'est pas une erreur.
  // Toute ligne présente mais inexploitable a déjà produit une erreur explicite.
  const emptyDeclaredSections = [
    declared.deposits && deposits.length === 0 ? 'dépôts non crédités' : null,
    declared.checks && checks.length === 0 ? 'chèques non débités' : null,
    declared.facilities && facilities.length === 0 ? 'facilités bancaires' : null,
    declared.impayes && impayes.length === 0 ? 'impayés' : null,
  ].filter((label): label is string => label !== null);
  if (emptyDeclaredSections.length > 0) {
    warnings.push(`Section(s) titrée(s) sans ligne : ${emptyDeclaredSections.join(', ')}.`);
  }
  if (ignoredPostTotalRowCount > 0) {
    warnings.push(`${ignoredPostTotalRowCount} ligne(s) après le total des facilités non exploitée(s).`);
  }

  const evidence: BankReportGridEvidence = {
    depositCount: deposits.length,
    checkCount: checks.length,
    facilityCount: facilities.length,
    unpaidCount: impayes.length,
    ignoredPostTotalRowCount,
  };
  if (errors.length > 0) return { success: false, errors, warnings, evidence };

  return {
    success: true,
    warnings,
    evidence,
    data: {
      bank,
      date: reportDate!,
      openingBalance: opening.amount!,
      closingBalance: closing.amount!,
      bankFacilities: facilities,
      depositsNotCleared: deposits,
      checksNotCleared: checks,
      impayes,
    },
  };
}

function sectionLabel(section: Section): string {
  switch (section) {
    case 'deposits': return 'dépôts non crédités';
    case 'checks': return 'chèques non débités';
    case 'facilities': return 'facilités bancaires';
    case 'impayes': return 'impayés';
    default: return 'section';
  }
}
