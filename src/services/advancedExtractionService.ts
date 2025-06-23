
import { BankReport, ExtractionResult, DepositNotCleared, BankFacility, Impaye, CheckNotCleared } from '@/types/banking';

// Patterns multilingues validés pour les 6 banques
export const MULTI_BANK_PATTERNS = {
  // En-tête universel (6 banques)
  header: /(?:BDK|SGS|SGBS|BICIS|ATB|ATLANTIQUE BANK|BIS|ORABANK)\s+(\d{2}\/\d{2}\/\d{4})/g,
  
  // Soldes (français/anglais)
  opening_balance: /(?:OPENING BALANCE|SOLDE D'OUVERTURE)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d\s]+)/g,
  closing_balance: /(?:CLOSING BALANCE|SOLDE DE CLÔTURE).*?([\d\s]+)/g,
  
  // Dépôts non crédités (multilingue)
  deposits_section: /(?:DEPOSIT NOT YET CLEARED|Dépôts pas encore encaissé)/gi,
  deposit_line: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(?:REGLEMENT FACTURE|REGUL IMPAYE|PAYMENT)\s+(\w+)\s+(\w+)\s*(\d+)?\s+([\d\s]+)/g,
  
  // Chèques non débités (NOUVEAU - manquait)
  checks_section: /(?:CHECK Not yet cleared|Chèques émis non encaissés)/gi,
  check_line: /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.*?)\s+([\d\s]+)/g,
  
  // Facilités bancaires
  facility_section: /(?:BANK FACILITY|Facilités)/gi,
  facility_line: /(\d{2}\/\d{2}\/\d{4})?\s*([A-Z\s]+[A-Z])\s+([\d\s]+)\s+([\d\s]+)\s+([\d\s]+)/g,
  
  // Impayés
  impaye_section: /(?:IMPAYE|Impayés|BOUNCED)/gi,
  impaye_line: /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})?\s*(?:IMPAYE|BOUNCED)\s+(\w+)\s+(.*?)\s+([\d\s]+)/g
};

// Configuration spécifique par banque
export const BANK_CONFIGS = {
  BDK: { 
    language: 'mixed', 
    hasDetailedFacilities: true, 
    hasFactureNumbers: true 
  },
  SGS: { 
    language: 'english', 
    hasBillsOfExchange: true, 
    crossBankImpayes: true 
  },
  BICIS: { 
    language: 'mixed', 
    hasLargeDeposits: true, 
    crossBankReferences: true 
  },
  ATB: { 
    language: 'english', 
    hasMultipleFacilities: true, 
    hasCheckReferences: true 
  },
  BIS: { 
    language: 'mixed', 
    hasMassiveFacilities: true, 
    lowUtilization: true 
  },
  ORA: { 
    language: 'french', 
    frenchTerminology: true, 
    lowUtilization: true 
  }
};

// Fonction utilitaire pour nettoyer les montants
function cleanAmount(amountStr: string): number {
  if (!amountStr) return 0;
  return parseInt(amountStr.replace(/[\s,]/g, ''), 10) || 0;
}

// Détection automatique de la langue
function detectLanguage(text: string): 'french' | 'english' | 'mixed' {
  const frenchKeywords = text.match(/(?:SOLDE|Dépôts|Facilités|Impayés)/gi);
  const englishKeywords = text.match(/(?:OPENING|CLOSING|DEPOSIT|FACILITY|IMPAYE)/gi);
  
  if (frenchKeywords && englishKeywords) return 'mixed';
  if (frenchKeywords) return 'french';
  return 'english';
}

// Extraction des chèques non débités (NOUVEAU)
function extractChecksNotCleared(text: string): CheckNotCleared[] {
  const checks: CheckNotCleared[] = [];
  
  const sectionMatch = text.match(MULTI_BANK_PATTERNS.checks_section);
  if (!sectionMatch) return checks;
  
  const matches = text.matchAll(MULTI_BANK_PATTERNS.check_line);
  for (const match of matches) {
    checks.push({
      dateEmission: match[1],
      numeroCheque: match[2],
      beneficiaire: match[3]?.trim(),
      montant: cleanAmount(match[4])
    });
  }
  
  return checks;
}

