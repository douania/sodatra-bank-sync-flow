
import { BankReport, BankFacility, Impaye, DepositNotCleared, CheckNotCleared } from '@/types/banking';

export interface SectionExtractionResult {
  success: boolean;
  data?: any;
  errors?: string[];
}

export interface BankSectionConfig {
  bankName: string;
  patterns: {
    openingBalance: RegExp;         // Pattern to find opening balance
    closingBalance: RegExp;         // Pattern to find closing balance
    depositsSection: RegExp;        // Pattern to identify deposits section
    depositLine: RegExp;            // Pattern to extract individual deposit lines
    depositsTotal?: RegExp;         // Pattern to extract total deposits (for ATB)
    checksSection: RegExp;          // Pattern to identify checks section
    checkLine: RegExp;              // Pattern to extract individual check lines
    checksTotal?: RegExp;           // Pattern to extract total checks (for ATB)
    facilitiesSection: RegExp;      // Pattern to identify facilities section
    facilityLine: RegExp;           // Pattern to extract individual facility lines
    impayesSection: RegExp;         // Pattern to identify impayes section
    impayeLine: RegExp;             // Pattern to extract individual impaye lines
  };
}

class BankReportSectionExtractor {
  private bankConfigs: BankSectionConfig[] = [
    {
      bankName: 'BDK',
      patterns: {
        openingBalance: /OPENING\s+BALANCE\s+\d{2}\/\d{2}\/\d{4}\s+([\d\s]+)/i,
        closingBalance: /CLOSING\s+BALANCE\s+as\s+per\s+Book\s*:\s*C=\(A-B\)\s+([\d\s]+)/i,
        depositsSection: /DEPOSIT\s+NOT\s+YET\s+CLEARED/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(REGUL\s+IMPAYE|REGLEMENT\s+FACTURE|TR\s+No\/FACT\.No)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHECK\s+Not\s+yet\s+cleared/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /BANK\s+FACILITY/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /IMPAYE/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+IMPAYE\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'ATB',
      patterns: {
        openingBalance: /OPENING\s+BALANCE\s+\d{2}\/\d{2}\/\d{4}\s+([\d\s]+)/i,
        closingBalance: /CLOSING\s+BALANCE\s+as\s+per\s+Book\s*:\s*C=\(A-B\)\s+([\d\s]+)/i,
        depositsSection: /DEPOSIT\s+NOT\s+YET\s+CLEARED/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHECK\s+Not\s+yet\s+cleared/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /BANK\s+FACILITY/i,
        facilityLine: /(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/g,
        impayesSection: /IMPAYE/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+IMPAYE\s+(.*?)\s+(.*?)\s+([\d\s]+)/g
      }
    },
    {
      bankName: 'BICIS',
      patterns: {
        openingBalance: /SOLDE\s+INITIAL\s+\d{2}\/\d{2}\/\d{4}\s+([\d\s]+)/i,
        closingBalance: /SOLDE\s+FINAL\s+COMPTABLE\s*:\s*([\d\s]+)/i,
        depositsSection: /DEPOTS\s+EN\s+ATTENTE/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHEQUES\s+EN\s+CIRCULATION/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /LIGNES\s+DE\s+CREDIT/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /INCIDENTS\s+DE\s+PAIEMENT/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+IMPAYE\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'ORA',
      patterns: {
        openingBalance: /BALANCE\s+OPENING\s+\d{2}\/\d{2}\/\d{4}\s+([\d\s]+)/i,
        closingBalance: /BALANCE\s+CLOSING\s+BOOK\s*:\s*([\d\s]+)/i,
        depositsSection: /DEPOSITS\s+NOT\s+CLEARED/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHECKS\s+NOT\s+CLEARED/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /CREDIT\s+FACILITIES/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /UNPAID\s+ITEMS/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})?\s*UNPAID\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'SGBS',
      patterns: {
        openingBalance: /SOLDE\s+OUVERTURE\s+\d{2}\/\d{2}\/\d{4}\s+([\d\s]+)/i,
        closingBalance: /SOLDE\s+FERMETURE\s+LIVRE\s*:\s*([\d\s]+)/i,
        depositsSection: /DEPOTS\s+NON\s+CREDITES/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHEQUES\s+NON\s+DEBITES/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /FACILITES\s+BANCAIRES/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /IMPAYES\s+NON\s+REGULARISES/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})?\s*IMPAYE\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    },
    {
      bankName: 'BIS',
      patterns: {
        openingBalance: /OPENING\s+BALANCE\s+\d{2}\/\d{2}\/\d{4}\s+([\d\s]+)/i,
        closingBalance: /CLOSING\s+BALANCE\s+BOOK\s*:\s*([\d\s]+)/i,
        depositsSection: /DEPOSITS\s+NOT\s+CLEARED/i,
        depositLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        checksSection: /CHECKS\s+NOT\s+CLEARED/i,
        checkLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/i,
        facilitiesSection: /FINANCING\s+FACILITIES/i,
        facilityLine: /(.*?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/,
        impayesSection: /DEFAULTED\s+ITEMS/i,
        impayeLine: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})?\s*DEFAULT\s+(\S+)\s+(.*?)\s+([\d\s]+)/i
      }
    }
  ];

