
import * as XLSX from 'xlsx';
import { BankReport } from '@/types/banking';
import { bankReportDetectionService, BankReportDetectionResult } from './bankReportDetectionService';

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
      console.log('🏦 DÉBUT TRAITEMENT RAPPORT BANCAIRE:', file.name);
      
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      
      if (!workbook.SheetNames.length) {
        return {
          success: false,
          errors: ['Aucune feuille trouvée dans le fichier Excel']
        };
      }
      
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      console.log(`📊 Données brutes extraites: ${rawData.length} lignes`);
      
      if (rawData.length < 2) {
        return {
          success: false,
          errors: ['Le fichier doit contenir au moins un en-tête et une ligne de données']
        };
      }
      
      // Détecter le type de rapport bancaire
      const detectionResult: BankReportDetectionResult = await bankReportDetectionService.detectBankReportType(rawData, file.name);
      
      if (!detectionResult.success || !detectionResult.data) {
        return {
          success: false,
          errors: detectionResult.errors || ['Type de rapport bancaire non reconnu'],
          warnings: [`Confiance de détection: ${detectionResult.confidence || 0}%`]
        };
      }
      
      console.log(`✅ Rapport bancaire ${detectionResult.bankType} détecté avec confiance ${detectionResult.confidence}%`);
      
      return {
        success: true,
        data: detectionResult.data,
        sourceFile: file.name,
        bankType: detectionResult.bankType,
        confidence: detectionResult.confidence
      };
      
    } catch (error) {
      console.error('❌ ERREUR CRITIQUE TRAITEMENT RAPPORT BANCAIRE:', error);
      return {
        success: false,
        errors: [`Erreur critique: ${error instanceof Error ? error.message : 'Erreur inconnue'}`]
      };
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
    
    return `${bankReport.bank}: Solde ${(bankReport.closingBalance / 1000000).toFixed(1)}M (${movementSign}${(movement / 1000000).toFixed(1)}M), ` +
           `Facilités ${(facilitiesTotal / 1000000000).toFixed(1)}Md, ` +
           `Impayés ${(impayesTotal / 1000000).toFixed(1)}M (${bankReport.impayes.length})`;
  }
}

export const bankReportProcessingService = new BankReportProcessingService();
