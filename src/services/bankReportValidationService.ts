import { BankReport } from '@/types/banking';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  calculatedValues: {
    expectedClosingBalance: number;
    totalDepositsNotCleared: number;
    totalChecksNotCleared: number;
    totalFacilitiesUsed: number;
    totalImpayes: number;
  };
}

class BankReportValidationService {
  validateBankReport(bankReport: BankReport): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      calculatedValues: {
        expectedClosingBalance: 0,
        totalDepositsNotCleared: 0,
        totalChecksNotCleared: 0,
        totalFacilitiesUsed: 0,
        totalImpayes: 0
      }
    };

    // Calcul des totaux
    result.calculatedValues.totalDepositsNotCleared = bankReport.depositsNotCleared
      .reduce((sum, deposit) => sum + deposit.montant, 0);
    
    result.calculatedValues.totalChecksNotCleared = (bankReport.checksNotCleared || [])
      .reduce((sum, check) => sum + check.montant, 0);
    
    result.calculatedValues.totalFacilitiesUsed = bankReport.bankFacilities
      .reduce((sum, facility) => sum + facility.usedAmount, 0);
    
    result.calculatedValues.totalImpayes = bankReport.impayes
      .reduce((sum, impaye) => sum + impaye.montant, 0);

    // Calcul du solde de clôture attendu
    // Note: Cette formule est simplifiée et peut nécessiter des ajustements selon la logique bancaire exacte
    result.calculatedValues.expectedClosingBalance = 
      bankReport.openingBalance + 
      result.calculatedValues.totalDepositsNotCleared - 
      result.calculatedValues.totalChecksNotCleared;

    // Vérifications
    const balanceDifference = Math.abs(
      bankReport.closingBalance - result.calculatedValues.expectedClosingBalance
    );

    // Tolérance plus élevée pour les écarts de solde (1% ou 10,000 FCFA)
    const toleranceAmount = Math.max(10000, bankReport.closingBalance * 0.01);
    
    if (balanceDifference > toleranceAmount) {
      result.warnings.push(
        `Possible incohérence dans le calcul du solde de clôture. ` +
        `Attendu: ${result.calculatedValues.expectedClosingBalance.toLocaleString()} FCFA, ` +
        `Obtenu: ${bankReport.closingBalance.toLocaleString()} FCFA, ` +
        `Différence: ${balanceDifference.toLocaleString()} FCFA`
      );
    }

    // Vérifications des facilités
    bankReport.bankFacilities.forEach((facility, index) => {
      const calculatedAvailable = facility.limitAmount - facility.usedAmount;
      if (Math.abs(facility.availableAmount - calculatedAvailable) > 1000) {
        result.warnings.push(
          `Facilité ${index + 1} (${facility.facilityType}): ` +
          `Montant disponible incohérent. ` +
          `Calculé: ${calculatedAvailable.toLocaleString()} FCFA, ` +
          `Reporté: ${facility.availableAmount.toLocaleString()} FCFA, ` +
          `Différence: ${Math.abs(facility.availableAmount - calculatedAvailable).toLocaleString()} FCFA`
        );
      }
    });

    // Vérification des montants négatifs
    if (bankReport.openingBalance < 0) {
      result.warnings.push(`Solde d'ouverture négatif: ${bankReport.openingBalance.toLocaleString()} FCFA`);
    }
    
    if (bankReport.closingBalance < 0) {
      result.warnings.push(`Solde de clôture négatif: ${bankReport.closingBalance.toLocaleString()} FCFA`);
    }

    // Vérification des dépôts non crédités
    if (bankReport.depositsNotCleared.length === 0) {
      result.warnings.push('Aucun dépôt non crédité trouvé');
    }

    // Vérification des facilités bancaires
    if (bankReport.bankFacilities.length === 0) {
      result.warnings.push('Aucune facilité bancaire trouvée');
    }

    // Vérification des impayés
    bankReport.impayes.forEach((impaye, index) => {
      if (!impaye.clientCode || impaye.clientCode === 'UNKNOWN') {
        result.warnings.push(`Impayé ${index + 1}: Code client manquant ou invalide`);
      }
      
      if (impaye.montant <= 0) {
        result.warnings.push(`Impayé ${index + 1}: Montant invalide (${impaye.montant.toLocaleString()} FCFA)`);
      }
    });

    // Résultat final
    result.isValid = result.errors.length === 0;
    
    return result;
  }

  async crossValidateWithStatements(
    bankReport: BankReport, 
    bankStatements: any[]
  ): Promise<ValidationResult> {
    // Logique de validation croisée avec les relevés bancaires
    // À implémenter selon les besoins spécifiques
    return {
      isValid: true,
      errors: [],
      warnings: [],
      calculatedValues: {
        expectedClosingBalance: 0,
        totalDepositsNotCleared: 0,
        totalChecksNotCleared: 0,
        totalFacilitiesUsed: 0,
        totalImpayes: 0
      }
    };
  }
}

export const bankReportValidationService = new BankReportValidationService();