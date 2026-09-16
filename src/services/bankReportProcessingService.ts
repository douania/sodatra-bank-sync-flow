
import { BankReport } from '@/types/banking';
import { analyzeBDKBankStatementText } from './bdkBankStatementDiagnosticService';
import { bankReportSectionExtractor } from './bankReportSectionExtractor';
import { extractBankReportFromGrid } from './bankReportGridExtractor';
import { corroborateBankIdentity, detectBankFromFileName } from './bankIdentity';
import {
  ExcelSheetSelectionError,
  listWorkbookSheetNames,
  readSelectedSheetGrid,
  resolveSelectedSheetName,
} from './excelSheetGrid';
import { reconstructPdfTextLines } from './pdfTextLineReconstruction';

export interface BankReportProcessingResult {
  success: boolean;
  data?: BankReport;
  errors?: string[];
  warnings?: string[];
  sourceFile?: string;
  bankType?: string;
  confidence?: number;
  /** Feuille Excel effectivement traitée (sélection explicite ou feuille unique). */
  sheetName?: string;
}

export interface BankReportProcessingOptions {
  /** Nom de la feuille à traiter ; obligatoire si le classeur en contient plusieurs. */
  sheetName?: string;
}

class BankReportProcessingService {
  async processBankReportExcel(
    file: File,
    options: BankReportProcessingOptions = {},
  ): Promise<BankReportProcessingResult> {
    try {
      // Journal sans nom de fichier ni valeur (Pack 2 : aucune donnée réelle en console).
      console.log('🏦 DÉBUT TRAITEMENT RAPPORT BANCAIRE (NOUVELLE VERSION)');

      const isPdfFile = file.name.toLowerCase().endsWith('.pdf');
      const isExcelFile = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
      if (!isPdfFile && !isExcelFile) {
        return {
          success: false,
          errors: ['Format de fichier non supporté. Utilisez .pdf, .xlsx ou .xls']
        };
      }

      const buffer = await file.arrayBuffer();

      if (isExcelFile) {
        return this.processExcelWorkbook(file, buffer, options);
      }

      const textContent = await this.extractTextFromPDF(buffer);
      if (!textContent || textContent.length < 100) {
        return {
          success: false,
          errors: ['Contenu textuel insuffisant extrait du fichier']
        };
      }

      const identity = corroborateBankIdentity(file.name, textContent);
      if (!identity.corroborated || !identity.bank) {
        return {
          success: false,
          errors: [identity.error ?? 'Identité bancaire non corroborée.'],
        };
      }
      const bankType = identity.bank;

      console.log(`🏦 Type de banque corroboré: ${bankType}`);

      if (bankType === 'BDK') {
        const diagnosticResult = analyzeBDKBankStatementText(textContent);

        if (diagnosticResult.detectedFormat === 'bdk_account_statement') {
          return {
            success: false,
            errors: ['BDK account statements are not supported as BankReport documents.']
          };
        }
      }

      console.log(`📄 Contenu extrait: ${textContent.length} caractères`);

      // Extraction par sections avec regex
      const extractionResult = await bankReportSectionExtractor.extractBankReportSections(textContent, bankType);

      if (!extractionResult.success || !extractionResult.data) {
        return {
          success: false,
          errors: extractionResult.errors || ['Échec de l\'extraction par sections'],
          warnings: [`Type de banque: ${bankType}`]
        };
      }

      console.log(`✅ Rapport bancaire ${bankType} traité avec succès par sections`);

      return {
        success: true,
        data: extractionResult.data,
        sourceFile: file.name,
        bankType: bankType
      };

    } catch (error) {
      console.error('❌ ERREUR CRITIQUE TRAITEMENT RAPPORT BANCAIRE:', error);
      return {
        success: false,
        errors: [`Erreur critique: ${error instanceof Error ? error.message : 'Erreur inconnue'}`]
      };
    }
  }

