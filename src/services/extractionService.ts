
import { BankReport, ExtractionResult, DepositNotCleared, BankFacility, Impaye } from '@/types/banking';

// Patterns améliorés et plus robustes
export const VALIDATED_PATTERNS = {
  // En-tête universel plus flexible
  header: /(?:BDK|SGS|SGBS|BICIS|ATLANTIQUE\s*BANK|ATB|BIS|ORABANK|ORA)\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/gi,
  
  // Soldes avec variations possibles
  opening_balance: /(?:OPENING\s*BALANCE|SOLDE\s*D[''`]?OUVERTURE|SOLDE\s*DEBUT)\s*(?:\d{2}[\/\-]\d{2}[\/\-]\d{4})?\s*([\d\s,\.]+)/gi,
  closing_balance: /(?:CLOSING\s*BALANCE|SOLDE\s*DE\s*CL[OÔ]TURE|SOLDE\s*FIN)\s*(?:\d{2}[\/\-]\d{2}[\/\-]\d{4})?\s*([\d\s,\.]+)/gi,
  
  // Montants génériques
  amount_pattern: /([\d\s,\.]+)/g,
  
  // Dépôts non crédités
  deposits_section: /(?:DEPOSIT\s*NOT\s*YET\s*CLEARED|D[EÉ]P[OÔ]TS?\s*(?:PAS\s*ENCORE\s*)?(?:ENCAISS[EÉ]S?|CR[EÉ]DIT[EÉ]S?))/gi,
  deposit_line: /(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s+(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s+(?:REGLEMENT|R[EÈ]GLEMENT|FACTURE|IMPAYE)\s+(\w+)\s+(\w+)\s*([\d\s,\.]+)/gi,
  
  // Facilités bancaires
  facility_section: /(?:BANK\s*FACILIT(?:Y|IES)|FACILIT[EÉ]S?\s*BANCAIRES?)/gi,
  facility_line: /([A-Z\s]+FACILIT[EÉY][\w\s]*)\s+([\d\s,\.]+)\s+([\d\s,\.]+)\s+([\d\s,\.]+)/gi,
  
  // Impayés
  impaye_section: /(?:IMPAY[EÉ]S?|UNPAID)/gi,
  impaye_line: /(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s*(?:(\d{2}[\/\-]\d{2}[\/\-]\d{4}))?\s*IMPAY[EÉ]\s+(\w+)\s+(.*?)\s+([\d\s,\.]+)/gi
};

// Fonction utilitaire améliorée pour nettoyer les montants
function cleanAmount(amountStr: string | undefined): number {
  if (!amountStr) {
    console.log('⚠️ Montant vide ou undefined');
    return 0;
  }
  
  try {
    // Nettoyer le string : supprimer espaces, virgules comme séparateurs de milliers
    const cleaned = amountStr
      .toString()
      .replace(/\s/g, '') // Supprimer tous les espaces
      .replace(/,/g, '') // Supprimer les virgules (séparateurs de milliers)
      .replace(/[^\d\.]/g, ''); // Garder seulement chiffres et points
    
    const result = parseInt(cleaned, 10) || 0;
    console.log(`💰 Montant nettoyé: "${amountStr}" -> ${result}`);
    return result;
  } catch (error) {
    console.error('❌ Erreur nettoyage montant:', amountStr, error);
    return 0;
  }
}

// Fonction utilitaire pour extraire la date
function extractDate(text: string): string {
  const headerMatch = text.match(VALIDATED_PATTERNS.header);
  if (headerMatch && headerMatch[1]) {
    const dateStr = headerMatch[1].replace(/[-]/g, '/');
    console.log(`📅 Date extraite: ${dateStr}`);
    return dateStr;
  }
  
  // Fallback sur la date actuelle
  const fallbackDate = new Date().toLocaleDateString('fr-FR');
  console.log(`📅 Date fallback utilisée: ${fallbackDate}`);
  return fallbackDate;
}

// Extraction améliorée du solde d'ouverture
function extractOpeningBalance(text: string): number {
  console.log('🔍 Recherche solde d\'ouverture...');
  
  const matches = Array.from(text.matchAll(VALIDATED_PATTERNS.opening_balance));
  
  for (const match of matches) {
    if (match[1]) {
      const amount = cleanAmount(match[1]);
      if (amount > 0) {
        console.log(`✅ Solde d'ouverture trouvé: ${amount}`);
        return amount;
      }
    }
  }
  
  // Recherche alternative avec pattern plus simple
  const simplePattern = /(?:OPENING|OUVERTURE)[\s\S]*?([\d\s,\.]{6,})/gi;
  const simpleMatch = text.match(simplePattern);
  if (simpleMatch) {
    const amounts = simpleMatch[0].match(/[\d\s,\.]{6,}/g);
    if (amounts && amounts[0]) {
      const amount = cleanAmount(amounts[0]);
      console.log(`✅ Solde d'ouverture trouvé (pattern simple): ${amount}`);
      return amount;
    }
  }
  
  console.log('⚠️ Aucun solde d\'ouverture trouvé');
  return 0;
}