  async extractBankReportSections(textContent: string, bankName: string): Promise<SectionExtractionResult> {
    console.log(`🔍 Extraction par sections pour ${bankName}...`);
    
    const config = this.bankConfigs.find(c => c.bankName === bankName);
    if (!config) {
      return {
        success: false,
        errors: [`Configuration non trouvée pour la banque ${bankName}`]
      };
    }

    try {
      const bankReport: BankReport = {
        bank: bankName,
        date: new Date().toISOString().split('T')[0],
        openingBalance: 0,
        closingBalance: 0,
        bankFacilities: [],
        depositsNotCleared: [],
        checksNotCleared: [],
        impayes: []
      };

      // Extraction des soldes
      const openingMatch = textContent.match(config.patterns.openingBalance);
      if (openingMatch) {
        bankReport.openingBalance = this.parseAmount(openingMatch[1]);
        console.log(`📊 Solde ouverture: ${bankReport.openingBalance}`);
      }

      const closingMatch = textContent.match(config.patterns.closingBalance);
      if (closingMatch) {
        bankReport.closingBalance = this.parseAmount(closingMatch[1]);
        console.log(`📊 Solde clôture: ${bankReport.closingBalance}`);
      }

      // Extraction des dépôts non crédités
      bankReport.depositsNotCleared = this.extractDepositsNotCleared(textContent, config);
      console.log(`💰 Dépôts non crédités: ${bankReport.depositsNotCleared.length}`);

      // Extraction des chèques non débités
      bankReport.checksNotCleared = this.extractChecksNotCleared(textContent, config);
      console.log(`📝 Chèques non débités: ${bankReport.checksNotCleared?.length || 0}`);

      // Extraction des facilités bancaires
      bankReport.bankFacilities = this.extractBankFacilities(textContent, config);
      console.log(`🏦 Facilités bancaires: ${bankReport.bankFacilities.length}`);

      // Extraction des impayés
      bankReport.impayes = this.extractImpayes(textContent, config);
      console.log(`❌ Impayés: ${bankReport.impayes.length}`);

      return {
        success: true,
        data: bankReport
      };

    } catch (error) {
      console.error(`❌ Erreur extraction ${bankName}:`, error);
      return {
        success: false,
        errors: [`Erreur extraction: ${error instanceof Error ? error.message : 'Erreur inconnue'}`]
      };
    }
  }