  /**
   * Pack 2 : un classeur Excel est traité feuille par feuille, jamais par
   * concaténation. La banque attendue vient du nom de fichier ; l'extracteur
   * tabulaire vérifie l'émetteur dans l'en-tête de la feuille choisie.
   */
  private async processExcelWorkbook(
    file: File,
    buffer: ArrayBuffer,
    options: BankReportProcessingOptions,
  ): Promise<BankReportProcessingResult> {
    const bankType = detectBankFromFileName(file.name);
    if (!bankType) {
      return { success: false, errors: ['Banque absente ou ambiguë dans le nom du fichier.'] };
    }

    let sheetName: string;
    try {
      sheetName = resolveSelectedSheetName(listWorkbookSheetNames(buffer), options.sheetName);
    } catch (error) {
      if (error instanceof ExcelSheetSelectionError) {
        return { success: false, errors: [error.message], bankType };
      }
      throw error;
    }

    let grid;
    try {
      grid = readSelectedSheetGrid(buffer, sheetName);
    } catch (error) {
      if (error instanceof ExcelSheetSelectionError) {
        return { success: false, errors: [error.message], bankType, sheetName };
      }
      throw error;
    }

    const extraction = await extractBankReportFromGrid(grid, bankType, { fileName: file.name });
    if (!extraction.success || !extraction.data) {
      return {
        success: false,
        errors: extraction.errors ?? ['Échec de l’extraction tabulaire'],
        warnings: [`Type de banque: ${bankType}`, ...(extraction.warnings ?? [])],
        bankType,
        sheetName,
      };
    }

    console.log(`✅ Rapport bancaire ${bankType} traité avec succès (feuille sélectionnée)`);
    return {
      success: true,
      data: extraction.data,
      warnings: extraction.warnings,
      sourceFile: file.name,
      bankType,
      sheetName,
    };
  }

  private async extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
    try {
      // Import pdfjs-dist for browser-compatible PDF parsing
      const pdfjsLib = await import('pdfjs-dist');

      // Set worker source to local file
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdf = await loadingTask.promise;

      let fullText = '';

      // Extract text from each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = reconstructPdfTextLines(textContent.items);
        fullText += pageText + '\n';
      }

      console.log(`📄 PDF text extracted: ${fullText.length} characters`);
      return fullText;
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      throw new Error(`Extraction PDF refusée: ${error instanceof Error ? error.message : 'erreur inconnue'}`);
    }
  }

  async validateBankReport(bankReport: BankReport): Promise<string[]> {
    const warnings: string[] = [];

    // Vérifications de cohérence
    if (bankReport.openingBalance === 0 && bankReport.closingBalance === 0) {
      warnings.push('Les soldes d\'ouverture et de clôture sont à zéro');
    }

    if (bankReport.bankFacilities.length === 0) {
      warnings.push('Aucune facilité bancaire détectée');
    }

    // Vérifier la cohérence des facilités
    for (const facility of bankReport.bankFacilities) {
      if (facility.usedAmount > facility.limitAmount) {
        warnings.push(`Facilité ${facility.facilityType}: montant utilisé supérieur à la limite`);
      }

      const calculatedAvailable = facility.limitAmount - facility.usedAmount;
      if (Math.abs(facility.availableAmount - calculatedAvailable) > 1000) {
        warnings.push(`Facilité ${facility.facilityType}: incohérence dans le calcul du disponible`);
      }
    }

    // Vérifier les impayés
    for (const impaye of bankReport.impayes) {
      if (!impaye.clientCode || impaye.clientCode === 'UNKNOWN') {
        warnings.push('Impayé détecté sans code client valide');
      }

      if (impaye.montant <= 0) {
        warnings.push('Impayé avec montant invalide détecté');
      }
    }

    return warnings;
  }

  getBankReportSummary(bankReport: BankReport): string {
    const movement = bankReport.closingBalance - bankReport.openingBalance;
    const movementSign = movement >= 0 ? '+' : '';
    const facilitiesTotal = bankReport.bankFacilities.reduce((sum, f) => sum + f.limitAmount, 0);
    const impayesTotal = bankReport.impayes.reduce((sum, i) => sum + i.montant, 0);
    const depositsTotal = bankReport.depositsNotCleared.reduce((sum, d) => sum + d.montant, 0);
    const checksTotal = bankReport.checksNotCleared?.reduce((sum, c) => sum + c.montant, 0) || 0;

    return `${bankReport.bank}: Solde ${(bankReport.closingBalance / 1000000).toFixed(1)}M (${movementSign}${(movement / 1000000).toFixed(1)}M), ` +
           `Facilités ${(facilitiesTotal / 1000000000).toFixed(1)}Md, ` +
           `Dépôts en attente ${(depositsTotal / 1000000).toFixed(1)}M (${bankReport.depositsNotCleared.length}), ` +
           `Chèques en attente ${(checksTotal / 1000000).toFixed(1)}M (${bankReport.checksNotCleared?.length || 0}), ` +
           `Impayés ${(impayesTotal / 1000000).toFixed(1)}M (${bankReport.impayes.length})`;
  }
}

export const bankReportProcessingService = new BankReportProcessingService();