// Extraction améliorée du solde de clôture
function extractClosingBalance(text: string): number {
  console.log('🔍 Recherche solde de clôture...');
  
  const matches = Array.from(text.matchAll(VALIDATED_PATTERNS.closing_balance));
  
  for (const match of matches) {
    if (match[1]) {
      const amount = cleanAmount(match[1]);
      if (amount > 0) {
        console.log(`✅ Solde de clôture trouvé: ${amount}`);
        return amount;
      }
    }
  }
  
  // Recherche alternative
  const simplePattern = /(?:CLOSING|CL[OÔ]TURE)[\s\S]*?([\d\s,\.]{6,})/gi;
  const simpleMatch = text.match(simplePattern);
  if (simpleMatch) {
    const amounts = simpleMatch[0].match(/[\d\s,\.]{6,}/g);
    if (amounts && amounts[0]) {
      const amount = cleanAmount(amounts[0]);
      console.log(`✅ Solde de clôture trouvé (pattern simple): ${amount}`);
      return amount;
    }
  }
  
  console.log('⚠️ Aucun solde de clôture trouvé');
  return 0;
}

// Extraction des dépôts non crédités
function extractDepositsNotCleared(text: string): DepositNotCleared[] {
  console.log('🔍 Recherche dépôts non crédités...');
  const deposits: DepositNotCleared[] = [];
  
  try {
    const sectionMatch = text.match(VALIDATED_PATTERNS.deposits_section);
    if (!sectionMatch) {
      console.log('⚠️ Section dépôts non trouvée');
      return deposits;
    }
    
    const matches = Array.from(text.matchAll(VALIDATED_PATTERNS.deposit_line));
    console.log(`📄 ${matches.length} lignes de dépôts trouvées`);
    
    for (const match of matches) {
      if (match[1] && match[2] && match[5]) {
        deposits.push({
          dateDepot: match[1],
          dateValeur: match[2],
          typeReglement: match[3] || 'REGLEMENT FACTURE',
          clientCode: match[4] || 'UNKNOWN',
          reference: match[4] || 'REF',
          montant: cleanAmount(match[5])
        });
      }
    }
    
    console.log(`✅ ${deposits.length} dépôts extraits`);
  } catch (error) {
    console.error('❌ Erreur extraction dépôts:', error);
  }
  
  return deposits;
}

