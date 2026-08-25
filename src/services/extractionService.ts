import { BankReport, ExtractionResult, DepositNotCleared, BankFacility, Impaye, FundPositionDetail, FundPositionHold } from '@/types/banking';
import { parseDocumentDate, parseFinancialInteger } from './bankReportExtractionContract';
import { validateFundPositionExtraction } from './fundPositionExtractionContract';

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

// Fonction utilitaire pour convertir les dates françaises en format ISO
function convertToISODate(dateStr: string): string {
  if (!dateStr) {
    return new Date().toISOString().split('T')[0];
  }
  
  try {
    // Nettoyer la chaîne de date
    const cleanDate = dateStr.replace(/\s/g, '').trim();
    
    // Détecter le format DD/MM/YYYY ou DD-MM-YYYY
    const frenchDateMatch = cleanDate.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (frenchDateMatch) {
      const [, day, month, year] = frenchDateMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // Si déjà au format YYYY-MM-DD
    const isoDateMatch = cleanDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateMatch) {
      return cleanDate;
    }
    
    // Fallback sur la date actuelle
    console.log(`⚠️ Format de date non reconnu: ${dateStr}, utilisation de la date actuelle`);
    return new Date().toISOString().split('T')[0];
  } catch (error) {
    console.error('❌ Erreur conversion date:', dateStr, error);
    return new Date().toISOString().split('T')[0];
  }
}

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
    
    // Éviter la notation scientifique en utilisant parseFloat puis Math.floor
    const floatValue = parseFloat(cleaned) || 0;
    // Vérifier si le nombre est trop grand pour être un entier sûr
    if (floatValue > Number.MAX_SAFE_INTEGER) {
      console.warn(`⚠️ Montant très élevé détecté: ${floatValue}, limitation à MAX_SAFE_INTEGER`);
      return Number.MAX_SAFE_INTEGER;
    }
    const result = Math.floor(floatValue);
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
    const dateStr = headerMatch[1];
    const isoDate = convertToISODate(dateStr);
    console.log(`📅 Date extraite et convertie: ${dateStr} -> ${isoDate}`);
    return isoDate;
  }
  
  // Fallback sur la date actuelle au format ISO
  const fallbackDate = new Date().toISOString().split('T')[0];
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
          dateDepot: convertToISODate(match[1]),
          dateValeur: convertToISODate(match[2]),
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
          dateEcheance: convertToISODate(match[1]),
          dateRetour: match[2] ? convertToISODate(match[2]) : undefined,
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
  void pdfText;
  void bankName;
  return {
    success: false,
    errors: ['Ce point d’entrée legacy permissif est désactivé ; utiliser bankReportSectionExtractor.'],
  };
}