  private extractDepositsNotCleared(textContent: string, config: BankSectionConfig): DepositNotCleared[] {
    const deposits: DepositNotCleared[] = [];
    const lines = textContent.split('\n');
    let inDepositsSection = false;
    
    console.log(`🔍 Extraction des dépôts non crédités pour ${config.bankName}...`);

    for (const line of lines) {
      if (config.patterns.depositsSection.test(line)) {
        inDepositsSection = true;
        console.log(`✅ Section des dépôts trouvée: "${line.trim()}"`);
        continue;
      }

      if (inDepositsSection && line.trim()) {
        const match = line.match(config.patterns.depositLine);
        if (match) {
          console.log(`✅ Ligne de dépôt trouvée: "${line.trim()}"`);
          deposits.push({
            dateDepot: this.parseDate(match[1]),
            reference: match[3] || '',
            clientCode: match[4] || '',
            typeReglement: match[3] || 'DEPOT',
            montant: this.parseAmount(match[5])
          });
        } else if (line.match(/^[A-Z\s]+:/) || line.match(/TOTAL|SOUS-TOTAL/i)) {
          inDepositsSection = false;
        }
      }
    }

    // Si aucun dépôt détaillé n'a été trouvé mais que la section existe,
    // essayer d'extraire le montant total des dépôts (cas ATB)
    if (deposits.length === 0 && config.patterns.depositsTotal) {
      console.log(`🔍 Aucun dépôt détaillé trouvé, recherche du total...`);
      const totalMatch = textContent.match(config.patterns.depositsTotal);
      if (totalMatch) {
        const totalAmount = this.parseAmount(totalMatch[1]);
        console.log(`✅ Total des dépôts trouvé: ${totalAmount}`);
        
        if (totalAmount > 0) {
          deposits.push({
            dateDepot: new Date().toISOString().split('T')[0], // Date actuelle par défaut
            reference: 'TOTAL_DEPOSITS',
            clientCode: 'VARIOUS',
            typeReglement: 'TOTAL',
            montant: totalAmount
          });
        }
      }
    }

    console.log(`📊 ${deposits.length} dépôts extraits`);
    return deposits;
  }

  private extractChecksNotCleared(textContent: string, config: BankSectionConfig): CheckNotCleared[] {
    const checks: CheckNotCleared[] = [];
    const lines = textContent.split('\n');
    let inChecksSection = false;
    
    console.log(`🔍 Extraction des chèques non débités pour ${config.bankName}...`);

    for (const line of lines) {
      if (config.patterns.checksSection.test(line)) {
        inChecksSection = true;
        console.log(`✅ Section des chèques trouvée: "${line.trim()}"`);
        continue;
      }

      if (inChecksSection && line.trim()) {
        const match = line.match(config.patterns.checkLine);
        if (match) {
          console.log(`✅ Ligne de chèque trouvée: "${line.trim()}"`);
          checks.push({
            dateEmission: this.parseDate(match[1]),
            numeroCheque: match[2] || '',
            beneficiaire: match[3] || '',
            montant: this.parseAmount(match[4])
          });
        } else if (line.match(/^[A-Z\s]+:/) || line.match(/TOTAL|SOUS-TOTAL/i)) {
          inChecksSection = false;
        }
      }
    }

    // Si aucun chèque détaillé n'a été trouvé mais que la section existe,
    // essayer d'extraire le montant total des chèques (cas ATB)
    if (checks.length === 0 && config.patterns.checksTotal) {
      console.log(`🔍 Aucun chèque détaillé trouvé, recherche du total...`);
      const totalMatch = textContent.match(config.patterns.checksTotal);
      if (totalMatch) {
        const totalAmount = this.parseAmount(totalMatch[1]);
        console.log(`✅ Total des chèques trouvé: ${totalAmount}`);
        
        if (totalAmount > 0) {
          checks.push({
            dateEmission: new Date().toISOString().split('T')[0], // Date actuelle par défaut
            numeroCheque: 'TOTAL_CHECKS',
            beneficiaire: 'VARIOUS',
            montant: totalAmount
          });
        }
      }
    }

    console.log(`📊 ${checks.length} chèques extraits`);
    return checks;
  }

