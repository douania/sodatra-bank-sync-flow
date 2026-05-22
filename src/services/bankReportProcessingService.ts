
import * as XLSX from 'xlsx';
import { BankReport } from '@/types/banking';
import { analyzeBDKBankStatementText } from './bdkBankStatementDiagnosticService';
import { bankReportSectionExtractor } from './bankReportSectionExtractor';

export interface BankReportProcessingResult {
  success: boolean;
  data?: BankReport;
  errors?: string[];
  warnings?: string[];
  sourceFile?: string;
  bankType?: string;
  confidence?: number;
}

class BankReportProcessingService {
  async processBankReportExcel(file: File): Promise<BankReportProcessingResult> {
    try {
      console.log('🏦 DÉBUT TRAITEMENT RAPPORT BANCAIRE (NOUVELLE VERSION):', file.name);
      
      const buffer = await file.arrayBuffer();
      let textContent = '';
      let bankType = '';

      // Détecter le type de banque depuis le nom de fichier
      bankType = this.detectBankTypeFromFilename(file.name);
      if (!bankType) {
        return {
          success: false,
          errors: ['Type de banque non détecté dans le nom de fichier']
        };
      }

      console.log(`🏦 Type de banque détecté: ${bankType}`);

      const isPdfFile = file.name.toLowerCase().endsWith('.pdf');

      // Extraction du contenu selon le type de fichier
      if (isPdfFile) {
        textContent = await this.extractTextFromPDF(buffer);
      } else if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        textContent = await this.extractTextFromExcel(buffer);
      } else {
        return {
          success: false,
          errors: ['Format de fichier non supporté. Utilisez .pdf, .xlsx ou .xls']
        };
      }

      if (!textContent || textContent.length < 100) {
        return {
          success: false,
          errors: ['Contenu textuel insuffisant extrait du fichier']
        };
      }

      if (isPdfFile && bankType === 'BDK') {
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
        bankType: bankType,
        confidence: 95 // Confiance élevée avec le nouveau système
      };
      
    } catch (error) {
      console.error('❌ ERREUR CRITIQUE TRAITEMENT RAPPORT BANCAIRE:', error);
      return {
        success: false,
        errors: [`Erreur critique: ${error instanceof Error ? error.message : 'Erreur inconnue'}`]
      };
    }
  }

  private detectBankTypeFromFilename(filename: string): string {
    const bankKeywords = {
      'BDK': ['BDK', 'BANQUE DE DAKAR'],
      'ATB': ['ATB', 'ARAB TUNISIAN', 'ATLANTIQUE'],
      'BICIS': ['BICIS', 'BIC'],
      'ORA': ['ORA', 'ORABANK'],
      'SGBS': ['SGBS', 'SOCIETE GENERALE', 'SG'],
      'BIS': ['BIS', 'BANQUE ISLAMIQUE']
    };
    
    const upperFilename = filename.toUpperCase();
    
    for (const [bankCode, keywords] of Object.entries(bankKeywords)) {
      if (keywords.some(keyword => upperFilename.includes(keyword))) {
        return bankCode;
      }
    }
    
    return '';
  }

  private async extractTextFromExcel(buffer: ArrayBuffer): Promise<string> {
    try {
      const workbook = XLSX.read(buffer, { type: 'array' });
      let allText = '';
      
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        
        for (const row of sheetData) {
          if (Array.isArray(row)) {
            allText += row.join(' ') + '\n';
          }
        }
      }
      
      return allText;
    } catch (error) {
      console.error('❌ Erreur extraction Excel:', error);
      return '';
    }
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
        const pageText = textContent.items
          .map((item: { str?: string }) => item.str ?? '')
          .join(' ');
        fullText += pageText + '\n';
      }
      
      console.log(`📄 PDF text extracted: ${fullText.length} characters`);
      return fullText;
    } catch (error) {
      console.error('❌ Erreur extraction PDF:', error);
      // Fallback: return empty string but log the error
      console.warn('⚠️ PDF extraction failed, returning empty content');
      return '';
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