// Extraction améliorée des dépôts
function extractDepositsNotCleared(text: string): DepositNotCleared[] {
  const deposits: DepositNotCleared[] = [];
  
  const sectionMatch = text.match(MULTI_BANK_PATTERNS.deposits_section);
  if (!sectionMatch) return deposits;
  
  const matches = text.matchAll(MULTI_BANK_PATTERNS.deposit_line);
  for (const match of matches) {
    deposits.push({
      dateDepot: match[1],
      dateValeur: match[2],
      typeReglement: match[3] || 'REGLEMENT FACTURE',
      clientCode: match[4],
      reference: match[5] || undefined,
      montant: cleanAmount(match[6])
    });
  }
  
  return deposits;
}

// Extraction améliorée des facilités
function extractBankFacilities(text: string): BankFacility[] {
  const facilities: BankFacility[] = [];
  
  const sectionMatch = text.match(MULTI_BANK_PATTERNS.facility_section);
  if (!sectionMatch) return facilities;
  
  const matches = text.matchAll(MULTI_BANK_PATTERNS.facility_line);
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

// Extraction améliorée des impayés
function extractImpayes(text: string): Impaye[] {
  const impayes: Impaye[] = [];
  
  const sectionMatch = text.match(MULTI_BANK_PATTERNS.impaye_section);
  if (!sectionMatch) return impayes;
  
  const matches = text.matchAll(MULTI_BANK_PATTERNS.impaye_line);
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

// Extraction des soldes améliorée
function extractOpeningBalance(text: string): number {
  const match = text.match(MULTI_BANK_PATTERNS.opening_balance);
  if (match) {
    return cleanAmount(match[2]);
  }
  return 0;
}

function extractClosingBalance(text: string): number {
  const match = text.match(MULTI_BANK_PATTERNS.closing_balance);
  if (match) {
    return cleanAmount(match[1]);
  }
  return 0;
}

function extractDate(text: string): string {
  const headerMatch = text.match(MULTI_BANK_PATTERNS.header);
  if (headerMatch) {
    return headerMatch[1];
  }
  return new Date().toLocaleDateString('fr-FR');
}

// Fonction d'extraction universelle améliorée
export function extractAdvancedBankReport(pdfText: string, bankName: string): ExtractionResult {
  try {
    console.log(`🏦 Extraction avancée pour ${bankName} - Début`);
    
    // Détection automatique de la langue
    const language = detectLanguage(pdfText);
    console.log(`🌐 Langue détectée: ${language}`);
    
    const report: BankReport = {
      bank: bankName,
      date: extractDate(pdfText),
      openingBalance: extractOpeningBalance(pdfText),
      closingBalance: extractClosingBalance(pdfText),
      depositsNotCleared: extractDepositsNotCleared(pdfText),
      checksNotCleared: extractChecksNotCleared(pdfText), // NOUVEAU
      bankFacilities: extractBankFacilities(pdfText),
      impayes: extractImpayes(pdfText)
    };
    
    console.log(`✅ Extraction ${bankName} terminée:`);
    console.log(`- Soldes: ${report.openingBalance} → ${report.closingBalance}`);
    console.log(`- Dépôts: ${report.depositsNotCleared.length}`);
    console.log(`- Chèques: ${report.checksNotCleared?.length || 0}`);
    console.log(`- Facilités: ${report.bankFacilities.length}`);
    console.log(`- Impayés: ${report.impayes.length}`);
    
    return {
      success: true,
      data: report
    };
  } catch (error) {
    console.error(`❌ Erreur extraction ${bankName}:`, error);
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Erreur inconnue']
    };
  }
}
