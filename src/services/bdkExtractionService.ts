
// Service d'extraction spécialisé pour les relevés BDK
export interface BDKOpeningBalance {
  date: string;
  amount: number;
}

export interface BDKDeposit {
  dateOperation: string;
  dateValeur: string;
  description: string;
  vendor: string;
  client: string;
  amount: number;
}

export interface BDKCheck {
  date: string;
  checkNumber: string;
  description: string;
  client?: string;
  reference?: string;
  amount: number;
}

export interface BDKFacility {
  name: string;
  dateEcheance?: string;
  limit: number;
  used: number;
  balance: number;
}

export interface BDKImpaye {
  date: string;
  reference: string;
  type: string;
  bank: string;
  client: string;
  description: string;
  amount: number;
}

export interface BDKParsedData {
  accountNumber?: string;
  reportDate: string;
  openingBalance: BDKOpeningBalance;
  deposits: BDKDeposit[];
  totalDeposits: number;
  totalBalanceA: number;
  checks: BDKCheck[];
  totalChecks: number;
  closingBalance: number;
  facilities: BDKFacility[];
  totalFacilities: {
    totalLimit: number;
    totalUsed: number;
    totalBalance: number;
  };
  impayes: BDKImpaye[];
  validation: {
    calculatedClosing: number;
    isValid: boolean;
    discrepancy: number;
  };
}

export class BDKExtractionService {
  
  /**
   * Parse un montant avec espaces (format BDK: "78 615 440")
   */
  private parseAmount(amountStr: string | undefined): number {
    if (!amountStr) return 0;
    
    try {
      // Nettoyer : garder seulement chiffres et espaces, puis supprimer espaces
      const cleaned = amountStr
        .toString()
        .replace(/[^\d\s]/g, '') // Garder chiffres et espaces
        .replace(/\s+/g, ''); // Supprimer tous les espaces
      
      const result = parseInt(cleaned, 10) || 0;
      console.log(`💰 Montant parsé: "${amountStr}" -> ${result.toLocaleString()}`);
      return result;
    } catch (error) {
      console.error('❌ Erreur parsing montant:', amountStr, error);
      return 0;
    }
  }

  /**
   * Extrait le solde d'ouverture
   */
  private extractOpeningBalance(textContent: string): BDKOpeningBalance {
    console.log('🔍 Extraction solde d\'ouverture BDK...');
    
    // Pattern: OPENING BALANCE 24/06/2025   78 615 440
    const openingPattern = /OPENING\s+BALANCE\s+(\d{2}\/\d{2}\/\d{4})\s+([\d\s]+)/i;
    const match = textContent.match(openingPattern);
    
    if (match) {
      const result = {
        date: match[1],
        amount: this.parseAmount(match[2])
      };
      console.log(`✅ Solde d'ouverture: ${result.date} - ${result.amount.toLocaleString()} FCFA`);
      return result;
    }
    
    console.log('❌ Solde d\'ouverture non trouvé');
    return { date: '', amount: 0 };
  }

  /**
   * Extrait les dépôts non crédités avec tous les détails
   */
  private extractDeposits(textContent: string): { deposits: BDKDeposit[], total: number } {
    console.log('🔍 Extraction dépôts non crédités BDK...');
    
    const deposits: BDKDeposit[] = [];
    const lines = textContent.split('\n');
    
    let inDepositsSection = false;
    let totalDeposits = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Début de section
      if (line.match(/ADD\s*:\s*DEPOSIT\s+NOT\s+YET\s+CLEARED/i)) {
        inDepositsSection = true;
        console.log('✅ Section dépôts trouvée');
        continue;
      }
      
      // Fin de section
      if (inDepositsSection && line.match(/TOTAL\s+DEPOSIT\s+([\d\s]+)/i)) {
        const totalMatch = line.match(/TOTAL\s+DEPOSIT\s+([\d\s]+)/i);
        if (totalMatch) {
          totalDeposits = this.parseAmount(totalMatch[1]);
          console.log(`✅ Total dépôts: ${totalDeposits.toLocaleString()} FCFA`);
        }
        inDepositsSection = false;
        break;
      }
      
      // Parser les lignes de dépôts
      if (inDepositsSection && line.length > 20) {
        // Pattern: 19/06/2025   18/08/2025   REGLEMENT FACTURE   ECOBANK   UNITED SOLAR   3 000 000
        const depositPattern = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+([A-Z\s]+)\s+([A-Z\s]+)\s+([A-Z\s\&]+)\s+([\d\s]+)$/;
        const match = line.match(depositPattern);
        
        if (match) {
          const deposit: BDKDeposit = {
            dateOperation: match[1],
            dateValeur: match[2],
            description: match[3].trim(),
            vendor: match[4].trim(),
            client: match[5].trim(),
            amount: this.parseAmount(match[6])
          };
          
          deposits.push(deposit);
          console.log(`✅ Dépôt: ${deposit.client} - ${deposit.amount.toLocaleString()} FCFA`);
        }
      }
    }
    