  private extractBankFacilities(textContent: string, config: BankSectionConfig): BankFacility[] {
    const facilities: BankFacility[] = [];
    const lines = textContent.split('\n');
    let inFacilitiesSection = false;
    
    console.log(`🔍 Extraction des facilités bancaires pour ${config.bankName}...`);

    for (const line of lines) {
      if (config.patterns.facilitiesSection.test(line)) {
        inFacilitiesSection = true;
        console.log(`✅ Section des facilités trouvée: "${line.trim()}"`);
        continue;
      }

      if (inFacilitiesSection && line.trim()) {
        // Use the global regex to find all matches in the line
        const matches = Array.from(line.matchAll(config.patterns.facilityLine));
        const match = matches.length > 0 ? matches[0] : null;
        
        if (match) {
          console.log(`✅ Ligne de facilité trouvée: "${line.trim()}"`);
          
          let limitAmount = 0;
          let usedAmount = 0;
          let availableAmount = 0;
          
          // Check if we have a date in the first capture group (new ATB pattern)
          if (match[1] && match[1].match(/\d{2}\/\d{2}\/\d{4}/)) {
            // New ATB pattern with date: date, type, limit, used, available
            limitAmount = this.parseAmount(match[3]);
            usedAmount = this.parseAmount(match[4]);
            availableAmount = this.parseAmount(match[5]);
          } else {
            // Format standard pour les autres banques
            limitAmount = this.parseAmount(match[2] || '0');
            usedAmount = this.parseAmount(match[3] || '0');
            availableAmount = this.parseAmount(match[4] || '0');
          }

          if (limitAmount > 0) {
            facilities.push({
              facilityType: match[1].match(/\d{2}\/\d{2}\/\d{4}/) ? match[2].trim() : match[1].trim(),
              limitAmount,
              usedAmount,
              availableAmount
            });
          }
        } else if (line.match(/^[A-Z\s]+:/) || line.match(/TOTAL|SOUS-TOTAL/i)) {
          inFacilitiesSection = false;
        }
      }
    }

    return facilities;
  }

  // Méthode pour convertir "500M" en 500000000
  private parseMillionAmount(value: string): number {
    if (!value) return 0;
    
    try {
      // Extraire le nombre avant le "M"
      const match = value.match(/(\d+)M/i);
      if (match && match[1]) {
        const millions = parseInt(match[1], 10);
        return millions * 1000000; // Convertir en unités
      }
      
      return this.parseAmount(value);
    } catch (error) {
      console.error('❌ Erreur parsing montant en millions:', error);
      return 0;
    }
  }

  private extractImpayes(textContent: string, config: BankSectionConfig): Impaye[] {
    const impayes: Impaye[] = [];
    const lines = textContent.split('\n');
    let inImpayesSection = false;
    
    console.log('🔍 Recherche des impayés dans le texte...');

    for (const line of lines) {
      if (config.patterns.impayesSection.test(line)) {
        inImpayesSection = true;
        console.log(`✅ Section des impayés trouvée: "${line.trim()}"`);
        continue;
      }

      if (inImpayesSection && line.trim()) {
        // Use the global regex to find all matches in the line
        const matches = Array.from(line.matchAll(config.patterns.impayeLine));
        const match = matches.length > 0 ? matches[0] : null;
        
        if (match) {
          console.log(`✅ Ligne d'impayé trouvée: "${line.trim()}"`);
          
          let clientCode = 'UNKNOWN';
          let description = 'IMPAYE';
          
          // Check if we have all the expected capture groups
          if (match.length >= 6) {
            clientCode = match[3]?.trim() || 'UNKNOWN';
            description = match[4]?.trim() || 'IMPAYE';
          }
          
          console.log(`✅ Impayé trouvé: Client ${clientCode}, Description: ${description}`);
          
          impayes.push({
            dateRetour: this.parseDate(match[1]),
            dateEcheance: this.parseDate(match[2]),
            clientCode: clientCode,
            description: description,
            montant: this.parseAmount(match[5])
          });
        } else if (line.match(/^[A-Z\s]+:/) || line.match(/TOTAL|SOUS-TOTAL/i)) {
          inImpayesSection = false;
        }
      }
    }

    return impayes;
  }

  private parseAmount(value: string): number {
    if (!value) return 0;
    return parseInt(value.replace(/\s/g, ''), 10) || 0;
  }

  private parseDate(value: string): string {
    if (!value) return new Date().toISOString().split('T')[0];
    
    try {
      const parts = value.split('/');
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fallback à la date actuelle
    }
    
    return new Date().toISOString().split('T')[0];
  }
}

export const bankReportSectionExtractor = new BankReportSectionExtractor();