// Extraction spécialisée pour Fund Position
export function extractFundPosition(pdfText: string): ExtractionResult {
  try {
    console.log('💰 Extraction détaillée du Fund Position...');

    const reportDateMatch = pdfText.match(
      /(?:FUND\s+POSITION|BOOK\s+BALANCE|REPORT\s+DATE)[^\r\n]{0,80}?(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i,
    );
    const reportDate = parseDocumentDate(reportDateMatch?.[1]);

    // Extraction des totaux principaux
    const totalFundMatch = pdfText.match(/TOTAL[ \t]+FUND[ \t]+AVAILABLE[ \t:]*([+-]?\d[\d \u00a0\u202f,.]*)/i);
    const collectionsMatch = pdfText.match(/COLLECTIONS[ \t]+NOT[ \t]+DEPOSITED[ \t:]*([+-]?\d[\d \u00a0\u202f,.]*)/i);
    const grandTotalMatch = pdfText.match(/GRAND[ \t]+TOTAL[ \t:]*([+-]?\d[\d \u00a0\u202f,.]*)/i);
    
    // Extraction des dépôts et paiements du jour
    const depositForDayMatch = pdfText.match(/DEPOSIT[ \t]+FOR[ \t]+THE[ \t]+DAY[ \t:]*([+-]?\d[\d \u00a0\u202f,.]*)/i);
    const paymentForDayMatch = pdfText.match(/PAYMENT[ \t]+FOR[ \t]+THE[ \t]+DAY[ \t:]*([+-]?\d[\d \u00a0\u202f,.]*)/i);

    const totalFundAvailable = totalFundMatch ? parseFinancialInteger(totalFundMatch[1]) : 0;
    const collectionsNotDeposited = collectionsMatch ? parseFinancialInteger(collectionsMatch[1]) : 0;
    const grandTotal = grandTotalMatch ? parseFinancialInteger(grandTotalMatch[1]) : null;
    const depositForDay = depositForDayMatch ? parseFinancialInteger(depositForDayMatch[1]) : 0;
    const paymentForDay = paymentForDayMatch ? parseFinancialInteger(paymentForDayMatch[1]) : 0;
    const detailsResult = extractFundPositionDetails(pdfText);
    const holdResult = extractHoldCollections(pdfText);
    const details = detailsResult.details;
    const errors = validateFundPositionExtraction({
      reportDate,
      grandTotalFound: Boolean(grandTotalMatch),
      grandTotal,
      details,
    });
    errors.push(...detailsResult.errors, ...holdResult.errors);

    if (totalFundMatch && totalFundAvailable === null) errors.push('Total fonds disponibles invalide.');
    if (collectionsMatch && collectionsNotDeposited === null) errors.push('Collections non déposées invalides.');
    if (depositForDayMatch && depositForDay === null) errors.push('Dépôt du jour invalide.');
    if (paymentForDayMatch && paymentForDay === null) errors.push('Paiement du jour invalide.');
    if (errors.length > 0) return { success: false, errors };

    const fundPosition = {
      reportDate: reportDate!,
      totalFundAvailable: totalFundAvailable ?? 0,
      collectionsNotDeposited: collectionsNotDeposited ?? 0,
      grandTotal: grandTotal!,
      depositForDay: depositForDay ?? 0,
      paymentForDay: paymentForDay ?? 0,
      details,
      holdCollections: holdResult.holdCollections,
    };
    
    console.log('💰 Fund Position extraite avec succès:', {
      totalFund: fundPosition.totalFundAvailable,
      collections: fundPosition.collectionsNotDeposited,
      grandTotal: fundPosition.grandTotal,
      bankDetails: fundPosition.details.length,
      holdItems: fundPosition.holdCollections.length
    });
    
    return {
      success: true,
      data: fundPosition as any
    };
  } catch (error) {
    console.error('❌ Erreur extraction Fund Position:', error);
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Erreur extraction Fund Position']
    };
  }
}

// Nouvelle fonction pour extraire les détails par banque
function extractFundPositionDetails(pdfText: string): {
  details: FundPositionDetail[];
  errors: string[];
} {
  const details: FundPositionDetail[] = [];
  const errors: string[] = [];
  
  try {
    // Rechercher la section "Book balance"
    const bookBalanceSection = pdfText.match(/Book\s+balance[\s\S]*?TOTAL\s+FUND\s+AVAILABLE/i);
    
    if (!bookBalanceSection) {
      console.warn('⚠️ Section "Book balance" non trouvée');
      return { details, errors };
    }
    
    // Extraire les lignes de la section
    const lines = bookBalanceSection[0].split('\n');
    
    // Identifier les lignes contenant des données bancaires (ignorer les en-têtes et totaux)
    const bankLines = lines.filter(line => {
      const trimmedLine = line.trim();
      // Exclure les lignes d'en-tête et de total
      return trimmedLine && 
             !trimmedLine.includes('Book balance') && 
             !trimmedLine.includes('TOTAL FUND') &&
             /[A-Za-z]/.test(trimmedLine) && // Contient au moins une lettre (nom de banque)
             /\d/.test(trimmedLine); // Contient au moins un chiffre (montant)
    });
    
    console.log(`📊 ${bankLines.length} lignes de détail bancaire trouvées`);
    
    // Traiter chaque ligne de banque
    for (const line of bankLines) {
      const columns = line.split('\t').map(value => value.trim()).filter(Boolean);
      if (columns.length !== 6) {
        errors.push(`Ligne Fund Position non exploitable: ${line.trim()}`);
        continue;
      }

      const [bankName, balance, fundApplied, netBalance, nonValidatedDeposit, grandBalance] = columns;
      const amounts = [balance, fundApplied, netBalance, nonValidatedDeposit, grandBalance]
        .map(value => parseFinancialInteger(value));
      if (amounts.some(value => value === null)) {
        errors.push(`Montant Fund Position invalide pour ${bankName.trim()}.`);
        continue;
      }

      details.push({
        bankName: bankName.trim(),
        balance: amounts[0]!,
        fundApplied: amounts[1]!,
        netBalance: amounts[2]!,
        nonValidatedDeposit: amounts[3]!,
        grandBalance: amounts[4]!,
      });
    }
    
    console.log(`✅ ${details.length} détails bancaires extraits`);
  } catch (error) {
    console.error('❌ Erreur extraction détails Fund Position:', error);
    errors.push(error instanceof Error ? error.message : 'Erreur extraction détails Fund Position.');
  }
  
  return { details, errors };
}