    console.log(`✅ ${deposits.length} dépôts extraits, Total: ${totalDeposits.toLocaleString()} FCFA`);
    return { deposits, total: totalDeposits };
  }

  /**
   * Extrait les chèques non débités avec tous les détails
   */
  private extractChecks(textContent: string): { checks: BDKCheck[], total: number } {
    console.log('🔍 Extraction chèques non débités BDK...');
    
    const checks: BDKCheck[] = [];
    const lines = textContent.split('\n');
    
    let inChecksSection = false;
    let totalChecks = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Début de section
      if (line.match(/LESS\s*:\s*CHECK\s+Not\s+yet\s+cleared/i)) {
        inChecksSection = true;
        console.log('✅ Section chèques trouvée');
        continue;
      }
      
      // Fin de section
      if (inChecksSection && line.match(/TOTAL\s+\(B\)\s+([\d\s]+)/i)) {
        const totalMatch = line.match(/TOTAL\s+\(B\)\s+([\d\s]+)/i);
        if (totalMatch) {
          totalChecks = this.parseAmount(totalMatch[1]);
          console.log(`✅ Total chèques: ${totalChecks.toLocaleString()} FCFA`);
        }
        inChecksSection = false;
        break;
      }
      
      // Parser les lignes de chèques
      if (inChecksSection && line.length > 15) {
        // Pattern complexe pour différents formats de chèques
        // Format 1: 17/04/2018   0,0215634   CUSTOM TAX   CEDEAO   CDE
        // Format 2: 23/04/2025   876701   DEBARQUEMENT   CARGOTRANS   CASSIS   100129   798 990
        
        const checkPatterns = [
          // Format avec montant à la fin
          /(\d{2}\/\d{2}\/\d{4})\s+([\d,\.]+)\s+([A-Z\s\/]+?)\s+([A-Z\s]+?)\s+([A-Z\s]+?)\s+(\d+)\s+([\d\s]+)$/,
          // Format simple
          /(\d{2}\/\d{2}\/\d{4})\s+([\d,\.]+)\s+([A-Z\s\/]+?)\s+([A-Z\s]+?)(?:\s+([A-Z\s]+?))?\s+([\d\s]+)$/
        ];
        
        for (const pattern of checkPatterns) {
          const match = line.match(pattern);
          if (match) {
            const check: BDKCheck = {
              date: match[1],
              checkNumber: match[2],
              description: match[3].trim(),
              client: match[4]?.trim(),
              reference: match[6] || match[5],
              amount: this.parseAmount(match[7] || match[6])
            };
            
            // Vérifier que le montant est valide (> 1000 pour filtrer les erreurs)
            if (check.amount > 1000) {
              checks.push(check);
              console.log(`✅ Chèque: ${check.checkNumber} - ${check.amount.toLocaleString()} FCFA`);
            }
            break;
          }
        }
      }
    }
    
    console.log(`✅ ${checks.length} chèques extraits, Total: ${totalChecks.toLocaleString()} FCFA`);
    return { checks, total: totalChecks };
  }

  /**
   * Extrait le solde de clôture
   */
  private extractClosingBalance(textContent: string): number {
    console.log('🔍 Extraction solde de clôture BDK...');
    
    // Pattern: CLOSING BALANCE as per Book : C=(A-B)   37 927 595
    const closingPattern = /CLOSING\s+BALANCE\s+as\s+per\s+Book\s*:\s*C=\(A-B\)\s+([\d\s]+)/i;
    const match = textContent.match(closingPattern);
    
    if (match) {
      const amount = this.parseAmount(match[1]);
      console.log(`✅ Solde de clôture: ${amount.toLocaleString()} FCFA`);
      return amount;
    }
    
    console.log('❌ Solde de clôture non trouvé');
    return 0;
  }

  /**
   * Extrait les facilités bancaires
   */
  private extractFacilities(textContent: string): { facilities: BDKFacility[], totals: any } {
    console.log('🔍 Extraction facilités bancaires BDK...');
    
    const facilities: BDKFacility[] = [];
    const lines = textContent.split('\n');
    
    let inFacilitiesSection = false;
    let totalLimit = 0, totalUsed = 0, totalBalance = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Début de section
      if (line.match(/BANK\s+FACILITY/i) && line.includes('Limit') && line.includes('Used')) {
        inFacilitiesSection = true;
        console.log('✅ Section facilités trouvée');
        continue;
      }
      
      // Ligne de totaux
      if (inFacilitiesSection && line.match(/^[\d\s]+\s+[\d\s]+\s+[\d\s]+$/)) {
        const parts = line.split(/\s+/).filter(p => p.length > 0);
        if (parts.length === 3) {
          totalLimit = this.parseAmount(parts[0]);
          totalUsed = this.parseAmount(parts[1]);
          totalBalance = this.parseAmount(parts[2]);
          console.log(`✅ Totaux facilités: Limite ${totalLimit.toLocaleString()}, Utilisé ${totalUsed.toLocaleString()}`);
          break;
        }
      }
      
      // Parser les lignes de facilités
      if (inFacilitiesSection && line.length > 10) {
        // Pattern: 27/06/2025   SPN   25 000 000   12 901 283   12 098 717
        const facilityPattern = /(?:(\d{2}\/\d{2}\/\d{4})\s+)?([A-Z\s]+?)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)$/;
        const match = line.match(facilityPattern);
        
        if (match) {
          const facility: BDKFacility = {
            name: match[2].trim(),
            dateEcheance: match[1] || undefined,
            limit: this.parseAmount(match[3]),
            used: this.parseAmount(match[4]),
            balance: this.parseAmount(match[5])
          };
          
          if (facility.limit > 0 || facility.used > 0) {
            facilities.push(facility);
            console.log(`✅ Facilité: ${facility.name} - Limite ${facility.limit.toLocaleString()}`);
          }
        }
      }
    }
    
    console.log(`✅ ${facilities.length} facilités extraites`);
    return {
      facilities,
      totals: { totalLimit, totalUsed, totalBalance }
    };
  }

  /**
   * Extrait les impayés
   */
  private extractImpayes(textContent: string): BDKImpaye[] {
    console.log('🔍 Extraction impayés BDK...');
    
    const impayes: BDKImpaye[] = [];
    const lines = textContent.split('\n');
    
    let inImpayesSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Début de section
      if (line.match(/IMPAYE/i) && !line.match(/REGUL\s+IMPAYE/i)) {
        inImpayesSection = true;
        console.log('✅ Section impayés trouvée');
      }
      
      // Parser les lignes d'impayés
      if (inImpayesSection && line.length > 20) {
        // Pattern: 22/04/2025   3361178   IMPAYE   CORIS   CHAFIC AZAR & Cie   REGUL IMPAYE + FRAIS   2 000 000
        const impayePattern = /(\d{2}\/\d{2}\/\d{4})\s+([\d]+)\s+(IMPAYE)\s+([A-Z]+)\s+([A-Z\s&]+?)\s+([A-Z\s+]+?)\s+([\d\s]+)$/;
        const match = line.match(impayePattern);
        
        if (match) {
          const impaye: BDKImpaye = {
            date: match[1],
            reference: match[2],
            type: match[3],
            bank: match[4],
            client: match[5].trim(),
            description: match[6].trim(),
            amount: this.parseAmount(match[7])
          };
          
          impayes.push(impaye);
          console.log(`✅ Impayé: ${impaye.client} - ${impaye.amount.toLocaleString()} FCFA`);
        }
      }
    }
    
    console.log(`✅ ${impayes.length} impayés extraits`);
    return impayes;
  }

  /**
   * Fonction principale d'extraction et validation
   */
  public extractBDKData(textContent: string): BDKParsedData {
    console.log('🏦 Début extraction complète BDK');
    console.log(`📄 Taille du contenu: ${textContent.length} caractères`);
    
    try {
      // Extraire la date du rapport
      const dateMatch = textContent.match(/(\d{2}\/\d{2}\/\d{4})\s+BDK/);
      const reportDate = dateMatch?.[1] || new Date().toLocaleDateString('fr-FR');
      
      // Extraction de toutes les sections
      const openingBalance = this.extractOpeningBalance(textContent);
      const { deposits, total: totalDeposits } = this.extractDeposits(textContent);
      const { checks, total: totalChecks } = this.extractChecks(textContent);
      const closingBalance = this.extractClosingBalance(textContent);
      const { facilities, totals: totalFacilities } = this.extractFacilities(textContent);
      const impayes = this.extractImpayes(textContent);
      
      // Calcul du solde total A (Opening + Deposits)
      const totalBalanceA = openingBalance.amount + totalDeposits;
      
      // Validation mathématique
      const calculatedClosing = totalBalanceA - totalChecks;
      const isValid = Math.abs(calculatedClosing - closingBalance) < 1000; // Tolérance de 1000 FCFA
      const discrepancy = calculatedClosing - closingBalance;
      
      const result: BDKParsedData = {
        reportDate,
        openingBalance,
        deposits,
        totalDeposits,
        totalBalanceA,
        checks,
        totalChecks,
        closingBalance,
        facilities,
        totalFacilities,
        impayes,
        validation: {
          calculatedClosing,
          isValid,
          discrepancy
        }
      };
      
      console.log('✅ Extraction BDK terminée avec succès');
      console.log(`📊 Validation: ${isValid ? '✅ VALIDE' : '❌ ERREUR'} (Écart: ${discrepancy.toLocaleString()} FCFA)`);
      console.log(`📈 Résumé: ${deposits.length} dépôts, ${checks.length} chèques, ${facilities.length} facilités, ${impayes.length} impayés`);
      
      return result;
      
    } catch (error) {
      console.error('❌ Erreur lors de l\'extraction BDK:', error);
      throw error;
    }
  }
}

export const bdkExtractionService = new BDKExtractionService();
