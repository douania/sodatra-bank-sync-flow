import { CollectionReport, DepositNotCleared, Impaye } from '@/types/banking';

export interface MatchResult {
  collection: CollectionReport;
  deposit?: DepositNotCleared;
  impaye?: Impaye;
  confidence: number;
  status: 'perfect' | 'partial' | 'unmatched';
  reasons: string[];
  matchType: 'effet' | 'cheque' | 'generic' | 'none';
}

export class SpecializedMatchingService {
  
  /**
   * Match a collection with the appropriate specialized algorithm based on its type
   */
  matchCollection(
    collection: CollectionReport,
    allDeposits: DepositNotCleared[],
    allImpayes: Impaye[]
  ): MatchResult {
    console.log(`🔍 Rapprochement spécialisé pour ${collection.clientCode} - Type: ${collection.collectionType || 'Non défini'}`);
    
    // Determine which specialized matching algorithm to use
    switch (collection.collectionType) {
      case 'EFFET':
        return this.matchEffet(collection, allDeposits, allImpayes);
      case 'CHEQUE':
        return this.matchCheque(collection, allDeposits, allImpayes);
      default:
        return this.matchGeneric(collection, allDeposits);
    }
  }
  
  /**
   * Specialized matching for EFFET type collections
   * Prioritizes matching by:
   * 1. Date d'échéance vs date de valeur
   * 2. Montant exact
   * 3. Banque
   * 4. Référence facture
   * Also checks for potential impayés
   */
  private matchEffet(
    collection: CollectionReport,
    allDeposits: DepositNotCleared[],
    allImpayes: Impaye[]
  ): MatchResult {
    console.log(`📅 Rapprochement EFFET pour ${collection.clientCode} - Échéance: ${collection.effetEcheanceDate || 'Non définie'}`);
    
    const reasons: string[] = [];
    let bestMatch: DepositNotCleared | undefined;
    let bestImpaye: Impaye | undefined;
    let maxConfidence = 0;
    let matchType: 'effet' | 'cheque' | 'generic' | 'none' = 'none';
    
    // First check if this effet is in the impayés list
    if (collection.effetEcheanceDate) {
      for (const impaye of allImpayes) {
        if (impaye.clientCode === collection.clientCode) {
          // Check if the dates are close (within 3 days)
          const effetDate = new Date(collection.effetEcheanceDate);
          const impayeDate = new Date(impaye.dateEcheance);
          const daysDiff = Math.abs((effetDate.getTime() - impayeDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysDiff <= 3 && Math.abs(collection.collectionAmount - impaye.montant) < 1000) {
            reasons.push('Effet trouvé dans les impayés');
            reasons.push(`Date échéance effet: ${collection.effetEcheanceDate}`);
            reasons.push(`Date échéance impayé: ${impaye.dateEcheance}`);
            reasons.push(`Montant correspondant: ${collection.collectionAmount.toLocaleString()} vs ${impaye.montant.toLocaleString()}`);
            
            bestImpaye = impaye;
            maxConfidence = 0.9; // High confidence but not perfect
            matchType = 'effet';
            
            // No need to check deposits if we found an impayé
            break;
          }
        }
      }
    }
    
    // If no impayé was found, check deposits
    if (!bestImpaye) {
      for (const deposit of allDeposits) {
        let confidence = 0;
        const matchReasons: string[] = [];
        
        // 1. Exact amount match (50 points)
        if (Math.abs(collection.collectionAmount - deposit.montant) < 1) {
          confidence += 50;
          matchReasons.push('Montant exact');
        } else if (Math.abs(collection.collectionAmount - deposit.montant) / collection.collectionAmount < 0.05) {
          confidence += 30;
          matchReasons.push('Montant proche (±5%)');
        }
        
        // 2. Bank match (20 points)
        if (collection.bankName && 
            deposit.typeReglement && 
            deposit.typeReglement.toUpperCase().includes('EFFET')) {
          confidence += 20;
          matchReasons.push('Type règlement: EFFET');
        }
        
        // 3. Date match - for effets, compare with effet_echeance_date (20 points)
        if (collection.effetEcheanceDate && deposit.dateValeur) {
          const effetDate = new Date(collection.effetEcheanceDate);
          const depositDate = new Date(deposit.dateValeur);
          const daysDiff = Math.abs((effetDate.getTime() - depositDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysDiff <= 3) {
            confidence += 20;
            matchReasons.push(`Date échéance proche (${daysDiff} jours d'écart)`);
          } else if (daysDiff <= 7) {
            confidence += 10;
            matchReasons.push(`Date échéance dans la semaine (${daysDiff} jours d'écart)`);
          }
        }
        
        // 4. Client code match (10 points)
        if (collection.clientCode && deposit.clientCode === collection.clientCode) {
          confidence += 10;
          matchReasons.push('Code client correspondant');
        }
        
        // Update best match if this one is better
        if (confidence > maxConfidence) {
          maxConfidence = confidence;
          bestMatch = deposit;
          reasons.length = 0;
          reasons.push(...matchReasons);
          matchType = 'effet';
        }
      }
    }
    
    // Determine match status based on confidence
    let status: 'perfect' | 'partial' | 'unmatched' = 'unmatched';
    if (maxConfidence >= 80) status = 'perfect';
    else if (maxConfidence >= 50) status = 'partial';
    
    return {
      collection,
      deposit: bestMatch,
      impaye: bestImpaye,
      confidence: maxConfidence,
      status,
      reasons,
      matchType
    };
  }
  
  /**
   * Specialized matching for CHEQUE type collections
   * Prioritizes matching by:
   * 1. Numéro de chèque exact
   * 2. Montant exact
   * 3. Banque
   * 4. Date de dépôt proche
   */
  private matchCheque(
    collection: CollectionReport,
    allDeposits: DepositNotCleared[],
    allImpayes: Impaye[]
  ): MatchResult {
    console.log(`🧾 Rapprochement CHÈQUE pour ${collection.clientCode} - Numéro: ${collection.chequeNumber || 'Non défini'}`);
    
    const reasons: string[] = [];
    let bestMatch: DepositNotCleared | undefined;
    let maxConfidence = 0;
    let matchType: 'effet' | 'cheque' | 'generic' | 'none' = 'none';
    
    for (const deposit of allDeposits) {
      let confidence = 0;
      const matchReasons: string[] = [];
      
      // 1. Exact amount match (40 points)
      if (Math.abs(collection.collectionAmount - deposit.montant) < 1) {
        confidence += 40;
        matchReasons.push('Montant exact');
      } else if (Math.abs(collection.collectionAmount - deposit.montant) / collection.collectionAmount < 0.05) {
        confidence += 25;
        matchReasons.push('Montant proche (±5%)');
      }
      
      // 2. Cheque number match in reference (30 points)
      if (collection.chequeNumber && deposit.reference && 
          deposit.reference.includes(collection.chequeNumber)) {
        confidence += 30;
        matchReasons.push(`Numéro de chèque trouvé: ${collection.chequeNumber}`);
      }
      
      // 3. Type reglement is CHEQUE (20 points)
      if (deposit.typeReglement && 
          (deposit.typeReglement.toUpperCase().includes('CHEQUE') || 
           deposit.typeReglement.toUpperCase().includes('CHQ'))) {
        confidence += 20;
        matchReasons.push('Type règlement: CHÈQUE');
      }
      
      // 4. Client code match (10 points)
      if (collection.clientCode && deposit.clientCode === collection.clientCode) {
        confidence += 10;
        matchReasons.push('Code client correspondant');
      }
      
      // Update best match if this one is better
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMatch = deposit;
        reasons.length = 0;
        reasons.push(...matchReasons);
        matchType = 'cheque';
      }
    }
    
    // Determine match status based on confidence
    let status: 'perfect' | 'partial' | 'unmatched' = 'unmatched';
    if (maxConfidence >= 80) status = 'perfect';
    else if (maxConfidence >= 50) status = 'partial';
    
    return {
      collection,
      deposit: bestMatch,
      confidence: maxConfidence,
      status,
      reasons,
      matchType
    };
  }
  
  /**
   * Generic matching for collections without a specific type
   * Uses a balanced approach considering multiple factors
   */
  private matchGeneric(
    collection: CollectionReport,
    allDeposits: DepositNotCleared[]
  ): MatchResult {
    console.log(`🔍 Rapprochement GÉNÉRIQUE pour ${collection.clientCode}`);
    
    const reasons: string[] = [];
    let bestMatch: DepositNotCleared | undefined;
    let maxConfidence = 0;
    
    for (const deposit of allDeposits) {
      let confidence = 0;
      const matchReasons: string[] = [];
      
      // 1. Exact amount match (50 points)
      if (Math.abs(collection.collectionAmount - deposit.montant) < 1) {
        confidence += 50;
        matchReasons.push('Montant exact');
      } else if (Math.abs(collection.collectionAmount - deposit.montant) / collection.collectionAmount < 0.05) {
        confidence += 30;
        matchReasons.push('Montant proche (±5%)');
      }
      
      // 2. Bank match (20 points)
      if (collection.bankName && deposit.typeReglement) {
        confidence += 20;
        matchReasons.push(`Type règlement: ${deposit.typeReglement}`);
      }
      
      // 3. Date match (20 points)
      if (collection.reportDate && deposit.dateValeur) {
        const collectionDate = new Date(collection.reportDate);
        const depositDate = new Date(deposit.dateValeur);
        const daysDiff = Math.abs((collectionDate.getTime() - depositDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 3) {
          confidence += 20;
          matchReasons.push(`Date proche (${daysDiff} jours d'écart)`);
        } else if (daysDiff <= 7) {
          confidence += 10;
          matchReasons.push(`Date dans la semaine (${daysDiff} jours d'écart)`);
        }
      }
      
      // 4. Client code match (10 points)
      if (collection.clientCode && deposit.clientCode === collection.clientCode) {
        confidence += 10;
        matchReasons.push('Code client correspondant');
      }
      
      // Update best match if this one is better
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        bestMatch = deposit;
        reasons.length = 0;
        reasons.push(...matchReasons);
      }
    }
    
    // Determine match status based on confidence
    let status: 'perfect' | 'partial' | 'unmatched' = 'unmatched';
    if (maxConfidence >= 80) status = 'perfect';
    else if (maxConfidence >= 50) status = 'partial';
    
    return {
      collection,
      deposit: bestMatch,
      confidence: maxConfidence,
      status,
      reasons,
      matchType: 'generic'
    };
  }
}

export const specializedMatchingService = new SpecializedMatchingService();