// Nouvelle fonction pour extraire les collections en attente (HOLD)
function extractHoldCollections(pdfText: string): {
  holdCollections: FundPositionHold[];
  errors: string[];
} {
  const holdCollections: FundPositionHold[] = [];
  const errors: string[] = [];
  
  try {
    // Rechercher la section "HOLD"
    const holdSection = pdfText.match(/HOLD[\s\S]*?Total[ \t]*:?[ \t]*([+-]?\d[\d \t\u00a0\u202f,.]*)/i);
    
    if (!holdSection) {
      console.warn('⚠️ Section "HOLD" non trouvée');
      return { holdCollections, errors };
    }

    if (parseFinancialInteger(holdSection[1]) === null) {
      errors.push('Total de la section HOLD invalide.');
    }
    
    // Extraire les lignes de la section
    const lines = holdSection[0].split('\n');
    
    // Identifier les lignes contenant des données de collection (ignorer les en-têtes et totaux)
    const collectionLines = lines.filter(line => {
      const trimmedLine = line.trim();
      // Exclure les lignes d'en-tête et de total
      return trimmedLine && 
             !trimmedLine.includes('HOLD') && 
             !trimmedLine.includes('DATE') &&
             !trimmedLine.includes('Total') &&
             /\d{2}\/\d{2}\/\d{4}/.test(trimmedLine); // Contient une date au format DD/MM/YYYY
    });
    
    console.log(`📊 ${collectionLines.length} lignes de collections en attente trouvées`);
    
    // Traiter chaque ligne de collection
    for (const line of collectionLines) {
      // Extraire les données avec une regex adaptée au format
      // Format attendu: DATE | n°chèque/Ech | BANQUE Client | Client | facture | Montant | DATE DEPOT/Nbre Jrs
      const collectionMatch = line.match(/(\d{2}\/\d{2}\/\d{4})\s+(\S+)\s+(\S+)\s+([^\|]+?)\s+(\S+)\s+([\d\s,\.]+)\s+(\S+)/);
      
      if (!collectionMatch) {
        errors.push(`Ligne HOLD non exploitable: ${line.trim()}`);
        continue;
      }

      const [_, holdDateRaw, chequeNumber, clientBank, clientName, factureRef, amountRaw, depositDateOrDays] = collectionMatch;
      const holdDate = parseDocumentDate(holdDateRaw);
      const amount = parseFinancialInteger(amountRaw);
      let depositDate: string | undefined;
      let daysRemaining: number | undefined;

      if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(depositDateOrDays)) {
        depositDate = parseDocumentDate(depositDateOrDays) ?? undefined;
        if (!depositDate) errors.push(`Date de dépôt HOLD invalide: ${depositDateOrDays}.`);
      } else if (/^\d+$/.test(depositDateOrDays)) {
        const parsedDays = Number(depositDateOrDays);
        if (Number.isSafeInteger(parsedDays)) daysRemaining = parsedDays;
        else errors.push(`Nombre de jours HOLD invalide: ${depositDateOrDays}.`);
      } else {
        errors.push(`Date de dépôt ou nombre de jours HOLD invalide: ${depositDateOrDays}.`);
      }

      if (!holdDate) errors.push(`Date HOLD invalide: ${holdDateRaw}.`);
      if (amount === null) errors.push(`Montant HOLD invalide pour ${chequeNumber}.`);
      if (!holdDate || amount === null || (!depositDate && daysRemaining === undefined)) continue;

      holdCollections.push({
        holdDate,
        chequeNumber: chequeNumber.trim(),
        clientBank: clientBank.trim(),
        clientName: clientName.trim(),
        factureReference: factureRef.trim(),
        amount,
        depositDate,
        daysRemaining,
      });
    }
    
    console.log(`✅ ${holdCollections.length} collections en attente extraites`);
  } catch (error) {
    console.error('❌ Erreur extraction collections HOLD:', error);
    errors.push(error instanceof Error ? error.message : 'Erreur extraction collections HOLD.');
  }
  
  return { holdCollections, errors };
}

export function extractClientReconciliation(pdfText: string): ExtractionResult {
  void pdfText;
  return {
    success: false,
    errors: ['Client Reconciliation reste bloqué : aucun moteur d’extraction opérationnel.'],
  };
}