// Extraction des facilités bancaires
function extractBankFacilities(text: string): BankFacility[] {
  console.log('🔍 Recherche facilités bancaires...');
  const facilities: BankFacility[] = [];
  
  try {
    const sectionMatch = text.match(VALIDATED_PATTERNS.facility_section);
    if (!sectionMatch) {
      console.log('⚠️ Section facilités non trouvée');
      return facilities;
    }
    
    const matches = Array.from(text.matchAll(VALIDATED_PATTERNS.facility_line));
    console.log(`💳 ${matches.length} lignes de facilités trouvées`);
    
    for (const match of matches) {
      if (match[1] && match[2] && match[3]) {
        const limitAmount = cleanAmount(match[2]);
        const usedAmount = cleanAmount(match[3]);
        const availableAmount = match[4] ? cleanAmount(match[4]) : (limitAmount - usedAmount);
        
        facilities.push({
          facilityType: match[1].trim(),
          limitAmount,
          usedAmount,
          availableAmount
        });
      }
    }
    
    console.log(`✅ ${facilities.length} facilités extraites`);
  } catch (error) {
    console.error('❌ Erreur extraction facilités:', error);
  }
  
  return facilities;
}

// Extraction des impayés
function extractImpayes(text: string): Impaye[] {
  console.log('🔍 Recherche impayés...');
  const impayes: Impaye[] = [];
  
  try {
    const sectionMatch = text.match(VALIDATED_PATTERNS.impaye_section);
    if (!sectionMatch) {
      console.log('⚠️ Section impayés non trouvée');
      return impayes;
    }
    
    const matches = Array.from(text.matchAll(VALIDATED_PATTERNS.impaye_line));
    console.log(`❌ ${matches.length} lignes d'impayés trouvées`);
    
    for (const match of matches) {
      if (match[1] && match[3] && match[5]) {
        impayes.push({
          dateEcheance: match[1],
          dateRetour: match[2] || undefined,
          clientCode: match[3],
          description: match[4]?.trim() || 'IMPAYE',
          montant: cleanAmount(match[5])
        });
      }
    }
    
    console.log(`✅ ${impayes.length} impayés extraits`);
  } catch (error) {
    console.error('❌ Erreur extraction impayés:', error);
  }
  
  return impayes;
}

// Fonction d'extraction universelle améliorée
export function extractBankReport(pdfText: string, bankName: string): ExtractionResult {
  try {
    console.log(`🏦 === EXTRACTION ${bankName} ===`);
    console.log(`📄 Taille du texte: ${pdfText.length} caractères`);
    console.log(`📄 Aperçu du contenu: ${pdfText.substring(0, 200)}...`);
    
    const report: BankReport = {
      bank: bankName,
      date: extractDate(pdfText),
      openingBalance: extractOpeningBalance(pdfText),
      closingBalance: extractClosingBalance(pdfText),
      depositsNotCleared: extractDepositsNotCleared(pdfText),
      bankFacilities: extractBankFacilities(pdfText),
      impayes: extractImpayes(pdfText)
    };
    
    console.log(`🏦 === RÉSUMÉ ${bankName} ===`);
    console.log(`📅 Date: ${report.date}`);
    console.log(`💰 Solde ouverture: ${report.openingBalance.toLocaleString()}`);
    console.log(`💰 Solde clôture: ${report.closingBalance.toLocaleString()}`);
    console.log(`📄 Dépôts: ${report.depositsNotCleared.length}`);
    console.log(`💳 Facilités: ${report.bankFacilities.length}`);
    console.log(`❌ Impayés: ${report.impayes.length}`);
    
    // Vérifier si on a au moins les soldes
    if (report.openingBalance === 0 && report.closingBalance === 0) {
      console.warn(`⚠️ ${bankName}: Aucun solde trouvé, extraction peut-être incomplète`);
      
      // Essayer d'extraire au moins quelques montants du texte
      const allNumbers = pdfText.match(/[\d\s,\.]{6,}/g);
      if (allNumbers && allNumbers.length >= 2) {
        report.openingBalance = cleanAmount(allNumbers[0]);
        report.closingBalance = cleanAmount(allNumbers[1]);
        console.log(`🔧 Fallback: soldes estimés - ouverture: ${report.openingBalance}, clôture: ${report.closingBalance}`);
      }
    }
    
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
