
import { BankReport, ExtractionResult, DepositNotCleared, BankFacility, Impaye } from '@/types/banking';

// Patterns validés selon le guide d'implémentation
export const VALIDATED_PATTERNS = {
  // En-tête universel
  header: /(?:BDK|SGS|SGBS|BICIS|ATLANTIQUE BANK|BIS|ORABANK)\s+(\d{2}\/\d{2}\/\d{4})/g,
  
  // Soldes (multilingue)
  opening_balance: /(?:OPENING BALANCE|SOLDE D'OUVERTURE)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d\s]+)/g,
  closing_balance: /(?:CLOSING BALANCE|SOLDE DE CLÔTURE).*?([\d\s]+)/g,
  
  // Dépôts non crédités
  deposits_section: /(?:DEPOSIT NOT YET CLEARED|Dépôts pas encore encaissé)/g,
  deposit_line: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(?:REGLEMENT FACTURE|REGUL IMPAYE)\s+(\w+)\s+(\w+)\s+(\d+)?\s+([\d\s]+)/g,
  
  // Facilités bancaires
  facility_section: /(?:BANK FACILITY|Facilités)/g,
  facility_line: /(\d{2}\/\d{2}\/\d{4})?\s*([A-Z\s]+)\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/g,
  
  // Impayés
  impaye_section: /(?:IMPAYE|Impayés)/g,
  impaye_line: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})?\s*IMPAYE\s+(\w+)\s+(.*?)\s+([\d\s]+)/g
};

// Fonction utilitaire pour nettoyer les montants
function cleanAmount(amountStr: string): number {
  return parseInt(amountStr.replace(/\s/g, ''), 10) || 0;
}

// Fonction utilitaire pour extraire la date
function extractDate(text: string): string {
  const headerMatch = text.match(VALIDATED_PATTERNS.header);
  if (headerMatch) {
    return headerMatch[1];
  }
  return new Date().toLocaleDateString('fr-FR');
}

// Extraction du solde d'ouverture
function extractOpeningBalance(text: string): number {
  const match = text.match(VALIDATED_PATTERNS.opening_balance);
  if (match) {
    return cleanAmount(match[2]);
  }
  return 0;
}

// Extraction du solde de clôture
function extractClosingBalance(text: string): number {
  const match = text.match(VALIDATED_PATTERNS.closing_balance);
  if (match) {
    return cleanAmount(match[1]);
  }
  return 0;
}

// Extraction des dépôts non crédités
function extractDepositsNotCleared(text: string): DepositNotCleared[] {
  const deposits: DepositNotCleared[] = [];
  
  // Vérifier si on est dans la section des dépôts
  const sectionMatch = text.match(VALIDATED_PATTERNS.deposits_section);
  if (!sectionMatch) return deposits;
  
  const matches = text.matchAll(VALIDATED_PATTERNS.deposit_line);
  for (const match of matches) {
    deposits.push({
      dateDepot: match[1],
      dateValeur: match[2],
      typeReglement: match[3] || 'REGLEMENT FACTURE',
      clientCode: match[4],
      reference: match[5],
      montant: cleanAmount(match[6])
    });
  }
  
  return deposits;
}

// Extraction des facilités bancaires
function extractBankFacilities(text: string): BankFacility[] {
  const facilities: BankFacility[] = [];
  
  const sectionMatch = text.match(VALIDATED_PATTERNS.facility_section);
  if (!sectionMatch) return facilities;
  
  const matches = text.matchAll(VALIDATED_PATTERNS.facility_line);
  for (const match of matches) {
    const limitAmount = cleanAmount(match[3]);
    const usedAmount = cleanAmount(match[4]);
    const availableAmount = cleanAmount(match[5]);
    
    facilities.push({
      facilityType: match[2].trim(),
      limitAmount,
      usedAmount,
      availableAmount: availableAmount || (limitAmount - usedAmount)
    });
  }
  
  return facilities;
}

// Extraction des impayés
function extractImpayes(text: string): Impaye[] {
  const impayes: Impaye[] = [];
  
  const sectionMatch = text.match(VALIDATED_PATTERNS.impaye_section);
  if (!sectionMatch) return impayes;
  
  const matches = text.matchAll(VALIDATED_PATTERNS.impaye_line);
  for (const match of matches) {
    impayes.push({
      dateEcheance: match[1],
      dateRetour: match[2] || undefined,
      clientCode: match[3],
      description: match[4]?.trim(),
      montant: cleanAmount(match[5])
    });
  }
  
  return impayes;
}

// Fonction d'extraction universelle selon le guide
export function extractBankReport(pdfText: string, bankName: string): ExtractionResult {
  try {
    console.log(`Extraction pour ${bankName} - Début du traitement`);
    
    const report: BankReport = {
      bank: bankName,
      date: extractDate(pdfText),
      openingBalance: extractOpeningBalance(pdfText),
      closingBalance: extractClosingBalance(pdfText),
      depositsNotCleared: extractDepositsNotCleared(pdfText),
      bankFacilities: extractBankFacilities(pdfText),
      impayes: extractImpayes(pdfText)
    };
    
    console.log(`Extraction pour ${bankName} - Terminée avec succès`);
    console.log(`Solde ouverture: ${report.openingBalance}, Solde clôture: ${report.closingBalance}`);
    console.log(`Dépôts non crédités: ${report.depositsNotCleared.length}`);
    console.log(`Facilités: ${report.bankFacilities.length}`);
    console.log(`Impayés: ${report.impayes.length}`);
    
    return {
      success: true,
      data: report
    };
  } catch (error) {
    console.error(`Erreur extraction ${bankName}:`, error);
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Erreur inconnue']
    };
  }
}

// Extraction spécialisée pour Fund Position
export function extractFundPosition(pdfText: string): ExtractionResult {
  try {
    const totalFundMatch = pdfText.match(/TOTAL FUND AVAILABLE.*?([\d\s]+)/i);
    const collectionsMatch = pdfText.match(/COLLECTIONS NOT DEPOSITED.*?([\d\s]+)/i);
    const grandTotalMatch = pdfText.match(/GRAND TOTAL.*?([\d\s]+)/i);
    
    const fundPosition = {
      reportDate: extractDate(pdfText),
      totalFundAvailable: totalFundMatch ? cleanAmount(totalFundMatch[1]) : 0,
      collectionsNotDeposited: collectionsMatch ? cleanAmount(collectionsMatch[1]) : 0,
      grandTotal: grandTotalMatch ? cleanAmount(grandTotalMatch[1]) : 0
    };
    
    console.log('Fund Position extraite:', fundPosition);
    
    return {
      success: true,
      data: fundPosition as any
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Erreur extraction Fund Position']
    };
  }
}

// Extraction pour Client Reconciliation
export function extractClientReconciliation(pdfText: string): ExtractionResult {
  try {
    const clients: any[] = [];
    const clientPattern = /([A-Z0-9_]+)\s+([A-Z\s]+)\s+([\d\s]+)/g;
    
    const matches = pdfText.matchAll(clientPattern);
    for (const match of matches) {
      if (cleanAmount(match[3]) > 0) {
        clients.push({
          reportDate: extractDate(pdfText),
          clientCode: match[1],
          clientName: match[2].trim(),
          impayesAmount: cleanAmount(match[3])
        });
      }
    }
    
    console.log(`Client Reconciliation: ${clients.length} clients avec impayés`);
    
    return {
      success: true,
      data: clients as any
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Erreur extraction Client Reconciliation']
    };
  }
}
